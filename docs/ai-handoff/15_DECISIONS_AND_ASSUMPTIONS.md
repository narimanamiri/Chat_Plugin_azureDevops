# 15 - Decisions and assumptions

## Confirmed decisions (evidence in the repo) - do not reverse casually

| # | Decision | Evidence | Why it matters |
| --- | --- | --- | --- |
| D1 | **No encryption.** Messages and files are plaintext since 0.7.0. | header comment of `src/core/crypto.ts`; `overview.md`; manifest description | The E2EE design failed on key management (device-bound keys, lockouts). Reintroducing it repeats that history. The owner explicitly ordered its removal ("remove encryption entirely"). Never promise privacy. |
| D2 | **No server of our own;** persistence = Extension Data Service only. | `storage.ts` is the only I/O layer | Enables a one-file, air-gapped install. Also the source of every size/limit constraint. |
| D3 | **Plain React 18 + hand-written CSS;** `azure-devops-ui` is not used. | `package.json`; `styles.css` header; docs/05 s5.1 | That library pins React 16.8. Costs: own components and theming. |
| D4 | **Polling,** two loops (30 s sidebar, 5 s open chat). | `notifications.ts` | Platform has no push. Do not add per-message full-collection reads. |
| D5 | **Deterministic DM / subject ids** (SHA-256 prefix). | `dmId`, `subjectId` | Two people opening the same DM converge without coordination. Changing the hash orphans every chat. |
| D6 | **Order by reserved `seq`,** not timestamps. | `messages.ts` `send`/`present` | Same-millisecond messages used to swap order differently per reader. |
| D7 | **Pages of 40 messages; attachment chunks of 64 KiB.** | `model.ts` | One poll = one conversation doc + one page. Chunk size is conservative because the document-size limit is undocumented. |
| D8 | **Names resolved at render time; ids that look like SIDs/GUIDs are never stored or shown as names.** | `client.ts` `nameOf`/`publishProfile`; `devops.ts` `looksLikeIdentityId`; tests | Persisting an id once poisoned every client permanently. |
| D9 | **`ChatClient.init()` is fast;** everything slow is in background `warmUp()`. | `client.ts` | An earlier version awaited directory scans and sat on "Loading..." for minutes. |
| D10 | **Writes to shared documents go through `Store.mutate`.** Only HTTP 409 is retried. | `storage.ts` | Retrying other statuses looked like a hang; `put` with a stale etag caused 409 storms. |
| D11 | **Delete is for everyone and removes content from the page documents** (tombstone), attachment chunks, and on conversation delete the pages and the doc. | `messages.ts` `remove`, `client.ts` `deleteConversation` | Owner asked for deletion "from server and everything". Cannot be undone; backups may keep copies. **Known exception:** the newest message's text can linger in `ConversationDoc.lastPreview` (KI-21). |
| D12 | **Namespace bump is the reset mechanism,** not migration code. | `model.ts` | Non-destructive. Do not bump for ordinary changes. |
| D13 | **Telegram-style UI;** CSS in logical properties; light/dark from the host. | `styles.css`, `Hub.tsx` | Owner request. RTL support depends on logical properties. |
| D14 | **Bilingual manual and UI (English, Persian)** with Persian digits; `overview.md` ships inside the package. | `overview.md`, `i18n.ts` | Owner request. Both languages must stay in sync. |
| D15 | **"Developed by Nariman Amiri"** appears in the About text (`overview.md`) and README. | `overview.md` | Owner request; keep it. |
| D16 | **Tests run the real core against an emulator,** not mocks of our own modules. | `tests/harness` | Every field bug was "two clients, one store"; unit tests of pure functions missed them. |
| D17 | **Bundle filenames carry a content hash.** | `webpack.config.js` | CDN caching once served old bundles so users ran different builds. |
| D18 | **Desktop notifications carry sender and conversation, never message text.** | `notifications.ts` `notifyNewMessages` | Text would appear on a possibly shared screen. |
| D19 | **Typing/presence/reactions reuse existing documents** (no new collections). | `model.ts` | Avoids more documents and more list calls; costs write contention on hot documents, hence caps (12 members, 3.5 s throttle, 6 fixed emoji). |
| D20 | **Search is bounded** (<= 40 conversations, <= 60 page reads). | `client.ts` `searchMessages` | The store cannot query; unbounded search would crawl the collection. UI should say results may be truncated. |

