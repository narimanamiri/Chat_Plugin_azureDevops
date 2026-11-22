# 13 - Known issues and technical debt

Snapshot 2026-11-10, version 1.0.0. **Nothing here has been fixed by this documentation pass** (the assignment forbade code changes). IDs (KI-nn) are stable references; add new ones at the end.

Evidence: **CONFIRMED** = read in source and/or executed; **INFERRED** = strong code evidence, effect not observed live; **NOT TESTED** = needs a live host.

`TODO`/`FIXME`/`XXX`/`HACK` markers in `src/`, `tests/`, `scripts/`: **none** (CONFIRMED by grep). The debt below was found by reading, not by markers.

---

## A. Confirmed defects (fix first)

### KI-01 - HIGH - `secureChatSweep()` deletes other people's attachments  [CONFIRMED, executed]
- **Where**: `src/core/client.ts` `sweepOrphanChunks` (~:684) builds the "live" blob set from `this.conversations.mine()` - only conversations the **caller** belongs to - then calls `Files.collectGarbage(live)` (`src/core/files.ts` ~:210), which lists **every** chunk in `v3_blobs` and deletes each whose blob id is not in the set.
- **Failure**: user Carol runs `secureChatSweep()` in the console; every attachment in conversations Carol is not in is destroyed. It also deletes chunks of an upload still in progress (chunks exist before the message does).
- **Reproduction (executed in the in-memory emulator, nothing real touched)**: Alice and Bob share a conversation with an attachment; Carol (not a member) calls `sweepOrphanChunks()` -> returns 1 removed; Bob then gets `Attachment chunk 1 of 1 is missing.` The existing test only covered a single shared conversation, so it passed.
- **Exposure**: only via manual console call `secureChatSweep()` (registered in `bootstrap`). No UI button. **Tell users not to call it.**
- **Re-run it**: `node docs/ai-handoff/tools/repro_ki01_sweep.mjs` (after `tsc -p tsconfig.test.json`; prints `attachment DESTROYED` while the bug exists). Independently reproduced by a separate reviewer.
- **Fix direction**: compute the live set from **all** conversations in the collection (`Conversations.list()`; note `allAttachments` then reads every page of every conversation - a heavy read), and never delete chunks younger than some age (needs a timestamp on `BlobChunkDoc`, or skip while uploads may be in flight); or delete the helper. Add a test with three users and two conversations (turn the repro script into that test).

### KI-02 - MEDIUM - Other users' reactions, edits and deletions do not appear live  [CONFIRMED by reading; NOT TESTED live]
- **Where**: `Poller.focusCycle` fingerprint (`notifications.ts` ~:238) = `id|messageCount|lastMessageId|typing`; the slow tick in `Hub.tsx` (`client.startPolling` first callback) refreshes the sidebar only and does not call `loadMessages`.
- **Failure**: in an open conversation, someone reacts to / edits / deletes a message; you see it only after a new message arrives, typing state changes, you reopen the chat, or you act locally.
- **Partial mitigation**: regaining tab visibility calls `Poller.kick()`, which clears the fingerprint and forces a reload; so does your own send/rename/delete.
- **Why tests missed it**: tests re-read with `recent()`; the poller is never started in tests.
- **Fix direction**: bump a counter on the conversation doc for these actions (one extra write per action) and include it in the fingerprint, or reload the window every Nth fast tick. Keep an idle chat at one small read per 5 s.

### KI-03 - MEDIUM - A half-typed message follows you into another conversation  [CONFIRMED by reading; NOT TESTED in browser]
- **Where**: `<Composer>` in `Hub.tsx` (~:790) has no `key`; its `text`/`files` state (`components.tsx` ~:917) is reset only on send/cancel.
- **Failure**: type "hi" in chat A, click chat B: "hi" is still in the box and can be sent to B. `replyTo`/`editing` *are* reset on selection change in `Hub.tsx`, the draft and any pending attachments are not. Worse: if you were **editing** a message in A, the edited text is loaded into the box and becomes a plain draft in B. The typing flag is also published for B.
- **Fix direction**: `key={selectedId}` on `<Composer>` (and probably on `<MessageList>`, see KI-12).

