# 04 - Repository map

Every entry below was checked to exist on 2026-11-10. Status column: **live** = part of the shipped extension, **dev** = build/test tooling, **stale** = describes a removed design, **foreign** = not part of this project.

## Top level

| Path | Status | What it is |
| --- | --- | --- |
| `azure-devops-extension.json` | live | The extension manifest: id, version, scopes, 5 contributions, which folders ship. Publisher is a placeholder. |
| `overview.md` | live | Marketplace details page **and** the user manual (English + Persian). Packaged into the `.vsix` (`content.details.path`). Do not delete or move. |
| `package.json`, `package-lock.json` | dev | Scripts and dependencies. Version here must match the manifest and `EXTENSION_VERSION`. |
| `tsconfig.json` | dev | Type-check for `src/` (strict, `@core/*` alias, JSX). |
| `tsconfig.test.json` | dev | Compiles **only `src/core/`** to CommonJS in `tests/build/` for the tests. UI files are not covered by tests. |
| `webpack.config.js` | dev | Three bundles, content-hashed filenames, HTML pages, copies `static/`. |
| `configs/dev.json` | dev | `tfx` override for a side-by-side dev build (id `azdo-secure-chat-dev`). Its name still says "(E2EE)" - stale. |
| `README.md` | **stale** | Describes the old encrypted product ("AES-256-GCM", "35 tests"). Do not trust. |
| `LICENSE` | live | MIT. |
| `CLAUDE.md`, `AGENTS.md` | live | Pointers to `docs/ai-handoff/01_START_HERE.md` (added with this handoff). |
| `.gitignore` | dev | Ignores `node_modules/ dist/ bin/ *.vsix tests/build/ preview/ .preview/ .claude/launch.json`. |

## Source: `src/`

| Path | Status | What it is |
| --- | --- | --- |
| `src/core/model.ts` | live | All document shapes, collection names, `NAMESPACE`, tuning constants. **Start here** for any data question. |
| `src/core/storage.ts` | live | `Store`: typed Extension Data Service wrapper (timeouts, etag-retry `mutate`). |
| `src/core/client.ts` | live | `ChatClient` facade + `bootstrap()`. The only object the UI calls. |
| `src/core/conversations.ts` | live | Conversation lifecycle, membership, typing flag. |
| `src/core/messages.ts` | live | Append, paged read, search, edit, delete, reactions. |
| `src/core/files.ts` | live | Attachment chunking, concurrent IO, integrity check, orphan sweep. |
| `src/core/notifications.ts` | live | `ReadState` (unread cursors), `Poller` (2 loops), desktop toasts. |
| `src/core/devops.ts` | live | The only module calling Azure DevOps REST/SDK services. People directory, mention resolution, hub URLs. |
| `src/core/mentions.ts` | live | Pure parser for `#`, `!`, sha, `@name`, URL tokens. |
| `src/core/crypto.ts` | live (misnamed) | **No encryption.** base64, SHA-256, random ids. Header comment explains the history. |
| `src/core/i18n.ts` | live | EN + FA strings (`Strings` interface forces both to be complete), digits, direction. |
| `src/Hub/Hub.tsx` | live | Entry of the hub bundle. `App()` owns all state. ~970 lines. |
| `src/Hub/components.tsx` | live | All presentational components (~1,370 lines; the largest source file). |
| `src/Hub/Hub.html` | live | tiny HTML shell (`<div id="root">`). Title still says "Secure Chat". |
| `src/Widget/Widget.tsx` + `Widget.html` | live | Dashboard widget. English only. |
| `src/Actions/Actions.ts` + `Actions.html` | live | Menu-action handlers (no UI). |
| `src/styles.css` | live | Single stylesheet for all three bundles. |

## Tests: `tests/`

