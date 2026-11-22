# 09 - Testing and debugging

## What exists

| Layer | Tool | Where | Count |
| --- | --- | --- | --- |
| Pure parser tests | Node built-in `node:test` | `tests/mentions.test.mjs` | 10 |
| End-to-end tests of the **real** `src/core` code against an emulated Azure DevOps | `node:test` + custom emulator | `tests/integration.test.mjs` | 26 |
| 1.0.0 feature and cost-regression tests | same | `tests/features.test.mjs` | 21 |
| Randomised stress | plain script | `tests/fuzz.mjs` | 60 steps |
| UI / React / CSS | **none automated** | - | - |
| Live Azure DevOps host | **none** | - | - |

No E2E framework (Playwright etc.) is configured. The user's global rules ask for 80% coverage and E2E tests; this repo does not meet that (NOT measured - no coverage tool is installed).

Commands: `bash docs/ai-handoff/tools/run_gate.sh` (one command; fails if fuzz fails) or the spelled-out version in `08_DEVELOPMENT_SETUP.md` "Run the tests". Current result (2026-11-10): **57 passed, 0 failed; fuzz 0 failures.**

## How the emulator works (`tests/harness/index.cjs`)

1. `bootWorld()` intercepts `require` of `azure-devops-extension-sdk` and `azure-devops-extension-api[/Core|/Git|/Identities|/WorkItemTracking]` (via `Module._resolveFilename`) and points them at `stub-*.cjs`. It also installs a fake `indexedDB` (leftover from the encrypted era, now unused), a minimal `window`/`document` (`window.location.origin` = `http://devops.local`, `document.hidden=false`, no-op listeners) and loads the compiled core from `tests/build/`.
2. The "server" is an in-memory `Map`: scope (`default` or `user:<id>`) -> collection -> id -> doc. `dataManager.setDocument` implements real etag semantics: a document carrying a stale `__etag` is rejected with status 409; `__etag` undefined or -1 is last-write-wins; every write bumps the stored etag.
3. `asUser(core, user, device, fn)` switches the current SDK user, resets process-wide singletons (`__resetStoreForTests`, `__resetDirectoryForTests`), creates and `init()`s a fresh `ChatClient`, runs `fn(client)`, then awaits `client.whenWarm()` so background startup cannot leak into the next simulated user. All users **share one document store**, which is what makes multi-user bugs reproducible.
4. Helpers: `resetWorld()`, `addTeamMember(teamId, id, displayName)`.

### Fault and measurement knobs (`harness.state`)

| Field | Effect |
| --- | --- |
| `latencyMs` | delays every data-service call |
| `failWritesWithStatus` | every `setDocument` rejects with that HTTP status |
| `sdkUserHasNoName` | SDK user has an id but no display name (SID-poisoning scenario) |
| `calls` | counts `{get, list, set, delete}` since last reset |
| `byCollection` | same counts per collection name, e.g. `harness.state.byCollection.get("v3_blobs")` |
| `documents` | the raw store, for assertions |

### Writing a new test (pattern)

```js
test("what should be true", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "hi" });
    return doc.id;
  });
  await asBob(async (bob) => {
    const [m] = await bob.recent(convId);
    assert.equal(m.body.text, "hi");
  });
});
```

Copy the header of `tests/features.test.mjs` (users, `asAlice`, `asBob`, `beforeEach` reset). Add the file name to the `node --test` list in `package.json` `scripts.test` **and** in the command in `08_`.

## What the tests CANNOT see (do not trust green here)

- Anything needing a real host: `devops.ts` directory/identity/mention resolution (stubs return fixed data), `Actions.ts`, URL building (`window.location.origin` is faked as `http://devops.local`, which hides the iframe-origin problem).
- `Poller` timers and visibility handling (`startPolling` is never called by tests).
- All React components, effects, scroll behaviour, CSS, RTL, theme sampling.
- Live propagation of other users' reactions/edits/deletes (tests re-read explicitly) - see the known gap in `03_`.
- Real data-service limits (document size, throttling).

## Manual layout checks (CSS / RTL)

`docs/ai-handoff/tools/layout-harness.html` is a static page that reproduces the component markup against the real `src/styles.css`, with buttons to flip `dir` (LTR/RTL) and theme. It is a **hand-written copy** of the markup: when you change `components.tsx`, update it or it will lie. Serve the repo root and open it:

```bash
python -m http.server 8127       # from repo root; .claude/launch.json uses the same port
# open http://localhost:8127/docs/ai-handoff/tools/layout-harness.html
```