### KI-04 - MEDIUM - Desktop toast suppressed after you read a conversation  [CONFIRMED by reading]
- **Where**: `Hub.tsx` slow-tick callback: `if (lastNotified.current[entry.convId] === entry.count) continue;` and the map is never cleared.
- **Failure**: message arrives (unread 1) -> toast; you read it (conversation leaves the active list); next message makes unread 1 again -> equal to the stored value -> **no toast**.
- Also, the map is written *before* the check that skips the conversation currently on screen, so viewing a conversation records its count too.
- **Fix direction**: delete `lastNotified.current[id]` when a conversation is not in `summary.active`.

### KI-05 - MEDIUM - Mention links built from the wrong origin  [CONFIRMED in code; effect INFERRED]
- **Where**: `devops.ts` `resolveMention` lines ~:470, :481, :497 use `window.location.origin` and an unencoded `project.name`.
- **Why wrong**: the extension runs in a sandboxed iframe whose origin is not the Azure DevOps product (Services serves extension content from a CDN origin). On Server the collection virtual directory (e.g. `/tfs/Collection`) is also missing. Clicking a `#1234` chip would navigate to a wrong or broken URL. The same bug was already fixed for hub URLs (`hostBaseUrl`, `hubUrl`) but not here.
- **Why tests missed it**: the harness fakes `window.location.origin` as `http://devops.local`.
- **Fix direction**: `await hostBaseUrl()` + `encodeURIComponent(project.name)`.

### KI-06 - MEDIUM (product honesty) - The app never tells users it is unencrypted  [CONFIRMED]
- `i18n.ts` has `notEncrypted` (EN + FA) but no component uses it. `static/logo.png` and `nav-icon.png` draw a **padlock** (`scripts/make_icons.py` `speech_bubble_with_lock`). Manifest `tags` include `encryption`, `e2ee`, `privacy`. `package.json` description says "End-to-end encrypted". Only `overview.md` and the manifest `description` state the truth.

### KI-07 - LOW-MEDIUM - Slow tick reads the whole conversation collection twice  [CONFIRMED by reading]
- `Poller.cycle` lists `v3_conversations`; the Hub's callback then calls `refresh()` -> `ChatClient.listConversations()` -> `conversations.mine()` -> lists again. Pass the already-fetched list through. Every tab-visibility change adds another round via `kick()`, and at boot the first poll runs concurrently with the initial `refresh()` (`03_`).

### KI-08 - LOW - Some storage calls have no timeout  [CONFIRMED]
- `Store.remove`, `getValue`, `setValue` do not use `withStoreTimeout` (`storage.ts`). A stalled delete (e.g. during conversation deletion) can hang indefinitely.

### KI-09 - LOW - `tests/fuzz.mjs` does not fail the process on a counted failure  [CONFIRMED]
- A failing loop step and the final "peer can read FINAL" check are only counted and printed (`-> N failure(s)`), exit code stays 0. (An exception in the setup or the final block, outside the `try`, would still crash non-zero.) Add `process.exit(failures ? 1 : 0)`. `tools/run_gate.sh` already enforces it.

### KI-10 - LOW - Stale product names and placeholders  [CONFIRMED]
- Manifest contribution texts: "Secure Chat" (`discuss-work-item`/`discuss-commit` menu text "Discuss in Secure Chat", widget name "Secure Chat unread", descriptions); `overview.md` tells users "Discuss in Team Chat" (mismatch). `<title>` in `Hub.html`, `Widget.html`, `Actions.html`. `configs/dev.json` name "Secure Chat (E2EE) [DEV]". Console log prefix `[secure-chat]` in `devops.ts` vs `[team-chat]` elsewhere. Placeholders: publisher `REPLACE_WITH_YOUR_PUBLISHER_ID`; `links.getstarted/support` = `https://example.invalid/...`.

### KI-11 - LOW - Widget is English-only and always light  [CONFIRMED in code; visual NOT TESTED]
- `Widget.tsx` has hard-coded English ("You are all caught up.", "Open chat", "Someone") and never calls `applyHostTheme`, so it uses the light palette even on a dark host.

### KI-21 - MEDIUM (privacy) - Deleted or edited text lingers in the conversation document  [CONFIRMED by reading]
- **Where**: `ConversationDoc.lastPreview` (first 120 chars of the newest message) and `lastMessageId` are written only in `Messages.send` (`messages.ts`). `Messages.edit` and `Messages.remove` rewrite the page document only. The sidebar renders `lastPreview` (`components.tsx` ConversationList).
- **Failure**: you delete (or edit away) the newest message; its original text is still in the conversation doc and shown in the sidebar for everyone until the next message is sent. Contradicts the "delete removes the content from the server" wording in the delete dialogs and `overview.md`.
- **Fix direction**: in `edit`/`remove`, when the target is the conversation's `lastMessageId`, update `lastPreview` in the same `mutate` flow (two documents again; keep it best-effort).

