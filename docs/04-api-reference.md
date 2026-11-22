> **STALE since 0.7.0 (checked 2026-11-10).** This file describes the earlier *end-to-end encrypted* design. Encryption was removed; messages are now plaintext. For current, verified documentation start at [`docs/ai-handoff/01_START_HERE.md`](ai-handoff/01_START_HERE.md). What in this file is still valid: `docs/ai-handoff/13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`, section E.

# 4. API reference

Public surface of each module in `src/core`. Signatures are the source of
truth; this is the map.

## 4.1 `client.ts` — `ChatClient`

The only thing the UI touches.

```ts
const client = await bootstrap();      // SDK.init + SDK.ready + Store + notifyLoadSucceeded
```

### Identity

| Method | Returns | Notes |
| --- | --- | --- |
| `init()` | `void` | Fully automatic: loads or silently mints the device identity, publishes the bundle, runs the first maintenance pass. Called by `bootstrap()` |
| `me` | `UnlockedIdentity` | `userId`, `displayName`, `fingerprint`, key handles |

There is no passphrase, no lock, and no setup state — identity is device-bound
and always available after `init()`.

### Directory

| Method | Returns |
| --- | --- |
| `people(force?)` | `Person[]` — every member of the **collection** reachable through `getAllTeams`; `hasKeys` / `peer` present for those who published a bundle |
| `directoryStatus` | `DirectoryResult \| undefined` — how the directory was built (`collection` / `project` / `none`), teams scanned, and any error. Shown in the picker's empty state |
| `nameOf(userId)` | `string` — display name, falling back to the raw id |

### Conversations

| Method | Returns |
| --- | --- |
| `listConversations()` | `{ views: ConversationView[]; unread: UnreadSummary }` |
| `openDirect(userId)` | `ConversationDoc` — deterministic id, created on first use |
| `createChannel(title, members)` | `ConversationDoc` |
| `openSubject(subject, title, members)` | `ConversationDoc` — work item / commit channel |
| `addMembers(convId, members)` | `ConversationDoc` — rotates the epoch |
| `removeMembers(convId, members)` | `ConversationDoc` — rotates the epoch |
| `getConversation(convId)` | `ConversationDoc \| undefined` |
| `maintainConversation(convId)` | `void` — targeted self-heal pass; the general pass runs automatically at startup and on every poll tick, so calling this is rarely needed |

### Messages

| Method | Returns |
| --- | --- |
| `recent(convId, limit?)` | `DecryptedMessage[]`, oldest first. Default 80 |
| `send(convId, body)` | `DecryptedMessage` |
| `editMessage(convId, messageId, body)` | `void` — author only |
| `deleteMessage(convId, messageId, attachments?)` | `void` — author only; removes attachment chunks too |
| `deleteConversation(convId)` | `{ attachmentsRemoved, chunksSwept, pagesRemoved, unreachableAttachments }` — destroys the conversation for **every** member: attachments, then pages, then the conversation document. Any member may call it; see [08-operations.md §8.3b](08-operations.md) |

### Attachments

| Method | Returns |
| --- | --- |
| `uploadAttachment(convId, file, onProgress?)` | `AttachmentManifest` |
| `downloadAttachment(convId, manifest, epoch, onProgress?)` | `Blob` — throws if the SHA-256 check fails |

### Polling

| Method | Notes |
| --- | --- |
| `startPolling(onUpdate, { activeSeconds?, idleSeconds? })` | Defaults 12 s / 60 s |
| `stopPolling()` | |
| `kick()` | Immediate refresh; called automatically after `send` |
| `markRead(convId)` | Moves the read cursor to the conversation's current count |

Every method except `init()` throws `"Secure Chat is still starting."` until
`init()` has resolved.

## 4.2 `crypto.ts`

Two interchangeable backends behind one API. No Azure DevOps imports, unit
tested in Node against both.

```ts
assertCryptoAvailable(): void   // throws only if getRandomValues is missing

// encoding
utf8 / fromUtf8 / b64encode / b64decode / randomBytes / randomId / equalStrings
sha256(input): Promise<string>         // base64

// identity
generateIdentity(): Promise<{ ecdh: EcKeyPair; ecdsa: EcKeyPair }>
exportPublicJwk(key): Promise<JsonWebKey>
importEcdhPublic(jwk) / importEcdsaPublic(jwk)
fingerprint(ecdhPub, ecdsaPub): Promise<string>   // "12345 67890 ..." × 12

// backend selection (see docs/02-crypto-design.md section 2.12)
backend(): "native" | "js"        // WebCrypto on HTTPS, @noble on HTTP
isFallbackBackend(): boolean
forceBackend("native" | "js" | "auto")   // test hook only

// private key persistence
persistablePrivate(priv): Promise<EcPrivateKey>
// native: re-imported non-extractable; js: the raw scalar

// symmetric keys
generateSymmetricKey() / generateConversationKey(): Promise<SymmetricKey>
importSymmetricRaw(bytes) / exportSymmetricRaw(key)

// conversation keys
deriveWrapKey(myEcdhPriv, theirEcdhPub, salt, info): Promise<SymmetricKey>
wrapConversationKey(ck, wrapKey) / unwrapConversationKey(sealed, wrapKey)

// payloads
sealBytes(key, plaintext, aad) / openBytes(key, sealed, aad)
sealJson(key, value, aad)      / openJson<T>(key, sealed, aad)

// signatures
signString(priv, s) / verifyString(pub, sig, s)
signBytes(priv, bytes) / verifyBytes(pub, sig, bytes)
```

Constants: `IV_BYTES = 12`, `SALT_BYTES = 16`, `CURVE = "P-256"`.

Key handles (`EcPrivateKey`, `EcPublicKey`, `SymmetricKey`) are opaque tagged
unions, not `CryptoKey`. No module outside `crypto.ts` inspects them, which is
what lets one set of call sites drive both backends.