Useful checks (run in the browser console): no horizontal overflow `document.documentElement.scrollWidth - document.documentElement.clientWidth === 0`; every `.sc-bubble` inside `.sc-messages`; timestamp (`.sc-meta`) not overlapping `.sc-text`; in RTL the sidebar's `getBoundingClientRect().left` is large (it moves to the right) and own bubbles sit on the left. A browser pane that is hidden reports a 0x0 viewport - set a size first (`resize_window`) before measuring.

## Debugging a failure in the real extension

1. Open the hub, press **F12**, switch the console to the hub's iframe context.
2. `await secureChatDiagnose()` - prints extension version, namespace `v3`, `me`, directory scan status **with a per-stage log**, profiles, per-conversation counts and member names. Contains no message text; safe to paste in a report.
3. Console prefixes: `[team-chat]` (most code) and `[secure-chat]` (older strings, mostly in `devops.ts`). Grep for both.
4. Where errors show: a red banner in the conversation header (when a conversation is open), or inside the dialog that triggered it (errors in the header are hidden behind modals); the composer shows its own error when a send fails and **keeps the text**; unexpected promise rejections go to the header banner via a global `unhandledrejection` handler.
5. Network tab: Extension Data Service calls should appear under `.../_apis/ExtensionManagement/InstalledExtensions/{publisher}/{extension}/Data/Scopes/...` (INFERRED from the public REST shape; NOT TESTED). A 401 across publisher or extension ids means the manifest identity changed.

## Common errors

Rows that quote an exact message come from our code and are CONFIRMED. Rows describing real Azure DevOps behaviour (empty picker causes, blank hub, handshake errors) are INFERRED / NOT TESTED against a live host.

| Message / symptom | Likely cause | Where to look |
| --- | --- | --- |
| `Could not write v3_... after 6 attempts: ...409` | A shared document was written with `put` (stale etag) or heavy contention | Use `Store.mutate`; `ReadState.write` is the model |
| `... timed out after 20000ms` | Server slow/unreachable; `Store` timeout | `storage.ts` `STORE_TIMEOUT_MS`; `remove`/`getValue`/`setValue` have no timeout |
| `Opening the conversation timed out after 30000ms` | `CONVERSATION_TIMEOUT_MS` | `client.ts` |
| `Conversation not found.` | Deleted by another member, or wrong id | `conversations.ts` |
| `You are not a member of this conversation.` | `Messages.send` membership check | `messages.ts` |
| `Only the author can edit/delete a message.` | author check | `messages.ts` |
| `Attachment chunk i of n is missing.` | orphaned/deleted blob, or `secureChatSweep()` ran | `files.ts` `download`; see `13_` data-loss bug |
| `Attachment failed its integrity check ...` | truncated/corrupt chunks | `files.ts` |
| `"<name>" is N MB. The limit is 16 MB.` | `MAX_ATTACHMENT_BYTES` | `model.ts` |
| `Team Chat is still starting.` | UI called a client method before `init` finished | `client.ts` `requireReady` |
| People picker empty | missing `vso.project` consent (uninstall + reinstall extension) or directory failure. The picker shows only the **last** directory log line, and says "The directory could not be read" even while the very first scan is still running (the empty snapshot has source `none`, KI-26); the full per-stage log is in `secureChatDiagnose().directory.log`. If typing 2+ letters finds people, only the REST cascade failed (identity search is the fallback) | `devops.ts` `loadDirectory`; `secureChatDiagnose().directory.log` |
| A person shows as a long id | profile not yet loaded; self-heals when the directory arrives | `client.ts` `nameOf`, `looksLikeIdentityId` |
| Hub blank, console shows a handshake error | iframe blocked, CSP, or `SDK.init` never completed | `bootstrap()` |
| `'"node"' is not recognized` when running `npm run` | malformed PATH entry on the dev machine | `08_` |
| Other users' reactions/edits do not appear until a new message | known gap | `03_` |

## "Is my change done?" checklist

1. `./node_modules/.bin/tsc --noEmit` is clean.
2. Run `bash docs/ai-handoff/tools/run_gate.sh`; it must end with `GATE PASSED`. (If you run the pieces by hand: rebuild tests with `tsc -p tsconfig.test.json` first, read the `fail` count, and read the fuzz line yourself - `fuzz.mjs` does not fail the process on a per-step failure.)
3. For a bug fix, a **new test fails before your change and passes after** (use `harness` knobs to reproduce).
4. `./node_modules/.bin/webpack --mode production` succeeds.
5. UI changes: checked in `layout-harness.html` in LTR+RTL and light+dark, or on a live collection.
6. The matching `docs/ai-handoff/` files are updated (`MAINTENANCE.md`).
7. You can state exactly what you did **not** verify (live host, UI behaviour).