### KI-26 - LOW (UX) - Empty people picker says the directory "could not be read" during the first scan  [CONFIRMED by reading]
- **Where**: `devops.ts` `EMPTY_DIRECTORY` (source `"none"`, no error) is the snapshot until the first scan finishes; `PeoplePicker.emptyReason` (`components.tsx`) maps `source === "none"` to "The directory could not be read."
- **Failure**: a user who opens the picker in the first seconds sees a failure message for what is only "still loading". Also the picker shows just the last log line of a failed scan, never the whole log.
- **Fix direction**: distinguish "not finished yet" (e.g. a `loading` flag on the snapshot) from "finished with nothing".

---

## B. Potential problems (INFERRED)

| ID | Problem | Evidence |
| --- | --- | --- |
| KI-12 | `<MessageList>` is not keyed per conversation: scroll bookkeeping refs (`previousCount`, `atBottomRef`, `heightBeforePrepend`) carry over when switching chats, so you may not land at the bottom | `Hub.tsx` renders it without `key`; `components.tsx` refs are component-lifetime |
| KI-13 | `hasOlder = messages.length < total`; `total` is `messageCount`, which also counts **empty slots** left when write 2 of a send fails. After such a failure "Load earlier messages" never goes away, and scrolling to the top keeps re-fetching | `messages.ts` `send` two-step; `Hub.tsx` `hasOlder` |
| KI-14 | A failed second write also inflates other users' unread counts by one | same |
| KI-15 | No message-length limit; a huge paste can exceed the (undocumented) document size and fail the page write after the slot was reserved | no check in `Messages.send` or `Composer` |
| KI-16 | Commit pattern `[0-9a-f]{7,40}` matches plain 7+ digit numbers (`1234567`) and a-f words (`defaced`), each triggering `getCommit` probes on up to 10 repositories | `mentions.ts` `COMMIT` |
| KI-17 | Client-side-only authorization: any member can alter any document via REST; `addMembers/removeMembers/rename/react` do not check membership | `11_` |
| KI-18 | Whole-collection list every 30 s per open tab scales with total conversations of all users | `Poller.cycle` |
| KI-19 | Real-host behaviours never exercised: theme sampling reads CSS var `--background-color`; identity-search id mapping (`localId`/`entityId`/`originId`); menu-action context shapes; `getAllTeams(false, 201)` parameters; hub URL via `getResourceAreaLocation` | all stubbed in tests |
| KI-20 | Rollback procedure and gallery behaviour with lower versions are unverified | `10_` |
| KI-22 | Stored `mentions[]` values are trusted at render: `resolveMention` turns a `url` mention's stored value into `href` and `navigateTo` with no scheme check, and `segment()` offsets are not validated against the text. A client writing documents directly could store any scheme. Host/browser blocking of such a URL is NOT TESTED | `devops.ts` `resolveMention` (kind `url`), `components.tsx` `MentionChip` |
| KI-23 | Timeouts do not cancel the underlying request (`withStoreTimeout`, `withTimeout`). A write reported as timed out can still land; the send path then shows an error and keeps the text, so a retry produces a **duplicate message** (new id) or a ghost reserved slot | `storage.ts`, `devops.ts` |
| KI-24 | Orphan attachment chunks arise from ordinary failures, not only crashes: a failed `client.send` after upload, or a failing chunk lane while the other lanes finish (`pooled`). The composer keeps the files, so a retry re-uploads under a new blob id. The only cleanup tool is the destructive `sweepOrphanChunks` (KI-01), so orphans accumulate toward the 100,000-document cap | `Hub.tsx` `handleSend`, `files.ts` `pooled` |
| KI-25 | `loadMessages` has no staleness guard: a slow response for conversation A can overwrite the list after switching to B; `handleSend` does `setTotal(n+1)` without checking the conversation, which can create a permanent "Load earlier" (like KI-13). Not executed | `Hub.tsx` |

---

## C. Dead code (CONFIRMED by exact grep; safe candidates for removal, not removed)

