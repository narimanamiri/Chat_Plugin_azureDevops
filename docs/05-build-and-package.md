> **STALE since 0.7.0 (checked 2026-11-10).** This file describes the earlier *end-to-end encrypted* design. Encryption was removed; messages are now plaintext. For current, verified documentation start at [`docs/ai-handoff/01_START_HERE.md`](ai-handoff/01_START_HERE.md). What in this file is still valid: `docs/ai-handoff/13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`, section E.

# 5. Build and package

## 5.1 Toolchain

| Tool | Version used | Why |
| --- | --- | --- |
| Node | 24.18 (18+ works) | Build, and `node:test` for the test suite |
| TypeScript | 5.6 | `strict` everywhere |
| webpack | 5 | Three entry points, three self-contained bundles |
| React | 18 | UI only |
| tfx-cli | 0.21 | Produces the `.vsix` |
| Python | 3.x | `scripts/make_icons.py` only, no third-party packages |
| @noble/curves, /ciphers, /hashes | 2.3 | Pure-JS crypto used when `crypto.subtle` is absent, i.e. on plain HTTP |

`azure-devops-ui` is deliberately **not** a dependency. It pins React 16.8 and
drags in a large tree; the UI here uses the CSS custom properties that
`SDK.init({ applyTheme: true })` injects, so it follows the host's light, dark
and high-contrast themes without a component library.

Nothing is loaded from a CDN. Every asset ships inside the `.vsix`, which is
what makes the air-gapped install in [06-offline-install.md](06-offline-install.md)
possible.

## 5.2 Scripts

```bash
npm install         # once
npm run icons       # regenerate static/*.png (only after editing the generator)
npm test            # compile src/core, run 20 node:test assertions
npm run typecheck   # tsc --noEmit
npm run build       # production bundles into dist/
npm run watch       # development bundles, rebuild on change
npm run package     # build + tfx extension create → bin/*.vsix
npm run clean       # remove dist/ and bin/
```

Expected output of `npm run build`:

```
hub/hub.js          413 KiB
widget/widget.js    221 KiB
actions/actions.js  153 KiB
```

Expected output of `npm test`: `tests 35 / pass 35 / fail 0`.

## 5.3 Entry points

`webpack.config.js` builds three independent bundles because Azure DevOps loads
each contribution in its own iframe:

| Entry | Source | HTML | Loaded by |
| --- | --- | --- | --- |
| `hub` | `src/Hub/Hub.tsx` | `dist/hub/Hub.html` | The Chat hub |
| `widget` | `src/Widget/Widget.tsx` | `dist/widget/Widget.html` | The dashboard widget |
| `actions` | `src/Actions/Actions.ts` | `dist/actions/Actions.html` | The two menu items |

The HTML files are copied verbatim by `copy-webpack-plugin`. Each is four lines
and references its sibling bundle by relative path, so the extension works
regardless of the host path the collection serves it from.

## 5.4 Before you package: set the publisher

`azure-devops-extension.json` ships with:

```json
"publisher": "REPLACE_WITH_YOUR_PUBLISHER_ID"
```

You must change it. Options:

**Azure DevOps Server, private use.** Any lowercase identifier works — it is
just a namespace on your own server. `contoso-internal` is fine.

**Azure DevOps Services, or you intend to share.** Create a publisher at
<https://marketplace.visualstudio.com/manage>, then use that exact id.

Either edit the manifest, or override at package time without touching the file:

```bash
npx tfx extension create --manifest-globs azure-devops-extension.json \
  --publisher contoso-internal --output-path ./bin
```

The publisher and extension id together form the identity of the data store.
**Changing either after deployment orphans every existing conversation** — the
data service scopes documents to `{publisher}.{extension}` and returns HTTP 401
across that boundary. Pick once.

## 5.5 Versioning

`version` in the manifest must increase on every upload, or the local gallery
rejects it as a duplicate. tfx can do it for you:

```bash
npx tfx extension create --manifest-globs azure-devops-extension.json --rev-version
```

Suggested scheme:

| Change | Bump |
| --- | --- |
| UI or copy | patch |
| New feature, backwards-compatible data | minor |
| Envelope format, AAD strings, or `canonicalBundle()` field order | **major**, with a migration path |

The last row is a hard rule. AAD strings and the canonical bundle ordering are
part of the on-disk contract; changing them invalidates existing ciphertexts and
signatures. See [03-data-model.md §3.7](03-data-model.md).

## 5.6 Development loop

There are two ways to iterate.

### Private published extension (recommended for Services)

1. Package with a `-dev` id so it can coexist with the stable build:
   ```bash
   npm run package:dev
   ```
   `configs/dev.json` overrides `id` to `azdo-secure-chat-dev` and forces
   `public: false`.
2. Upload, share with your organisation, install.
3. Re-run and re-upload for each change. Slow, but exactly what users will get.

### Local webpack server (faster, Server only)

Serve `dist/` over **HTTPS** — WebCrypto will not run otherwise — and point the
manifest `uri` values at it while developing. Remember to point them back
before packaging.

## 5.7 Reproducibility and supply chain

For anything security-relevant, build from a clean tree and record the hash:

```bash
npm ci
npm run build
npx tfx extension create --manifest-globs azure-devops-extension.json \
  --publisher contoso-internal --output-path ./bin
sha256sum bin/*.vsix
```

Publish that hash alongside the file. Whoever installs it should verify the hash
before upload — see [06-offline-install.md](06-offline-install.md) step 2. For an
end-to-end encrypted tool this matters more than usual: whoever controls the
bundle controls the keys.

`npm ci` rather than `npm install` so the build uses the locked dependency tree.

## 5.8 Troubleshooting the build

| Symptom | Cause | Fix |
| --- | --- | --- |
| Interop tests fail after a `@noble` upgrade | A wire-format or API change in the JS backend | Do not ship it. `tests/interop.test.mjs` is the gate that keeps HTTP and HTTPS users able to read each other |
| `Cannot find module '@core/...'` | Alias missing | The alias is declared in both `tsconfig.json` (`paths`) and `webpack.config.js` (`resolve.alias`). Both are needed |
| `tfx: ENOENT overview.md` | `content.details.path` points at a missing file | Keep `overview.md` at the repository root |
| Bundle far larger than expected | A stray `azure-devops-ui` import | Check `npm ls azure-devops-ui` |
| Hub loads blank, console shows a postMessage error | `SDK.init()` not called, or `notifyLoadSucceeded()` missing | Both happen in `bootstrap()` in `client.ts` |
| `crypto.subtle is undefined` | Page served over HTTP | Expected. The JS backend takes over automatically; see [02-crypto-design.md §2.12](02-crypto-design.md) |
