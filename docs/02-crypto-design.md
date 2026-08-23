# 2. Cryptographic design and threat model

Read this before deploying. It says plainly what is protected and what is not.

## 2.1 Why encryption is needed at all

The Extension Data Service scopes documents either to a single user or to the
**whole project collection**. Collection-scoped documents are readable — and
writable — by any collection member who calls:

```
GET  {collection}/_apis/ExtensionManagement/InstalledExtensions/{publisher}/{extension}/Data/Scopes/Default/Current/Collections/{collection}/Documents
```

with the extension installed. Add to that the server administrator, the
database administrator, and anyone holding a backup.

So a chat extension that stored plaintext in that store would be readable by
every colleague with a REST client. Encryption here is not decoration; it is
what makes the feature deployable.

## 2.2 Threat model

### In scope — the design defends against these

| Adversary | Capability | Defence |
| --- | --- | --- |
| Curious colleague | Reads every extension document over REST | Bodies, titles and files are AES-256-GCM ciphertext |
| Server / DB administrator | Full read of the store and of backups | Same; keys never reach the server unwrapped |
| Backup thief | Offline copy of the database | Same |
| Active tamperer with write access | Rewrites documents | GCM tag + AAD binding; ECDSA sender signature; per-chunk position binding |
| Channel member forging another member | Holds the shared conversation key | ECDSA signature per message, verified against the keyring |
| Removed member | Had the old key | Membership change mints a new epoch key they never receive |
| Newly added member | Wants the backlog | Only the current epoch key is wrapped for them |

### Out of scope — the design does **not** defend against these

| Threat | Why not | Mitigation available |
| --- | --- | --- |
| **Traffic analysis** | Membership, timestamps, message counts, attachment sizes and file names are plaintext | None in this design. Padding and cover traffic would be needed |
| **Malicious keyring substitution** | Anyone in the collection can overwrite a keyring document with a fresh, correctly self-signed bundle — and automatic maintenance will re-issue conversation keys to it (§2.9) | Safety-number display and key-change records exist, but do not gate re-issue. Restrict who can reach the extension data REST surface; audit writes |
| **A hostile Azure DevOps server serving modified JavaScript** | The server ships the extension code; a server that rewrites the bundle can exfiltrate keys | Fundamental to any browser-delivered E2EE. Pin the extension version, verify the `.vsix` hash before upload, restrict who can publish extensions. **On plain HTTP this extends to anyone on the network path — see §2.12** |
| **Compromise of a user's device** | The identity is device-bound and always available once minted | On HTTPS the key is a non-extractable handle, usable but not readable by script. On HTTP it is raw bytes (§2.12) |
| **Past-message forward secrecy** | Epoch keys are long-lived | Ratchet upgrade, see [07-roadmap-rnd.md](07-roadmap-rnd.md) |
| **Malicious co-installed extension on the same origin** | Shares the browser origin, so it shares IndexedDB | On HTTPS the handle can be *used* but not *read*. On HTTP the raw scalar is exposed. Vet extensions |

The keyring substitution row is the important one. A self-signature proves a
bundle is internally consistent, not that it belongs to the named person, and
since v0.2.0 automatic key re-issue does not wait for a human to confirm a
fingerprint (§2.9). Safety numbers are still displayed and key changes are
still recorded, but they inform rather than gate. Restricting write access to
the extension data REST surface is the operative control.

## 2.3 Algorithms

| Purpose | Algorithm | Parameters |
| --- | --- | --- |
| Identity key agreement | ECDH | P-256 |
| Identity signing | ECDSA | P-256, SHA-256 |
| Key derivation | HKDF | SHA-256, random 16-byte salt, contextual `info` |
| Bulk encryption | AES-GCM | 256-bit key, 96-bit random IV, 128-bit tag |
| Integrity / fingerprints | SHA-256 | — |

WebCrypto on HTTPS; the audited `@noble` implementations of the same
algorithms on plain HTTP, where WebCrypto does not exist (§2.12). Nothing is
hand-rolled in either path.

### Choices worth defending

**P-256 rather than X25519/Ed25519.** WebCrypto ships P-256 in every current
browser; X25519 support is recent and uneven. A curve everybody actually has
beats a marginally nicer curve behind a polyfill.

**Two key pairs per identity.** WebCrypto refuses to use one EC key for both
ECDH and ECDSA, and reusing a key across primitives is bad practice anyway.

**96-bit random IVs.** With a random IV, GCM's safe limit is roughly 2^32
messages per key before birthday collisions matter. Epoch rotation on every
membership change keeps real conversations far below that.

## 2.4 Key hierarchy

```
identity private keys (ECDH P-256, ECDSA P-256)   ← IndexedDB, this device only
   │ ECDH with a peer's public key
   ▼
shared secret ──HKDF(salt, info="secure-chat/ck/{convId}/{epoch}")──► wrap key
   │ wraps
   ▼
conversation key (AES-256-GCM, one per conversation per epoch)
   ├─ encrypts message bodies       AAD = msg|conv|epoch|msgId|sender|sentAt
   ├─ encrypts the conversation title
   └─ wraps file keys               AAD = filekey|{blobId}
        │
        ▼
      file key (AES-256-GCM, one per attachment)
        └─ encrypts chunks          AAD = blob|{blobId}|{index}|{total}
```