## 4.3 `storage.ts` — `Store`

```ts
const store = await getStore();        // process-wide singleton

store.get<T>(collection, id, scope?)      // undefined instead of throwing on 404
store.list<T>(collection, scope?)         // [] instead of throwing on 404
store.put<T>(collection, doc, scope?)     // upsert
store.remove(collection, id, scope?)      // no-op when already absent
store.mutate<T>(collection, id, fn, scope?, attempts = 6)
store.getValue<T>(key, scope?) / store.setValue<T>(key, value, scope?)
```

`scope` is `"collection"` (default) or `"user"`.

`mutate` is the important one: it re-reads, applies `fn`, writes with the
current `__etag`, and on conflict retries against fresh state with exponential
backoff plus jitter. Return `null` from `fn` to abort without writing.

`assertDocId(id)` throws when an id exceeds 50 characters, rather than letting
the service truncate it into a collision.

## 4.4 `keystore.ts` — `Keystore`

```ts
ensure(): Promise<UnlockedIdentity>   // load from IndexedDB, or mint silently
reset(): Promise<void>                // forget this device; next ensure() bumps generation
forgetDevice(): Promise<void>         // module-level export
```

`ensure()` never prompts and never throws for a missing identity. The device
record notes which crypto backend wrote it; a record from the other backend is
ignored and a new generation is minted, because a raw scalar and a `CryptoKey`
handle are not interchangeable.

## 4.5 `keyring.ts` — `Keyring`

```ts
publish(identity): Promise<KeyBundleDoc>   // idempotent
all(force?): Promise<PeerKeys[]>
get(userId, force?): Promise<PeerKeys | undefined>
markVerified(userId): Promise<void>
acknowledgeChange(userId): Promise<void>
```

`PeerKeys.trust` is `"unverified" | "verified" | "changed"`. A bundle whose
self-signature fails verification is dropped silently from `all()` rather than
rendered — a malformed or tampered bundle must not be selectable as a
conversation member.

## 4.6 `conversations.ts` — `Conversations`

```ts
maintain(convDocs, peers): Promise<void>        // self-healing pass: re-wrap + clear-to-e2ee upgrade
mine(): Promise<ConversationDoc[]>              // membership filtered, newest first
get(id) / list()
keyFor(conv, epoch): Promise<SymmetricKey>      // throws when no wrap exists for you
openDirect(otherUserId)
createChannel(title, memberIds)
openSubject(subject, title, memberIds)
addMembers(convId, ids) / removeMembers(convId, ids)
rename(convId, title)
toView(conv, unread, nameOf): Promise<ConversationView>
```

Module functions `dmId(a, b)` and `subjectId(subject)` produce the deterministic
16-character ids described in [03-data-model.md](03-data-model.md).

## 4.7 `messages.ts` — `Messages`

```ts
send(convId, body, options?): Promise<DecryptedMessage>
recent(convId, limit?): Promise<DecryptedMessage[]>
page(convId, page): Promise<DecryptedMessage[]>
edit(convId, messageId, body): Promise<void>
remove(convId, messageId): Promise<void>
```

`recent` never drops a message it cannot read. It returns a `DecryptedMessage`
with `failed` set and `authentic: false`, so a key problem is visible in the UI
instead of appearing as missing history.

## 4.8 `files.ts` — `Files`

```ts
upload(conversationKey | null, file, onProgress?): Promise<AttachmentManifest>
download(conversationKey | null, manifest, onProgress?): Promise<Blob>
remove(manifest): Promise<void>
collectGarbage(liveBlobIds: Set<string>): Promise<number>
saveBlob(blob, filename): void          // module-level, triggers the browser save
```

`download` verifies SHA-256 against the manifest and throws rather than handing
back a corrupted file.

`collectGarbage` deletes any chunk whose `blobId` is not in `liveBlobIds`. The
caller must build that set by decrypting every page it can read — so only run it
from a client that holds all the relevant keys, or it will delete live data.

## 4.9 `mentions.ts`

```ts
parseMentions(text, { knownUsers }): Mention[]     // pure, sorted, non-overlapping
segment(text, mentions): Segment[]                 // alternating text / mention
memoiseResolver(resolver, max = 200): Resolver     // LRU around the REST lookups
```

Grammar: `#123` work item, `!123` pull request, 7–40 hex characters commit,
`@Display Name` user, `http(s)://…` URL. Users are matched longest-name-first
and URLs are claimed before bare tokens, so a sha inside a link is not counted
twice.

## 4.10 `devops.ts`

The only module that calls Azure DevOps REST.

```ts
currentProject(): Promise<IProjectInfo | undefined>    // memoised
collectionMembers(force?): Promise<DirectoryResult>    // collection-wide, memoised
navigateTo(url): Promise<void>
resolveMention(mention): Promise<ResolvedRef | undefined>
firstWorkItemId(context) / firstCommitId(context)      // menu action payloads
```

A bare sha carries no repository, so `resolveMention` probes the project's
repositories in order and stops at the first hit, capped at 10 probes.

## 4.11 `notifications.ts`

```ts
class ReadState {
  summarise(conversations, myUserId): Promise<UnreadSummary>
  markRead(conv): Promise<void>
}

class Poller {
  constructor(store, { activeSeconds, idleSeconds, onTick, onError })
  start() / stop() / kick()
}

requestDesktopPermission(): Promise<boolean>
notifyNewMessages(senderName, conversationTitle, count): void
```

`notifyNewMessages` deliberately carries **no message text**. Handing plaintext
to the operating system's notification centre would undo the encryption.

`Poller` doubles its interval on each consecutive failure, up to 8×, and
refreshes immediately when the tab becomes visible.
