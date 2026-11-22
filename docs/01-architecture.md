> **STALE since 0.7.0 (checked 2026-11-10).** This file describes the earlier *end-to-end encrypted* design. Encryption was removed; messages are now plaintext. For current, verified documentation start at [`docs/ai-handoff/01_START_HERE.md`](ai-handoff/01_START_HERE.md). What in this file is still valid: `docs/ai-handoff/13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`, section E.

# 1. Architecture

## The constraint that shapes everything

An Azure DevOps web extension is a sandboxed iframe. It gets:

- an HTML page served from the extension's own origin
- a postMessage bridge to the host (`azure-devops-extension-sdk`)
- an access token scoped to the extension
- the **Extension Data Service**: a JSON document store, scoped either to the
  project collection or to a single user

It does **not** get: a server process, a websocket, a blob store, a background
worker, a cron trigger, or any extension point on the global page header.

Every design decision below follows from that list.

| Requirement | Constraint it hits | What was built |
| --- | --- | --- |
| Store chat on the server | No database | Extension Data Service documents |
| End-to-end encryption | Any collection member can read the store over REST | Encrypt in the browser; the store only ever sees ciphertext |
| File upload | No blob store | Chunk the file, encrypt each chunk, one document per chunk |
| Live updates | No websocket | Poll conversation documents; plaintext counters make polling cheap |
| Notification badge | No header extension point | Bell inside the hub + a dashboard widget + browser notifications |
| Offline install | No external service allowed | Everything bundled; zero outbound requests |

## Contribution points used

Declared in `azure-devops-extension.json`:

| Contribution | Type | Target | Purpose |
| --- | --- | --- | --- |
| `chat-hub-group` | `ms.vss-web.hub-group` | `ms.vss-web.project-hub-groups-collection` | Adds **Chat** to the project's left navigation |
| `chat-hub` | `ms.vss-web.hub` | `.chat-hub-group` | The chat page itself |
| `chat-unread-widget` | `ms.vss-dashboards-web.widget` | `ms.vss-dashboards-web.widget-catalog` | Unread badge on a team dashboard |
| `discuss-work-item` | `ms.vss-web.action` | work item toolbar, query result menu, backlog item menu | "Discuss in Secure Chat" |
| `discuss-commit` | `ms.vss-web.action` | commit details menu, commit list menu | "Discuss in Secure Chat" |

### Why there is no header badge

Azure DevOps publishes extensibility points for hub groups, hubs, menus,
toolbars, work item forms, PR tabs, dashboard widgets and pipeline tasks. There
is no supported contribution that renders into the global header or that runs
JavaScript on every page. A badge that follows the user around the product is
therefore not something an extension can build, only something Microsoft can.

The three surfaces that *are* possible, all implemented:

1. **In-hub bell** with a live count, in `src/Hub/components.tsx`
2. **Dashboard widget** (`src/Widget/Widget.tsx`) — pin it to the team
   dashboard and the count is visible from the project's landing page
3. **Browser notifications** — the Notification API works inside the iframe
   once the user grants permission

## Module map

```
src/core/
  crypto.ts         WebCrypto primitives. No Azure DevOps imports at all.
  model.ts          Every persisted document shape + tuning constants.
  storage.ts        Typed wrapper over IExtensionDataManager.
                    404 handling, etag retry with backoff, id length guard.
  keystore.ts       Create / unlock / re-wrap the private identity.
                    IndexedDB device cache of non-extractable key handles.
  keyring.ts        Publish and fetch public bundles. TOFU trust records.
  conversations.ts  Conversation CRUD, epochs, per-member key wrapping.
  messages.ts       Append and read paged, signed, encrypted messages.
  files.ts          Chunked encrypted attachments + garbage collection.
  mentions.ts       Pure parser and segmenter for #, !, @, sha, URL tokens.
  devops.ts         The only module that calls Azure DevOps REST APIs.
  notifications.ts  Unread maths, the poller, desktop toasts.
  client.ts         ChatClient facade. The UI never reaches past this.

src/Hub/            React page: Hub.tsx (state) + components.tsx (rendering)
src/Widget/         Dashboard widget
src/Actions/        Hidden frame that handles the two menu actions
```

The dependency rule: `Hub` and `Widget` import `client.ts` and `model.ts`;
they never import `crypto.ts` or `storage.ts` directly. That keeps every
security-relevant decision inside `src/core` and makes the question "can the UI
touch a raw key?" answerable by reading one file.

`crypto.ts` and `mentions.ts` import nothing from Azure DevOps, which is why
they can be unit tested in plain Node.

## Runtime flow

### Cold start

```
Hub.html
  └─ bootstrap()                     client.ts
       ├─ SDK.init({ applyTheme })   theme variables injected into the iframe
       ├─ SDK.ready()
       ├─ Store.create()             getAccessToken → getExtensionDataManager
       └─ ChatClient.create()
  └─ client.init()                   keystore.ensure()
       ├─ IndexedDB hit for this user and backend?  → use it
       └─ otherwise → mint a key pair silently, bumped generation
```

There is no setup screen and no unlock step. `init()` then publishes the
public bundle (idempotent), builds `Conversations` and `Messages`, caches
display names from the keyring, and runs the first self-healing maintenance
pass.

### Sending a message

```
Composer.onSend(text, files)
  ├─ for each file: uploadAttachment()
  │     ├─ conversations.keyFor(conv, epoch)   unwrap the conversation key
  │     ├─ files.upload()                      random file key, chunk, seal
  │     └─ file key sealed under the conversation key → travels in the message
  ├─ parseMentions(text, knownUsers)           pure, no network
  └─ messages.send()
        ├─ sealJson(convKey, body, aad)        AES-256-GCM
        ├─ signString(ecdsaPriv, aad|sha(ct))  proves which member sent it
        ├─ store.mutate(conversations, id)     reserve a slot (etag retry)
        └─ store.mutate(pages, convId_page)    append the ciphertext
```

### Receiving

The poller reads the `conversations` collection every 12 s while the tab is
visible, 60 s when hidden, with exponential backoff on failure. Conversation
documents carry `messageCount` in the clear, so unread counts are computed
without decrypting anything — which is also why the dashboard widget works on a
device that has never been unlocked.

When the selected conversation's count moves, the hub fetches the head page and
decrypts it.

### The two menu actions

`Actions.ts` runs in a hidden frame with no UI, so it cannot render a
conversation itself. It writes the target into
user-scoped extension data under `pending-subject` and navigates to the hub;
the hub picks it up on load, clears it, and opens (or creates) the channel for
that work item or commit.

## Trade-offs taken

| Decision | Why | Cost |
| --- | --- | --- |
| Paged message documents (40 per page) | One document read per poll instead of N | A page write is a read-modify-write, so concurrent senders contend on the etag |
| Reserve-then-write append | Distinct ordering index per sender under concurrency | Not atomic: a crash between the two writes leaves an empty slot |
| Plaintext membership and counters | Makes polling and unread counts free, and the widget key-free | Metadata is visible to the server |
| Epoch rotation instead of a ratchet | Simple, auditable, works with the document store | No per-message forward secrecy |
| Polling instead of push | No alternative exists | Latency is up to one poll interval |
| Bundled dependencies, no CDN | Air-gapped installs | 351 KB hub bundle |