### Additional authenticated data

Every AES-GCM operation passes plaintext metadata as AAD. It is not hidden, but
it is authenticated, so a ciphertext cannot be:

- replayed into a different conversation (`convId` in the AAD)
- re-attributed to a different sender (`senderId` in the AAD)
- moved to a different epoch (`epoch` in the AAD)
- reordered, duplicated or truncated inside a file (`index|total` in the AAD)

`tests/crypto.test.mjs` asserts each of these fails.

## 2.5 Epochs

An epoch is a `(conversation, generation)` pair with its own key.

```
epoch 1  members {A, B}         A and B hold wraps of key K1
  A adds C
epoch 2  members {A, B, C}      A, B and C hold wraps of K2; C has no K1
  B is removed
epoch 3  members {A, C}         A and C hold wraps of K3; B has no K3
```

Old epoch entries stay in the conversation document so that existing members
can still read history. `messages.decryptAll` groups by epoch and unwraps once
per epoch, and renders a clear "you do not have the key for this part of the
conversation" placeholder rather than silently dropping messages.

**Caveat:** a removed member who kept a copy of the ciphertext can still read
everything up to their removal. Removal stops future access, not past access.
No protocol can retract what somebody already decrypted.

## 2.6 Sender authentication

Inside a channel, every member holds the same conversation key, so AES-GCM
alone proves only "somebody in this channel wrote this". The ECDSA signature
over `aad | SHA-256(ciphertext)` proves *which* member.

Verification fails, and the UI shows "unverified sender", when:

- the sender has no published keyring bundle
- the sender's key generation has moved on since the message was signed
- the signature does not verify

The message body is still shown; the warning is on the attribution, not the
content.

## 2.7 What lands where

| Artefact | Location | Server sees |
| --- | --- | --- |
| Private identity keys | IndexedDB on the device only | Nothing — never uploaded |
| Public identity keys | Collection-scoped `keyring` | Public keys, display name |
| Conversation keys | Inside conversation documents, wrapped per member | Wrapped bytes only |
| Message body | Inside page documents | Ciphertext + IV + tag |
| Message metadata | Page + conversation documents | Sender, timestamp, epoch, id — **plaintext** |
| Channel title | Conversation document | Ciphertext |
| Membership | Conversation document | **Plaintext** |
| Attachment content | `blobs` documents | Ciphertext |
| Attachment name, size, MIME | Inside the encrypted message body | Ciphertext |
| Trust decisions | User-scoped document | Fingerprints you have seen |

## 2.8 Identity: automatic and device-bound

There is no passphrase and no setup ceremony. On first load a key pair is
generated silently and stored in the browser's IndexedDB as **non-extractable**
CryptoKey handles — usable by script while a tab is open, never readable out.

The identity is therefore bound to a browser profile. A new machine, a new
browser, or a cleared profile mints a fresh key pair with a bumped generation
number; recovery is handled by the maintenance pass below, with no user action.

What this trades away, stated plainly:

- **No roaming secret.** Each device is its own identity generation. The
  passphrase-wrapped roaming identity of the earlier design was removed in
  favour of zero user friction.
- **Terminal loss case.** If *every* member of a conversation loses their
  device state simultaneously, that conversation's encrypted history is
  unrecoverable. With any one surviving member, maintenance restores everyone.

## 2.9 Automatic maintenance (self-healing keys)

`Conversations.maintain` runs at startup and rides along with every poll tick.
It compares data the poller already fetched — conversation documents and the
keyring — so healthy state adds one request per tick and zero writes.

**Re-wrap.** When a member's published generation no longer matches the
`toGeneration` recorded in their wrap, any member who can unwrap that epoch
re-issues it to the member's current key. Existing wraps are replaced; missing
wraps are only added for the current epoch. History epochs are never
backfilled, so a late joiner still gets no backlog, while a member who lost
a device gets back every epoch they already had.

**Rotate for access.** A member who cannot open the current epoch, while
somebody else still can, used to have to wait for that person to open the app
before they could send anything. In practice that is indistinguishable from
being broken. Such a member now mints a new epoch for themselves and everyone
else, restoring sending immediately.

This deliberately does **not** mark older history dead: other members may
still be able to read it, and one device's inability to do so is no reason to
hide it from everyone. If the original key holder later returns, their
maintenance pass re-issues the old epoch keys and that history reappears.

**Recover.** A conversation can reach a state re-wrapping cannot fix: every
member's wrap names a key generation that member no longer has, so there is no
survivor left to re-issue from. `isOrphaned` detects this from wrap metadata
alone — no key material needed — by checking whether *any* member's
`toGeneration` still matches their published bundle. If none does, the
conversation is dead, and maintenance mints a fresh epoch so it works again
from that point on.

