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
  CHUNK_CONCURRENCY,
  COLLECTIONS,
  MAX_ATTACHMENT_BYTES,
} from "./model";
import { Store } from "./storage";

const chunkDocId = (blobId: string, index: number) =>
  `${blobId}_${String(index).padStart(5, "0")}`;

export type ProgressFn = (done: number, total: number) => void;

/**
 * Run `work` over every index with a small fixed concurrency.
 *
 * A 16 MB attachment is 256 chunk documents. Written one at a time that is
 * 256 sequential round trips - on a server 80 ms away, twenty seconds of
 * apparent hang. Four at a time is a four-fold improvement without turning
 * one upload into a burst the service will throttle.
 */
async function pooled(
  count: number,
  work: (index: number) => Promise<void>,
  onDone?: (completed: number, total: number) => void
): Promise<void> {
  let next = 0;
  let completed = 0;
  const lanes = Array.from({ length: Math.min(CHUNK_CONCURRENCY, count) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      await work(index);
      onDone?.(++completed, count);
    }
  });
  // Promise.all rejects on the first failure, but the other lanes keep
  // running; awaiting them all means a partial upload never leaves a
  // dangling write that lands after the error was reported.
  const results = await Promise.allSettled(lanes);
  const failed = results.find((r) => r.status === "rejected");
  if (failed && failed.status === "rejected") throw failed.reason;
}

/** True for the image types a browser will render inline. */
export function isImage(mime: string): boolean {
  return /^image\/(png|jpeg|jpg|gif|webp|bmp|avif)$/i.test(mime);
}

/** Natural dimensions of an image file, or undefined if it is not one. */
async function imageSize(file: File): Promise<{ width: number; height: number } | undefined> {
  if (!isImage(file.type)) return undefined;
  if (typeof createImageBitmap !== "function") return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    return undefined;
  }
}

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

    await pooled(
      chunks,
      async (index) => {
        const slice = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
        const doc: BlobChunkDoc = {
          id: chunkDocId(blobId, index),
          blobId,
          convId,
          index,
          data: b64encode(slice),
        };
        await this.store.put(COLLECTIONS.blobs, doc);
      },
      onProgress
    );

    const manifest: AttachmentManifest = {
      blobId,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      chunks,
      chunkBytes: CHUNK_BYTES,
      sha256: sha256(bytes),
    };

    // Record pixel size for images so a preview can reserve its space and the
    // message list does not jump as thumbnails decode.
    const dims = await imageSize(file);
    if (dims) {
      manifest.width = dims.width;
      manifest.height = dims.height;
    }
    return manifest;
  }

  async download(manifest: AttachmentManifest, onProgress?: ProgressFn): Promise<Blob> {
    // Indexed rather than appended: the pool finishes chunks out of order,
    // and concatenating them in completion order would corrupt the file.
    const parts = new Array<Uint8Array>(manifest.chunks);
    await pooled(
      manifest.chunks,
      async (index) => {
        const doc = await this.store.get<BlobChunkDoc>(
          COLLECTIONS.blobs,
          chunkDocId(manifest.blobId, index)
        );
        if (!doc) {
          throw new Error(`Attachment chunk ${index + 1} of ${manifest.chunks} is missing.`);
        }
        parts[index] = b64decode(doc.data);
      },
      onProgress
    );

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
    await pooled(manifest.chunks, (index) =>
      this.store.remove(COLLECTIONS.blobs, chunkDocId(manifest.blobId, index))
    );
  }

  /**
   * Delete every chunk belonging to a conversation.
   *
   * COSTLY. `list` on the blob collection downloads every chunk document in
   * the whole project collection, base64 payload included - megabytes, to
   * delete kilobytes. It exists to catch chunks whose manifest was lost (an
   * upload interrupted between its chunk writes and its message write), so
   * it is a repair tool, not part of the normal delete path. Deleting a
   * conversation walks its manifests instead; see ChatClient.
   */
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
