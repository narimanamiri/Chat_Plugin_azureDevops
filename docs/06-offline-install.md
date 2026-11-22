> **STALE since 0.7.0 (checked 2026-11-10).** This file describes the earlier *end-to-end encrypted* design. Encryption was removed; messages are now plaintext. For current, verified documentation start at [`docs/ai-handoff/01_START_HERE.md`](ai-handoff/01_START_HERE.md). What in this file is still valid: `docs/ai-handoff/13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`, section E.

# 6. Offline / manual installation

For an Azure DevOps **Server** with no internet access. The extension has no
external dependencies and makes no outbound requests, so an air-gapped install
is fully supported.

If you are on Azure DevOps **Services** (dev.azure.com), skip to §6.6 — manual
`.vsix` upload does not exist there.

## 6.0 Before you start

**Prerequisites**

- Azure DevOps Server 2020, 2022 or 2025
- The server published over HTTPS **or** plain HTTP. HTTPS is strongly
  preferred: on HTTP the extension falls back to bundled JavaScript crypto,
  which still encrypts everything at rest but gives up transport integrity,
  stores keys as raw bytes, and loses desktop notifications. The hub labels
  the downgrade in its header. See
  [02-crypto-design.md §2.12](02-crypto-design.md)
- You are a member of the **Team Foundation Administrators** group and hold
  **Edit instance-level information** on the target server
- A modern Chromium, Firefox or Safari on the client machines

**What you need to carry across the air gap**

One file: `secure-chat-demo.azdo-secure-chat-0.1.0.vsix` (about 668 KB), or
whatever your publisher id names it.

## 6.1 Step 1 — Produce the `.vsix` on a connected machine

```bash
git clone <this repository>
cd Chat_Plugin_azureDevops
npm ci
npm run icons
npm test
npm run build
npx tfx extension create --manifest-globs azure-devops-extension.json --publisher YOUR_PUBLISHER --output-path ./bin
```

Replace `YOUR_PUBLISHER` with a lowercase identifier of your choice — on a
private server it is only a namespace. See
[05-build-and-package.md §5.4](05-build-and-package.md) for why this choice is
permanent.

The file lands in `bin/`.

## 6.2 Step 2 — Record and verify the hash

On the connected machine:

```bash
sha256sum bin/YOUR_PUBLISHER.azdo-secure-chat-0.1.0.vsix
```

Write the value down and carry it separately from the file.

On the offline machine, in PowerShell:

```bash
Get-FileHash .\YOUR_PUBLISHER.azdo-secure-chat-0.1.0.vsix -Algorithm SHA256
```

The two must match. For an end-to-end encrypted tool this step is not
ceremony: whoever can alter the bundle between build and install can alter the
code that handles your keys.

## 6.3 Step 3 — Transfer

Copy the single `.vsix` to the offline machine by whatever route your policy
allows — removable media, a one-way file drop, an internal share. Nothing else
needs to cross.

## 6.4 Step 4 — Upload to the local gallery

1. Sign in to Azure DevOps Server as an account in the **Team Foundation
   Administrators** group.

2. Navigate to the local extension gallery:

   ```
   https://<your-server>/<your-collection>/_gallery/manage
   ```

   Equivalent UI path: **Collection Settings → Extensions → Browse local
   extensions → Manage extensions**.

3. Select **Upload new extension**, choose the `.vsix`, and confirm.

   The extension now exists in the local gallery. It is **not yet installed**
   into any collection — uploading and installing are two separate steps.

## 6.5 Step 5 — Install into a collection

1. On the same `_gallery/manage` page, click the newly uploaded **Secure Chat
   (E2EE)** entry.

2. Select **Install**.

3. Choose the project collection, then confirm. Repeat for each collection that
   needs it.

4. Verify. Go to **Collection Settings → Extensions** and confirm Secure Chat
   appears in the installed list.

5. Open any project in that collection. **Chat** now appears in the left
   navigation, with a **Messages** page under it.

The extension requests these scopes at install time — the consent screen will
list them:

| Scope | Why it is needed |
| --- | --- |
| `vso.extension.data_write` | Read and write its own document store. This is where chat lives |
| `vso.profile`, `vso.identity` | Identify the signed-in user and display names |
| `vso.project` | List teams and their members, so you can message anybody in the collection |
| `vso.work` | Resolve `#1234` to a work item title and state |
| `vso.code` | Resolve `!1234` and commit shas |

There is no scope for anything outside the collection, and the extension opens
no outbound connections.

## 6.6 Azure DevOps Services (cloud)

There is no local gallery on dev.azure.com and no way to upload a `.vsix`
directly. The only supported path:

1. Create a publisher at <https://marketplace.visualstudio.com/manage>
2. Set that publisher id in the manifest and package
3. **Publish extension → private** (never public, unless you intend to)
4. Share it with your organisation
5. Install it from the Marketplace into your organisation

Note the consequence: the `.vsix` passes through Microsoft's Marketplace even
when the extension is private. If that is unacceptable, Azure DevOps Server is
the only option.

## 6.7 First run for each user

Open **Chat → Messages**. That is the whole procedure — keys are generated
silently on first load, the public bundle is published automatically, and the
only thing the browser may ask is the standard desktop-notification permission.

