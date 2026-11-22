# START HERE

You are inheriting **Team Chat**: a chat extension that runs inside Azure DevOps (Server or Services). Version 1.0.0. State documented: 2026-11-10, git `b061bbb` + uncommitted work.

- **No backend.** All data = JSON documents in Azure DevOps' *Extension Data Service*, via `src/core/storage.ts`.
- **Stack**: TypeScript (strict), React 18, webpack 5, `tfx-cli` to build the `.vsix`. Tests: Node `node:test` against an in-memory emulator.
- **Owner**: Nariman Amiri. UI is English + Persian (RTL).
- Read this file fully (about 2 minutes). Then read **only** what your task needs.

## Names (one product, several names - do not be confused)

| Name | What it is |
| --- | --- |
| **Team Chat** | The current product name shown to users (manifest `name`, `overview.md`, UI). |
| `azdo-secure-chat` | The extension **id**. Permanent: it scopes the stored data. Never rename. |
| "Secure Chat" | The **old** product name. Still present in some manifest texts (menu item "Discuss in Secure Chat", widget "Secure Chat unread"), HTML titles, console log prefix `[secure-chat]`, `window.secureChatDiagnose`. Cosmetic leftovers (`13_` KI-10). |
| "Secure Chat (E2EE)" | Even older name (end-to-end encrypted). Only in `configs/dev.json` and the stale docs. |
| `DecryptedMessage`, `crypto.ts` | Legacy **code** names. Nothing is decrypted; `crypto.ts` only does base64, SHA-256 and random ids. |

## Five warnings (these have burned people)

1. **Messages are plaintext.** Encryption was removed in 0.7.0. The README and `docs/01-08` still describe the old encrypted design: **ignore them** (each has a banner).
2. **Never run `secureChatSweep()` / `ChatClient.sweepOrphanChunks`.** Confirmed bug: it deletes attachments of conversations the caller is not in (`13_` KI-01).
3. **Never change these casually:** `NAMESPACE` and collection names (`src/core/model.ts`), id formats, `dmId`/`subjectId`, manifest `id`/`publisher`. They orphan all stored data.
4. **Not live-tested.** The code has only run against the emulator in `tests/harness`. Anything touching real Azure DevOps (directory, mention links, menu actions, theme) is unverified. Say so in your report.
5. **`npm run ...` fails on the reference machine** (broken PATH entry). Use `bash docs/ai-handoff/tools/run_gate.sh` and the direct commands in `08_`.

## Which document to open

| The request | Open first | Then |
| --- | --- | --- |
| "What is this / explain it" | `02_PROJECT_OVERVIEW.md` | `03_ARCHITECTURE.md` |
| Fix a bug | `12_TASK_PLAYBOOKS.md` section 1 | `graphify explain` the symbol; write a failing test first |
| Add a feature | `12_` (sections 2-4) | `05_COMPONENT_REFERENCE.md` |
| Change stored data / add a field | `06_DATA_AND_DATABASE.md` | `12_` section 2 (the `present()` trap) |
| Change Azure DevOps calls, scopes, menu actions, mentions | `07_API_AND_INTEGRATIONS.md` | `12_` sections 7, 8, 10, 11 |
| Change UI text or language | `12_` section 4 | `src/core/i18n.ts` |
| Change CSS / RTL / theme | `12_` section 5 | `09_` "Manual layout checks" |
| Slow / too many requests | `12_` section 17 | `03_` polling; `06_` capacity |
| Run / build / install the toolchain | `08_DEVELOPMENT_SETUP.md` | |
| Tests fail / debug in browser | `09_TESTING_AND_DEBUGGING.md` | |
| People picker empty, or names wrong/missing | `09_` "Debugging a failure" + "Common errors" | `07_` "directory cascade"; run `await secureChatDiagnose()` |
| Release, install on a server, roll back | `10_DEPLOYMENT_AND_OPERATIONS.md` | `12_` sections 14-16 |
| Security question / permissions | `11_SECURITY_AND_CONFIGURATION.md` | |
| "Is X a known problem?" | `13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md` | |
| Unknown word | `14_GLOSSARY.md` | |
| "Why was it built this way?" / may I change it | `15_DECISIONS_AND_ASSUMPTIONS.md` | |
| Find a file or symbol fast | `04_REPOSITORY_MAP.md`, `source-index.json` | `graphify explain "<Symbol>"` |
| Update the docs after a change | `MAINTENANCE.md` | |

## The standard workflow (follow in order)

1. Read this file.
2. Name the task in one sentence.
3. Read only the documents from the table above.
4. Locate symbols: `graphify explain ".methodName()"` (exact name) or `grep -rn "symbol" src`. Line numbers in docs are hints.
5. **Open the real source** of every function you will change. Do not trust summaries, including these.
6. Before editing, list who uses it: `grep -rnE "\.method[<(]" src tests` (the graph misses calls through instance fields; the `[<(]` matters: TypeScript generic calls look like `.mutate<T>(`, and the plain pattern `\.mutate\(` finds **nothing**).
7. Make the smallest change that works. Do not refactor, rename or reformat unrelated code.
8. Run the gate (`bash docs/ai-handoff/tools/run_gate.sh`). For a bug: a new test must fail before and pass after.
9. Update the affected docs (`MAINTENANCE.md` table).
10. Report: what changed, which commands you ran and their result, what you could **not** verify.

