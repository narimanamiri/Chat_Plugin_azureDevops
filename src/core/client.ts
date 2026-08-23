/**
 * client.ts - the facade the UI talks to.
 *
 * 0.7.0 removed the key system entirely. There is no identity to mint, no
 * bundle to publish, no key to wrap, re-issue, rotate or recover. Startup is
 * therefore: read who you are from the SDK, and go.
 *
 * The failure mode that dominated 0.2 through 0.6 - a member holding a key
 * that no longer opens anything, with recovery depending on somebody else
 * being online - cannot occur, because no such key exists.
 */

import * as SDK from "azure-devops-extension-sdk";

import { Conversations } from "./conversations";
import { Files } from "./files";
import { Messages } from "./messages";
import { Poller, ReadState, UnreadSummary } from "./notifications";
import { Store, getStore } from "./storage";
import {
  collectionMembers,
  directorySnapshot,
  looksLikeIdentityId,
  primeDirectory,
  searchPeople,
  withTimeout,
  type DirectoryResult,
} from "./devops";
import {
  AttachmentManifest,
  COLLECTIONS,
  ConversationDoc,
  ConversationSubject,
  ConversationView,
  DecryptedMessage,
  MessageBody,
  NAMESPACE,
  ProfileDoc,
} from "./model";

/** Kept in step with the manifest so a support dump names the build. */
export const EXTENSION_VERSION = "0.7.1";

/** Ceiling for conversation creation, which is a couple of dependent writes. */
const CONVERSATION_TIMEOUT_MS = 30_000;

export interface ChatClientOptions {
  activeSeconds?: number;
  idleSeconds?: number;
}

export interface Person {
  userId: string;
  displayName: string;
}

export class ChatClient {
  readonly store: Store;
  readonly readState: ReadState;
  readonly files: Files;

  private conversations!: Conversations;
  private messages!: Messages;
  private poller?: Poller;
  private names = new Map<string, string>();
  private directory?: DirectoryResult;
  private ready = false;
  private warmPromise?: Promise<void>;

  private user = { id: "", displayName: "" };

  private constructor(store: Store) {
    this.store = store;
    this.readState = new ReadState(store);
    this.files = new Files(store);
  }

  static async create(): Promise<ChatClient> {
    return new ChatClient(await getStore());
  }

  get me(): { userId: string; displayName: string } {
    return { userId: this.user.id, displayName: this.user.displayName };
  }

  /* -------------------------------------------------------------- */
  /* startup                                                        */
  /* -------------------------------------------------------------- */

  async init(): Promise<void> {
    const sdkUser = SDK.getUser();
    // `displayName` is not always populated - some Azure DevOps Server
    // frames hand back a user context with only an id. Falling back to the
    // id is fine for rendering, but it must never be treated as a real name
    // (see publishProfile).
    const claimed = sdkUser.displayName || sdkUser.name || "";
    this.user = {
      id: sdkUser.id,
      displayName: looksLikeIdentityId(claimed) ? sdkUser.id : claimed,
    };
    if (!looksLikeIdentityId(this.user.displayName)) {
      this.names.set(this.user.id, this.user.displayName);
    }

    this.conversations = new Conversations(this.store, this.user.id);
    this.messages = new Messages(this.store, this.conversations, this.user.id, this.nameOf);
    this.ready = true;

    this.warmPromise = this.warmUp();
  }

  /** Resolves when background startup has finished. Tests use this. */
  whenWarm(): Promise<void> {
    return this.warmPromise ?? Promise.resolve();
  }

  /**
   * Background startup. Never awaited by `init`, and every step guarded: a
   * failure here degrades naming, not the ability to chat.
   */
  private async warmUp(): Promise<void> {
    try {
      await this.publishProfile();
    } catch (err) {
      console.warn("[secure-chat] could not publish profile", err);
    }
    primeDirectory();
    try {
      await this.loadProfiles();
    } catch (err) {
      console.warn("[secure-chat] could not load profiles", err);
    }

    // Once the directory arrives we may finally know our own real name.
    // Publish it then, and repair a profile previously written with an id.
    void collectionMembers()
      .then(() => this.publishProfile())
      .catch((err) => console.warn("[secure-chat] profile repair failed", err));
  }