`fromUtf8` (`crypto.ts:38`), `LANGUAGES` (`i18n.ts:21`), `Messages.page` (`messages.ts:216`), `ChatClient.kick` (`client.ts:735`), `Files.removeByConversation` (`files.ts:195`, now only mentioned in a comment), `ICONS.copy` (`components.tsx`), five unused i18n keys (`copy`, `copied`, `lastSeenUnknown`, `notEncrypted`*, `about`) - *`notEncrypted` should be **used**, see KI-06. Unused npm dependencies: `@noble/ciphers`, `@noble/curves` (zero imports). The test harness still installs an IndexedDB shim nobody uses.

Graph caveat: graphify's "no incoming edges" list is dominated by false positives because it cannot see method calls through instance fields; every candidate above was re-checked with `grep`.

## D. Technical debt

- **Misleading names**: `src/core/crypto.ts` (no cryptography), `DecryptedMessage` (nothing is decrypted), test titles/comments mentioning "device changes". Renaming touches many imports - do it deliberately.
- **Stale comments**: encrypted-era wording in `mentions.ts` (:9 "keyring", :18 "encrypted payload"), `messages.ts` :4, `files.ts` :6, `conversations.ts` :4, `model.ts`, `client.ts`, `crypto.ts` :20 (references non-existent `docs/02-security-model.md`), `devops.ts` ("cannot hold keys").
- **File size**: `src/Hub/components.tsx` (1,370 lines), `src/Hub/Hub.tsx` (968), `src/core/client.ts` (807) and `src/styles.css` (1,270) exceed the owner's 800-line guideline (line counts 2026-11-10); split by feature (list / messages / composer / dialogs).
- **Three version strings** edited by hand (`package.json`, manifest, `client.ts`).
- **No lint, no formatter config in repo, no CI, no coverage tool, no UI tests, no E2E.**
- **`npm run` broken on the reference machine** (PATH quote) - environment, not repo (`08_`).
- **`tests/features.test.mjs` and `tests/integration.test.mjs` duplicate helper setup**; extract to the harness.
- **Hard-coded English** strings remain outside `i18n.ts` (widget, a few labels).

## E. Stale documentation (do not trust; each file now has a banner)

| File | What is wrong |
| --- | --- |
| `README.md` | Claims end-to-end encryption (AES-256-GCM, ECDH, WebCrypto/HTTP fallback), "35 tests", safety numbers, key rotation, clear/encrypted modes, name "Secure Chat". Author line and install pointers are fine. |
| `docs/01-architecture.md` | Module map includes `keystore.ts`/`keyring.ts`; crypto-centred flow |
| `docs/02-crypto-design.md` | **Wholly obsolete** (entire design removed in 0.7.0) |
| `docs/03-data-model.md` | Says `NAMESPACE` is `v2` (it is `v3`); collections `keyring`/`self`/sealed titles no longer exist. Service limits, id budget, quota maths remain valid. |
| `docs/04-api-reference.md` | Documents `keystore.ts` and `keyring.ts` (deleted) and an old `crypto.ts` API |
| `docs/05-build-and-package.md` | "20"/"35" tests, `tests/interop.test.mjs` (does not exist), unhashed bundle names, `crypto.subtle`/HTTPS rows, `@noble/curves`/`ciphers`. Publisher and versioning advice remain valid. |
| `docs/06-offline-install.md` | Key/safety-number/clear-mode steps and gallery name "Secure Chat (E2EE)" are wrong. Gallery upload steps, scope table and s6.12 (no cross-collection) remain valid. |
| `docs/07-roadmap-rnd.md` | Several backlog items are now built (reactions, search, edit, typing, presence, RTL). |
| `docs/08-operations.md` | `v2`, `keystore.ts`, 12 s polling, ciphertext-in-backups are stale. The `collectGarbage` warning is **still correct and now matters (KI-01)**. |
| `overview.md` | Accurate for 0.9.0; does **not** mention 1.0.0 features (reactions, edit, search, typing, presence, Persian UI, member management) and says "Discuss in Team Chat" (manifest says "Secure Chat"). |

## F. Missing test coverage worth adding first

1. Three-user sweep scenario (KI-01).
2. Poller/Hub behaviour with a DOM shim (KI-02, KI-04).
3. `resolveMention` URL construction with a fake `hostBaseUrl` (KI-05).
4. A component test for Composer draft isolation (KI-03).
