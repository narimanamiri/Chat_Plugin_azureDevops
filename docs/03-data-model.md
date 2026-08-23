# 3. Data model

Everything lives in the Azure DevOps Extension Data Service. Two scopes are
used: **collection** (shared by everyone in the project collection) and **user**
(private to one user of that collection).

## 3.1 Service limits that shape the schema

| Limit | Value | Source |
| --- | --- | --- |
| Document id length | 50 characters | Documented |
| Documents returned by "get all" | 100 000 | Documented |
| Concurrency control | `__etag`, or `-1` for last-write-wins | Documented |
| Cross-extension access | Denied (HTTP 401) | Documented |
| Document size | **Not documented** | Measured per server — see §3.6 |

The undocumented one is the dangerous one. `CHUNK_BYTES` in `src/core/model.ts`
is deliberately conservative at 64 KiB for exactly that reason.

## 3.1b Storage namespace

Every collection name carries a namespace prefix, `NAMESPACE` in
`src/core/model.ts`, currently **`v2`**. So the real collection names are
`v2_keyring`, `v2_conversations`, `v2_pages`, `v2_blobs`, and so on.

Bumping the namespace gives the extension a clean slate on the server:
earlier documents are simply no longer addressed. It is non-destructive - the
old documents stay where they are under their old names - and it is the
sanctioned way to abandon accumulated state that is not worth migrating.

`v2` was adopted after a run of releases in which device-bound key material
drifted out of sync badly enough that repairing conversations in place was
less trustworthy than starting fresh.

Do **not** bump it for ordinary format changes. Those belong in the per-record
`v` field, which supports migration; a namespace bump does not.

## 3.2 Collections

| Collection | Scope | Document id | Contents |
| --- | --- | --- | --- |
| `keyring` | collection | Azure DevOps user id (GUID, 36 chars) | Public key bundle |
| `conversations` | collection | 16 hex chars | Members, epochs, wrapped keys, counters |
| `pages` | collection | `{convId}_{page:5}` = 22 chars | Up to 40 encrypted messages |
| `blobs` | collection | `{blobId}_{index:5}` = 18 chars | One encrypted attachment chunk |
| `self` | user | `identity`, `trust` | Wrapped private keys; trust records |
| `readstate` | user | `cursors` | Per-conversation read watermark |
| `$settings` | user | `pending-subject` | Hand-off from the menu actions |

### Document id budget

The 50-character ceiling is the tightest constraint in the schema. Every id is
built to leave headroom:

```
conversation   16                                    →  16 / 50
page           16 + 1 + 5   convId _ page            →  22 / 50
blob chunk     12 + 1 + 5   blobId _ index           →  18 / 50
keyring        36           user GUID                →  36 / 50
```

`Store.assertDocId` throws rather than letting a truncated id silently collide.

## 3.3 Document shapes

Full TypeScript definitions live in `src/core/model.ts`. The essentials:

### `keyring/{userId}` — public key bundle

```jsonc
{
  "id": "3f2c...",          // Azure DevOps user id
  "userId": "3f2c...",
  "displayName": "Jane Doe",
  "ecdhPub":  { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "ecdsaPub": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
  "generation": 1,          // bumped when the user regenerates keys
  "createdAt": "2026-08-22T09:00:00.000Z",
  "selfSig": "base64"       // ECDSA over the canonical bundle
}
```

`canonicalBundle()` in `keyring.ts` fixes the field order that the signature
covers. **Never reorder it** — doing so invalidates every published bundle.

### `conversations/{convId}`

```jsonc
{
  "id": "a1b2c3d4e5f60718",
  "kind": "dm",                    // dm | channel | workitem | commit
  "members": ["userA", "userB"],   // sorted, PLAINTEXT
  "epoch": 2,
  "keys": {
    "1": { "userA": { "sealed": {...}, "salt": "...", "fromEcdhPub": {...}, "toGeneration": 1 },
           "userB": { ... } },
    "2": { ... }
  },
  "sealedTitle": { "v": 1, "iv": "...", "ct": "..." },   // channels only
  "headPage": 3,
  "messageCount": 137,             // PLAINTEXT - drives unread counts
  "lastActivityAt": "2026-08-22T09:15:00.000Z",
  "lastMessageId": "l9x2k0p3-a1b2c3",
  "lastSenderId": "userA",
  "subject": { "type": "workitem", "key": "4213" }
}
```

Direct message ids are **deterministic**: `SHA-256("dm|" + sorted member ids)`
truncated to 16 hex characters. Both participants therefore converge on the
same document without coordinating.

The cost of that determinism: deleting a DM and starting a new one produces
**the same `id`, again at `epoch: 1`, with an entirely different key**. Any
cache keyed on `(convId, epoch)` will hand back the dead key — and since
sending shares that cache, the client would encrypt with it and produce
messages nobody can read. `Conversations.keyFor` therefore caches on the wrap
*ciphertext*, which changes whenever the key does. `instanceId` records which
life of the id a document belongs to, for logs and diagnostics. Subject channels use
`SHA-256("{type}|{repositoryId}|{key}")` the same way, so "Discuss in Secure
Chat" on work item 4213 always lands in the same channel.

