# 14 - Glossary

Plain-language meanings of words used in this repository. Where a name misleads, the real meaning is given.

| Term | Meaning here |
| --- | --- |
| **Azure DevOps (ADO)** | Microsoft's project platform (boards, repos, pipelines). Two products: **Services** (cloud, dev.azure.com) and **Server** (self-hosted, formerly TFS). |
| **Project collection** | Top-level container on ADO Server (and the organisation on Services). Holds many projects. **Our storage and users are scoped to one collection.** |
| **Extension** | A plug-in package (`.vsix`) that adds UI to ADO. Ours is "Team Chat", id `azdo-secure-chat`. |
| **`.vsix`** | The zip file that is the installable extension. Built by `tfx`. |
| **Contribution** | One thing an extension adds to ADO (a hub, a widget, a menu action). Declared in `azure-devops-extension.json`. We have five: `chat-hub-group`, `chat-hub`, `chat-unread-widget`, `discuss-work-item`, `discuss-commit`. |
| **Hub / hub group** | A page in a project's left navigation / the section that holds it. Ours: group "Chat", hub "Messages". |
| **Widget** | A tile on a dashboard. Ours shows the unread count. |
| **Action (menu action)** | A menu item added to existing ADO screens (work item toolbar, commit menu). Runs in a hidden iframe. |
| **Iframe / sandbox** | ADO loads each contribution in a sandboxed iframe. It cannot touch the page around it and has a different web origin than the product. This is why `window.location.origin` is wrong for building ADO links. |
| **SDK** | `azure-devops-extension-sdk`: handshake with the host (`init`, `ready`, `getUser`, `getAccessToken`, `getService`, `register`). |
| **`azure-devops-extension-api`** | Generated TypeScript REST clients (`CoreRestClient`, `GitRestClient`, `WorkItemTrackingRestClient`) and service ids. |
| **Extension Data Service (EDS)** | ADO's built-in JSON document store for extensions. Our only persistence. Scoped to publisher + extension + collection. |
| **Document / collection (EDS meaning)** | A JSON object with a string `id` (<= 50 chars) / a named group of them (e.g. `v3_pages`). Not related to a project collection - context tells which. |
| **Scope (EDS)** | `collection` = shared by everyone; `user` = private per user. Not to be confused with **manifest scopes** (`vso.*` permissions the extension requests). |
| **`__etag`** | Version number on a document. Writing with an old etag fails with HTTP 409 (conflict). |
| **`mutate`** | `Store.mutate`: read, change, write with retry on 409. The only safe way to update a shared document. |
| **Namespace (`NAMESPACE`)** | Prefix (`v3_`) on every collection name. Bumping it starts everyone with empty chat data. |
| **Conversation** | A chat: DM, channel, or one tied to a work item/commit. One `ConversationDoc`. |
| **DM (direct message)** | Two-person conversation with a deterministic id so both sides find the same one. |
| **Channel** | Named multi-member conversation with a random id. |
| **Subject conversation** | Conversation bound to a work item or commit (`kind` `workitem`/`commit`); deterministic id; everyone opening "Discuss" joins. |
| **Page** | A document holding up to 40 messages of one conversation (`PAGE_SIZE`). Reads fetch the newest page(s). |
| **Slot / `seq`** | A message's reserved position: `messageCount` at reservation. Authoritative order, because timestamps can tie. |
| **Reserve (a slot)** | Step 1 of sending: increment `messageCount` on the conversation doc. Step 2 writes the body into the page. |
| **Gap / empty slot** | A reserved slot whose message write failed. Readers skip it; `messageCount` stays inflated. |
| **Tombstone** | A deleted message kept as an empty marker (`deleted: true`) so numbering and ordering stay stable. |
| **Chunk** | A 64 KiB piece of an attachment stored as base64 in its own document (`BlobChunkDoc`). |
| **Blob / `blobId`** | One uploaded file (all its chunks share the id). |
| **Manifest (attachment)** | `AttachmentManifest`: name, size, MIME, chunk count, SHA-256 - stored inside the message. Not the same as the **extension manifest**. |
| **Extension manifest** | `azure-devops-extension.json`. |
| **Orphan (chunk)** | Chunks no message references (interrupted upload). |
| **Profile** | `ProfileDoc`: a user's display name and last-seen time, published by that user so others can name them quickly. |
| **Directory** | The list of people discoverable in the collection, built by scanning teams (`loadDirectory`). Read synchronously from a snapshot. |
| **Identity id** | A user's id: a GUID on Services, a Windows SID (`S-1-5-...`) on Server. Must never be shown or stored as a name. See `looksLikeIdentityId`. |
| **SID poisoning** | The historical bug where an id was saved as a display name and then shown forever. Guarded in `client.ts`. |
| **Read cursor** | Per-user count of messages seen per conversation; unread = `messageCount - cursor`. |
| **Fingerprint** | String of a conversation's key fields compared by the fast poller to decide whether to reload. |
| **Slow tick / fast tick** | The two poll loops (all conversations every 30 s / the open one every 5 s). |
| **Optimistic send** | The UI shows your message immediately as "sending" and replaces it with the stored one. |
| **Mention** | A parsed reference in message text: `#1234` work item, `!1234` pull request, 7-40 hex sha commit, `@Name` user, URL. |
| **Chip** | The clickable rendering of a mention. |
| **Presence** | "online" / "last seen", derived from `lastSeenAt` on the profile (coarse: written at most every 5 min). |
| **Typing flag** | Ephemeral map on the conversation doc; entries expire after 8 s. |
| **E2EE** | End-to-end encryption. Present in 0.1-0.6, **removed in 0.7.0**. Any remaining mention is history. |
| **`DecryptedMessage`** | Legacy name for "message ready to render". Nothing is decrypted. |
| **`crypto.ts`** | Legacy name for the helper module (base64, SHA-256, random ids). No encryption. |
| **`secureChat*` globals** | `window.secureChatDiagnose()` (safe report) and `window.secureChatSweep()` (**destructive, buggy**). Names kept from the old product. |
| **Emulator / harness** | `tests/harness`: in-memory fake of ADO's SDK and data service used by tests. |
| **graphify / knowledge graph** | Tool that parses code into `graphify-out/graph.json` (nodes = files/classes/functions, edges = imports/calls/references). |
| **Gallery** | Where ADO Server keeps uploaded extensions (`_gallery/manage`). On Services it is the Marketplace. |
| **Publisher** | Namespace owner of an extension. Part of the data store's identity. Currently a placeholder. |
| **TFS / Team Foundation Administrators** | Older name of ADO Server / its admin group, needed to upload extensions. |
