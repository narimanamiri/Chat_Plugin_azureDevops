/**
 * model.ts - every document shape that Secure Chat persists.
 *
 * As of 0.7.0 message bodies are stored as PLAINTEXT. Anything in a `Doc`
 * type is readable by the Azure DevOps server and by any collection member
 * who calls the Extension Data REST API. See docs/02-security-model.md.
 */

/* ------------------------------------------------------------------ */
/* collection names                                                    */
/* ------------------------------------------------------------------ */

/**
 * Storage namespace.
 *
 * Bumping this gives the extension a clean slate on the server: previous
 * documents are simply no longer addressed. `v3` accompanies the removal of
 * encryption - the old documents are ciphertext under keys that no longer
 * exist, so there is nothing to migrate.
 */
export const NAMESPACE = "v3";

const ns = (name: string): string => `${NAMESPACE}_${name}`;

export const COLLECTIONS = {
  /** Collection scope. Display name per user, so names survive a slow directory. */
  profiles: ns("profiles"),
  /** Collection scope. One document per conversation. */
  conversations: ns("conversations"),
  /** Collection scope. Message pages, `${convId}_${page}`. */
  pages: ns("pages"),
  /** Collection scope. Attachment chunks, `${blobId}_${index}`. */
  blobs: ns("blobs"),
  /** User scope. Read cursors. */
  readState: ns("readstate"),
} as const;

/** Document ids are capped at 50 characters by the data service. */
export const MAX_DOC_ID = 50;

/** Messages per page document. Tuned in docs/03-data-model.md. */
export const PAGE_SIZE = 40;

/** Bytes per attachment chunk before base64 expansion. */
export const CHUNK_BYTES = 64 * 1024;

/** Refuse to attach anything larger than this. */
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* stored documents                                                    */
/* ------------------------------------------------------------------ */

export interface StoredDoc {
  id: string;
  /** Concurrency token maintained by the data service. -1 means last write wins. */
  __etag?: number;
}

/**
 * A user's display name, recorded so conversation titles and message authors
 * resolve even when the REST directory is slow or unavailable.
 *
 * This replaces the old public key bundle. It holds no secrets, so unlike the
 * keyring it cannot go stale in a way that locks anybody out.
 */
export interface ProfileDoc extends StoredDoc {
  userId: string;
  displayName: string;
  /** Build that last wrote this, purely for diagnostics. */
  appVersion?: string;
  namespace?: string;
  updatedAt: string;
}

export type ConversationKind = "dm" | "channel" | "workitem" | "commit";

export interface ConversationDoc extends StoredDoc {
  kind: ConversationKind;
  title?: string;
  /** Azure DevOps user ids. Sorted, so DM ids are deterministic. */
  members: string[];
  createdBy: string;
  createdAt: string;
  /** Index of the page currently being appended to. Derived from messageCount. */
  headPage: number;
  /** Total messages ever appended. Also the unread watermark. */
  messageCount: number;
  lastActivityAt: string;
  lastMessageId?: string;
  lastSenderId?: string;
  /** Set for `workitem` / `commit` conversations. */
  subject?: ConversationSubject;
}

export interface ConversationSubject {
  type: "workitem" | "commit";
  /** Work item id, or commit sha. */
  key: string;
  repositoryId?: string;
  projectId?: string;
}

/** A page of messages. Collection scope, id = `${convId}_${page}`. */
export interface PageDoc extends StoredDoc {
  convId: string;
  page: number;
  items: StoredMessage[];
}

export interface StoredMessage {
  id: string;
  senderId: string;
  /**
   * Position reserved on the conversation when the message was accepted.
   *
   * This is the authoritative order. Timestamps are not: two messages sent
   * in the same millisecond would otherwise be ordered by a random id
   * suffix, so they could appear swapped - and differently to each reader.
   */
  seq?: number;
  /** ISO timestamp claimed by the sender. */
  sentAt: string;
  body: MessageBody;
  /** Tombstone marker. Content is gone, the slot stays for ordering. */
  deleted?: boolean;
}

/** Attachment chunk. Collection scope, id = `${blobId}_${index}`. */
export interface BlobChunkDoc extends StoredDoc {
  blobId: string;
  index: number;
  /** Owning conversation, so a purge can sweep reliably. */
  convId: string;
  /** Base64 chunk content. */
  data: string;
}

/** Read cursors. User scope, id = "cursors". */
export interface ReadStateDoc extends StoredDoc {
  cursors: Record<string, { lastReadMessageId: string; lastReadAt: string; count: number }>;
}

/* ------------------------------------------------------------------ */
/* message content                                                     */
/* ------------------------------------------------------------------ */

export type MentionKind = "user" | "workitem" | "pullrequest" | "commit" | "build" | "url";

export interface Mention {
  kind: MentionKind;
  /** Raw token as typed, e.g. "#4213" or "@Jane Doe". */
  raw: string;
  /** Resolved identifier: work item id, sha, user id, url. */
  value: string;
  /** Character offset in the message text. */
  start: number;
  length: number;
  repositoryId?: string;
  /** Snapshot of the title at send time, so history survives deletion. */
  label?: string;
}

export interface AttachmentManifest {
  blobId: string;
  name: string;
  size: number;
  mime: string;
  chunks: number;
  chunkBytes: number;
  /** SHA-256 of the file, for an integrity check on download. */
  sha256: string;
}

export interface MessageBody {
  text: string;
  mentions?: Mention[];
  attachments?: AttachmentManifest[];
  replyToId?: string;
  editedAt?: string;
}

/** A message ready for rendering. */
export interface DecryptedMessage {
  id: string;
  senderId: string;
  senderName: string;
  sentAt: string;
  /** Reservation order; see StoredMessage.seq. */
  seq?: number;
  body: MessageBody;
  deleted?: boolean;
  pending?: boolean;
  failed?: string;
}

/** A conversation with unread state applied. */
export interface ConversationView {
  id: string;
  kind: ConversationKind;
  title: string;
  members: string[];
  unread: number;
  lastActivityAt: string;
  lastSenderId?: string;
  subject?: ConversationSubject;
}
