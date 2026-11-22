# Graph Report - Chat_Plugin_azureDevops  (2026-11-10)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 392 nodes · 964 edges · 16 communities (14 shown, 2 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 41 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b061bbb8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 13
- Community 15
- Community 17
- Community 18
- Community 19

## God Nodes (most connected - your core abstractions)
1. `ChatClient` - 54 edges
2. `ConversationDoc` - 33 edges
3. `App()` - 29 edges
4. `Store` - 22 edges
5. `Conversations` - 22 edges
6. `Messages` - 18 edges
7. `DecryptedMessage` - 15 edges
8. `AttachmentManifest` - 14 edges
9. `MessageList()` - 14 edges
10. `ReadState` - 13 edges

## Surprising Connections (you probably didn't know these)
- `PollerOptions` --references--> `ConversationDoc`  [EXTRACTED]
  src/core/notifications.ts → src/core/model.ts
- `Widget()` --calls--> `navigateToHub()`  [EXTRACTED]
  src/Widget/Widget.tsx → src/core/devops.ts
- `ChatClient` --references--> `Conversations`  [EXTRACTED]
  src/core/client.ts → src/core/conversations.ts
- `ChatClient` --references--> `Files`  [EXTRACTED]
  src/core/client.ts → src/core/files.ts
- `ChatClient` --references--> `Messages`  [EXTRACTED]
  src/core/client.ts → src/core/messages.ts

## Import Cycles
- None detected.

## Communities (16 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (58): bootstrap(), Person, isImage(), saveBlob(), applyLanguage(), dirOf(), EN, FA (+50 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (9): ChatClient, activeTypers(), collectionMembers(), DirectoryResult, directorySnapshot(), looksLikeIdentityId(), primeDirectory(), withTimeout() (+1 more)

### Community 2 - "Community 2"
Cohesion: 0.10
Nodes (21): Conversations, dmId(), subjectId(), hashId(), randomBytes(), randomId(), Messages, newMessageId() (+13 more)

### Community 3 - "Community 3"
Cohesion: 0.10
Nodes (24): ChatClientOptions, EXTENSION_VERSION, BlobChunkDoc, CHUNK_BYTES, CHUNK_CONCURRENCY, COLLECTIONS, ConversationView, MAX_ATTACHMENT_BYTES (+16 more)

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (12): b64decode(), b64encode(), sha256(), TEXT_DECODER, TEXT_ENCODER, utf8(), chunkDocId(), Files (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (8): MAX_DOC_ID, assertDocId(), isConflict(), isNotFound(), Scope, scopeOptions(), Store, withStoreTimeout()

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (10): bootWorld(), dataManager, installDom(), installIndexedDb(), installModuleInterception(), Module, path, state (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (25): park(), CommitActionContext, currentProject(), DirectoryEntry, EMPTY_DIRECTORY, errText(), firstCommitId(), firstWorkItemId() (+17 more)

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (8): bell(), blank(), main(), ring(), rounded_rect(), speech_bubble_with_lock(), triangle(), write_png()

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (4): CoreRestClient, GitRestClient, instances, WorkItemTrackingRestClient

### Community 13 - "Community 13"
Cohesion: 0.17
Nodes (5): ALICE, BOB, CAROL, core, require

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (5): ALICE, BOB, CAROL, core, require

### Community 17 - "Community 17"
Cohesion: 0.25
Nodes (4): CopyPlugin, entries, HtmlPlugin, path

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (4): core, device, require, USERS

## Knowledge Gaps
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ChatClient` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `App()` (e.g. with `.listConversations()` and `.markRead()`) actually correct?**
  _`App()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.08619777895293496 - nodes in this community are weakly interconnected._
- **Why does `ConversationDoc` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07337662337662337 - nodes in this community are weakly interconnected._
- **Why does `Store` connect `Community 5` to `Community 1`, `Community 2`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10195035460992907 - nodes in this community are weakly interconnected._