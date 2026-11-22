# 08 - Development setup

Legend for every command: **VERIFIED** = executed successfully in this repo on the machine described below during the 1.0.0 work (typecheck and the full test suite were re-run on 2026-11-10; the production build and `tfx` packaging were run when 1.0.0 was produced, earlier in the same engagement, on the same tree). **NOT TESTED** = identified, not run. **BROKEN HERE** = fails on this machine for an environmental reason (workaround given).

## Reference machine (where VERIFIED applies)

Windows 11, Git Bash and PowerShell, Node **v24.18.0**, npm 11.16.0, Python 3.12 (graphify) / 3.x. Repo root: `E:\my python projects\Chat_Plugin_azureDevops`. The repo had `node_modules/` (370 entries) already installed.

## Required software

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 18+ (24.18 used) | build, tests |
| npm | 9+ (11.16 used) | install, lockfile |
| Python | 3.x, standard library only | `scripts/make_icons.py` and `docs/ai-handoff/tools/build_source_index.py` |
| `tfx-cli` | 0.21 (devDependency; run via `node_modules/.bin/tfx`) | producing the `.vsix` |
| graphify | 0.9.97, CLI `graphify` (installed globally, outside the repo) | optional: refresh the knowledge graph |

Browsers for users: current Chromium, Firefox or Safari. Azure DevOps target: Server 2020+ or Services (`azure-devops-extension.json` targets `Microsoft.VisualStudio.Services`).

## Environment variables and secrets

**None.** CONFIRMED: no `process.env` / `import.meta.env` / `localStorage` / `sessionStorage` / cookie use anywhere in `src/`, `tests/`, or `webpack.config.js`. There are no API keys. The publisher id is the only deployment-specific value (`azure-devops-extension.json`, or `--publisher` on the `tfx` command line).

## Install

```bash
npm ci          # NOT TESTED this session (node_modules already present). Uses package-lock.json.
```

`@noble/ciphers` and `@noble/curves` in `package.json` are **unused** (CONFIRMED: zero imports); only `@noble/hashes` is used. Removing them is safe but has not been done.

## IMPORTANT: `npm run <script>` is BROKEN on the reference machine

Symptom: `'"node"' is not recognized as an internal or external command`.
Cause (CONFIRMED): the machine's `PATH` contains a malformed entry `C:\Program Files\nodejs"` (stray double quote). `npm run` shells out to `cmd.exe`, which cannot resolve `node` through it. Both Git Bash and PowerShell hit it.
Fix on that machine: remove the stray quote from the PATH entry (user environment). On a normal machine `npm run ...` is expected to work (NOT TESTED).
Workaround that works regardless: call the tools directly, as below.

## Commands

| Goal | Command (run from repo root in Git Bash) | Status |
| --- | --- | --- |
| Type-check | `./node_modules/.bin/tsc --noEmit` | VERIFIED (exit 0, no output) |
| Production build | `./node_modules/.bin/webpack --mode production` | VERIFIED (3 bundles in `dist/`; hub ~439 KiB) |
| Dev build | `./node_modules/.bin/webpack --mode development` | NOT TESTED |
| Watch | `./node_modules/.bin/webpack --mode development --watch` | NOT TESTED |
| Full test suite | see "Run the tests" below | VERIFIED (57 pass, fuzz 0 failures) |
| Package `.vsix` | `./node_modules/.bin/tfx extension create --manifest-globs azure-devops-extension.json --output-path ./bin` | VERIFIED (produced `bin/REPLACE_WITH_YOUR_PUBLISHER_ID.azdo-secure-chat-1.0.0.vsix`) |
| Package with your publisher | add `--publisher YOUR_ID` | NOT TESTED |
| Dev-id package | add `--overrides-file configs/dev.json` | NOT TESTED |
| Regenerate icons | `python scripts/make_icons.py` | NOT TESTED |
| `npm run typecheck / build / test / package / icons / fuzz` | equivalents of the above (see `package.json` `scripts`) | BROKEN HERE |

### Run the tests (what `npm test` does, spelled out)

```bash
./node_modules/.bin/tsc -p tsconfig.test.json
node -e "require('fs').writeFileSync('tests/build/package.json','{\"type\":\"commonjs\"}')"
node --test tests/mentions.test.mjs tests/integration.test.mjs tests/features.test.mjs
node tests/fuzz.mjs
```

Expected tail: `tests 57`, `pass 57`, `fail 0`, then `60 randomised steps, device changes included -> 0 failure(s)`. Run time is a few seconds. The first line compiles `src/core/` only into `tests/build/`; **you must rerun it after editing any `src/core/*.ts` file or the tests will run stale code.**

## Local workflow

1. Edit `src/...`.
2. `./node_modules/.bin/tsc --noEmit` (fast feedback; strict mode).
3. If you touched `src/core/`, run the four test commands above.
4. `./node_modules/.bin/webpack --mode production` to make sure it bundles.
5. For UI changes there is **no live preview**: the hub needs an Azure DevOps host frame (`SDK.init` never resolves outside one). Options: (a) the static harness `preview/mock.html` (gitignored, may be absent) served by `python -m http.server`; see `09_`; (b) package a dev `.vsix` and install it on a real Server/Services collection.
6. Bump version in three places (`12_` "Release").

## Editor/formatter note

There is no Prettier/ESLint config in the repo, but files are reformatted after edits on the reference machine by a **global** formatter hook (INFERRED: files "changed on disk" and line counts grew after writes). Expect reflowed lines and shifting line numbers; never rely on line numbers across edits.

## Knowledge graph (optional)

```bash
graphify update .                                       # re-extract code, no LLM, no network
python docs/ai-handoff/tools/build_source_index.py      # regenerate source-index.json
graphify query "how does a message get sent" --budget 1500
graphify explain "Messages"
graphify path "ChatClient" "Store"
```

All VERIFIED except `update` (see `docs/ai-handoff/MAINTENANCE.md` for what was observed).