## Observed platform constraints

- Extension Data Service: 50-char ids, 100,000-doc "get all", undocumented doc size, per-collection and per-extension scoping. (`06_`)
- No cross-collection messaging; no global-header extension point; no push channel. (`02_`)
- Extension content runs in a sandboxed iframe on another origin: do not use `window.location.origin` to reach ADO; `window.confirm` may be blocked (use `<Confirm>`).
- Adding manifest scopes or contributions requires reinstall on existing collections.
- Browsers block desktop notifications on plain HTTP.

## Owner preferences observed in the conversation history (not recorded in the repo)

- "Do everything automatically; do not ask the client for anything; do not add clutter to the UI." No passphrases, no setup screens, no manual repair buttons.
- Must work over plain **HTTP** as well as HTTPS (no WebCrypto dependency remains).
- Test by **emulating** the environment before releasing; typecheck alone is not acceptable.
- Wants Telegram-like look and feel; wants Persian and English user manual in the About section.
- Reacts strongly to regressions in sending/reading. Treat any change touching send, read, names or read-cursors as high risk and test it with two simulated users.
- Prefers terse reports that state plainly what was and was not verified.

## Assumptions (unverified)

| # | Assumption | Risk if wrong |
| --- | --- | --- |
| A1 | The iframe origin differs from the product origin | If same-origin on Server, `window.location.origin` links might work there (KI-05) but still not on Services |
| A2 | Host exposes CSS variable `--background-color` for theme sampling | Theme detection falls back to OS preference |
| A3 | `searchIdentitiesAsync` results carry `localId` matching `SDK.getUser().id` | Messages could be addressed to the wrong id; picker names fine |
| A4 | `getAllTeams(false, 201)` and `getTeamMembersWithExtendedProperties(project, team, 500)` behave as the typings say on every supported Server version | Picker empty; the 3-stage cascade and identity search mitigate |
| A5 | Document size limit is comfortably above ~90 KB (one base64 chunk) and a 40-message page | Writes fail with 400; lower `CHUNK_BYTES`/`PAGE_SIZE` |
| A6 | Menu-action `context` contains `id`/`workItemId`/`ids` and `commitId`/`repositoryId` | "Discuss" does nothing; log `context` and adjust `Actions.ts` |
| A7 | A rollback by republishing under a higher version works | `10_` |
| A8 | Persian strings are correct and natural | Review by a native speaker (owner is one; machine-translated wording was written by an AI) |

## Unresolved questions for the owner

1. Final publisher id and whether Services (Marketplace) or Server-only.
2. Is plaintext acceptable long-term, or should a *server-managed* encryption design be explored? (D1 says no for now.)
3. Should `secureChatSweep()` be fixed or removed? (KI-01)
4. Replace the padlock icons and `e2ee` tags? (KI-06)
5. Rename `crypto.ts` / `DecryptedMessage`? (cosmetic, wide blast radius)
6. Which Azure DevOps Server version(s) are actually deployed (affects the scan and menu-action behaviour)?
7. Should `docs/01-08` and README be rewritten or archived now that `docs/ai-handoff/` exists?

## Do not change casually (checklist)

`NAMESPACE`; collection names; id formats; manifest `id`/`publisher`; `dmId`/`subjectId`; the two-step send; `Store.mutate` retry rule; `looksLikeIdentityId` usage; the `Strings` interface completeness rule; CSS logical properties; the position of the "Developed by" credit.
