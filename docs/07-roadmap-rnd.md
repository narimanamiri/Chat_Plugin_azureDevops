> **STALE since 0.7.0 (checked 2026-11-10).** This file describes the earlier *end-to-end encrypted* design. Encryption was removed; messages are now plaintext. For current, verified documentation start at [`docs/ai-handoff/01_START_HERE.md`](ai-handoff/01_START_HERE.md). What in this file is still valid: `docs/ai-handoff/13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`, section E.

# 7. Research notes and feature backlog

What was investigated while building the prototype, what got built, what got
rejected and why, and what is worth building next.

## 7.1 What already exists on the market

Searched the Visual Studio Marketplace and GitHub for an existing free chat
extension before writing any code. Findings:

| Category | Examples | Verdict |
| --- | --- | --- |
| In-product team chat | **Nothing.** Microsoft removed Team Rooms in 2018 and did not replace it | The gap this project fills |
| Chat-platform bridges | Microsoft Teams Integration, Slack Integration, Azure Boards Slack/Teams apps | Marketing stubs (`Microsoft.VisualStudio.Services.Integration`) with no code. They configure service hooks; they are not chat |
| Pipeline notifiers | Rocket Chat Hook Notification, Google Chat webhook | Real, but one-directional build notifications, not conversation |
| AI assistants | ScrumBot, Copilot4DevOps, AI Work Item Assistant | Chat-shaped UI, but every one routes prompts to a vendor cloud. ScrumBot posts to `devopsllmbackend.azurewebsites.net` |

Conclusion: there is no free, self-contained, privacy-preserving chat extension
for Azure DevOps. Hence this build.

## 7.2 Platform capabilities investigated

| Capability | Available? | Consequence |
| --- | --- | --- |
| Server-side storage for extensions | Yes — Extension Data Service | Chat can be stored with no backend |
| Server-side query or filter | **No** | Forced the paging design in [03-data-model.md](03-data-model.md) |
| Blob storage | **No** | Attachments are chunked into JSON documents |
| WebSocket / push | **No** | Polling, with plaintext counters to keep it cheap |
| Background script on every page | **No** | The badge cannot follow the user around |
| Global header contribution | **No** | Bell in-hub + dashboard widget + browser notifications |
| Work item / commit / PR menus | Yes | "Discuss in Secure Chat" |
| Dashboard widgets | Yes | The unread widget |
| Service hooks consumer | Yes | Not used yet — see §7.4.9 |
| Pipeline tasks | Yes | Not used yet — see §7.4.9 |
| WebCrypto | **HTTPS only** | Forced the dual-backend design: `@noble` fallback on HTTP, byte-identical wire format |
| IndexedDB in the extension iframe | Yes | Device key cache |
| Notification API in the extension iframe | Yes with permission, **HTTPS only** | Desktop toasts; silently unavailable on HTTP |

## 7.3 Built in this prototype

Requested by the brief:

- End-to-end encrypted messages stored on the server
- Encrypted file upload and download
- Mentions of work items, pull requests, commits and users
- User-to-user direct messages
- Notification icon with an unread badge

Added during R&D because they were necessary rather than optional:

| Feature | Why it was not optional |
| --- | --- |
| Safety numbers and TOFU trust | Anyone in the collection can overwrite a keyring document. Fingerprints surface a key swap, though since v0.2.0 they inform rather than gate |
| Dual crypto backend | `crypto.subtle` is secure-context only, so plain-HTTP servers had no encryption path at all |
| ECDSA sender signatures | In a channel every member holds the same key, so without signatures any member can forge any other |
| Epoch rotation on membership change | Otherwise a removed colleague keeps reading, and a new joiner reads the entire backlog |
| Paged message documents | One document per message means an N-document fetch per poll |
| Per-chunk AAD on attachments | Otherwise chunks can be reordered or truncated undetectably |
| Automatic key re-issue | A device change must not mean losing every message |
| Multi-tab safe polling | Every open Azure DevOps tab runs its own loop |

## 7.4 Backlog

Ordered by value ÷ effort. Effort is rough developer-days.

### 7.4.1 Message reactions — 2 days

Store reactions **outside** the page document, in a `reactions` collection keyed
`{convId}_{messageId}`, to avoid rewriting a 40-message page for every emoji.
Reactions are low-entropy: encrypting `"👍"` under a known key with a known
recipient set leaks almost nothing, so store the emoji in the clear and the
reactor list encrypted, or accept both in the clear. Decide explicitly and write
it in the threat model.

