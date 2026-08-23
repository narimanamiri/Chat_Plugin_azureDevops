/**
 * notifications.ts - unread tracking and the polling loop.
 *
 * Azure DevOps offers extensions no push channel and no websocket, so new
 * messages are discovered by polling the conversation documents. That is one
 * cheap request per cycle: conversation documents carry `messageCount` and
 * `lastMessageId` in the clear, so unread counts are computed without
 * decrypting anything. The widget therefore works even when the user's keys
 * are locked.
 *
 * Polling backs off hard when the tab is hidden, which matters because every
 * open Azure DevOps tab runs its own copy of this loop.
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
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1))
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
    delete doc.cursors[convId];
    await this.store.put(COLLECTIONS.readState, doc, "user");
  }

  /** Mark everything up to the conversation's current count as read. */
  async markRead(conv: ConversationDoc): Promise<void> {
    const doc = await this.load();
    doc.cursors[conv.id] = {
      lastReadMessageId: conv.lastMessageId ?? "",
      lastReadAt: new Date().toISOString(),
      count: conv.messageCount,
    };
    await this.store.put(COLLECTIONS.readState, doc, "user");
  }
}

/* ------------------------------------------------------------------ */
/* poller                                                              */
/* ------------------------------------------------------------------ */

export interface PollerOptions {
  /** Base interval while the tab is visible. */
  activeSeconds: number;
  /** Interval while the tab is hidden. */
  idleSeconds: number;
  onTick: (conversations: ConversationDoc[]) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

export class Poller {
  private timer?: number;
  private stopped = false;
  private consecutiveErrors = 0;

  constructor(private readonly store: Store, private readonly options: PollerOptions) {}

  start(): void {
    this.stopped = false;
    void this.cycle();
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** Force an immediate refresh, e.g. right after sending a message. */
  kick(): void {
    if (this.timer) window.clearTimeout(this.timer);
    void this.cycle();
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
        this.timer = window.setTimeout(() => void this.cycle(), this.intervalMs);
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
 * Message bodies are end to end encrypted, and the point of that is defeated
 * if the plaintext is handed to the operating system's notification centre.
 * So the toast names the sender and the conversation and nothing else.
 */
export function notifyNewMessages(senderName: string, conversationTitle: string, count: number): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const body =
    count === 1
      ? `${senderName} sent a message`
      : `${senderName} and others sent ${count} messages`;
  try {
    new Notification(conversationTitle, { body, tag: conversationTitle, silent: false });
  } catch {
    /* some browsers reject notifications from inside an iframe */
  }
}
