/**
 * notifications.ts - unread tracking and the polling loop.
 *
 * Azure DevOps offers extensions no push channel and no websocket, so new
 * messages are discovered by polling. There are two cadences, because the
 * two things we poll for have very different costs:
 *
 *   fast tick  - the ONE conversation document the user is looking at.
 *                A single getDocument, so it can run every few seconds.
 *                This is what makes an open conversation feel live, and it
 *                also carries the typing indicator.
 *
 *   slow tick  - every conversation document in the collection, for the
 *                sidebar and the unread badge. The data service has no
 *                query language, so this is a whole-collection read; it is
 *                bounded by conversation count, not history length, but it
 *                is still the expensive call and must not run every five
 *                seconds.
 *
 * Before 0.10.0 there was only the expensive cadence, running every twelve
 * seconds in every open Azure DevOps tab.
 */

import { COLLECTIONS, ConversationDoc, ReadStateDoc } from "./model";
import { Store } from "./storage";

const READ_STATE_DOC_ID = "cursors";

export interface UnreadSummary {
  total: number;
  perConversation: Record<string, number>;
  /** Conversations with unread messages, most recent first. */
  active: { convId: string; count: number; lastSenderId?: string; lastActivityAt: string }[];
}

export class ReadState {
  private doc?: ReadStateDoc;

  constructor(private readonly store: Store) {}

  private async load(): Promise<ReadStateDoc> {
    if (!this.doc) {
      this.doc =
        (await this.store.get<ReadStateDoc>(COLLECTIONS.readState, READ_STATE_DOC_ID, "user")) ??
        ({ id: READ_STATE_DOC_ID, cursors: {} } as ReadStateDoc);
    }
    return this.doc;
  }

  async summarise(conversations: ConversationDoc[], myUserId: string): Promise<UnreadSummary> {
    const doc = await this.load();
    const perConversation: Record<string, number> = {};
    let total = 0;

    for (const conv of conversations) {
      const seen = doc.cursors[conv.id]?.count ?? 0;
      // Sending into a conversation counts as reading it - otherwise your own
      // messages show up as unread in every other tab you have open.
      const effective =
        conv.lastSenderId === myUserId ? 0 : Math.max(0, conv.messageCount - seen);
      perConversation[conv.id] = effective;
      total += effective;
    }

    const active = conversations
      .filter((c) => perConversation[c.id] > 0)
      .sort((a, b) =>
        a.lastActivityAt === b.lastActivityAt
          ? a.id.localeCompare(b.id)
          : a.lastActivityAt < b.lastActivityAt
            ? 1
            : -1
      )
      .map((c) => ({
        convId: c.id,
        count: perConversation[c.id],
        lastSenderId: c.lastSenderId,
        lastActivityAt: c.lastActivityAt,
      }));

    return { total, perConversation, active };
  }

  /** Drop the cursor for a conversation that no longer exists. */
  async forget(convId: string): Promise<void> {
    const doc = await this.load();
    if (!(convId in doc.cursors)) return;
    this.doc = await this.write((base) => {
      if (!(convId in base.cursors)) return null;
      const cursors = { ...base.cursors };
      delete cursors[convId];
      return { ...base, cursors };
    });
  }

  /**
   * Mark everything up to the conversation's current count as read.
   *
   * Returns how many messages were unread beforehand, which the UI uses to
   * place its unread divider.
   *
   * Two things matter here, both learned the hard way:
   *
   *  - it writes ONLY when the cursor actually moves. The open conversation
   *    is re-read on every tick, and writing unconditionally meant one
   *    server write every few seconds per open tab, forever, for no change.
   *
   *  - it writes through mutate, not put. The cached document holds the
   *    __etag from the read that produced it, and put does not refresh it,
   *    so the second write of a session failed with HTTP 409 - which
   *    surfaced as an error when switching between two conversations.
   *    mutate re-reads before writing, which also merges cursors across
   *    tabs instead of clobbering them.
   */
  async markRead(conv: ConversationDoc): Promise<number> {
    const doc = await this.load();
    const previous = doc.cursors[conv.id]?.count ?? 0;
    if (previous >= conv.messageCount) return 0;

    const entry = {
      lastReadMessageId: conv.lastMessageId ?? "",
      lastReadAt: new Date().toISOString(),
      count: conv.messageCount,
    };
    this.doc = await this.write((base) => {
      const seen = base.cursors[conv.id]?.count ?? 0;
      if (seen >= conv.messageCount) return null;
      return { ...base, cursors: { ...base.cursors, [conv.id]: entry } };
    });
    return Math.max(0, conv.messageCount - previous);
  }

