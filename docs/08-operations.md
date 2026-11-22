> **STALE since 0.7.0 (checked 2026-11-10).** This file describes the earlier *end-to-end encrypted* design. Encryption was removed; messages are now plaintext. For current, verified documentation start at [`docs/ai-handoff/01_START_HERE.md`](ai-handoff/01_START_HERE.md). What in this file is still valid: `docs/ai-handoff/13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`, section E.

# 8. Operations

Running Secure Chat after it is installed.

## 8.1 Tunable constants

All in `src/core/model.ts` unless noted. Changing any of these requires a
rebuild and a re-upload.

| Constant | Default | Effect of raising it |
| --- | --- | --- |
| `PAGE_SIZE` | 40 | Fewer documents; more write contention, because appending rewrites the whole page |
| `CHUNK_BYTES` | 64 KiB | Fewer documents per file; risk of exceeding the undocumented document size limit |
| `MAX_ATTACHMENT_BYTES` | 16 MiB | Larger files; faster quota consumption |
| `CHUNK_BYTES` on HTTP | 64 KiB | The JS AES-GCM backend is slower than WebCrypto; large attachments take noticeably longer to encrypt |
| `activeSeconds` (`client.ts`) | 12 | Lower latency, more requests |
| `idleSeconds` (`client.ts`) | 60 | Applies while the tab is hidden |

### Measuring the document size limit

Not documented, and it differs between Services and Server. Before raising
`CHUNK_BYTES`, test on **your** server: write a single document of the target
size to a scratch collection through the Extension Management REST API and
confirm it round-trips. Treating any value as safe without measuring is
guesswork.

## 8.2 Capacity planning

The binding limit is **100 000 documents** returned by a "get all" on one
collection.

| Content | Documents | Headroom |
| --- | --- | --- |
| 4 000 000 messages | 100 000 pages | Not a practical concern |
| One 16 MiB attachment | 256 | ~390 such files fills the quota |
| One 1 MB attachment | 16 | ~6 250 such files |
| One 100 KB attachment | 2 | ~50 000 such files |

Attachments dominate. A team that shares screenshots will hit the ceiling long
before a team that only talks.

**Monitoring:** there is no built-in gauge. The honest check is to count
documents in the `blobs` collection through the REST API on a schedule and
alert past 60 %.

## 8.3 Garbage collection

Deleting a message deletes its attachment chunks. Chunks are orphaned when
that path is interrupted — a browser closed mid-delete, a failed write.

`Files.collectGarbage(liveBlobIds)` removes any chunk whose blob id is not in
the set it is given.

**It is dangerous.** The caller must build `liveBlobIds` by decrypting *every
page of every conversation it can read*. A client that cannot read some
conversation would compute an incomplete live set and delete other people's
live attachments.

Safe procedure:

1. Run it from an account that is a member of every conversation, or accept
   that it can only be run per-conversation.
2. Do a dry run first: build the live set, list what would be deleted, and eyeball
   the count.
3. Only then delete.

There is no UI for this yet — see [07-roadmap-rnd.md §7.4.6](07-roadmap-rnd.md).

## 8.3b Deleting a conversation

The hub's **Delete** button removes a conversation and everything under it:
attachment chunks, message pages, then the conversation document, in that
order. If the run is interrupted, what survives is a partly emptied
conversation rather than orphaned documents nobody can locate.

Three things to be clear about:

- **It is not per-user.** Conversation, page and blob documents are
  collection-scoped and shared by every member, so deleting removes it for all
  of them. Any member can do it; there is no owner. The dialog says so.
- **Attachments from messages that cannot be decrypted.** Chunks written by
  0.5.0 or later carry their conversation id and are swept regardless. Older
  chunks are reachable only through their manifest, so if the message will not
  decrypt they remain. The result reports the count as
  `unreachableAttachments`; `Files.collectGarbage` is the tool for those.
- **Backups.** Deletion removes live documents. Whatever is already in an
  Azure DevOps collection backup stays there until it ages out.

## 8.4 Backup and restore

Chat data is inside the Azure DevOps collection database, so your existing
collection backup covers it. Two things to understand:

- **A restore is a rollback.** Restoring the collection to an earlier point
  rolls chat back with it. Messages sent after the backup are gone.
- **Backups contain ciphertext.** A stolen backup does not expose messages. It
  does expose membership, timestamps and message counts.

There is no separate export today. See
[07-roadmap-rnd.md §7.4.12](07-roadmap-rnd.md).

## 8.5 User lifecycle

### Onboarding

The user opens the hub. Keys are generated and published silently on first
load. There is no setup screen and nothing for an administrator to do.

### Resetting everything on the server

Bump `NAMESPACE` in `src/core/model.ts` and `DEVICE_RECORD_VERSION` in
`src/core/keystore.ts`, then rebuild. Every client starts from empty: new
identities, new keyring, no conversations.

The previous documents are not deleted, just no longer addressed. Remove them
through the Extension Management REST API if you want the space back - see
§8.6 for the endpoint, substituting the old collection names.

### A user changes device, browser, or clears their profile

Fully automatic. The new session mints a fresh key pair with a bumped
generation; every other member's client notices during its normal maintenance
pass (startup and each poll tick) and re-issues conversation keys to the new
identity for every epoch the user already had. Their history comes back with
no action from anyone.

What does **not** come back: epochs where they never had a wrap (channels they
joined late), and nothing at all if *every* member of a conversation lost
their device state at the same time — with no surviving key holder there is
nobody who can re-issue.

### Offboarding

1. Remove them from conversations. That rotates each epoch, so they cannot read
   anything sent afterwards.
