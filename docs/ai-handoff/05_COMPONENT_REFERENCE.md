# 05 - Component reference

Line numbers: graph-derived hints as of 2026-11-10 (`source-index.json` has the full table). If a line is wrong, `grep -n "<symbol>" <file>`.
Tests: `INT` = `tests/integration.test.mjs`, `FEAT` = `tests/features.test.mjs`, `MENT` = `tests/mentions.test.mjs`, `FUZZ` = `tests/fuzz.mjs`.

Graph caveat (CONFIRMED): graphify resolves imports, top-level calls and class-to-class references, but **not method calls made through instance fields** (e.g. `this.conversations.rename(...)`). Concrete proof: `graphify explain ".mutate()"` shows no callers at all, yet `grep -rnE "\.mutate[<(]" src` finds **eleven** call sites (`client.ts` publishProfile, `conversations.ts` x4, `messages.ts` x5, `notifications.ts` ReadState.write). The plain pattern `\.mutate\(` finds none, because every call is the generic form `.mutate<T>(`. (Depending on how your grep treats the dot, the result may also list the definition and the inner callback in `storage.ts`; those are not callers.) When you need "who calls method X", use grep - do not rely on the graph.

---

## `model.ts` - persisted shapes and constants
- **Location**: `src/core/model.ts` (types lines ~94-260; constants lines 21-80)
- **Responsibility**: single source of truth for every stored document, collection name, id budget and tuning constant.
- **Key symbols**: `NAMESPACE` (`"v3"`, :21), `COLLECTIONS` (:25), `PAGE_SIZE` 40 (:42), `CHUNK_BYTES` 64 KiB (:45), `MAX_ATTACHMENT_BYTES` 16 MiB (:48), `CHUNK_CONCURRENCY` 4 (:51), `TYPING_TTL_MS` 8000 (:54), `REACTION_EMOJI` (:75), `ProfileDoc` (:94), `ConversationDoc` (:114), `PageDoc` (:159), `StoredMessage` (:165), `BlobChunkDoc` (:193), `ReadStateDoc` (:203), `AttachmentManifest` (:227), `MessageBody` (:241), `DecryptedMessage` (:250).
- **Dependents**: every other core module.
- **Failure modes**: none at runtime (types and constants).
- **Modification risk**: **HIGH**. These are the on-disk contract. Changing a collection name, `NAMESPACE`, or an id format orphans existing data. Adding an *optional* field is safe (older builds ignore it). Details: `06_DATA_AND_DATABASE.md`.
- **Name trap**: `DecryptedMessage` is not decrypted from anything any more; it is just "message ready to render" (historical name).

## `storage.ts` - `Store`
- **Location**: `src/core/storage.ts` - `Store` :87, `mutate` :160, `isConflict` :46, `assertDocId` :78, `getStore` :213.
- **Responsibility**: the only code that talks to `IExtensionDataManager`. Converts 404 into `undefined`, enforces the 50-char id limit, applies a 20 s timeout (`STORE_TIMEOUT_MS`) to `get`, `list`, `put`, and `mutate`'s write.
- **Inputs/Outputs**: `get/list/put/remove(collection, ...)`, `mutate(collection, id, fn, scope="collection", attempts=6)`, `getValue/setValue(key, value, scope="user")` for the `$settings` area.
- **`mutate` contract**: reads the current doc, calls `fn(current)`; `fn` returns the new doc, or `null` to abort without writing. On HTTP 409 (or a message matching etag/conflict/modified) it retries with exponential backoff + jitter, up to `attempts`. **Only 409 is retried** (HTTP 400 is a permanent failure - an earlier version retried it and appeared to hang for 12 s).
- **Failure modes**: `"... timed out after 20000ms"`; `"Could not write ... after N attempts"`; `"Document id ... is N characters"`. **`remove`, `getValue`, `setValue` have no timeout** (CONFIRMED) - a stalled delete can hang.
- **Tests**: INT ("a permanent write failure is not retried", "storage lives under a versioned namespace"), plus everything transitively.
- **Modification risk**: **HIGH**. Anything that writes a document that another client may also write **must** use `mutate`, not `put`. `put` presents no `__etag` handling and is only safe for documents with a single writer. Today `Store.put` is called in exactly one place: attachment chunk documents in `files.ts` (profiles and read cursors both use `mutate`). See "ReadState" for the bug that taught this.

