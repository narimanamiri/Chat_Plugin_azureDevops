# Maintaining this knowledge base

The handoff is only useful while it is true. Whoever changes the code updates the docs **in the same change**.

## 1. Which doc to update when you change X

| You changed | Update |
| --- | --- |
| A document shape, collection name, id format, constant in `model.ts` | `06_DATA_AND_DATABASE.md`; `05_` if a component's behaviour changed |
| A `ChatClient` method, or any core module's behaviour | `05_COMPONENT_REFERENCE.md` (+ `03_ARCHITECTURE.md` if a flow changed) |
| Anything in `devops.ts`, scopes, manifest contributions, a REST/SDK call | `07_API_AND_INTEGRATIONS.md`, and `11_` if scopes changed |
| Polling intervals, fingerprint, ReadState | `03_ARCHITECTURE.md` (polling section), `05_` |
| Build/test/package commands, dependencies, Node/tool versions | `08_DEVELOPMENT_SETUP.md`, `09_`, `10_` |
| Test files or harness features | `09_TESTING_AND_DEBUGGING.md` (+ counts here and in `01_`) |
| Release/install/rollback procedure, version number | `10_DEPLOYMENT_AND_OPERATIONS.md` (sha256 of the shipped `.vsix`), version strings in `01_`/`02_` |
| Authorization, input validation, anything security-relevant | `11_SECURITY_AND_CONFIGURATION.md` |
| A bug fixed / a new bug found | `13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`: mark the KI as fixed (keep the id, add date and commit) or add a new KI |
| A new term or concept | `14_GLOSSARY.md` |
| A decision made or reversed | `15_DECISIONS_AND_ASSUMPTIONS.md` |
| Files added, moved, deleted | `04_REPOSITORY_MAP.md` and `tools/build_source_index.py` (`FILES`) |
| A new kind of task became common | `12_TASK_PLAYBOOKS.md` |
| User-visible behaviour | `overview.md` (English **and** Persian) |

## 2. Refreshing the knowledge graph and the source index

```bash
graphify update .                                   # re-extract code only; no LLM, no network
graphify cluster-only . --no-label                  # OPTIONAL: reset community names (see below)
python docs/ai-handoff/tools/build_source_index.py  # regenerate docs/ai-handoff/source-index.json
```

What was **observed** (graphify 0.9.97, this repo, 2026-11-10):

- `graphify update .` is a code-only rebuild; it printed `Rebuilt: 392 nodes, 964 edges, 16 communities` and rewrote `graph.json`, `graph.html`, `GRAPH_REPORT.md` in `graphify-out/`. It first copies the previous graph into a dated folder (`graphify-out/2026-11-10/`).
- The repo's **`.graphifyignore`** (gitignore syntax) keeps prose docs, `package.json`, `tsconfig*.json`, `docs/` and `vsix/` out of the graph. Without it, `update` ingested `README.md`, `overview.md` and the stale `docs/0*.md` as heading nodes (graph grew to 671 nodes with false "keyring/epoch" concepts). Do not remove it; if you add prose docs you do want indexed, edit it deliberately.
- After a rebuild, **saved community names are re-applied by number** and can be wrong (communities get renumbered). Run `graphify cluster-only . --no-label` to reset them to neutral "Community N" names rather than keep misleading ones. Naming with an LLM (`graphify label`) was not used.
- `build_source_index.py` **fails loudly** if a symbol or file it lists disappeared (`STALE ENTRIES`). Fix the `FILES` / `SYMBOLS` lists at the top of the script, rerun. Labels follow graphify's forms: classes/consts/types `Name`, functions `name()`, methods `.name()`.
- Full semantic extraction of docs (`/graphify` skill) was deliberately **not** run (stale docs would poison it). To index the handoff prose later, remove `docs/` from `.graphifyignore` after rewriting the stale docs.

`graphify-out/` contents: `graph.json` (machine-readable), `GRAPH_REPORT.md` (god nodes, communities), `graph.html` (open in a browser), `manifest.json`, `cache/`, dated backup folders, small `.graphify_*` state files. Whether to commit `graphify-out/` is the owner's decision; it is currently untracked and not in `.gitignore`.

### Querying (what works and what does not)

```bash
graphify explain ".deleteConversation()"        # node + callers/callees with file:line  (best tool)
graphify explain "Messages"
graphify path "ChatClient" "Store"              # shortest dependency path
graphify query "deleteConversation" --budget 1500   # use EXACT symbol names
```

- Free-text questions ("how is a conversation deleted") match generic words and start from the wrong nodes (CONFIRMED). Use symbol names.
- Method names are not unique (`.send()` exists on `Messages` and `ChatClient`); the output shows the file, read it.
- The graph does **not** resolve method calls made through instance fields (`this.conversations.rename(...)`) - use `grep -rnE "\.rename[<(]" src tests` for "who calls this method" (the `[<(]` also matches TypeScript generic calls like `.mutate<T>(`). Proof: `graphify explain ".mutate()"` lists no callers, while grep finds eleven call sites. It is reliable for: what is defined where, imports, class-level references, top-level calls. For impact analysis of a method change, **start with grep**, then use the graph to see class-level neighbours.
- Never treat the graph as proof. Open the source.

## 3. Documentation consistency checklist (run before finishing a task)

- [ ] `python docs/ai-handoff/tools/check_docs.py` prints `OK` (every file path, symbol, `NN_` reference and `KI-nn` id resolves).
- [ ] Every file path I wrote exists (`ls`), every symbol still exists (`grep -n`).
- [ ] Commands in `08_`/`09_`/`10_` still work, or are labelled NOT TESTED.
- [ ] Test counts (57 = 10 + 26 + 21 at 1.0.0) and the fuzz result match what I just ran (`bash docs/ai-handoff/tools/run_gate.sh`).
- [ ] Version strings agree: `package.json`, `azure-devops-extension.json`, `client.ts` `EXTENSION_VERSION`, and `01_`/`02_`.
- [ ] No contradiction between `13_` (known issues) and other docs; fixed issues are marked, not deleted.
- [ ] `source-index.json` regenerated after any rename/move.
- [ ] Every claim is CONFIRMED / INFERRED / NOT TESTED / UNKNOWN - I did not call something working because a UI element exists.
- [ ] No secrets, tokens, personal data or real message text in any doc.
- [ ] `overview.md` English and Persian sections still match.

## 4. Evidence rules for writing docs here

Quote the symbol and file; add a line number only as a hint. Prefer a command the reader can run to verify. If you could not run it, say NOT TESTED. If code and an old doc disagree, the code wins - then record the discrepancy in `13_` section E.

## 5. When you are the weaker model

You may not understand a file fully. That is fine: change little, run the gate, report exactly what you verified and what you could not. Do not "tidy" things you were not asked to change.