  /**
   * Our own display name, from the best source currently available.
   *
   * Returns undefined rather than an id when nothing usable is known, so
   * callers can decline to persist a placeholder.
   */
  private bestOwnName(): string | undefined {
    if (!looksLikeIdentityId(this.user.displayName)) return this.user.displayName;
    const fromDirectory = directorySnapshot().people.find((p) => p.id === this.user.id);
    if (fromDirectory && !looksLikeIdentityId(fromDirectory.displayName)) {
      this.user.displayName = fromDirectory.displayName;
      this.names.set(this.user.id, fromDirectory.displayName);
      return fromDirectory.displayName;
    }
    return undefined;
  }

  /**
   * Record this user's display name so others can render it without waiting
   * on the REST directory, which is slow and sometimes unavailable.
   *
   * This is the whole of what replaced the keyring. It holds no secrets, so
   * it cannot go stale in a way that locks anybody out.
   */
  private async publishProfile(): Promise<void> {
    const name = this.bestOwnName();
    if (!name) {
      // Nothing usable to publish. Writing the id here is what made SIDs
      // stick: once stored, every client reads it back as the person's name
      // forever. Better to publish nothing and try again once the directory
      // has loaded.
      console.warn("[secure-chat] display name unknown; not publishing a profile yet");
      return;
    }

    const existing = await this.store.get<ProfileDoc>(COLLECTIONS.profiles, this.user.id);
    if (
      existing &&
      existing.displayName === name &&
      existing.appVersion === EXTENSION_VERSION
    ) {
      return;
    }
    await this.store.put<ProfileDoc>(COLLECTIONS.profiles, {
      id: this.user.id,
      userId: this.user.id,
      displayName: name,
      appVersion: EXTENSION_VERSION,
      namespace: NAMESPACE,
      updatedAt: new Date().toISOString(),
    });
  }

  private async loadProfiles(): Promise<ProfileDoc[]> {
    const profiles = await this.store.list<ProfileDoc>(COLLECTIONS.profiles);
    for (const profile of profiles) {
      // A profile written by an older build may carry an id as its name.
      // Ignore it so the directory gets a chance to supply a real one.
      if (looksLikeIdentityId(profile.displayName)) continue;
      this.names.set(profile.userId, profile.displayName);
    }
    return profiles;
  }

  private requireReady(): { conv: Conversations; msg: Messages } {
    if (!this.ready) throw new Error("Secure Chat is still starting.");
    return { conv: this.conversations, msg: this.messages };
  }

  /* -------------------------------------------------------------- */
  /* directory                                                      */
  /* -------------------------------------------------------------- */