| Path | Status | What it is |
| --- | --- | --- |
| `tests/harness/index.cjs` | dev | In-process Azure DevOps emulator (see `09_`). Exports `bootWorld`, `asUser`, `resetWorld`, `addTeamMember`, `state`. |
| `tests/harness/stub-*.cjs` | dev | Stubs for `azure-devops-extension-sdk` and `-api` (+ Core, Git, Identities, WorkItemTracking). |
| `tests/mentions.test.mjs` | dev | 10 parser tests. |
| `tests/integration.test.mjs` | dev | 26 end-to-end tests (two+ simulated users on one store). Some titles/comments still speak of "device changes" from the encrypted era; the behaviour they test still holds. |
| `tests/features.test.mjs` | dev | 21 tests for 1.0.0 features and cost regressions. |
| `tests/fuzz.mjs` | dev | 60 randomised steps (fixed seed), each step a randomly chosen one of two users (a third is registered but unused); prints `... -> N failure(s)`. **Does not set a failing exit code** (CONFIRMED: file ends in `console.log`), so a fuzz failure would not fail a chained `npm test`. "Device change" is now just a new simulated browser profile - harmless since encryption was removed. |
| `tests/build/` | generated | Output of `tsc -p tsconfig.test.json`. Gitignored. Contains a `package.json` forcing CommonJS. |

## Documentation: `docs/`

| Path | Status | Notes |
| --- | --- | --- |
| `docs/ai-handoff/` | live | This knowledge base. **Authoritative.** |
| `docs/01-architecture.md` ... `docs/08-operations.md` | **stale** (partly reusable) | Written for the encrypted 0.2-0.6 design. Each now carries a banner. Still-valid parts are quoted in `10_`. `02-crypto-design.md` is wholly obsolete. `04-api-reference.md` documents `keystore.ts`/`keyring.ts`, which no longer exist. |

## Assets, scripts, artefacts

| Path | Status | Notes |
| --- | --- | --- |
| `static/logo.png`, `nav-icon.png`, `widget-icon.png` | live | Shipped icons. `logo.png` and `nav-icon.png` draw a **padlock** (misleading now). |
| `scripts/make_icons.py` | dev | Dependency-free PNG generator (`npm run icons`). Functions `speech_bubble_with_lock`, `bell`. |
| `vsix/` | **foreign** | Two third-party extensions (`InQubatorByQubiz.scrumbot-devops-extension-1.0.90.vsix`, `damienaicheh.rocket-chat-tasks-1.2.0.vsix`) downloaded during the first "find an existing plugin" request. Not used by this project. |
| `bin/` | generated | Built `.vsix` files, gitignored. Latest: `REPLACE_WITH_YOUR_PUBLISHER_ID.azdo-secure-chat-1.0.0.vsix`. Older `secure-chat-demo.*` files are history. |
| `dist/` | generated | webpack output, gitignored. |
| `preview/mock.html` | dev | Static layout harness for measuring CSS/RTL (gitignored; may be absent). |
| `graphify-out/` | generated | Knowledge graph (`graph.json`, `GRAPH_REPORT.md`, `graph.html`). See `01_START_HERE.md`. |
| `.claude/launch.json` | dev | Preview server config (port 8127, `python -m http.server`). Gitignored. |

## Where does X live? (quick lookup)

| Question | File |
| --- | --- |
| What can be stored, and under what name? | `src/core/model.ts` |
| How is a document id built? | `model.ts` (`COLLECTIONS`), `conversations.ts` (`dmId`, `subjectId`), `messages.ts` (`pageDocId`), `files.ts` (`chunkDocId`) |
| Where is the retry on HTTP 409? | `storage.ts` `Store.mutate` |
| Where are poll intervals? | `client.ts` `startPolling` defaults |
| Where is the membership check on send? | `messages.ts` `send` |
| Where are UI strings? | `src/core/i18n.ts` (`EN`, `FA`) - plus a few hard-coded English strings (see `13_`) |
| Where are the "Discuss in ..." menu labels? | `azure-devops-extension.json` (`properties.text`) - **not** in i18n |
| Where is the version? | `package.json`, `azure-devops-extension.json`, `client.ts` `EXTENSION_VERSION` (three places, edited by hand) |
| Where is the user manual? | `overview.md` (English then Persian inside `<div dir="rtl">`) |
