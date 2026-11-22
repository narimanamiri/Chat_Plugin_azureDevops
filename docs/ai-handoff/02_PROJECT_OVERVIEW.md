# 02 - Project overview

Snapshot: git HEAD `b061bbb` plus uncommitted work, extension version **1.0.0**, documented 2026-11-10.
Evidence labels used everywhere: **CONFIRMED** (read in source or executed), **INFERRED** (strong code evidence, not run), **UNKNOWN**, **NOT TESTED**.

## What it is

A **team chat extension that runs inside Azure DevOps** (Server 2020+ or Services). Users get a "Chat" entry in each project's left navigation with a Telegram-style messenger. There is **no backend of our own**: every message, profile and file is stored as JSON documents in Azure DevOps' built-in *Extension Data Service* inside the project collection where the extension is installed. (CONFIRMED: `src/core/storage.ts` is the only persistence layer and calls only `IExtensionDataManager`.)

Package identity: extension id `azdo-secure-chat`, display name **"Team Chat"**, publisher is a **placeholder** `REPLACE_WITH_YOUR_PUBLISHER_ID` (`azure-devops-extension.json`). Author: Nariman Amiri. License MIT.

## Who uses it

Members of an Azure DevOps project collection, mostly on an air-gapped Azure DevOps Server. The design goal that drives everything: **install one `.vsix` file and be done** - no database, no service, no outbound network.

## Messages are NOT encrypted (read this)

Versions 0.1-0.6 had end-to-end encryption. It was **deliberately removed in 0.7.0** because device-bound keys kept locking users out. From 0.7.0 on, anyone who can read the collection's extension data (admins, DB admins, backups, or any member calling the REST API) can read every message. The README and `docs/01-08` still describe the *old encrypted* design - they are stale. See `13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md` section "Stale documentation".

## Feature list (all CONFIRMED present in source; test coverage as stated)

| Feature | Where implemented | Tests |
| --- | --- | --- |
| Direct messages (deterministic id), channels, work-item and commit conversations | `src/core/conversations.ts` | integration, features |
| Send / read / page back messages, ordering by reserved `seq` | `src/core/messages.ts` | integration, features |
| Reply (quote), edit (marks "edited"), delete-for-everyone (tombstone) | `messages.ts` + `Hub.tsx` | features (edit, delete); reply in integration |
| Emoji reactions (6 fixed emoji) | `messages.ts` `react` | features |
| Attachments up to 16 MiB, chunked, SHA-256 checked, inline image preview, paste and drag-drop | `src/core/files.ts`, `components.tsx` | integration, features |
| `#1234` work item, `!1234` pull request, `a1b2c3d` commit, `@Name`, URL chips | `src/core/mentions.ts` + `devops.ts` `resolveMention` | `tests/mentions.test.mjs` (parser only; resolution NOT TESTED) |
| Unread badge in hub, unread dashboard widget, desktop notifications | `notifications.ts`, `Widget.tsx` | features (cursor logic only) |
| Search across your conversations (bounded cost) | `client.ts` `searchMessages` | features |
| Typing indicator, last-seen presence | `conversations.ts` `setTyping`, `client.ts` `touchPresence` | features |
| Channel member management and rename | `conversations.ts`, `Hub.tsx` | features (rename only) |
| "Discuss in ..." menu items on work items and commits | `src/Actions/Actions.ts` | **no tests** (needs a live host) |
| English and Persian UI, right-to-left layout | `src/core/i18n.ts`, `styles.css` | layout only, via a manual harness (see `09_`) |
| Light/dark theme following the host | `Hub.tsx` `applyHostTheme` | NOT TESTED against a real host |

## Cannot be done (platform limits, not bugs)

- **No cross-collection messaging**: the Extension Data Service is per project collection. (docs/06 section 6.12; INFERRED, matches the SDK design.)
- **No global header badge**: Azure DevOps has no extension point on the global header. The unread count is visible in the hub and in a dashboard widget only.
- **No push/websocket**: new messages are found by polling.

## Maturity - be honest

- All verification so far is the in-memory emulator (`tests/harness`) plus a static layout harness. **The extension has never been run against a live Azure DevOps host** (NOT TESTED). Anything that touches real SDK/REST behaviour - directory enumeration, identity search, hub URLs, theme sampling, menu actions - is INFERRED from documentation and code.
- One confirmed data-loss bug exists in a manual console helper (`secureChatSweep()`); see `13_`.

## Where to go next

Architecture: `03_ARCHITECTURE.md`. Task steps: `12_TASK_PLAYBOOKS.md`. Problems: `13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md`.