## `client.ts` - `ChatClient`
- **Location**: `src/core/client.ts` - class :71, `bootstrap` :789, `init` :107, `publishProfile` :189, `nameOf` :322, `searchMessages` :521, `deleteConversation` :636, `sweepOrphanChunks` :684, `startPolling` :706, `diagnose` :753.
- **Responsibility**: facade for the UI. Owns name resolution, profile publishing, presence throttle, typing throttle, search budget, polling wiring, object-URL cache for images.
- **Startup rule**: `init()` must stay fast and must not await network work; background work belongs in `warmUp()` (not awaited by `init`, awaited by `whenWarm()`).
- **Public methods** (UI-facing): `me`, `people`, `search`, `nameOf`, `listConversations`, `openDirect`, `createChannel`, `openSubject`, `addMembers`, `removeMembers`, `renameConversation`, `getConversation`, `recent`, `recentWindow`, `send`, `editMessage`, `react`, `deleteMessage`, `uploadAttachment`, `downloadAttachment`, `imageUrl`, `releaseImageUrls`, `setTyping`, `typersIn`, `searchMessages`, `presenceOf`, `touchPresence`, `deleteConversation`, `sweepOrphanChunks`, `startPolling`, `stopPolling`, `markRead`, `diagnose`, `directoryStatus`, `whenWarm`. (`ChatClient.kick` exists but nothing calls it; the `this.poller?.kick()` calls inside other methods are the `Poller`'s own method.)
- **Constants**: poll defaults 30 s / 120 s / 5 s; `SEARCH_PAGE_BUDGET` 60, `SEARCH_CONVERSATION_LIMIT` 40, `CONVERSATION_TIMEOUT_MS` 30 s, `EXTENSION_VERSION` "1.0.0" (:46, hand-maintained).
- **Globals set on `window`**: `secureChatDiagnose()` (safe, no message text) and `secureChatSweep()` (**DESTRUCTIVE, buggy** - see `13_`).
- **Failure modes**: `"Team Chat is still starting."` if a method is called before `init`; timeouts from `withTimeout`.
- **Tests**: INT, FEAT (almost everything), FUZZ.
- **Modification risk**: MEDIUM-HIGH. The name-safety code (`bestOwnName`, `publishProfile`, `nameOf`) exists to prevent raw SIDs from being stored; read its comments before touching it.

## `conversations.ts` - `Conversations`
- **Location**: `src/core/conversations.ts` - class :55, `dmId` :29, `subjectId` :32, `activeTypers` :41, `mine` :70, `openDirect` :95, `setTyping` :199.
- **Responsibility**: create/open DMs (deterministic id), channels (random id), subject conversations (work item / commit, deterministic id); membership edits; rename; typing flag; `toView` (title for display).
- **Key behaviours**: `create()` uses `store.mutate` upsert so two people opening the same DM at once converge. `mine()` = all conversation docs filtered to those containing the caller, sorted newest first with a stable tiebreak. `setTyping` never touches `lastActivityAt`; skipped when members > 12; single write attempt, errors swallowed.
- **Dependents**: `Messages`, `ChatClient`. **Tests**: INT (DM convergence, delete+recreate), FEAT (typing, rename).
- **Failure modes**: `"Conversation not found."`. **No membership check in `addMembers`/`removeMembers`/`rename`** (CONFIRMED) - see `11_`.
- **Modification risk**: HIGH for `dmId`/`subjectId` (changing the hash orphans every existing DM and work-item chat).

## `messages.ts` - `Messages`
- **Location**: `src/core/messages.ts` - class :52, `send` :69, `recent` :137, `search` :181, `present` :226, `edit` :253, `react` :279, `remove` :323, `findPage` :377, `previewOf` :43.
- **Responsibility**: all message storage logic.
- **`send` algorithm**: (1) `mutate` the conversation doc: take `index = messageCount`, increment, set `headPage`, `lastActivityAt`, `lastMessageId`, `lastSenderId`, `lastPreview` (first 120 chars); (2) `mutate` the page doc `${convId}_${page:5}` (page = `floor(seq/40)`), appending the message with `seq = index` (skipped if the id already exists). Not atomic.
- **`present`**: maps stored messages to render form, resolves sender names *now*, sorts by `seq`, falling back to `sentAt` then id for messages that predate `seq`.
- **`edit`/`remove`**: author only (throws `"Only the author can ..."`). `remove` writes a **tombstone** (`deleted: true`, empty body, keeps `id/senderId/seq/sentAt`). `react` toggles the caller's id in `reactions[emoji]`; refuses tombstones (returns `{}`).
- **`search`**: reads pages newest-first within a page budget; matches body text and attachment file names, case-insensitive substring; skips tombstones.
- **Tests**: INT, FEAT, FUZZ. **Modification risk**: HIGH. `seq` assignment and the two-step write are load-bearing; sort comparators must return 0 for ties (an inconsistent comparator once scrambled same-millisecond messages).
- **Dead code**: `Messages.page()` (:216) has no callers.

## `files.ts` - `Files`
- **Location**: `src/core/files.ts` - class :87, `pooled` :45, `upload` :90, `download` :145, `collectGarbage` :210, `removeByConversation` :195, `isImage`, `saveBlob`.
- **Responsibility**: split a `File` into 64 KiB pieces, base64 each into a `BlobChunkDoc` (`${blobId}_${index:5}`), 4 concurrent; `download` reassembles **by index** (not completion order) and verifies SHA-256 against the manifest; image width/height recorded via `createImageBitmap` when available.
- **Failure modes**: `"... is N MB. The limit is 16 MB."`; `"Attachment chunk i of n is missing."`; `"Attachment failed its integrity check and was not opened."`.
- **Tests**: INT (round trip, corruption detected), FEAT (multi-chunk concurrency, sweep).
- **Dead code**: `removeByConversation` (:195) is no longer called. **DANGEROUS**: `collectGarbage` deletes every chunk in the collection whose blob id is not in the set you pass.
- **Modification risk**: MEDIUM. Keep ordering-by-index in `download`; keep chunk id format.

## `notifications.ts` - `ReadState`, `Poller`
- **Location**: `src/core/notifications.ts` - `ReadState` :36, `markRead` :115, `Poller` :168, `focusCycle` :238, `notifyNewMessages` :291.
- **ReadState**: one user-scoped doc `v3_readstate/cursors` mapping convId -> `{count, lastReadMessageId, lastReadAt}`. `summarise` computes unread (`messageCount - cursor.count`, zero if you sent the last message). `markRead` **writes only if the cursor moves** and **writes through `mutate`** so the etag is fresh and tabs merge.
- **Poller**: see `03_ARCHITECTURE.md` (two loops). `kick()` restarts both; `resetFocus()` clears the fingerprint.
- **Tests**: FEAT ("two conversations ... does not 409", "merge across tabs", "writes nothing when the cursor has not moved"), INT ("an idle poll tick performs no writes"). The poller timers themselves are NOT TESTED (needs a DOM).
- **Modification risk**: MEDIUM-HIGH. The fingerprint omits page-level changes (see the known gap in `03_`).

## `devops.ts` - Azure DevOps integration
- **Location**: `src/core/devops.ts` - `hostBaseUrl` :51, `hubUrl` :64, `navigateToHub` :77, `looksLikeIdentityId` :108, `withTimeout` :187, `collectionMembers` :237, `loadDirectory` :248, `searchPeople` :400, `resolveMention` :456.
- **Responsibility**: everything that needs the live host. Full detail in `07_API_AND_INTEGRATIONS.md`.
- **Tests**: only via the stub (`tests/harness/stub-api*.cjs`), which returns a fixed team. **Resolution and navigation are NOT TESTED**.
- **Modification risk**: HIGH, and untestable here - changes cannot be verified without a live host. `resolveMention` builds links from `window.location.origin` (:470, :481, :497), which is probably wrong inside the sandboxed iframe (see `13_`).

## `mentions.ts`
- **Location**: `src/core/mentions.ts` - `parseMentions` :37, `segment` :106, `memoiseResolver`.
- **Responsibility**: pure tokenizer. Order of precedence: users (longest name first) > URLs > `#id` > `!id` > sha. Overlaps rejected, earliest matcher wins.
- **Tests**: MENT (10). **Known weakness**: the commit pattern `[0-9a-f]{7,40}` also matches plain numbers of 7+ digits (e.g. `1234567`) and ordinary words made of a-f letters (`defaced`), which then trigger REST probing (see `13_`).

## `i18n.ts`
- **Location**: `src/core/i18n.ts` - `Strings` interface, `EN` :119, `FA` :213, `translator` :323, `applyLanguage` :353.
- **Rule**: both `EN` and `FA` are typed `Strings`, so the compiler forces every key into both. Placeholders use `{name}` and numbers are rendered in Persian digits for `fa`.
- **Unused keys** (CONFIRMED): `copy`, `copied`, `lastSeenUnknown`, `notEncrypted`, `about`; unused export `LANGUAGES`.
- **Not localised**: Widget text, menu-action labels (manifest), `<title>`s, a few strings in `components.tsx` (`"Today"/"Yesterday"` are handled inline, `"link"` chip label, `"edited"` is localised).

## `Hub/Hub.tsx` - `App`
- **Location**: `src/Hub/Hub.tsx` - `App` :90, `applyHostTheme` :68.
- **Responsibility**: React state owner. Boots the client, runs the polling effects, opening/paging/search logic, optimistic send, edit, react, dialogs.
- **State worth knowing**: `selectedId` + `selectedRef` (the poller reads the ref), `limit/limitRef` (message window, +60 per "load earlier"), `total` (real message count; `hasOlder = messages.length < total`), `unreadOnOpen` (positions the unread divider), `typing`, `highlightId` (search jump).
- **Dialogs**: `"dm" | "channel" | "delete" | "deleteMessage" | "members" | "rename"`. Deletions use in-app `<Confirm>` (not `window.confirm`, which fails in sandboxed iframes).
- **Tests**: none (needs React + DOM). **Modification risk**: HIGH - effect dependency arrays are deliberate (see comments about the poller not restarting on selection change).

## `Hub/components.tsx`
- **Location**: `src/Hub/components.tsx` - `ConversationList` :207, `MessageList` :621, `Composer` :895, `Modal` :1163, `Confirm` :1212, `PeoplePicker` :1241; also `Avatar`, `Bell`, `LanguageToggle`, `SearchResults`, `Reactions`, `ReactionPicker`, `TypingLine`, `MemberList`, `MentionChip`, `Attachment`.
- **Rules**: no storage access; strings via `useLang()` context; layout in CSS logical properties; Latin identifiers inside Persian text are wrapped with `dir="ltr"`.
- **Tests**: none. Verified only by the static layout harness described in `09_`.

## `Widget/Widget.tsx` and `Actions/Actions.ts`
- **Widget**: `computeSummary` (:68) lists conversations + profiles directly through `getStore()`; renders count and up to 3 sender names; "Open chat" calls `navigateToHub("chat-hub")`. English-only; never sets `data-theme`, so it always uses the light palette (CONFIRMED in code; visual effect NOT TESTED).
- **Actions**: `park()` (:24) stores `{subject, title}` in the **user-scoped** setting `pending-subject` and navigates to the hub; the hub reads and clears it on load, then calls `openSubject`.

---

## Components that are dangerous to modify (summary)

| Component | Why |
| --- | --- |
| `model.ts` `NAMESPACE`, `COLLECTIONS`, id formats | Orphans every existing conversation, message, attachment |
| `conversations.ts` `dmId`, `subjectId` | Same - DM and work-item chats get new ids |
| `azure-devops-extension.json` `id` / `publisher` | Data store is scoped to publisher+extension id; changing orphans all data (docs/05 s5.4; INFERRED) |
| `Store.mutate` | Concurrency core; every shared write depends on it |
| `Messages.send` / `present` | `seq` allocation and ordering |
| `ReadState.markRead` | Etag handling; a regression reintroduces HTTP 409 on conversation switch |
| `client.ts` name logic | Regression stores raw SIDs permanently |
| `Poller` fingerprint | Controls what refreshes live |
| `Files.collectGarbage` / `sweepOrphanChunks` | Deletes other people's data |