## Entry points (where execution starts)

| What | File / symbol | How it is wired |
| --- | --- | --- |
| Hub page (the chat UI) | `src/Hub/Hub.tsx` bottom: `createRoot(...).render(<App />)`; `App()` | webpack entry `hub`; manifest contribution `chat-hub` -> `dist/hub/Hub.html` |
| Client boot | `bootstrap()` in `src/core/client.ts` | called by `App` in an effect on mount |
| Dashboard widget | `src/Widget/Widget.tsx` bottom IIFE, `SDK.register("chat-unread-widget", ...)` | entry `widget`; contribution `chat-unread-widget` |
| Menu actions | `src/Actions/Actions.ts` bottom IIFE, `SDK.register("discuss-work-item" / "discuss-commit", ...)` | entry `actions`; contributions `discuss-work-item`, `discuss-commit` |
| Build entries | `webpack.config.js` `entries` | `hub`, `widget`, `actions` |
| Tests | `tests/*.test.mjs`, `tests/fuzz.mjs`; emulator `tests/harness/index.cjs` | `08_` |

## Where things are

```
src/core/model.ts          every stored shape + constants (start here for data)
src/core/storage.ts        Store: the only code touching the data service
src/core/client.ts         ChatClient: the UI's only entry point; bootstrap()
src/core/messages.ts       send / read / search / edit / delete / react
src/core/conversations.ts  DMs, channels, membership, typing
src/core/files.ts          attachments (64 KiB chunk documents)
src/core/notifications.ts  unread cursors + the two polling loops
src/core/devops.ts         the only Azure DevOps REST/SDK caller
src/core/mentions.ts       #id !id sha @name url parser (pure)
src/core/i18n.ts           English + Persian strings
src/Hub/Hub.tsx            App(): owns all UI state     src/Hub/components.tsx   presentational parts
src/Widget/Widget.tsx      dashboard widget             src/Actions/Actions.ts   menu actions
src/styles.css             all CSS (logical properties, light/dark)
azure-devops-extension.json  manifest      overview.md  user manual (EN + FA), shipped in the package
tests/                     harness/ (emulator), *.test.mjs, fuzz.mjs
docs/ai-handoff/           THIS knowledge base       graphify-out/   code graph
```

## The gate (one command, a few seconds)

```bash
bash docs/ai-handoff/tools/run_gate.sh      # exit 0 and the words GATE PASSED, or it failed
```

It runs: type-check, rebuild of the compiled core for tests, the three `node:test` suites, and the fuzz script (and, unlike the fuzz script alone, **fails** when fuzz reports a failure). Expect `tests=57 pass=57 fail=0` and `GATE PASSED`. The individual commands are spelled out in `08_` if you need them. Package/build: `08_`. (VERIFIED: the script was run twice on 2026-11-10, both `GATE PASSED`; its failure-detection logic was checked on synthetic output, not on a real failing run.)

## Knowledge graph

`graphify-out/graph.json` (392 nodes, 964 edges, code only). Use exact symbol names:

```bash
graphify explain ".send()"             # who calls it, what it calls, file:line
graphify path "ChatClient" "Store"
graphify query "deleteConversation" --budget 1500
```

Free-text questions work badly; method calls via `this.field.method()` are invisible to it. Refresh and caveats: `MAINTENANCE.md`.

## Evidence labels used in all these docs

**CONFIRMED** read in source or executed - **INFERRED** strong evidence, not run - **NOT TESTED** identified, not executed - **UNKNOWN** not enough evidence. If something is not labelled in your own report, say which it is.

## Document index

`01_START_HERE` (this) - `02_PROJECT_OVERVIEW` - `03_ARCHITECTURE` - `04_REPOSITORY_MAP` - `05_COMPONENT_REFERENCE` - `06_DATA_AND_DATABASE` - `07_API_AND_INTEGRATIONS` - `08_DEVELOPMENT_SETUP` - `09_TESTING_AND_DEBUGGING` - `10_DEPLOYMENT_AND_OPERATIONS` - `11_SECURITY_AND_CONFIGURATION` - `12_TASK_PLAYBOOKS` - `13_KNOWN_ISSUES_AND_TECHNICAL_DEBT` - `14_GLOSSARY` - `15_DECISIONS_AND_ASSUMPTIONS` - `MAINTENANCE` - `VALIDATION_LOG` - `source-index.json` - `tools/` (`run_gate.sh` verification gate, `repro_ki01_sweep.mjs` reproduces KI-01, `build_source_index.py` regenerates the index, `check_docs.py` checks these docs' references, `layout-harness.html` CSS/RTL check)
