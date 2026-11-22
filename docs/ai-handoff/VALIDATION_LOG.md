# Validation log

How this knowledge base was checked, what the checks found, and what was **not** checked. Date: 2026-11-10. Repo state: git `b061bbb` + uncommitted work, version 1.0.0.

## 1. Mechanical checks (re-runnable)

| Check | Command | Result 2026-11-10 |
| --- | --- | --- |
| Every file path, symbol, `NN_` cross-reference, `KI-nn` id and Mermaid block in these docs resolves | `python docs/ai-handoff/tools/check_docs.py` | OK (17 docs, 543 file tokens, 170 symbol tokens, 26 KI ids) |
| Type-check + tests + fuzz | `bash docs/ai-handoff/tools/run_gate.sh` | GATE PASSED: tsc clean, `tests=57 pass=57 fail=0`, fuzz `60 steps -> 0 failure(s)` |
| `source-index.json` matches the graph | `python docs/ai-handoff/tools/build_source_index.py` | 20 files, 88 symbols, no stale entries; an independent reviewer found 0 line mismatches |
| Gate failure detection | synthetic output fed to the same parsing logic | detects test failures, fuzz failures, missing summary |
| KI-01 reproduces | `node docs/ai-handoff/tools/repro_ki01_sweep.mjs` | prints `attachment DESTROYED` (reproduced by the author and independently by the reviewer) |

## 2. Small-model simulation

A fresh read-only agent on a **small model tier (Claude Haiku-class, no conversation history)** was given only the repository, `docs/ai-handoff/`, and the graph CLI, and had to answer the 12 onboarding questions. It ran the type-check and test suite itself using the documented commands.

Round 1 (12 questions): **8 PASS, 4 PARTIAL, 0 FAIL.** It reproduced the build and test numbers exactly (57/57, fuzz 0).

| Q | Topic | Round 1 | Gap found | Fix made |
| --- | --- | --- | --- | --- |
| 3 | entry points | PARTIAL | no single list | "Entry points" table in `01_START_HERE.md` |
| 6 | add a feature | PARTIAL | only a field recipe, UI/i18n/ops scattered | worked end-to-end example "Pin" (`12_` section 21) |
| 8 | empty people picker | PARTIAL | `07_` overstated what the picker shows | corrected `07_`, `09_`; new KI-26 |
| 12 | impact of changing `Store.mutate` | PARTIAL | graph misses instance-field calls | stronger caveat with the real proof in `05_`, `MAINTENANCE` |

Round 2 (re-test of Q3, Q6, Q8, Q12 after the fixes, fresh agent): **A (entry points) PASS, B (Pin) PASS, C (picker) PARTIAL, D (impact) PARTIAL.** New defects it exposed, both fixed afterwards:
- the grep recipe in `01_`/`12_`/`MAINTENANCE` was `grep "\.method("`, which finds **zero** hits for `Store.mutate` because every call is the generic form `.mutate<T>(`. The correct pattern is `\.method[<(]` (11 real call sites); the docs now say so and show why;
- the picker wording and the "still scanning" case (KI-26).

**Not re-simulated after those last two fixes.** The corrected recipe was verified by running it (it returns the 11 sites).

Caveat: Haiku-class agents are weaker than a typical working model but are not the owner's actual target model; treat the result as evidence, not a guarantee.

## 3. Independent fact-check

A separate read-only agent (Sonnet tier) tried to **refute** the docs against the source. Result: no CONFIRMED known issue refuted; ~75 specific claims and all 88 `source-index.json` symbols verified; observed numbers matched. Errors it found and the disposition:

| Finding | Disposition |
| --- | --- |
| Opening a conversation cost was wrong (it is about 2 conversation reads + 2-3 page reads + cursor get/set) | corrected `12_` section 17, `03_` |
| `Store.put` is not used for profiles (only attachment chunks) | corrected `05_` |
| **Deleted/edited text lingers in `ConversationDoc.lastPreview`** | verified in source; new KI-21; corrected `03_`, `06_`, `11_`, `15_` D11 |
| "`javascript:` cannot be produced" overstated (render trusts stored mention values) | softened `11_`, `07_`; new KI-22 |
| Boot order: polling starts concurrently with the first refresh; `SDK.init/ready` have no timeout | corrected `03_`, `07_` |
| `memoiseResolver` is FIFO, caches failures; timeouts do not cancel requests | corrected `07_`; new KI-23 |
| `lastPreview` not always truncated; id lengths vary; fuzz overstated; KB vs KiB; fuzz "alternating" | corrected `06_`, `13_` KI-09, `04_`, `10_` |
| `visibilitychange` kick is a partial mitigation for KI-02; KI-03 and KI-04 are broader than first described | folded into KI-02/03/04, `03_` |
| Orphan chunks arise from ordinary failures; `loadMessages` has no staleness guard | new KI-24, KI-25 |
| `VALIDATION_LOG` was listed but did not exist | this file |
| 05 cited stale docs as evidence for platform limits | rewording in `06_` |

## 4. What was NOT verified (read this before trusting anything)

- **No live Azure DevOps host was ever used.** Directory enumeration, identity search, mention resolution links, menu-action contexts, theme sampling, hub URLs, install/upgrade/rollback and every "Extension Data Service" limit are INFERRED or NOT TESTED.
- **Mermaid diagrams were reviewed by eye and by the fact-checker, not rendered by a parser** (an attempt to load Mermaid from a CDN in the browser pane was blocked by the safety classifier and abandoned). They use quoted labels and `<br/>` line breaks.
- UI behaviour (React effects, scroll, toasts, RTL) is verified only by the static layout harness and by code reading.
- `npm run ...` was observed broken on the reference machine and not tested on a normal PATH; `npm ci` was not re-run.
- `graphify` was used in code-only mode (no LLM, no prose docs). Community names are neutral placeholders. Line numbers in docs are hints that drift after every edit.
- The prose docs `README.md` and `docs/01-08` were deliberately not used as evidence.
- Documentation was written by the same agent that built 1.0.0, then checked by two other agents; a human owner review has not happened.

## 5. How to repeat this validation

1. Run the three scripts in section 1.
2. Spawn a fresh agent with no context. Give it only the repo path, the instruction to start at `docs/ai-handoff/01_START_HERE.md`, a strict read-only rule, and these 12 questions: (1) what does the project do and not do; (2) how to build/run it from scratch and what is broken; (3) where are the entry points; (4) how a chat message travels through the code; (5) where a named business rule is implemented; (6) how to add a feature; (7) how to change the stored data shape safely; (8) how to debug a named common failure; (9) how to run the tests and know a change is verified; (10) how to deploy and roll back, and what must never change; (11) which components are dangerous; (12) how to find what a change to a named function affects. Ask for PASS / PARTIAL / FAIL per question with reasons, plus any doc-versus-source contradictions.
3. Fix every PARTIAL/FAIL in the docs and record it here.