History under the dead epochs is **not recoverable** — the keys that opened it
do not exist anywhere. It is also not deleted: the ciphertext stays on the
server and `orphanedBelowEpoch` simply tells readers to skip it, so a recovered
conversation is usable instead of buried under one failure line per message. An
encrypted channel title is lost the same way, and the channel falls back to its
member- or subject-derived name.

**Upgrade.** A conversation involving someone who has never opened Secure Chat
starts in **clear mode** (see §2.11). The moment the last member's keys appear
in the keyring, maintenance mints a conversation key, wraps it to everyone,
moves the title under encryption and flips the conversation to e2ee. Messages
sent before the upgrade remain stored as they were sent.

**Trust consequence, stated plainly:** re-wrapping trusts whatever bundle the
keyring currently holds — trust-on-first-use, automatically. An attacker who
replaces a member's keyring bundle and can wait for a maintenance pass obtains
the conversation keys that pass re-issues. The safety-number Verify dialog
still exists and key changes are still recorded, but verification is advisory
display, not a gate. This is the explicit price of fully automatic recovery;
the earlier design gated re-issue on human verification and paid for it in
lockouts.

## 2.10 Clear mode

A conversation whose members do not all have published keys cannot be
end-to-end encrypted — there is nothing to wrap a key to. Such conversations
run in **clear mode**: bodies and title are stored as plaintext, messages are
still ECDSA-signed (authorship remains provable), and attachments still go
through the chunk pipeline but with their file key carried openly in the
manifest. The mode is chosen automatically at creation and shown as
"not encrypted" in the conversation list; nobody is asked anything. Clear
conversations upgrade to e2ee automatically (§2.9) and never downgrade.

## 2.12 Running over plain HTTP

`crypto.subtle` is exposed only in a *secure context*, so a server published
over plain HTTP has no WebCrypto. Rather than refuse to run, `crypto.ts`
selects a backend at load time:

| Context | Backend | Implementation |
| --- | --- | --- |
| HTTPS | `native` | WebCrypto |
| HTTP | `js` | `@noble/curves`, `@noble/ciphers`, `@noble/hashes` |

Both produce **byte-identical output** for ECDH, HKDF, AES-256-GCM, ECDSA and
SHA-256. `tests/interop.test.mjs` proves it by driving both backends in one
process and crossing the output over, including a full message path from an
HTTP sender to an HTTPS reader. An HTTP user and an HTTPS user in the same
conversation read each other with no special handling anywhere.

`crypto.getRandomValues` is available in non-secure contexts, so the CSPRNG is
the platform's in both modes. Nothing here reimplements randomness.

### What HTTP costs you

This is a genuine downgrade, not an equivalent. Three specific losses:

1. **No transport integrity — the important one.** The extension's JavaScript
   is delivered over an unauthenticated channel. Anyone who can modify traffic
   between the server and the browser can replace the bundle with one that
   exfiltrates keys. Against an active network attacker, in-browser E2EE over
   HTTP provides no confidentiality at all.

2. **Private keys are stored as raw bytes.** Without WebCrypto there is no
   non-extractable `CryptoKey` handle, so the identity scalar sits in
   IndexedDB readable by script. Any XSS on the origin can lift it, where on
   HTTPS it could only *use* the key while a tab was open.

3. **No desktop notifications.** The Notification API is also secure-context
   only. The bell and the widget still work; the OS toast does not.

What still holds on HTTP: **encryption at rest**. The Azure DevOps server, the
database, its backups, and every other collection member with REST access see
ciphertext only. On an internal network where that — not a wiretap — is the
threat you are defending against, HTTP mode is a reasonable trade. If you are
defending against anyone who can touch the network path, it is not, and no
amount of client-side cryptography will change that.

The hub says `http, no transport security` in its header whenever the fallback
backend is active, so the downgrade is never silent.

### Switching between HTTP and HTTPS

The two backends produce incompatible *private key handles* (an opaque
`CryptoKey` versus a raw scalar), so the device record records which backend
wrote it. Reaching the same origin the other way mints a fresh key generation,
which the maintenance pass in §2.9 heals like any other device change. No user
action, no lost history — provided at least one other member is reachable.

### Dependency note

The JS backend adds three packages from the `@noble` family — audited,
zero-dependency, and about 62 KiB in the bundle. That is a deliberate reversal
of the earlier "no third-party crypto library" position: hand-rolling AES-GCM
or P-256 to avoid a dependency would be far worse than taking a well-reviewed
one.

## 2.13 Residual risks worth writing down

1. **No external audit.** The design is conventional and the tests are real,
   but neither substitutes for review by a cryptographer.
2. **Extension code is served by the same party you are hiding from.** True of
   every in-browser E2EE product. Mitigate by controlling who can publish
   extensions to the collection and by pinning versions.
3. **`messageCount` is a side channel.** Anybody in the collection can watch
   two people's DM counter and infer conversation intensity.
4. **Attachment sizes leak.** Chunk count is public, so file size is known to
   within 64 KiB. Padding to a size bucket would help; it is not implemented.
5. **Deletion is best-effort.** `deleteMessage` removes the ciphertext from the
   live document, but Azure DevOps backups may retain it.
