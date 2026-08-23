/**
 * conversations.ts - conversation lifecycle.
 *
 * Compare this against the 0.6.x version to see what encryption cost: key
 * epochs, per-member key wrapping, drift detection, re-issue, orphan
 * recovery, rotation and epoch pruning are all gone. What remains is a
 * member list and a title.
 *
 * Nothing here can put a user into a state they cannot get out of, which is
 * the property the previous design repeatedly failed to hold.
 */

import { hashId, randomId } from "./crypto";
import {
  COLLECTIONS,
  ConversationDoc,
  ConversationKind,
  ConversationSubject,
  ConversationView,
} from "./model";
import { Store } from "./storage";

/**
 * Deterministic id for a direct message, so both participants converge on
 * the same document without coordinating.
 */
export const dmId = (a: string, b: string): string =>
  hashId(`dm|${[a, b].sort().join("|")}`, 16);

export const subjectId = (subject: ConversationSubject): string =>
  hashId(`${subject.type}|${subject.repositoryId ?? ""}|${subject.key}`, 16);

export class Conversations {
  constructor(
    private readonly store: Store,
    private readonly userId: string
  ) {}

  /* -------------------------------------------------------------- */
  /* reading                                                        */
  /* -------------------------------------------------------------- */

  list(): Promise<ConversationDoc[]> {
    return this.store.list<ConversationDoc>(COLLECTIONS.conversations);
  }

  /** Only the conversations the current user is a member of. */
  async mine(): Promise<ConversationDoc[]> {
    const all = await this.list();
    return all
      .filter((c) => c.members.includes(this.userId))
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
  }

  get(id: string): Promise<ConversationDoc | undefined> {
    return this.store.get<ConversationDoc>(COLLECTIONS.conversations, id);
  }

  /* -------------------------------------------------------------- */
  /* creation                                                       */
  /* -------------------------------------------------------------- */

  /** Open the DM with `otherUserId`, creating it on first use. */
  async openDirect(otherUserId: string): Promise<ConversationDoc> {
    const id = dmId(this.userId, otherUserId);
    const existing = await this.get(id);
    if (existing) return existing;
    return this.create(id, "dm", [this.userId, otherUserId]);
  }

  createChannel(title: string, memberIds: string[]): Promise<ConversationDoc> {
    return this.create(randomId(8), "channel", [this.userId, ...memberIds], title);
  }

  /**
   * Channel bound to a work item or a commit. Deterministic id, so "Discuss
   * in Secure Chat" always lands in the same place.
   */
  async openSubject(
    subject: ConversationSubject,
    title: string,
    memberIds: string[]
  ): Promise<ConversationDoc> {
    const id = subjectId(subject);
    const existing = await this.get(id);
    if (existing) {
      if (existing.members.includes(this.userId)) return existing;
      return this.addMembers(id, [this.userId]);
    }
    return this.create(id, subject.type, [this.userId, ...memberIds], title, subject);
  }

  private async create(
    id: string,
    kind: ConversationKind,
    members: string[],
    title?: string,
    subject?: ConversationSubject
  ): Promise<ConversationDoc> {
    const now = new Date().toISOString();
    const doc: ConversationDoc = {
      id,
      kind,
      title,
      members: Array.from(new Set(members)).sort(),
      createdBy: this.userId,
      createdAt: now,
      headPage: 0,
      messageCount: 0,
      lastActivityAt: now,
      subject,
    };
    // Upsert rather than blind create: two people can open the same DM at
    // the same moment, and the deterministic id means they collide.
    const stored = await this.store.mutate<ConversationDoc>(
      COLLECTIONS.conversations,
      id,
      (current) => current ?? doc
    );
    return stored ?? doc;
  }

  /* -------------------------------------------------------------- */
  /* membership                                                     */
  /* -------------------------------------------------------------- */

  addMembers(convId: string, newMembers: string[]): Promise<ConversationDoc> {
    return this.editMembers(convId, (members) =>
      Array.from(new Set([...members, ...newMembers])).sort()
    );
  }

  removeMembers(convId: string, drop: string[]): Promise<ConversationDoc> {
    return this.editMembers(convId, (members) =>
      members.filter((m) => !drop.includes(m)).sort()
    );
  }

  private async editMembers(
    convId: string,
    next: (current: string[]) => string[]
  ): Promise<ConversationDoc> {
    const updated = await this.store.mutate<ConversationDoc>(
      COLLECTIONS.conversations,
      convId,
      (current) => {
        if (!current) throw new Error("Conversation not found.");
        return {
          ...current,
          members: next(current.members),
          lastActivityAt: new Date().toISOString(),
        };
      }
    );
    if (!updated) throw new Error("Conversation not found.");
    return updated;
  }

  async rename(convId: string, title: string): Promise<void> {
    await this.store.mutate<ConversationDoc>(COLLECTIONS.conversations, convId, (current) =>
      current ? { ...current, title } : null
    );
  }

  /** Remove the conversation document itself. Pages are the caller's job. */
  async removeDocument(convId: string): Promise<void> {
    await this.store.remove(COLLECTIONS.conversations, convId);
  }

  /* -------------------------------------------------------------- */
  /* presentation                                                   */
  /* -------------------------------------------------------------- */

  toView(
    conv: ConversationDoc,
    unread: number,
    nameOf: (userId: string) => string
  ): ConversationView {
    let title: string;
    if (conv.kind === "dm") {
      const other = conv.members.find((m) => m !== this.userId);
      title = other ? nameOf(other) : "Direct message";
    } else if (conv.title) {
      title = conv.title;
    } else {
      title = conv.subject ? `${conv.subject.type} ${conv.subject.key}` : "Channel";
    }

    return {
      id: conv.id,
      kind: conv.kind,
      title,
      members: conv.members,
      unread,
      lastActivityAt: conv.lastActivityAt,
      lastSenderId: conv.lastSenderId,
      subject: conv.subject,
    };
  }
}
