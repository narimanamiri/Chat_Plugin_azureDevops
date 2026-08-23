/**
 * crypto.ts - encoding and hashing helpers.
 *
 * WHAT THIS NO LONGER DOES
 * ------------------------
 * Up to 0.6.x this module implemented end-to-end encryption: ECDH key
 * agreement, per-member key wrapping, AES-256-GCM message bodies and ECDSA
 * sender signatures. All of that is gone as of 0.7.0.
 *
 * The reason was not that the cryptography was wrong - it round-tripped
 * correctly and was covered by tests. The reason is that its key material
 * was necessarily device-bound: private keys lived in IndexedDB and could
 * not be roamed without either a passphrase (rejected as friction) or
 * server-side storage (which would have defeated the point). Every browser
 * change, profile reset or extension reinstall minted a new identity, and
 * conversation keys wrapped to the old one became unopenable. Recovering
 * from that required another member to still hold a usable key and to be
 * online. In practice that produced repeated lockouts.
 *
 * Messages are now stored as plaintext. See docs/02-security-model.md for
 * exactly who can read them, which is a materially weaker position than
 * before and is stated there without euphemism.
 *
 * There is no longer any dependency on WebCrypto, so the extension works
 * identically over HTTP and HTTPS with no secure-context caveat.
 */

import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";

/* ------------------------------------------------------------------ */
/* encoding                                                            */
/* ------------------------------------------------------------------ */

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export const utf8 = (s: string): Uint8Array => TEXT_ENCODER.encode(s);
export const fromUtf8 = (b: ArrayBuffer | Uint8Array): string =>
  TEXT_DECODER.decode(b instanceof Uint8Array ? b : new Uint8Array(b));

export function b64encode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  // Chunked so large attachments do not blow the call argument limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export function b64decode(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* identifiers                                                         */
/* ------------------------------------------------------------------ */

/**
 * `crypto.getRandomValues` is available in every context including plain
 * HTTP - only `crypto.subtle` was secure-context only, and that is no longer
 * used. Falls back to Math.random solely so a non-browser test runner cannot
 * crash; ids are not security-bearing.
 */
export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return b;
}

/** Short, collision-resistant id. Produces `bytes * 2` hex characters. */
export function randomId(bytes = 8): string {
  return Array.from(randomBytes(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------------------------------------------ */
/* hashing                                                             */
/* ------------------------------------------------------------------ */

/**
 * SHA-256, base64 encoded.
 *
 * Used for deterministic conversation ids and for attachment integrity
 * checks - not for anything security-bearing. Implemented with @noble so it
 * works without WebCrypto, i.e. over plain HTTP.
 */
export function sha256(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? utf8(input) : input;
  return b64encode(nobleSha256(bytes));
}

/** Hex-encoded SHA-256, truncated. Used for stable document identifiers. */
export function hashId(input: string, chars: number): string {
  const digest = nobleSha256(utf8(input));
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, chars);
}