### 7.4.2 Threaded replies — 2 days

`MessageBody.replyToId` already exists and is already encrypted. Only the UI is
missing: a reply affordance, a quoted-parent line, and a thread pane. No schema
change.

### 7.4.3 Client-side search — 3 days

A server that cannot read the messages cannot index them. Options:

| Approach | Trade-off |
| --- | --- |
| Decrypt-and-scan on demand | Correct, no leakage, slow past a few thousand messages |
| IndexedDB plaintext cache | Fast; puts plaintext on disk, which weakens the device-compromise story |
| Encrypted index (blinded trigrams) | Server-side filtering with partial leakage; real research, real risk |

Recommendation: option 1 with a bounded scan and a progress indicator. Reach for
option 3 only with a cryptographer in the room.

### 7.4.4 Attachment size padding — 1 day

Chunk counts leak file size to within 64 KiB. Pad the last chunk to a size
bucket (64 KiB, 256 KiB, 1 MiB, 4 MiB, 16 MiB) so the observable size is one of
five values. Costs storage, closes a named side channel from
[02-crypto-design.md §2.13](02-crypto-design.md).

### 7.4.4b Subresource integrity for HTTP deployments — 2 days

On plain HTTP the biggest exposure is bundle substitution in transit (§2.12).
A partial mitigation: have the hub verify a SHA-256 of its own bundle against
a hash pinned in the manifest before initialising crypto. It does not stop an
attacker who rewrites both, but it raises the bar past passive tampering and
makes the check auditable.

### 7.4.5 History compaction — 3 days

Pages are never rewritten once full, so a busy channel accumulates documents
forever. Add a retention policy per conversation — for example "drop pages older
than 180 days" — executed by any client that holds the keys, with the deletion
recorded as a signed tombstone so other clients agree it was intentional rather
than tampering.

### 7.4.6 Automatic garbage collection — 1 day

`files.collectGarbage()` exists but nothing calls it. Wire it to a manual
"reclaim space" button in a settings panel first, with a dry-run count. Do not
run it automatically: it deletes any chunk whose blob id is not in the live set,
and a client that cannot decrypt every page would compute an incomplete live
set and destroy other people's attachments. Guard it with an explicit
"I can read every conversation" precondition.

### 7.4.7 Presence and typing indicators — 2 days

A `presence` collection with a heartbeat document per user, treated as stale
after 60 seconds. Typing indicators need a 2–3 second poll, which multiplies
request volume by roughly 5×. Make it opt-in per conversation and measure the
load on a real server before enabling it by default.

### 7.4.8 Per-message forward secrecy — 10+ days

The current model is static: an epoch key is long-lived, so compromising a
private key exposes every epoch that user ever held.

| Option | Notes |
| --- | --- |
| Double Ratchet (Signal) | Well understood for 1:1. Painful for groups. Needs ordered delivery, which polling does not guarantee |
| Sender Keys (WhatsApp style) | Practical for groups. Per-sender chain keys, ratcheted forward |
| MLS (RFC 9420) | The right long-term answer for groups. No mature browser implementation, and MLS assumes a delivery service with ordering guarantees that the document store does not provide |

Realistic next step: sender keys, ratcheting a chain key per sender per epoch,
with the chain state cached in IndexedDB. Accept that a client that misses
messages must fall back to the epoch key.

### 7.4.9 Pipeline and service-hook bot — 4 days

Post build results into a channel. The obstacle is that a pipeline agent cannot
hold a user's private key.

Design: a channel may have a **bot member** whose key pair is generated in the
browser, with the private key placed in a secret pipeline variable by an
administrator. A pipeline task then encrypts to the channel exactly like any
member. Every human member sees the bot in the member list, so the trade-off is
visible rather than hidden — anybody who can read that pipeline variable can
read the channel.

### 7.4.10 Slash commands — 3 days

`/wi create <title>`, `/assign #1234 @Jane`, `/pr status !99`, `/build <pipeline>`.
The REST clients are already wired up in `devops.ts`. The work is a command
parser, an argument model, and a confirmation step for anything that writes.

### 7.4.11 Auto-channels for pull requests — 2 days

