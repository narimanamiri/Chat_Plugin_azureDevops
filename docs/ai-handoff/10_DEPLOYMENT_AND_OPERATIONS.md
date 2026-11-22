# 10 - Deployment and operations

**There is no CI/CD, Docker, Kubernetes, IaC, monitoring or alerting in this repository** (CONFIRMED: no `.github/`, `azure-pipelines*.yml`, `Dockerfile*`, `docker-compose*`, ESLint/Prettier/Jest/Playwright config). "Deployment" means: build a `.vsix`, upload it to an Azure DevOps gallery, install it into a collection. Everything marked "(docs/06)" or "(docs/08)" comes from the older, partly stale docs and was **NOT TESTED** here - this project has never been installed on a live server by us.

## Release artefact

- Output: `bin/<publisher>.azdo-secure-chat-<version>.vsix`. Current: `bin/REPLACE_WITH_YOUR_PUBLISHER_ID.azdo-secure-chat-1.0.0.vsix`, 935,647 bytes (913.7 KiB), sha256 `aff85c384b62bb4e9658091594ec0e0224e7abea2e218500da3dc26f82a289e4` (VERIFIED, hashed 2026-11-10).
- The `bin/secure-chat-demo.*` files are older builds under a different publisher; they are history.
- Contents (per manifest `files`): `dist/` (three hashed bundles + three HTML pages) and `static/` (icons), plus `overview.md` as the details page.

## Identity: choose the publisher once

The manifest ships `"publisher": "REPLACE_WITH_YOUR_PUBLISHER_ID"`. Override on the command line instead of editing the file:

```bash
./node_modules/.bin/tfx extension create --manifest-globs azure-devops-extension.json \
  --publisher YOUR_PUBLISHER --output-path ./bin
```

On Azure DevOps **Server** any lowercase identifier is fine (it is only a namespace). On **Services** it must be a real Marketplace publisher (docs/05 s5.4).

**The extension id (`azdo-secure-chat`) and publisher together scope the data store.** Changing either after users have chatted makes the new install unable to read the old documents (the data service returns HTTP 401 across that boundary; docs/05 s5.4, INFERRED). Treat both as permanent. A side-by-side dev build uses id `azdo-secure-chat-dev` via `configs/dev.json` and therefore has a **separate, empty** store.

## Release procedure

1. Decide the new version (semver). It must be **higher** than anything the gallery already has; duplicates are rejected (docs/05 s5.5).
2. Edit the version in **three** places: `package.json` `version`, `azure-devops-extension.json` `version`, `src/core/client.ts` `EXTENSION_VERSION` (:46). Nothing checks they agree.
3. Run the checks from `09_` ("Is my change done?").
4. Build and package:
   ```bash
   ./node_modules/.bin/webpack --mode production
   ./node_modules/.bin/tfx extension create --manifest-globs azure-devops-extension.json --publisher YOUR_PUBLISHER --output-path ./bin
   sha256sum bin/*.vsix
   ```
5. Record the hash; transfer the file; verify the hash on the destination machine (`Get-FileHash <file> -Algorithm SHA256` in PowerShell).
6. Update `overview.md` if user-visible behaviour changed (the manual ships inside the package).

## Install - Azure DevOps Server (air-gapped) (docs/06; NOT TESTED)

Requirements: Azure DevOps Server 2020/2022/2025; you are in **Team Foundation Administrators** with *Edit instance-level information*.

1. Sign in as that admin and open `https://<server>/<collection>/_gallery/manage` (UI path: Collection Settings -> Extensions -> Browse local extensions -> Manage extensions).
2. **Upload new extension**, choose the `.vsix`. Uploading does **not** install it.
3. Click the uploaded entry (its display name is **"Team Chat"**; old docs say "Secure Chat (E2EE)"), choose **Install**, pick the collection(s), confirm. Consent screen lists the scopes in `07_`.
4. In any project of that collection, **Chat -> Messages** appears in the left navigation.
5. Smoke test: two users; A sends "hello" to B; B sees an unread badge and the message; B replies with `#<work item id>` and A sees a chip that resolves; A attaches a small file and B downloads it; add the "Secure Chat unread" widget (the name in the manifest) to a team dashboard.

Each collection is a separate, isolated chat (no cross-collection messaging).

## Install - Azure DevOps Services (docs/06 s6.6; NOT TESTED)

No manual `.vsix` upload exists. Create a Marketplace publisher, set it as `--publisher`, publish the extension as **private**, share with the organisation, install from the Marketplace. The `.vsix` therefore passes through Microsoft's Marketplace even when private.

## Update

Build a higher version, upload it on `_gallery/manage`, choose **Update** on the extension entry. Existing conversations are unaffected while publisher, extension id and `NAMESPACE` are unchanged. **If the new build adds a manifest scope, users/admins must uninstall and reinstall** (in-place update does not obtain new consent) - until then, e.g. the people picker is empty.

## Rollback (INFERRED; NOT TESTED)

The gallery rejects duplicate versions and a lower version is probably also unwelcome (UNKNOWN), so rollback = check out the old tag, bump to a version **higher than the broken one**, build, upload, update. Data compatibility: stored data is forward/backward compatible between 0.7.0 and 1.0.0 because later versions only added **optional** fields (`seq`, `lastPreview`, `reactions`, `typing`, `lastSeenAt`, image `width/height`), and older builds use object spreads that preserve them. Do not roll back across a `NAMESPACE` bump - the older code would address different (possibly empty) collections. Rolling back to 0.9.0 reintroduces the HTTP 409 read-cursor bug; to 0.7.x-0.8.x, ordering and other fixes.

## Uninstall

Collection Settings -> Extensions -> Team Chat -> Uninstall. **Data stays** in the collection and reappears on reinstall. To destroy it, delete documents through the Extension Management REST API before uninstalling (no tooling provided), or bump `NAMESPACE` and rebuild to start empty while leaving the old data orphaned.

## Operations

| Topic | Fact |
| --- | --- |
| Running processes | none of ours; everything executes in users' browsers |
| Logs | browser console only (`[team-chat]`, `[secure-chat]` prefixes). No server-side logs |
| Health check | open the hub, run `await secureChatDiagnose()` |
| Monitoring / alerts | none. docs/08 suggests counting documents in `v3_blobs` via REST and alerting at 60% of 100,000 |
| Capacity | see `06_` "Capacity". Attachments dominate |
| Tunable constants | `model.ts`: `PAGE_SIZE`, `CHUNK_BYTES`, `MAX_ATTACHMENT_BYTES`, `CHUNK_CONCURRENCY`, typing/presence constants; `client.ts`: poll intervals, search budgets. Any change needs rebuild + re-upload. Measure the server's document-size limit before raising `CHUNK_BYTES` |
| Backup | included in the normal Azure DevOps collection backup; contains **plaintext** messages |
| Restore | rolls chat back to the backup point; messages after it are lost |
| Reset all chat data | bump `NAMESPACE` (`model.ts:21`), rebuild, release. Non-destructive; old docs remain unaddressed |
| User offboarding | profiles/messages are not removed automatically; no tooling |
| Orphan attachments | `secureChatSweep()` exists in the console but is **destructive and currently buggy** (deletes attachments of conversations you are not in). **Do not run it** until fixed (`13_`) |

## Security of the supply chain

Build from a clean tree with `npm ci`, record the sha256, and verify it after transfer (docs/05 s5.7, docs/06 s6.2). All assets are bundled; nothing is fetched from a CDN at runtime (CONFIRMED: `webpack.config.js` externalises nothing).
