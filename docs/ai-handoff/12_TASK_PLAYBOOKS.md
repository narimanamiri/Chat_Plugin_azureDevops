# 12 - Task playbooks

Each playbook is specific to this repo. Symbols are exact; find lines with `grep -n "<symbol>" <file>` (lines drift). "Run the gate" means:

```bash
bash docs/ai-handoff/tools/run_gate.sh     # must end with GATE PASSED
```

(type-check + rebuild of the compiled core + all test suites + fuzz; details in `08_`.)

Golden rules for every task: read the target file first; change the smallest thing; never edit `NAMESPACE`, ids, or manifest identity unless the task says so; update docs (`MAINTENANCE.md`).

---

## 1. Fix a bug in sending, reading, ordering, unread, deletion

1. **Start**: reproduce it with a test. Open `tests/features.test.mjs`, copy the header and one test. Use `asAlice`/`asBob`. Knobs: `harness.state.latencyMs`, `failWritesWithStatus`, `sdkUserHasNoName`, `calls`, `byCollection`.
2. **Inspect**: `src/core/messages.ts` (`send`, `recent`, `present`), `conversations.ts`, `notifications.ts` (`ReadState`), `client.ts` (facade).
3. **Change**: fix in the lowest layer that owns the behaviour (core before client before Hub).
4. **Do not**: use `Store.put` for a document another client might write (use `mutate`); add an `await` of network work to `ChatClient.init`; write a sort comparator that never returns 0; compute a name from an id string.
5. **Affected**: everything funnels through `ChatClient`, so grep callers: `grep -rnE "\.theMethod[<(]" src tests` (the `[<(]` also catches generic calls such as `.mutate<T>(`).
6. **Verify**: new test failed before, passes after; run the gate.

## 2. Add or change a field in stored data (no migration framework)

Example: add `pinned?: boolean` to messages.
1. `src/core/model.ts`: add the **optional** field to `StoredMessage`; if the UI renders it, add to `DecryptedMessage` too.
2. `src/core/messages.ts` `present()`: **add it to the explicit property list** - `present` builds a new object and silently drops anything not listed (this is how `reactions` would have been lost).
3. Any code that rebuilds a stored message: `edit` and `react` spread `...original` (field survives); `remove` builds the tombstone by listing fields - decide whether the field should survive deletion.
4. Read side must tolerate absence (old messages lack it).
5. **Do not** bump `NAMESPACE`, rename existing fields, or change types of existing fields.
6. Test in `tests/features.test.mjs` (write -> read via a second user). Gate.
7. Update `06_DATA_AND_DATABASE.md` (document table + "optional fields" list).

## 3. Add a new kind of document / collection

Only if truly needed (each collection is another thing to list and delete).
1. `model.ts`: add an interface extending `StoredDoc`, add to `COLLECTIONS` via `ns("name")`.
2. Check the id fits 50 chars (`assertDocId` will throw otherwise).
3. Access it only through `Store`; use `mutate` if multi-writer.
4. **Deleting a conversation must also delete it**: edit `ChatClient.deleteConversation`.
5. Test it, including deletion; update `06_`.

## 4. Add or change a UI string / language

1. `src/core/i18n.ts`: add the key to the `Strings` interface, then to **both** `EN` and `FA` (the compiler rejects a missing one). Placeholders `{n}`, `{name}`; numbers passed through `translator` become Persian digits in `fa`.
2. In a component: `const { t } = useLang();` then `t("yourKey", { n: 3 })`. `components.tsx` supplies `LangContext`.
3. **Not localised, edit separately**: Widget text (`Widget.tsx`), menu labels (`azure-devops-extension.json` `properties.text`), HTML `<title>`s.
4. Unused keys are not detected by the compiler (5 exist today).
5. Get Persian reviewed by a native speaker; do not machine-polish idioms.
6. Gate; check LTR and RTL in `layout-harness.html`.
7. Adding a third language: extend `Lang`, `LANGUAGES`, `STRINGS`, `dirOf`, `localeOf`, and replace `LanguageToggle` (it flips between exactly two).

## 5. Change layout, colours, RTL

1. `src/styles.css` only. Light palette in `:root`, dark in `html[data-theme="dark"]` (set by `applyHostTheme` in `Hub.tsx`; **the Widget never sets it**).
2. Use CSS **logical properties** (`margin-inline-start`, `inset-inline-end`, `border-start-end-radius`, `text-align: start`). Do not write `left`/`right` for things that should mirror in Persian.
3. Verify in `docs/ai-handoff/tools/layout-harness.html`: LTR/RTL x light/dark; no horizontal overflow; bubbles inside the list.
4. If you change markup in `components.tsx`, mirror it in the harness.
5. Contrast: dark timestamp colour was tuned to 5.78:1 (AA); keep >= 4.5:1.