  private async write(
    change: (base: ReadStateDoc) => ReadStateDoc | null
  ): Promise<ReadStateDoc> {
    const saved = await this.store.mutate<ReadStateDoc>(
      COLLECTIONS.readState,
      READ_STATE_DOC_ID,
      (existing) => change(existing ?? ({ id: READ_STATE_DOC_ID, cursors: {} } as ReadStateDoc)),
      "user"
    );
    // mutate hands back the stored document, carrying the etag the next
    // write has to present. Caching anything else reintroduces the 409.
    if (saved) return saved;
    this.doc = undefined;
    return this.load();
  }
}

/* ------------------------------------------------------------------ */
/* poller                                                              */
/* ------------------------------------------------------------------ */

export interface PollerOptions {
  /** Full-list interval while the tab is visible. */
  activeSeconds: number;
  /** Full-list interval while the tab is hidden. */
  idleSeconds: number;
  /** Single-document interval for the conversation on screen. */
  focusSeconds: number;
  /** Which conversation is on screen, read fresh on every fast tick. */
  focusId: () => string | undefined;
  onTick: (conversations: ConversationDoc[]) => void | Promise<void>;
  onFocusTick?: (conv: ConversationDoc) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

export class Poller {
  private slowTimer?: number;
  private fastTimer?: number;
  private stopped = false;
  private consecutiveErrors = 0;
  /** messageCount plus typing state last seen for the focused document. */
  private focusFingerprint = "";

  constructor(private readonly store: Store, private readonly options: PollerOptions) {}

  start(): void {
    this.stopped = false;
    void this.cycle();
    void this.focusCycle();
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(): void {
    this.stopped = true;
    if (this.slowTimer) window.clearTimeout(this.slowTimer);
    if (this.fastTimer) window.clearTimeout(this.fastTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** Force an immediate refresh of both cadences, e.g. right after sending. */
  kick(): void {
    this.focusFingerprint = "";
    if (this.slowTimer) window.clearTimeout(this.slowTimer);
    if (this.fastTimer) window.clearTimeout(this.fastTimer);
    void this.cycle();
    void this.focusCycle();
  }

  /** Forget the focus fingerprint so the next fast tick reports regardless. */
  resetFocus(): void {
    this.focusFingerprint = "";
  }

  private onVisibility = () => {
    if (!document.hidden) this.kick();
  };

  private get intervalMs(): number {
    const base = document.hidden ? this.options.idleSeconds : this.options.activeSeconds;
    // Back off on repeated failures so a broken server is not hammered.
    const penalty = Math.min(8, 2 ** this.consecutiveErrors);
    return base * 1000 * penalty;
  }

  private async cycle(): Promise<void> {
    if (this.stopped) return;
    try {
      const conversations = await this.store.list<ConversationDoc>(COLLECTIONS.conversations);
      this.consecutiveErrors = 0;
      await this.options.onTick(conversations);
    } catch (err) {
      this.consecutiveErrors++;
      this.options.onError?.(err);
    } finally {
      if (!this.stopped) {
        this.slowTimer = window.setTimeout(() => void this.cycle(), this.intervalMs);
      }
    }
  }

  /**
   * The cheap loop. One document, and the callback only fires when something
   * in it actually changed - so an idle conversation costs one small read
   * and no re-render.
   */
  private async focusCycle(): Promise<void> {
    if (this.stopped) return;
    try {
      const id = this.options.focusId();
      if (id && !document.hidden) {
        const conv = await this.store.get<ConversationDoc>(COLLECTIONS.conversations, id);
        if (conv) {
          const fingerprint = [
            conv.id,
            conv.messageCount,
            conv.lastMessageId ?? "",
            JSON.stringify(conv.typing ?? {}),
          ].join("|");
          if (fingerprint !== this.focusFingerprint) {
            this.focusFingerprint = fingerprint;
            await this.options.onFocusTick?.(conv);
          }
        }
      }
    } catch (err) {
      this.options.onError?.(err);
    } finally {
      if (!this.stopped) {
        this.fastTimer = window.setTimeout(
          () => void this.focusCycle(),
          Math.max(2000, this.options.focusSeconds * 1000)
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* desktop notifications                                               */
/* ------------------------------------------------------------------ */

export async function requestDesktopPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

/**
 * The toast names the sender and the conversation, never the message text.
 *
 * Message bodies are no longer encrypted, but a desktop notification is
 * rendered by the operating system on a possibly shared screen - which is a
 * different exposure from a chat window the reader chose to open.
 *
 * The tag is the conversation id rather than its title: two conversations
 * with the same title would otherwise replace each other's toasts.
 */
export function notifyNewMessages(
  senderName: string,
  conversationTitle: string,
  count: number,
  convId?: string
): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const body =
    count === 1
      ? `${senderName} sent a message`
      : `${senderName} and others sent ${count} messages`;
  try {
    new Notification(conversationTitle, { body, tag: convId ?? conversationTitle, silent: false });
  } catch {
    /* some browsers reject notifications from inside an iframe */
  }
}