  /**
   * Everyone chat can talk to. Names come from three places, cheapest first:
   * profiles published by the extension, the background directory crawl, and
   * live identity search in the picker.
   */
  async people(force = false): Promise<Person[]> {
    if (force) primeDirectory(true);
    const byId = new Map<string, Person>();

    try {
      for (const profile of await this.loadProfiles()) {
        byId.set(profile.userId, {
          userId: profile.userId,
          displayName: profile.displayName,
        });
      }
    } catch {
      /* profiles are an optimisation, not a requirement */
    }

    const directory = force ? await collectionMembers(false) : directorySnapshot();
    this.directory = directory;
    for (const member of directory.people) {
      if (looksLikeIdentityId(member.displayName)) continue;
      byId.set(member.id, { userId: member.id, displayName: member.displayName });
      this.names.set(member.id, member.displayName);
    }

    return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  get directoryStatus(): DirectoryResult | undefined {
    return this.directory;
  }

  /** Live people search through the host's own identity picker service. */
  async search(query: string): Promise<Person[]> {
    const found = await searchPeople(query);
    const out: Person[] = [];
    for (const entry of found) {
      if (entry.id === this.user.id) continue;
      this.names.set(entry.id, entry.displayName);
      out.push({ userId: entry.id, displayName: entry.displayName });
    }
    return out;
  }

  /**
   * Resolve a display name, falling through every source before giving up
   * and showing a raw id - which on a real server is a SID or GUID.
   */
  nameOf = (userId: string): string => {
    const known = this.names.get(userId);
    if (known && !looksLikeIdentityId(known)) return known;

    const fromDirectory = directorySnapshot().people.find((p) => p.id === userId);
    if (fromDirectory && !looksLikeIdentityId(fromDirectory.displayName)) {
      // Only real names are cached. Caching an id would freeze it in place
      // and defeat the retry on the next render.
      this.names.set(userId, fromDirectory.displayName);
      return fromDirectory.displayName;
    }
    return known ?? userId;
  };

  /* -------------------------------------------------------------- */
  /* conversations                                                  */
  /* -------------------------------------------------------------- */

  async listConversations(): Promise<{ views: ConversationView[]; unread: UnreadSummary }> {
    const { conv } = this.requireReady();
    const docs = await conv.mine();

    // Fill any unknown participant names before rendering, so the list never
    // shows raw identity ids while background warm-up is still in flight.
    if (docs.some((d) => d.members.some((m) => !this.names.has(m)))) {
      try {
        await this.loadProfiles();
      } catch {
        /* fall back to raw ids rather than failing the render */
      }
    }


    const unread = await this.readState.summarise(docs, this.user.id);
    const views = docs.map((d) => conv.toView(d, unread.perConversation[d.id] ?? 0, this.nameOf));
    return { views, unread };
  }

  openDirect(userId: string): Promise<ConversationDoc> {
    return withTimeout(
      this.requireReady().conv.openDirect(userId),
      CONVERSATION_TIMEOUT_MS,
      "Opening the conversation"
    );
  }

  createChannel(title: string, members: string[]): Promise<ConversationDoc> {
    return withTimeout(
      this.requireReady().conv.createChannel(title, members),
      CONVERSATION_TIMEOUT_MS,
      "Creating the channel"
    );
  }

  openSubject(
    subject: ConversationSubject,
    title: string,
    members: string[]
  ): Promise<ConversationDoc> {
    return withTimeout(
      this.requireReady().conv.openSubject(subject, title, members),
      CONVERSATION_TIMEOUT_MS,
      "Opening the conversation"
    );
  }

  addMembers(convId: string, members: string[]): Promise<ConversationDoc> {
    return this.requireReady().conv.addMembers(convId, members);
  }

  removeMembers(convId: string, members: string[]): Promise<ConversationDoc> {
    return this.requireReady().conv.removeMembers(convId, members);
  }

  getConversation(convId: string): Promise<ConversationDoc | undefined> {
    return this.requireReady().conv.get(convId);
  }

  /* -------------------------------------------------------------- */
  /* messages                                                       */
  /* -------------------------------------------------------------- */

  async recent(convId: string, limit?: number): Promise<DecryptedMessage[]> {
    const { conv, msg } = this.requireReady();
    // Names must be in hand BEFORE rendering. Profiles load in the
    // background, so a conversation opened immediately after startup would
    // otherwise show raw identity ids for its authors.
    await this.ensureNamesFor(await conv.get(convId));
    return msg.recent(convId, limit);
  }

  /** Load profiles if any participant of `conv` is still unnamed. */
  private async ensureNamesFor(conv: ConversationDoc | undefined): Promise<void> {
    if (!conv || conv.members.every((m) => this.names.has(m))) return;
    try {
      await this.loadProfiles();
    } catch {
      /* fall back to raw ids rather than failing the read */
    }
  }

  /**
   * Send, and nothing else.
   *
   * Callers must not have to await a refresh to learn that the send
   * succeeded. When they did, a failing refresh made a delivered message
   * look like a failure - which is why the composer kept its text after
   * sending.
   */
  async send(convId: string, body: MessageBody): Promise<DecryptedMessage> {
    const result = await this.requireReady().msg.send(convId, body);
    this.poller?.kick();
    return result;
  }

  editMessage(convId: string, messageId: string, body: MessageBody): Promise<void> {
    return this.requireReady().msg.edit(convId, messageId, body);
  }

  async deleteMessage(
    convId: string,
    messageId: string,
    attachments?: AttachmentManifest[]
  ): Promise<void> {
    await this.requireReady().msg.remove(convId, messageId);
    for (const attachment of attachments ?? []) await this.files.remove(attachment);
  }

  /* -------------------------------------------------------------- */
  /* attachments                                                    */
  /* -------------------------------------------------------------- */

  uploadAttachment(
    convId: string,
    file: File,
    onProgress?: (done: number, total: number) => void
  ): Promise<AttachmentManifest> {
    this.requireReady();
    return this.files.upload(convId, file, onProgress);
  }

  downloadAttachment(
    manifest: AttachmentManifest,
    onProgress?: (done: number, total: number) => void
  ): Promise<Blob> {
    this.requireReady();
    return this.files.download(manifest, onProgress);
  }

  /* -------------------------------------------------------------- */
  /* deletion                                                       */
  /* -------------------------------------------------------------- */

  /**
   * Delete a conversation and everything in it, for everyone.
   *
   * Attachments, then pages, then the conversation document. If interrupted,
   * what remains is a partly emptied conversation rather than orphaned
   * documents nobody can find.
   */
  async deleteConversation(convId: string): Promise<{
    attachmentsRemoved: number;
    chunksSwept: number;
    pagesRemoved: number;
  }> {
    const { conv, msg } = this.requireReady();
    const doc = await conv.get(convId);
    if (!doc) throw new Error("Conversation not found.");
    if (!doc.members.includes(this.user.id)) {
      throw new Error("You are not a member of this conversation.");
    }

    const manifests = await msg.allAttachments(convId);
    for (const manifest of manifests) {
      try {
        await this.files.remove(manifest);
      } catch (err) {
        console.warn("[secure-chat] attachment removal failed", err);
      }
    }
    let chunksSwept = 0;
    try {
      chunksSwept = await this.files.removeByConversation(convId);
    } catch (err) {
      console.warn("[secure-chat] chunk sweep failed", err);
    }

    const pagesRemoved = await msg.purgePages(convId, doc.messageCount);
    await conv.removeDocument(convId);
    try {
      await this.readState.forget(convId);
    } catch {
      /* a stale cursor is harmless */
    }

    this.poller?.kick();
    return { attachmentsRemoved: manifests.length, chunksSwept, pagesRemoved };
  }

  /* -------------------------------------------------------------- */
  /* polling                                                        */
  /* -------------------------------------------------------------- */

  startPolling(
    onUpdate: (unread: UnreadSummary, conversations: ConversationDoc[]) => void,
    options: ChatClientOptions = {}
  ): void {
    this.requireReady();
    this.poller?.stop();
    this.poller = new Poller(this.store, {
      activeSeconds: options.activeSeconds ?? 12,
      idleSeconds: options.idleSeconds ?? 60,
      onTick: async (all) => {
        const mine = all.filter((c) => c.members.includes(this.user.id));
        onUpdate(await this.readState.summarise(mine, this.user.id), mine);
      },
      onError: (err) => console.warn("[secure-chat] poll failed", err),
    });
    this.poller.start();
  }

  stopPolling(): void {
    this.poller?.stop();
    this.poller = undefined;
  }

  kick(): void {
    this.poller?.kick();
  }

  async markRead(convId: string): Promise<void> {
    const doc = await this.requireReady().conv.get(convId);
    if (doc) await this.readState.markRead(doc);
  }

  /* -------------------------------------------------------------- */
  /* diagnostics                                                    */
  /* -------------------------------------------------------------- */

  /**
   * Support dump, reachable from the console as `secureChatDiagnose()`.
   * Contains no message content, so it is safe to paste into a bug report.
   */
  async diagnose(): Promise<unknown> {
    const out: Record<string, unknown> = {
      extensionVersion: EXTENSION_VERSION,
      storageNamespace: NAMESPACE,
      encryption: "none (removed in 0.7.0)",
      origin: window.location.origin,
      ready: this.ready,
      me: this.me,
    };
    if (!this.ready) return out;

    out.directory = directorySnapshot();
    try {
      out.profiles = (await this.loadProfiles()).map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        appVersion: p.appVersion ?? "unknown",
        namespace: p.namespace ?? "unknown",
      }));
    } catch (err) {
      out.profiles = `failed: ${String(err)}`;
    }

    const docs = await this.conversations.mine();
    out.conversations = docs.map((conv) => ({
      id: conv.id,
      kind: conv.kind,
      messageCount: conv.messageCount,
      members: conv.members.map((m) => ({ userId: m, name: this.nameOf(m) })),
      lastActivityAt: conv.lastActivityAt,
    }));
    return out;
  }
}

/** Boot the SDK once per frame, then build and initialise a client. */
export async function bootstrap(): Promise<ChatClient> {
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();
  const client = await withTimeout(ChatClient.create(), 30_000, "Connecting to Azure DevOps");
  await withTimeout(client.init(), 30_000, "Starting Secure Chat");
  (window as unknown as Record<string, unknown>).secureChatDiagnose = async () => {
    const report = await client.diagnose();
    console.log(JSON.stringify(report, null, 2));
    return report;
  };
  SDK.notifyLoadSucceeded();
  return client;
}