### `pages/{convId}_{page}`

```jsonc
{
  "id": "a1b2c3d4e5f60718_00003",
  "convId": "a1b2c3d4e5f60718",
  "page": 3,
  "items": [
    {
      "id": "l9x2k0p3-a1b2c3",       // base36 timestamp + 6 random hex, sortable
      "senderId": "userA",
      "sentAt": "2026-08-22T09:15:00.000Z",
      "epoch": 2,
      "sealed": { "v": 1, "iv": "...", "ct": "..." },
      "sig": "base64",
      "senderGeneration": 1
    }
  ]
}
```

The decrypted `sealed.ct` is a `MessageBody`:

```jsonc
{
  "text": "fixed in #4213, see 9f2a1c4",
  "mentions": [ { "kind": "workitem", "raw": "#4213", "value": "4213", "start": 9, "length": 5 } ],
  "attachments": [ { "blobId": "...", "name": "trace.log", "size": 91234, "chunks": 2,
                     "chunkBytes": 65536, "fileKey": {...}, "sha256": "..." } ],
  "replyToId": "l9x2k0p1-9f8e7d"
}
```

Attachment **file names live inside the ciphertext**, so the server sees chunk
counts but not what the file is called.

### `blobs/{blobId}_{index}`

```jsonc
{ "id": "9c4f21ab70de_00000", "blobId": "9c4f21ab70de", "index": 0,
  "convId": "a1b2c3d4e5f60718",
  "sealed": { "v": 1, "iv": "...", "ct": "..." } }
```

`convId` exists so deleting a conversation can sweep its chunks even when the
owning message cannot be decrypted. It is absent on chunks written before
0.5.0, which are reachable only through their manifest.

## 3.4 Paging

Storing one document per message would make every poll an N-document fetch,
because the data service has no server-side query or filter. Messages are
therefore packed:

```
page = floor(messageIndex / PAGE_SIZE)     PAGE_SIZE = 40
```

`headPage` is derived, not authoritative — it is written for readability but
every read recomputes it from `messageCount`, so the two cannot drift.

### Append protocol

```
1. store.mutate(conversations, convId):
     index = messageCount
     messageCount = index + 1
     lastActivityAt / lastMessageId / lastSenderId updated
   → etag conflict retries with exponential backoff + jitter (6 attempts)

2. store.mutate(pages, `${convId}_${floor(index / 40)}`):
     items.push(encryptedMessage)
   → same retry policy
```

Two senders racing get distinct indexes from step 1, so ordering is well
defined even under contention. The cost is that the pair is **not atomic**: a
failure between the steps leaves `messageCount` incremented with no ciphertext
behind it. Readers skip the gap and the sender sees the error.

### Tuning `PAGE_SIZE`

| Value | Poll cost | Write contention | Note |
| --- | --- | --- | --- |
| 10 | More documents to walk when scrolling back | Low | Fine for very busy channels |
| **40** | 1 document per poll | Moderate | Default |
| 200 | 1 document per poll | High — every sender rewrites a large document | Only for quiet channels |

Contention rises with page size because appending rewrites the whole page.

## 3.5 Attachments

```
file (≤ 16 MiB)
  └─ split into ceil(size / 65536) chunks
       └─ each chunk sealed with the file key, AAD = blob|{blobId}|{i}|{total}
            └─ one document per chunk
```

Base64 inflates by 4/3, so a 64 KiB chunk becomes about 87 KB of JSON, plus a
small envelope.

| File size | Chunks | Documents | Approximate stored bytes |
| --- | --- | --- | --- |
| 100 KB | 2 | 2 | ~137 KB |
| 1 MB | 16 | 16 | ~1.4 MB |
| 16 MB | 256 | 256 | ~22 MB |

## 3.6 Quota maths

The hard number is 100 000 documents returned by a "get all" on one collection.

- **Messages.** At 40 per page, 100 000 pages is 4 million messages per project
  collection. Not a practical concern.
- **Attachments.** A 16 MiB file is 256 documents. 100 000 documents is roughly
  **390 maximum-size files**, or many more small ones. This *is* a practical
  ceiling — `files.collectGarbage()` exists because of it, and
  [08-operations.md](08-operations.md) covers running it.

Before raising `CHUNK_BYTES`, measure. Write a single document of the target
size to a scratch collection on **your** server and confirm it round-trips.
Azure DevOps Services and Azure DevOps Server do not necessarily agree, and the
limit is not documented, so treating any particular value as safe without
testing is guesswork.

## 3.7 Migration

Every encrypted envelope carries `"v": 1`. A future format change should:

1. add `v: 2` writing, keep `v: 1` reading
2. re-encrypt lazily, on read, when a document is next written
3. never delete the `v: 1` reader — old pages are never rewritten on their own

`canonicalBundle()` and the AAD string formats are part of the on-disk contract.
Changing either is a breaking change that invalidates existing signatures and
ciphertexts.