People who have never opened the hub can still be included in conversations:
those conversations run in **clear mode** (visible as "not encrypted" in the
list) and upgrade themselves to end-to-end encryption automatically once
everyone involved has opened Secure Chat at least once. See
[02-crypto-design.md §2.10](02-crypto-design.md).

## 6.8 Verifying the install works

A five-minute smoke test:

1. Two users, A and B, both complete setup.
2. A: **New message**, pick B, send "hello".
3. B: opens Chat, sees the unread pill and the message.
4. B: replies with `#<some work item id>`. A sees a chip that resolves to the
   work item's title and navigates on click.
5. A: attaches a small file. B downloads it and the contents match.
6. A: **Verify** in the top bar, compares safety numbers with B out of band,
   marks verified. B's entry shows `verified`.
7. Add the **Secure Chat unread** widget to a team dashboard and confirm the
   count matches.

If step 3 shows nothing, wait one poll interval (12 seconds) or switch tabs and
back, which forces an immediate refresh.

## 6.9 Updating

1. Build the new `.vsix` with a **higher** `version` (see
   [05-build-and-package.md §5.5](05-build-and-package.md)). The gallery rejects
   a duplicate version.
2. Upload it on the same `_gallery/manage` page.
3. Select **Update** on the extension entry.

Existing conversations are unaffected as long as the publisher id, extension id
and envelope format are unchanged.

## 6.10 Uninstalling and removing

- **Uninstall from a collection:** Collection Settings → Extensions → Secure
  Chat → Uninstall. The documents stay; reinstalling restores access.
- **Remove from the gallery:** `_gallery/manage` → context menu (`…`) → Remove.

**Uninstalling does not delete the data.** The ciphertext remains in the
extension data store. To destroy it, delete the documents through the Extension
Management REST API before uninstalling — or accept that it is unreadable
ciphertext, which for most threat models is sufficient.

## 6.12 Scope of who you can message

**Within a collection: everybody you can see.** The directory is built from
every team in the project collection (`getAllTeams`), not just the current
project, so a direct message can be opened with anyone in the collection. The
one limit is a permission boundary: teams your account cannot read are not
returned by Azure DevOps, and the extension does not try to work around that.

**Across collections: not possible.** The Extension Data Service is scoped to
a single project collection. Every document — keyring, conversations, message
pages, attachment chunks — lives inside the collection the extension is
installed in, reachable only at that collection's REST endpoint. Two
collections are two isolated stores with no shared surface between them.

So installing the extension in collections A and B gives two independent
chats. A user who belongs to both has a separate identity, separate contacts
and separate history in each. Nothing bridges them, and nothing in the
extension can, because bridging requires storage that both sides can reach.

If you need cross-collection messaging, that means introducing a shared
service, which trades away the property that makes this extension installable
air-gapped. The design sketch is in
[07-roadmap-rnd.md §7.4.18](07-roadmap-rnd.md).

## 6.11 Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Header says `http, no transport security` | Server published over HTTP, so the JS crypto fallback is active | Working as designed. Move to HTTPS to regain transport integrity and desktop notifications |
| Desktop notifications never appear | The Notification API is secure-context only | Expected on HTTP. The in-hub bell and the dashboard widget still work |
| Upload rejected as a duplicate | `version` not increased | Bump the manifest version and repackage |
| **Chat** missing from the left navigation | Uploaded but not installed | Complete §6.5 |
| Hub is blank, console shows a handshake error | Extension content blocked, or a CSP appliance in the path | Confirm `dist/hub/hub.js` loads in the network tab |
| A conversation shows "not encrypted" | Some member has never opened Secure Chat, so it runs in clear mode | It upgrades to e2ee automatically once they open the hub. Nothing to do |
| Somebody shows as **key changed** | New device or browser profile — or somebody replaced their published key | Keys are re-issued automatically. Verify safety numbers out of band if the change is unexpected |
| Message says "You do not have the key for this part of the conversation" | Sent before you joined the channel — or your device changed and repair has not converged yet | Joined later: by design, no backlog. Device change: wait one poll cycle or reopen the conversation; any member's client re-issues keys automatically |
| One user cannot read another's messages | Key drift — repair converges automatically | Reopen the conversation, or wait for the next poll tick (12 s foreground) |
| Still unreadable after upgrading and reloading | Conversations from before 0.3.1 whose keys no member holds any more | Maintenance detects this and recovers the conversation at a fresh epoch automatically. Pre-recovery history stays unreadable — those keys are gone |
| Want to know exactly what is wrong | — | Open the Chat hub, press F12, run `secureChatDiagnose()` in the console. It prints key generations, directory status and per-conversation health, with no message content |
| The people picker is empty | Usually the `vso.project` scope was not granted when the extension was updated | Uninstall and reinstall the extension in the collection so the new scope is consented to. The picker now states the actual reason instead of just "nobody found" |
| Somebody in another collection is not listed | Expected — see §6.12 | Chat is per collection. There is no cross-collection messaging |
| Everything is slow with many attachments | Approaching the document quota | Run garbage collection, see [08-operations.md](08-operations.md) |