2. Their keyring document remains. Delete it through the REST API if you want
   them out of the people picker.
3. **They can still read anything they already decrypted.** Removal stops
   future access, not past access. No protocol changes that.

## 8.6 Security operations

### Diagnosing a "cannot read messages" report

Open the Chat hub, press F12, and run:

```
secureChatDiagnose()
```

It prints the extension version, the active crypto backend, your key
generation, and for every conversation: its epoch, whether this client can open
it, and per member whether their wrap still matches their published key
generation. It contains no message content and no private key material, so it
is safe to paste into a ticket.

The two patterns to look for:

- **`wrapIsCurrent: false` for some members, `true` for at least one** — normal
  drift. The member whose wrap is current will re-issue on their next poll.
- **`wrapIsCurrent: false` for every member** — orphaned. No key holder
  survives. Maintenance recovers the conversation at a new epoch; history
  before that point is gone.

### Reviewing what the server holds

```
GET https://<server>/<collection>/_apis/ExtensionManagement/InstalledExtensions/{publisher}/{extension}/Data/Scopes/Default/Current/Collections/conversations/Documents?api-version=7.1-preview.1
```

Useful for confirming that bodies really are ciphertext, and for auditing
membership. Note that any collection member can run this — which is the reason
the encryption exists.

### Responding to a "key changed" report

A changed fingerprint has two causes: the person's device changed, or somebody
overwrote their keyring document. The client cannot distinguish them, and
since v0.2.0 automatic key re-issue does **not** wait for a human to decide —
so treat an unexpected change as an incident promptly.

1. Contact the person over a channel that is **not** Secure Chat.
2. Confirm whether they changed device or browser profile.
3. If they did not, check the audit log for writes to the extension data store
   and review who holds collection-level access.
4. Once resolved, both parties compare the new safety number and mark it
   verified.

### Pinning the extension

Because the server ships the JavaScript that handles the keys, whoever can
publish extensions to the collection can, in principle, publish a version that
exfiltrates them. Reduce that surface:

- Restrict who holds **Edit instance-level information**
- Record the `.vsix` SHA-256 for each deployed version
- Re-verify the hash on every upgrade

**On plain HTTP this widens considerably.** The bundle is delivered without
transport integrity, so anyone able to modify traffic on the path can swap it,
not just whoever can publish. If you run HTTP, the network itself has to be
part of your trust boundary. See [02-crypto-design.md §2.12](02-crypto-design.md).

## 8.7 Performance notes

| Operation | Cost | Notes |
| --- | --- | --- |
| Poll cycle | 2 requests | `conversations` and `keyring` documents |
| Open a conversation | 1–3 requests | Conversation document plus one or two pages |
| Send a message | 2 requests | Reserve, then append |
| Upload a 1 MB file | 16 requests | One per chunk, sequential |
| First load (mint identity) | ~10–40 ms | Two P-256 key pairs |
| AES-GCM on the JS backend | ~3-8× slower than WebCrypto | Noticeable only on large attachments |
| ECDSA verify on the JS backend | ~5-15 ms each | Why bundle verification and message verification are both memoised - see below |
| Decrypt a 40-message page | ~5–15 ms | AES-GCM is hardware accelerated |

Attachment upload is sequential on purpose. Parallel chunk writes would be
faster but would multiply concurrent load on the data service; for a prototype,
predictable behaviour beats a couple of saved seconds. If you parallelise it,
bound the concurrency to about 4.

## 8.7b Caches that matter for responsiveness

Three results are memoised. Each was, before it existed, redone on every
twelve-second poll - which on the pure-JS crypto backend (plain HTTP) meant
seconds of blocked main thread per tick.

| Cache | Keyed on | Invalidates when |
| --- | --- | --- |
| Verified key bundles (`Keyring.verified`) | `userId + generation + selfSig` | The bundle document changes in any way |
| Decrypted messages (`Messages.decrypted`) | message id + its ciphertext | The message is edited or replaced |
| Conversation keys (`Conversations.keyCache`) | epoch + the wrap ciphertext | The wrap changes, including delete-and-recreate |

All three key on **content**, never on a name or a counter. That is deliberate:
a counter-keyed cache is what produced the delete-and-recreate corruption in
0.5.0, where `(convId, epoch)` addressed two different keys across a
conversation's two lives.

Decryption *failures* are deliberately not memoised - a failure usually means
a key that maintenance is about to re-issue, and caching it would keep the
message broken on screen after the fix landed.

## 8.8 Known issues

| Issue | Impact | Workaround |
| --- | --- | --- |
| Append is not atomic | A failure between the two writes leaves an empty slot | Cosmetic. The gap is skipped on read |
| Every open tab polls independently | Request volume scales with tabs | Raise `activeSeconds`, or add a BroadcastChannel leader election |
| Widget navigation URL is constructed by string manipulation | May be wrong on unusual collection paths | Open the hub from the left navigation |
| No pagination UI | Only the most recent ~80 messages are shown | `Messages.page(convId, n)` exists; the scroll-back UI does not |
| Editing re-encrypts under the current epoch | An old message edited after a rotation moves epoch | Correct, but means the edit is invisible to a since-removed member. Intended |
| Messages sent by a 0.5.0 client into a deleted-and-recreated DM | Encrypted with a stale cached key; permanently unreadable | Fixed in 0.5.1. Delete the affected conversation once more after every participant is on 0.5.1 |
| No rate limiting | A script could flood a conversation | Azure DevOps applies its own request throttling |
| HTTP stores private keys as raw bytes | XSS on the origin can exfiltrate an identity | Move to HTTPS; see [02-crypto-design.md §2.12](02-crypto-design.md) |