## 6. Change polling, unread logic, or what updates live

1. `src/core/notifications.ts` (`Poller`, `ReadState`) and the `startPolling` defaults in `client.ts`; consumers in `Hub.tsx` (effect that calls `client.startPolling`).
2. The Hub reads the open conversation through `selectedRef`; **never put `selectedId` in that effect's dependency list** (it tears down the poller on every switch).
3. `focusCycle` only fires `onFocusTick` when the fingerprint changes. If your change needs other users' edits/reactions/deletes to appear live, that is the **known gap** in `13_`; any fix must keep an idle open chat at one cheap read per 5 s.
4. Verify cost with `harness.state.byCollection` counters (pattern: test "a re-read stays cheap"). Timers themselves are untested (no DOM in the harness).

## 7. Change who appears in the people picker / directory

1. `src/core/devops.ts` `loadDirectory` (stages 1-3) and `searchPeople`. Limits are the constants at the top (`MAX_TEAMS`, `CONCURRENCY`, timeouts).
2. A stage must only "win" if it yields **people**.
3. **Cannot be verified without a live host** (stubs return fixed data). Say so in your report.
4. `looksLikeIdentityId` guards against SIDs/GUIDs as names - keep it in every path that gets or stores a name.

## 8. Change `#`, `!`, sha, `@name` parsing or add a mention kind

1. `src/core/mentions.ts` regexes and `parseMentions`; `MentionKind` in `model.ts`.
2. Resolution: `devops.ts` `resolveMention` `switch (mention.kind)`; chip sigil table `KIND_SIGIL` in `components.tsx`.
3. Add cases to `tests/mentions.test.mjs`. Beware: the commit regex also matches 7+ digit numbers and words made of a-f (known issue).
4. Build URLs with `hostBaseUrl()` + `encodeURIComponent`, **not** `window.location.origin`.

## 9. Change attachments

1. `src/core/files.ts`; constants `CHUNK_BYTES`, `MAX_ATTACHMENT_BYTES`, `CHUNK_CONCURRENCY` in `model.ts`.
2. Keep `download` assembling by index. Keep chunk ids `${blobId}_${index:5}` (<= 50 chars).
3. Do not raise `CHUNK_BYTES` without measuring the server's document-size limit.
4. Deleting must stay manifest-driven (`ChatClient.deleteConversation`); never reintroduce a whole-collection list on the delete path (a test asserts `list` count on `v3_blobs` is 0).

## 10. Add a menu action or any new manifest contribution

1. `azure-devops-extension.json`: add a contribution (`type: "ms.vss-web.action"`, `targets`, `properties.uri: "dist/actions/Actions.html"`, `registeredObjectId`).
2. `src/Actions/Actions.ts`: `SDK.register("<registeredObjectId>", { execute: async (context) => ... })`. Log `context` once on a live host; the context types in `devops.ts` are guesses.
3. Park a `{subject, title}` via `park()`; extend `ConversationSubject["type"]` and `ConversationKind` in `model.ts`, and `subjectId` if keyed differently.
4. A new contribution target or scope needs **uninstall + reinstall** on existing collections.
5. Not testable here. Bump version (playbook 14).

## 11. Add a manifest scope

Edit `scopes` in `azure-devops-extension.json`, justify it in `11_`, bump version, and tell admins to reinstall (update will not prompt).

## 12. Authentication / authorization changes

There is no auth code to change; identity is the host's. Real server-side authorization is impossible with this architecture (see `11_`). If asked to "make it private", the honest options are: reintroduce encryption (large, previously failed on key management - read the header of `crypto.ts` and `15_`), or add a server (breaks the air-gap premise). Raise it with the owner before building anything.

## 13. Background jobs

There are none outside the browser tab. Periodic work belongs in `Poller` or a Hub effect and runs **per open tab**, so keep it cheap and idempotent. Do not add cross-user maintenance that assumes a single runner.

## 14. Release (version bump, package, hand over)

Follow `10_DEPLOYMENT_AND_OPERATIONS.md` "Release procedure". Three version strings must match: `package.json`, `azure-devops-extension.json`, `client.ts` `EXTENSION_VERSION`. Update `overview.md` when behaviour changes. Do not commit or push unless the owner asks.

## 15. Roll back a bad release

Rebuild the previous tag with a **higher** version and upload it (`10_`). Never roll across a `NAMESPACE` bump.

## 16. Wipe / reset all chat data

Bump `NAMESPACE` (`model.ts`), release. Data is not deleted, only abandoned. Warn users: everyone starts empty.

## 17. Investigate a performance problem

