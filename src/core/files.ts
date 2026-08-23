/**
 * files.ts - attachments.
 *
 * Azure DevOps gives extensions no blob store, only the JSON document store,
 * so a file is split into fixed-size chunks and each chunk becomes one
 * document. That part is unchanged from the encrypted design.
 *
 * What changed in 0.7.0: chunks hold base64 of the file itself rather than
 * ciphertext. An attachment is readable by anyone who can read the documents.
 *
 * A SHA-256 of the whole file is still recorded and verified on download.
 * That is an integrity check against truncation or a partial write - it is
 * not a security control, since anyone who can rewrite a chunk can also
 * rewrite the hash.
 *
 * Sizing: base64 inflates by 4/3, so CHUNK_BYTES of 64 KiB becomes roughly
 * 88 KB of JSON per document. Raise it only after testing your server; the
 * document size ceiling is undocumented.
 */

import { b64decode, b64encode, sha256 } from "./crypto";
import {
  AttachmentManifest,
  BlobChunkDoc,
  CHUNK_BYTES,
  COLLECTIONS,
  MAX_ATTACHMENT_BYTES,
} from "./model";
import { Store } from "./storage";

const chunkDocId = (blobId: string, index: number) =>
  `${blobId}_${String(index).padStart(5, "0")}`;

export type ProgressFn = (done: number, total: number) => void;

export class Files {
  constructor(private readonly store: Store) {}

  async upload(
    convId: string,
    file: File,
    onProgress?: ProgressFn
  ): Promise<AttachmentManifest> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB. The limit is ` +
          `${MAX_ATTACHMENT_BYTES / 1048576} MB.`
      );
    }

    const blobId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.slice(
      0,
      12
    );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunks = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));

    for (let index = 0; index < chunks; index++) {
      const slice = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      const doc: BlobChunkDoc = {
        id: chunkDocId(blobId, index),
        blobId,
        convId,
        index,
        data: b64encode(slice),
      };
      await this.store.put(COLLECTIONS.blobs, doc);
      onProgress?.(index + 1, chunks);
    }

    return {
      blobId,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      chunks,
      chunkBytes: CHUNK_BYTES,
      sha256: sha256(bytes),
    };
  }

  async download(manifest: AttachmentManifest, onProgress?: ProgressFn): Promise<Blob> {
    const parts: Uint8Array[] = [];
    for (let index = 0; index < manifest.chunks; index++) {
      const doc = await this.store.get<BlobChunkDoc>(
        COLLECTIONS.blobs,
        chunkDocId(manifest.blobId, index)
      );
      if (!doc) throw new Error(`Attachment chunk ${index + 1} of ${manifest.chunks} is missing.`);
      parts.push(b64decode(doc.data));
      onProgress?.(index + 1, manifest.chunks);
    }

    const total = parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.length;
    }

    if (sha256(joined) !== manifest.sha256) {
      throw new Error("Attachment failed its integrity check and was not opened.");
    }
    return new Blob([joined as BlobPart], { type: manifest.mime });
  }

  /** Remove every chunk of a blob. Called when a message is deleted. */
  async remove(manifest: AttachmentManifest): Promise<void> {
    for (let index = 0; index < manifest.chunks; index++) {
      await this.store.remove(COLLECTIONS.blobs, chunkDocId(manifest.blobId, index));
    }
  }

  /** Delete every chunk belonging to a conversation. */
  async removeByConversation(convId: string): Promise<number> {
    const all = await this.store.list<BlobChunkDoc>(COLLECTIONS.blobs);
    let removed = 0;
    for (const doc of all) {
      if (doc.convId !== convId) continue;
      await this.store.remove(COLLECTIONS.blobs, doc.id);
      removed++;
    }
    return removed;
  }

  /**
   * Sweep chunks whose owning message no longer exists. The document store
   * has no cascade delete, so orphans are otherwise permanent.
   */
  async collectGarbage(liveBlobIds: Set<string>): Promise<number> {
    const all = await this.store.list<BlobChunkDoc>(COLLECTIONS.blobs);
    let removed = 0;
    for (const doc of all) {
      if (!liveBlobIds.has(doc.blobId)) {
        await this.store.remove(COLLECTIONS.blobs, doc.id);
        removed++;
      }
    }
    return removed;
  }
}

/** Trigger a browser download for an assembled blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export { chunkDocId };
