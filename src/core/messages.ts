/**
 * messages.ts - append and read messages.
 *
 * The storage layout is unchanged from the encrypted design: messages are
 * packed into page documents of PAGE_SIZE entries, so a poll costs one
 * conversation document plus one page regardless of history length. What
 * changed in 0.7.0 is that bodies are stored as plaintext.
 *
 * Append is a two-step, non-atomic operation:
 *   1. reserve a slot by incrementing `messageCount` on the conversation
 *      (optimistic concurrency gives every sender a distinct index)
 *   2. write the body into the page that index falls in
 *
 * A failure between the two leaves an empty slot; readers skip gaps.
 */

import { randomId } from "./crypto";
import {
  AttachmentManifest,
  COLLECTIONS,
  ConversationDoc,
  DecryptedMessage,
  MessageBody,
  PAGE_SIZE,
  PageDoc,
  StoredMessage,
} from "./model";
import { Conversations } from "./conversations";
import { Store } from "./storage";

const pageDocId = (convId: string, page: number) => `${convId}_${String(page).padStart(5, "0")}`;

/** Time-ordered, collision-resistant, 16 characters. */
function newMessageId(): string {
  return `${Date.now().toString(36).padStart(9, "0")}-${randomId(3)}`;
}

export interface SendOptions {
  replyToId?: string;
}

/** One short line summarising a message, for the conversation list. */
function previewOf(body: MessageBody): string {
  const text = body.text?.trim();
  if (text) return text.replace(/\s+/g, " ").slice(0, 120);
  const attachments = body.attachments ?? [];
  if (attachments.length === 1) return `📎 ${attachments[0].name}`;
  if (attachments.length > 1) return `📎 ${attachments.length} files`;
  return "";
}

export class Messages {
  constructor(
    private readonly store: Store,
    private readonly conversations: Conversations,
    private readonly userId: string,
    /**
     * Resolves a display name from every source the client knows about,
     * including our own. Names are never captured at send time - they are
     * looked up on every render, so a name learned late still appears.
     */
    private readonly resolveName: (userId: string) => string
  ) {}

  /* -------------------------------------------------------------- */
  /* sending                                                        */
  /* -------------------------------------------------------------- */