1. Count calls: write a test using `harness.state.byCollection` (see "a re-read stays cheap", "deleting a conversation does not read the whole blob collection").
2. Known costs: slow tick = **two** whole-collection reads of `v3_conversations` (the poller's list, then `listConversations` inside Hub's `refresh`); every tab-visibility change forces another round (`kick`); idle open chat = one `get` per 5 s; loading the visible window = about **2 conversation gets + 2-3 page gets + read-cursor get/set** (measured on an 81-message DM: the head page may hold only a few messages, so 60 messages can span 3 pages); search = up to 60 page reads.
3. Do not add a feature that lists `v3_blobs` or `v3_pages` wholesale.

## 18. Update the user manual (shipped inside the package)

`overview.md`: English manual first, then Persian inside `<div dir="rtl" align="right"> ... </div>`. Keep both in sync; write Persian digits in prose. The file must stay UTF-8 and at the repo root (`content.details.path`). Verify it is in the `.vsix`: a `.vsix` is a zip; `python -c "import zipfile,sys; sys.stdout.reconfigure(encoding='utf-8'); print(zipfile.ZipFile('bin/<file>.vsix').read('overview.md').decode('utf-8')[:400])"` reads `overview.md` at the zip root (VERIFIED for 0.9.0). On Windows consoles always set the UTF-8 reconfigure, or printing Persian raises `UnicodeEncodeError`.

## 19. Add or update tests

Pattern in `09_TESTING_AND_DEBUGGING.md`. Add the new file to the `node --test` list in `package.json` and `08_`. Make a test fail first. Remember `tsc -p tsconfig.test.json` after editing `src/core`.

## 20. Refresh the knowledge graph and source index

`MAINTENANCE.md`.

## 21. Add a message action end to end (worked example: "Pin")

This is the full path from a button to the data service. Follow it for any per-message feature (pin, bookmark, flag...).

1. **Data** - `src/core/model.ts`: add `pinned?: boolean` (optional!) to `StoredMessage` and to `DecryptedMessage`.
2. **Read path** - `src/core/messages.ts` `present()`: add `pinned: item.pinned` to the explicit property list (otherwise it is silently dropped). Decide what `remove()`'s tombstone should keep (a deleted message should probably lose the pin).
3. **Write path** - `Messages`: add `pin(convId, messageId, value)` modelled on `react()`: `findPage`, then `store.mutate` on the page doc, find the item, return `null` if missing or `deleted`, return `{...current, items}` with a copied item. Decide the permission rule (react allows any member; edit/delete are author-only) and enforce it here. Note: neither `react` nor a new method checks that the caller is a conversation member - add the check if it matters.
4. **Facade** - `src/core/client.ts`: add `pinMessage(convId, messageId, value)` that calls `this.requireReady().msg.pin(...)` then `this.poller?.resetFocus()` (as `react` does).
5. **State/handler** - `src/Hub/Hub.tsx` `App`: add `handlePin` modelled on `handleReact`: optimistic `setMessages(...)`, call the client, on error `setError(...)` and reload with `loadMessages(client, convId, limitRef.current)`. Pass `onPin` to `<MessageList>`.
6. **UI** - `src/Hub/components.tsx` `MessageList`: new `onPin` prop; add a button inside `.sc-bubble-actions` (new path in `ICONS`, `title`/`aria-label` from `t("pin")`); show a pinned marker on the bubble. No storage access in components.
7. **Strings** - `src/core/i18n.ts`: add `pin`, `unpin`, `pinned` to `Strings`, then to **both** `EN` and `FA`.
8. **CSS** - `src/styles.css`: logical properties only; check LTR/RTL x light/dark in `docs/ai-handoff/tools/layout-harness.html` (update its markup copy too).
9. **Tests** - `tests/features.test.mjs`: two users; pin as Alice, read as Bob via `recent()`; unpin; pin on a deleted message is a no-op; an order/edit check. Run the gate.
10. **Docs** - `overview.md` (English and Persian), `05_`, `06_` (new optional field), `13_` (if you introduce a known gap).
11. **Known trap** - other users will not see the pin live until the fingerprint changes or the tab is refocused (KI-02). Do not "fix" that inside this feature unless asked.

## What not to do (any task)

- Do not "clean up" `crypto.ts` into a real crypto module, or remove `@noble/hashes`; `hashId`/`sha256` are load-bearing for ids and attachments.
- Do not rename `DecryptedMessage` or `crypto.ts` casually; many imports (and the graph) depend on them.
- Do not change `window.secureChatDiagnose` / `secureChatSweep` names without updating `09_` (they are the documented support tools).
- Do not commit `node_modules`, `dist`, `bin`, `tests/build` (gitignored).
