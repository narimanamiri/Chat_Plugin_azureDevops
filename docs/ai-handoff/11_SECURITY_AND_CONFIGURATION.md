# 11 - Security and configuration

No secrets exist in this repository and none are needed (CONFIRMED: no env vars, no API keys, no credentials in `src/`, `tests/`, configs). **Never add real tokens, PATs or passwords to any file, test or doc.** Record variable *names* and locations only.

## The security model in one paragraph

Authentication is delegated entirely to Azure DevOps (the user is already signed in; the extension receives the user id and a token from the SDK). **Authorization is enforced only by client-side code in the browser.** All chat data sits in collection-scoped documents that every member of the collection can read and write through the Extension Data REST API, regardless of what our UI allows. Messages are **plaintext** since 0.7.0. Treat the chat like a comment thread on a work item, not like a private channel. (`overview.md` says this to users in English and Persian; the in-app UI does not - see below.)

## Who can read what (CONFIRMED by data layout; REST access itself NOT TESTED)

| Data | Readable by |
| --- | --- |
| Every message body, conversation member list, preview, attachment bytes | any user who can call the Extension Data Service for this extension in the collection (members, admins), DB administrators, anyone with a collection backup |
| Per-user read cursors, `pending-subject`, `ui-language` | the user (user scope); admins/DBAs too |
| Our UI's filtering ("only my conversations") | cosmetic: `Conversations.mine()` filters in the browser |

## Authorization checks that exist (all client-side, all bypassable by direct REST)

| Check | Where | Notes |
| --- | --- | --- |
| Sender must be a member to send | `messages.ts` `send` | throws `"You are not a member of this conversation."` |
| Only the author edits/deletes a message | `messages.ts` `edit`, `remove` | |
| Only a member deletes a conversation | `client.ts` `deleteConversation` | any member can delete for **everyone** |
| Own reactions only | `messages.ts` `react` (always uses the caller's id) | |
| **No check** on `addMembers`, `removeMembers`, `rename`, `react` membership | `conversations.ts`, `messages.ts` | CONFIRMED by reading; a non-member could alter a channel via REST |
| Subject conversations add the opener automatically | `conversations.ts` `openSubject` | by design: anyone who opens "Discuss" on a work item joins |

Identity is whatever `SDK.getUser().id` says; message `senderId` is written by the client, so a malicious client could write a message with another user's id (INFERRED; no server validation exists).

## Attack surface and input handling

| Surface | Handling | Verdict |
| --- | --- | --- |
| Message text rendered in the UI | React text nodes + `segment()`. CONFIRMED by grep: zero matches in `src/` for `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval(`, `new Function`, `document.write` | no XSS path found |
| URL mentions | the **parser** only accepts `https?://...`; but at render the chip trusts the stored `mention.value` (`resolveMention` -> `href` and `navigateTo`) with no scheme check | an honest client cannot produce `javascript:`; a client writing documents directly could store any scheme. Whether the host's `navigate` or the browser blocks it is NOT TESTED (`13_` KI-22) |
| Attachment names | rendered as text; downloaded via `a.download` | browsers sanitize names |
| Attachment MIME | sender-controlled; `isImage` whitelists png/jpeg/gif/webp/bmp/avif (no SVG) for inline preview | OK |
| Message length | **no limit** in code. A huge message can make the page document exceed the undocumented size limit; the write fails after the slot is already reserved | robustness issue (`13_`) |
| Attachment size | 16 MiB cap, checked client-side only | |
| Mention resolution | calls REST as the reader, so a reader only learns titles they are permitted to see; failures fall back to the stored label | OK |
| Desktop notifications | show sender and conversation title, **not** message text | deliberate (shared screens) |
| Web storage | none used (no localStorage/cookies) | |
| Dependencies | `@noble/hashes` (used), unused `@noble/ciphers` / `@noble/curves`, React 18, ADO SDK/API. No `npm audit` was run (NOT TESTED) | |

## Deleted and edited text can linger

`ConversationDoc.lastPreview` holds the first 120 characters of the newest message and is shown in the sidebar. It is written only when a message is **sent**. Editing or deleting that message leaves the old text in the conversation document until someone sends the next message (CONFIRMED, `messages.ts` `send` vs `edit`/`remove`; `13_` KI-21). Anyone reading the document (or a backup) can still see it. "Delete for everyone" therefore does not guarantee erasure.

## Honesty gap: the app does not say it is unencrypted

`i18n.ts` has a key `notEncrypted` ("Messages are not encrypted") and its Persian twin, but **no component uses it** (CONFIRMED). Users learn it only from `overview.md` and the marketplace description. The icons (`logo.png`, `nav-icon.png`) still draw a **padlock**, and the manifest `tags` still include `encryption`, `e2ee`, `privacy`. A privacy-conscious user could be misled. Fix candidates: show the `notEncrypted` string in the hub, replace the icons (`scripts/make_icons.py` function `speech_bubble_with_lock`), drop the tags.

## Sensitive operations (handle with care)

| Operation | Why dangerous |
| --- | --- |
| `secureChatSweep()` / `ChatClient.sweepOrphanChunks` | deletes attachment chunks of conversations the caller is not in (**reproduced** in the emulator) |
| `ChatClient.deleteConversation` | permanent for all members; no undo |
| Changing manifest `id`/`publisher`, `NAMESPACE`, `dmId`/`subjectId` | orphans data |
| Adding scopes | requires reinstall; widens what the extension may do |
| `Files.collectGarbage(live)` | trusts the caller's `live` set completely |

## Configuration inventory

| Item | Location | Notes |
| --- | --- | --- |
| Extension id, version, scopes, contributions | `azure-devops-extension.json` | publisher is a placeholder; `links` are `https://example.invalid/...` placeholders |
| Dev override | `configs/dev.json` | id `azdo-secure-chat-dev` |
| Storage namespace | `src/core/model.ts` `NAMESPACE` | `"v3"` |
| Tuning constants | `model.ts`, `client.ts` | `06_`, `10_` |
| Build config | `webpack.config.js`, `tsconfig*.json` | |
| Per-user settings | extension user-scope settings `pending-subject`, `ui-language` | |
| Environment variables | none | |
| Feature flags | none | |

## If you find a security problem

Stop, record it in `13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`, do not paste real data into docs, and tell the owner. Use the `security-reviewer` agent if available. If real credentials ever appear in a file, rotate them; they would be in git history.