`openSubject` already handles work items and commits. Add a `pr` subject type
and contribute to `ms.vss-code-web.pull-request-action-menu`. Optionally
auto-create the channel when a PR opens, via a service-hook consumer.

### 7.4.12 Conversation export — 1 day

Decrypt locally, write a JSON or Markdown transcript, hand it to the browser.
Useful for incident review and for satisfying a records-retention obligation
without weakening the encryption.

### 7.4.13 Multi-device improvements — 3 days

Identity is device-bound, and a new device is healed by peers re-issuing keys.
What is missing: a device list, per-device revocation, and a warning when a new
device appears. Requires a `devices` collection with signed enrolment records.

### 7.4.14 Key rotation without losing history — 2 days

`Keystore.create` currently orphans history. A proper rotation would: mint the
new identity, and for every conversation the user can still read, re-wrap the
existing epoch keys to the new public key. Needs a resumable migration, because
it touches every conversation document.

### 7.4.15 Compliance mode — 2 days, contentious

Some organisations legally cannot deploy communications they are unable to
audit. A per-channel escrow key, whose public half is a channel member, would
let a compliance officer decrypt.

Do this only with:

- an explicit per-channel opt-in, never a global default
- a permanent, unmissable banner in the channel naming the escrow holder
- the escrow member listed in the member list like any other member

An escrow that members cannot see is a backdoor. One they can see is a policy
choice. The difference is the entire ethical distinction, and it is worth being
strict about.

### 7.4.16 Localisation and RTL — 2 days

The UI is English-only and LTR. Azure DevOps ships in many locales, including
right-to-left ones. Extract strings, add a message catalogue, and set `dir`
from the host locale — the CSS is flexbox and grid throughout, so RTL is mostly
a `dir` attribute and a handful of logical-property fixes.

### 7.4.17 Accessibility audit — 2 days

Landmarks, `aria-label`s and keyboard handlers are present, but nothing has been
tested with a screen reader. Needs: focus management when dialogs open and
close, an `aria-live` region for arriving messages, verified contrast in all
three themes, and a full keyboard path through the conversation list.

### 7.4.18 Cross-collection messaging — 8+ days, changes the architecture

Today chat is per project collection, because the Extension Data Service is.
Every document lives under `{collection}/_apis/ExtensionManagement/...` and
there is no storage an extension can reach from two collections at once. The
extension token is issued for the current host, so it does not authorise calls
against another collection's endpoint either.

Making this work means a shared store, which is the one thing the current
design refuses. Options, worst to best:

| Approach | Assessment |
| --- | --- |
| Nominate one collection as "home" and have clients call its REST API directly with a user-supplied PAT | Works on paper. Puts a long-lived credential in browser storage, needs per-user setup, and breaks the moment the PAT expires. Not worth it |
| A small relay service storing only ciphertext | The honest answer. Roughly a key-value store with auth; the client-side crypto is unchanged, so the relay never sees plaintext. Costs the air-gapped, zero-backend property |
| Federate through an existing shared system (a Git repo, a shared work item) | Ugly, slow, and abuses a store not built for it |

If cross-collection is a real requirement, take the relay. Keep the same
envelope format so a relay deployment and a collection-local deployment stay
wire-compatible, and make the relay URL configurable per collection so
adopting it is a deployment decision rather than a fork.

## 7.5 Rejected, with reasons

| Idea | Why not |
| --- | --- |
| Bundle a WASM Argon2id | Better KDF, but adds a binary dependency and a supply-chain surface to an extension whose whole pitch is self-containment. 600k PBKDF2 rounds is the accepted floor |
| Store attachments as work item attachments | The API allows larger files, but unattached uploads are garbage collected, and it puts file bytes outside the extension's own scope |
| Use a Git repository as a blob store | Works, but pollutes a real repository and inherits its permissions, which are not the conversation's permissions |
| Encrypt membership lists | Every client needs the member list to find its own key wrap. Encrypting it creates a chicken-and-egg problem for no real gain — the same information is inferable from who holds a wrap |
| Ship an AI assistant | Every existing one ships data to a vendor cloud. Incompatible with both the encryption model and the offline requirement. A locally hosted model behind an admin-configured endpoint would be defensible; a hardcoded SaaS call would not |
| Real-time via long polling | Halves latency, multiplies request volume. Not worth it against a document store with no change feed |