  async send(
    convId: string,
    body: MessageBody,
    options: SendOptions = {}
  ): Promise<DecryptedMessage> {
    const conv = await this.conversations.get(convId);
    if (!conv) throw new Error("Conversation not found.");
    if (!conv.members.includes(this.userId)) {
      throw new Error("You are not a member of this conversation.");
    }

    const id = newMessageId();
    const sentAt = new Date().toISOString();
    const payload: MessageBody = { ...body, replyToId: options.replyToId ?? body.replyToId };
    let stored: StoredMessage = { id, senderId: this.userId, sentAt, body: payload };

    // 1. reserve the slot
    const reserved = await this.store.mutate<ConversationDoc>(
      COLLECTIONS.conversations,
      convId,
      (current) => {
        if (!current) throw new Error("Conversation not found.");
        const index = current.messageCount;
        return {
          ...current,
          messageCount: index + 1,
          headPage: Math.floor(index / PAGE_SIZE),
          lastActivityAt: sentAt,
          lastMessageId: id,
          lastSenderId: this.userId,
          lastPreview: previewOf(payload),
        };
      }
    );
    if (!reserved) throw new Error("Conversation vanished while sending.");
    const seq = reserved.messageCount - 1;
    stored = { ...stored, seq };
    const page = Math.floor(seq / PAGE_SIZE);

    // 2. write the body
    await this.store.mutate<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page), (current) => {
      const doc: PageDoc = current ?? { id: pageDocId(convId, page), convId, page, items: [] };
      if (doc.items.some((m) => m.id === id)) return null;
      return { ...doc, items: [...doc.items, stored] };
    });

    return {
      id,
      senderId: this.userId,
      senderName: this.resolveName(this.userId),
      sentAt,
      seq,
      body: payload,
    };
  }

  /* -------------------------------------------------------------- */
  /* reading                                                        */
  /* -------------------------------------------------------------- */

  /**
   * The most recent `limit` messages, walking pages back from the head.
   *
   * `known` lets a caller that already holds the conversation document pass
   * it in. Without it, one read from the UI fetched the same document three
   * times: once in the client to resolve names, once here, and once in
   * `window` to learn the total.
   */
  async recent(
    convId: string,
    limit = PAGE_SIZE * 2,
    known?: ConversationDoc
  ): Promise<DecryptedMessage[]> {
    const conv = known ?? (await this.conversations.get(convId));
    if (!conv) return [];

    const head = Math.floor(Math.max(0, conv.messageCount - 1) / PAGE_SIZE);
    const collected: StoredMessage[] = [];
    for (let page = head; page >= 0 && collected.length < limit; page--) {
      const doc = await this.store.get<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page));
      if (!doc) continue;
      collected.unshift(...doc.items);
    }
    return this.present(collected.slice(-limit));
  }

  /**
   * The same read as `recent`, plus the conversation's real message count.
   *
   * The UI needs the total to decide whether a "load earlier" affordance
   * should exist. Inferring it from "the page came back full" was wrong at
   * the boundary: a conversation holding exactly `limit` messages offered a
   * button that loaded nothing.
   */
  async window(
    convId: string,
    limit = PAGE_SIZE * 2,
    known?: ConversationDoc
  ): Promise<{ items: DecryptedMessage[]; total: number }> {
    const conv = known ?? (await this.conversations.get(convId));
    if (!conv) return { items: [], total: 0 };
    return { items: await this.recent(convId, limit, conv), total: conv.messageCount };
  }

  /**
   * Substring search within one conversation, newest first.
   *
   * The data service has no query language, so this reads page documents
   * backwards from the head. `pageBudget` caps how far back one call will
   * go; the caller spends its total budget across conversations so a search
   * cannot turn into an unbounded crawl of the whole collection.
   */
  async search(
    convId: string,
    needle: string,
    pageBudget: number
  ): Promise<{ hits: DecryptedMessage[]; pagesRead: number }> {
    const conv = await this.conversations.get(convId);
    if (!conv || conv.messageCount === 0) return { hits: [], pagesRead: 0 };

    const lowered = needle.toLowerCase();
    const head = Math.floor(Math.max(0, conv.messageCount - 1) / PAGE_SIZE);
    const found: StoredMessage[] = [];
    let pagesRead = 0;

    for (let page = head; page >= 0 && pagesRead < pageBudget; page--) {
      const doc = await this.store.get<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page));
      pagesRead++;
      if (!doc) continue;
      for (const item of doc.items) {
        if (item.deleted) continue;
        const text = item.body?.text ?? "";
        const names = (item.body?.attachments ?? []).map((a) => a.name).join(" ");
        if (
          text.toLowerCase().includes(lowered) ||
          names.toLowerCase().includes(lowered)
        ) {
          found.push(item);
        }
      }
    }

    // present() sorts oldest first; a search reads better newest first.
    return { hits: this.present(found).reverse(), pagesRead };
  }

  /** One page by index, oldest first. Used when scrolling back. */
  async page(convId: string, page: number): Promise<DecryptedMessage[]> {
    const doc = await this.store.get<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page));
    return doc ? this.present(doc.items) : [];
  }

  /**
   * Names are resolved at render time, never stored with the message: the
   * directory loads asynchronously, and freezing a name into a cached entry
   * used to leave raw identity ids on screen permanently.
   */
  private present(items: StoredMessage[]): DecryptedMessage[] {
    return items
      .map((item) => ({
        id: item.id,
        senderId: item.senderId,
        senderName: this.resolveName(item.senderId),
        sentAt: item.sentAt,
        seq: item.seq,
        body: item.deleted ? { text: "" } : item.body,
        deleted: item.deleted,
        reactions: item.reactions,
      }))
      .sort((a, b) => {
        // Reservation order first: it is the only total order every reader
        // agrees on. Timestamps are a fallback for anything written before
        // `seq` existed.
        if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
        if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? -1 : 1;
        return a.id.localeCompare(b.id);
      });
  }

  /* -------------------------------------------------------------- */
  /* editing and deletion                                           */
  /* -------------------------------------------------------------- */

  /** Replace the body in place. Only the original sender may do this. */
  async edit(convId: string, messageId: string, body: MessageBody): Promise<void> {
    const page = await this.findPage(convId, messageId);
    if (page === undefined) throw new Error("Message not found.");

    await this.store.mutate<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page), (current) => {
      if (!current) return null;
      const index = current.items.findIndex((m) => m.id === messageId);
      if (index < 0) return null;
      const original = current.items[index];
      if (original.senderId !== this.userId) {
        throw new Error("Only the author can edit a message.");
      }
      const items = [...current.items];
      items[index] = { ...original, body: { ...body, editedAt: new Date().toISOString() } };
      return { ...current, items };
    });
  }

  /**
   * Add or remove one reaction of ours. Returns the resulting set.
   *
   * Anyone in the conversation may react to anyone's message, so unlike
   * edit and delete there is no author check - but a client can only ever
   * add or remove ITS OWN id, which is enforced here rather than trusted
   * from the caller.
   */
  async react(
    convId: string,
    messageId: string,
    emoji: string
  ): Promise<Record<string, string[]>> {
    const page = await this.findPage(convId, messageId);
    if (page === undefined) throw new Error("Message not found.");

    let result: Record<string, string[]> = {};
    await this.store.mutate<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page), (current) => {
      if (!current) return null;
      const index = current.items.findIndex((m) => m.id === messageId);
      if (index < 0) return null;
      const original = current.items[index];
      if (original.deleted) return null;

      const reactions: Record<string, string[]> = {};
      for (const [key, users] of Object.entries(original.reactions ?? {})) {
        reactions[key] = [...users];
      }
      const mine = reactions[emoji] ?? [];
      if (mine.includes(this.userId)) {
        const left = mine.filter((u) => u !== this.userId);
        if (left.length) reactions[emoji] = left;
        else delete reactions[emoji];
      } else {
        reactions[emoji] = [...mine, this.userId];
      }

      result = reactions;
      const items = [...current.items];
      items[index] = Object.keys(reactions).length
        ? { ...original, reactions }
        : { ...original, reactions: undefined };
      return { ...current, items };
    });
    return result;
  }

  /**
   * Delete for everyone. The body is removed from the page document, so this
   * is a real deletion on the server rather than a client-side hide. The slot
   * is kept as a tombstone to preserve ordering.
   */
  async remove(convId: string, messageId: string): Promise<void> {
    const page = await this.findPage(convId, messageId);
    if (page === undefined) throw new Error("Message not found.");

    await this.store.mutate<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page), (current) => {
      if (!current) return null;
      const index = current.items.findIndex((m) => m.id === messageId);
      if (index < 0) return null;
      const original = current.items[index];
      if (original.senderId !== this.userId) {
        throw new Error("Only the author can delete a message.");
      }
      const items = [...current.items];
      items[index] = {
        id: original.id,
        senderId: original.senderId,
        seq: original.seq,
        sentAt: original.sentAt,
        body: { text: "" },
        deleted: true,
      };
      return { ...current, items };
    });
  }

  /* -------------------------------------------------------------- */
  /* bulk operations                                                */
  /* -------------------------------------------------------------- */

  /** Every attachment manifest in a conversation, for deletion purposes. */
  async allAttachments(convId: string): Promise<AttachmentManifest[]> {
    const conv = await this.conversations.get(convId);
    if (!conv) return [];
    const out: AttachmentManifest[] = [];
    const pages = Math.floor(Math.max(0, conv.messageCount - 1) / PAGE_SIZE);
    for (let page = 0; page <= pages; page++) {
      const doc = await this.store.get<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page));
      if (!doc) continue;
      for (const item of doc.items) {
        for (const attachment of item.body?.attachments ?? []) out.push(attachment);
      }
    }
    return out;
  }

  /** Remove every page document of a conversation. */
  async purgePages(convId: string, messageCount: number): Promise<number> {
    const pages = Math.floor(Math.max(0, messageCount - 1) / PAGE_SIZE);
    for (let page = 0; page <= pages; page++) {
      await this.store.remove(COLLECTIONS.pages, pageDocId(convId, page));
    }
    return pages + 1;
  }

  private async findPage(convId: string, messageId: string): Promise<number | undefined> {
    const conv = await this.conversations.get(convId);
    if (!conv) return undefined;
    const head = Math.floor(Math.max(0, conv.messageCount - 1) / PAGE_SIZE);
    for (let page = head; page >= 0; page--) {
      const doc = await this.store.get<PageDoc>(COLLECTIONS.pages, pageDocId(convId, page));
      if (doc?.items.some((m) => m.id === messageId)) return page;
    }
    return undefined;
  }
}

export { pageDocId, newMessageId };
