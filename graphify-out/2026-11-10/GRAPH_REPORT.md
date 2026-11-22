# Graph Report - Chat_Plugin_azureDevops  (2026-11-10)

## Corpus Check
- 45 files · ~52,593 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .css 1)

## Summary
- 671 nodes · 1311 edges · 29 communities (27 shown, 2 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 72 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b061bbb8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Hub UI, i18n, boot
- ChatClient facade + directory
- messages.ts
- Azure DevOps SDK + Actions
- Files and encoding
- Store (data service wrapper)
- Test emulator harness
- tsconfig (app)
- Icon generator script
- Test stubs for ADO API
- devDependencies
- dependencies
- tsconfig (tests)
- features.test setup
- package metadata, toolchain
- integration.test setup
- npm scripts
- webpack config
- mentions.test
- fuzz test setup
- 6. Offline / manual installation
- راهنمای کاربر (فارسی)
- 7.4 Backlog
- 2. Cryptographic design and threat model
- 8. Operations
- 3. Data model
- 1. Architecture
- CoreRestClient

## God Nodes (most connected - your core abstractions)
1. `ChatClient` - 55 edges
2. `ConversationDoc` - 34 edges
3. `App()` - 29 edges
4. `Conversations` - 24 edges
5. `Store` - 23 edges
6. `Messages` - 20 edges
7. `7.4 Backlog` - 20 edges
8. `compilerOptions` - 18 edges
9. `DecryptedMessage` - 17 edges
10. `AttachmentManifest` - 15 edges

## Surprising Connections (you probably didn't know these)
- `4.6 `conversations.ts` — `Conversations`` --references--> `Conversations`  [INFERRED]
  docs/04-api-reference.md → src/core/conversations.ts
- `4.10 `devops.ts`` --references--> `resolveMention()`  [INFERRED]
  docs/04-api-reference.md → src/core/devops.ts
- `Attachments` --references--> `AttachmentManifest`  [INFERRED]
  docs/04-api-reference.md → src/core/model.ts
- ``pages/{convId}_{page}`` --references--> `MessageBody`  [INFERRED]
  docs/03-data-model.md → src/core/model.ts
- `Messages` --references--> `DecryptedMessage`  [INFERRED]
  docs/04-api-reference.md → src/core/model.ts

## Import Cycles
- None detected.

## Communities (29 total, 2 thin omitted)

### Community 0 - "Hub UI, i18n, boot"
Cohesion: 0.08
Nodes (64): react, Person, saveBlob(), applyLanguage(), dirOf(), EN, FA, formatNumber() (+56 more)

### Community 1 - "ChatClient facade + directory"
Cohesion: 0.06
Nodes (23): 4.1 `client.ts` — `ChatClient`, Attachments, Conversations, Directory, Identity, Messages, Polling, 5.8 Troubleshooting the build (+15 more)

### Community 2 - "messages.ts"
Cohesion: 0.12
Nodes (18): 4.10 `devops.ts`, 4.11 `notifications.ts`, 4.2 `crypto.ts`, 4.4 `keystore.ts` — `Keystore`, 4.5 `keyring.ts` — `Keyring`, 4.6 `conversations.ts` — `Conversations`, 4.7 `messages.ts` — `Messages`, 4.9 `mentions.ts` (+10 more)

### Community 3 - "Azure DevOps SDK + Actions"
Cohesion: 0.07
Nodes (41): azure-devops-extension-sdk, park(), ChatClientOptions, EXTENSION_VERSION, CommitActionContext, currentProject(), DirectoryEntry, EMPTY_DIRECTORY (+33 more)

### Community 4 - "Files and encoding"
Cohesion: 0.10
Nodes (25): 3.6 Quota maths, 4.8 `files.ts` — `Files`, 7.4.6 Automatic garbage collection — 1 day, 8.3b Deleting a conversation, dmId(), subjectId(), b64decode(), b64encode() (+17 more)

### Community 5 - "Store (data service wrapper)"
Cohesion: 0.12
Nodes (9): 4.3 `storage.ts` — `Store`, MAX_DOC_ID, assertDocId(), isConflict(), isNotFound(), Scope, scopeOptions(), Store (+1 more)

### Community 6 - "Test emulator harness"
Cohesion: 0.12
Nodes (7): bootWorld(), installDom(), installIndexedDb(), installModuleInterception(), Module, path, STUBS

### Community 7 - "tsconfig (app)"
Cohesion: 0.09
Nodes (21): compilerOptions, allowSyntheticDefaultImports, baseUrl, esModuleInterop, forceConsistentCasingInFileNames, jsx, lib, module (+13 more)

### Community 8 - "Icon generator script"
Cohesion: 0.12
Nodes (10): commit_hash(), main(), bell(), blank(), main(), ring(), rounded_rect(), speech_bubble_with_lock() (+2 more)

### Community 9 - "Test stubs for ADO API"
Cohesion: 0.22
Nodes (3): GitRestClient, instances, WorkItemTrackingRestClient

### Community 10 - "devDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, css-loader@^7.1.2, rimraf@^6.0.1, style-loader@^4.0.0, ts-loader@^9.5.1, @types/react@^18.3.12, @types/react-dom@^18.3.1, webpack-cli@^5.1.4 (+7 more)

### Community 11 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, azure-devops-extension-api@^4.267.0, azure-devops-extension-sdk@^4.0.2, @noble/ciphers@^2.3.0, @noble/curves@^2.3.0, @noble/hashes@^2.3.0, react@^18.3.1, react-dom@^18.3.1 (+5 more)

### Community 12 - "tsconfig (tests)"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, lib, module, moduleResolution, outDir, rootDir (+4 more)

### Community 13 - "features.test setup"
Cohesion: 0.17
Nodes (5): ALICE, BOB, CAROL, core, require

### Community 14 - "package metadata, toolchain"
Cohesion: 0.17
Nodes (11): description, tfx-cli@^0.21.1, typescript@^5.6.3, webpack@^5.96.1, license, name, private, version (+3 more)

### Community 15 - "integration.test setup"
Cohesion: 0.18
Nodes (5): ALICE, BOB, CAROL, core, require

### Community 16 - "npm scripts"
Cohesion: 0.18
Nodes (11): scripts, build, build:dev, clean, fuzz, icons, package, package:dev (+3 more)

### Community 17 - "webpack config"
Cohesion: 0.20
Nodes (8): copy-webpack-plugin@^12.0.2, html-webpack-plugin@^5.6.8, copy-webpack-plugin, html-webpack-plugin, CopyPlugin, entries, HtmlPlugin, path

### Community 19 - "fuzz test setup"
Cohesion: 0.29
Nodes (4): core, device, require, USERS

### Community 21 - "6. Offline / manual installation"
Cohesion: 0.06
Nodes (33): 5.1 Toolchain, 5.2 Scripts, 5.3 Entry points, 5.4 Before you package: set the publisher, 5.5 Versioning, 5.6 Development loop, 5.7 Reproducibility and supply chain, 5. Build and package (+25 more)

### Community 22 - "راهنمای کاربر (فارسی)"
Cohesion: 0.06
Nodes (32): About, Attach a file, Create a channel, Delete a message or a conversation, Discuss a work item or a commit, Getting started, Link to work items, pull requests and commits, Messages are not encrypted (+24 more)

### Community 23 - "7.4 Backlog"
Cohesion: 0.08
Nodes (24): 7.1 What already exists on the market, 7.2 Platform capabilities investigated, 7.3 Built in this prototype, 7.4.10 Slash commands — 3 days, 7.4.11 Auto-channels for pull requests — 2 days, 7.4.12 Conversation export — 1 day, 7.4.13 Multi-device improvements — 3 days, 7.4.14 Key rotation without losing history — 2 days (+16 more)

### Community 24 - "2. Cryptographic design and threat model"
Cohesion: 0.10
Nodes (20): 2.10 Clear mode, 2.12 Running over plain HTTP, 2.13 Residual risks worth writing down, 2.1 Why encryption is needed at all, 2.2 Threat model, 2.3 Algorithms, 2.4 Key hierarchy, 2.5 Epochs (+12 more)

### Community 25 - "8. Operations"
Cohesion: 0.11
Nodes (19): 8.1 Tunable constants, 8.2 Capacity planning, 8.3 Garbage collection, 8.4 Backup and restore, 8.5 User lifecycle, 8.6 Security operations, 8.7 Performance notes, 8.7b Caches that matter for responsiveness (+11 more)

### Community 26 - "3. Data model"
Cohesion: 0.13
Nodes (15): 3.1 Service limits that shape the schema, 3.1b Storage namespace, 3.2 Collections, 3.3 Document shapes, 3.4 Paging, 3.5 Attachments, 3.7 Migration, 3. Data model (+7 more)

### Community 27 - "1. Architecture"
Cohesion: 0.15
Nodes (12): 1. Architecture, Cold start, Contribution points used, Module map, Receiving, Runtime flow, Sending a message, The constraint that shapes everything (+4 more)

### Community 28 - "CoreRestClient"
Cohesion: 0.20
Nodes (4): dataManager, state, CoreRestClient, SERVICES

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ChatClient` connect `ChatClient facade + directory` to `Hub UI, i18n, boot`, `messages.ts`, `Azure DevOps SDK + Actions`, `Files and encoding`, `Store (data service wrapper)`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `App()` (e.g. with `.listConversations()` and `.markRead()`) actually correct?**
  _`App()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Should `Hub UI, i18n, boot` be split into smaller, more focused modules?**
  _Cohesion score 0.07638279192273925 - nodes in this community are weakly interconnected._
- **Why does `Files` connect `Files and encoding` to `ChatClient facade + directory`, `Azure DevOps SDK + Actions`, `Store (data service wrapper)`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Conversations` (e.g. with `Cold start` and `4.6 `conversations.ts` — `Conversations``) actually correct?**
  _`Conversations` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `ChatClient facade + directory` be split into smaller, more focused modules?**
  _Cohesion score 0.05679974034404414 - nodes in this community are weakly interconnected._
- **Why does `4. API reference` connect `messages.ts` to `ChatClient facade + directory`, `Store (data service wrapper)`, `Files and encoding`, `6. Offline / manual installation`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._