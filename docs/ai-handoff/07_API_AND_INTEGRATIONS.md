# 07 - APIs and integrations

This project **exposes no HTTP API** (CONFIRMED: no server code exists). It *consumes* Azure DevOps services from inside the browser. All consumption is in `src/core/devops.ts`, `src/core/storage.ts` and the `SDK.*` calls in `client.ts`, `Widget.tsx`, `Actions.ts`.

Every integration below was verified by **reading the code**; none was exercised against a live Azure DevOps host (NOT TESTED). The emulator stubs in `tests/harness/stub-*.cjs` return fixed data, so green tests say nothing about real REST behaviour.

## Authentication and trust

- No login of our own. The host page is already authenticated; the extension runs in an iframe and receives identity from `SDK.getUser()` (`{id, displayName, name}`) and an access token from `SDK.getAccessToken()`.
- The token is used in exactly one place: `Store.create` -> `service.getExtensionDataManager(extensionId, token)` (`storage.ts`).
- REST clients are created with `getClient(CoreRestClient | GitRestClient | WorkItemTrackingRestClient)`; the SDK attaches authentication. The manifest `scopes` must cover them (see table).

### Manifest scopes (`azure-devops-extension.json`)

| Scope | Needed for |
| --- | --- |
| `vso.extension.data_write` | Reading/writing our own documents (the whole chat) |
| `vso.profile`, `vso.identity` | Current user, identity search |
| `vso.project` | Listing teams and members (people directory) |
| `vso.work` | Resolving `#1234` titles |
| `vso.code` | Resolving `!1234` and commit shas |

Adding a scope later requires **uninstall and reinstall** in the collection (an in-place update does not obtain new consent) - symptom: empty people picker.

## Host services used (SDK)

| Service / call | File:symbol | Purpose | Failure handling |
| --- | --- | --- | --- |
| `SDK.init({loaded:false, applyTheme:true})`, `SDK.ready()`, `SDK.notifyLoadSucceeded()` | `client.ts` `bootstrap` | iframe handshake | `SDK.init`/`SDK.ready` have **no timeout** (a stalled handshake hangs); only `ChatClient.create()` and `client.init()` are each capped at 30 s. Failure shows "Team Chat could not start" |
| `SDK.getUser()` | `client.ts` `init` | identity | nameless user handled by `looksLikeIdentityId` |
| `ExtensionDataService.getExtensionDataManager` | `storage.ts` `Store.create` | persistence | see `06_` |
| `ProjectPageService.getProject()` | `devops.ts` `currentProject` | current project name/id | cached promise; `undefined` => resolution skipped |
| `HostNavigationService.navigate(url)` | `devops.ts` `navigateTo` | open chips, hub | none (fire and forget) |
| `LocationService.getResourceAreaLocation(CoreRestClient.RESOURCE_AREA_ID)` | `devops.ts` `hostBaseUrl` | real host base URL (the iframe's own origin is *not* the product) | `navigateToHub` falls back to `window.location.origin` on error |
| `IdentityService.searchIdentitiesAsync(q, ["user"], ["ims","source"])` | `devops.ts` `searchPeople` | people search in pickers | returns `[]` on any error |

## REST calls (via generated clients)

| Client method | Called from | Why | Limits / timeouts |
| --- | --- | --- | --- |
| `CoreRestClient.getAllTeams(false, 201)` | `loadDirectory` stage 1 | all teams in the collection | `MAX_TEAMS` 200; 15 s per call |
| `getProjects()` + `getTeams(projectId, false, 200)` | `loadDirectory` stage 2 | fallback if stage 1 yields no people | `MAX_PROJECTS` 50 |
| `getTeams(currentProject.id ...)` | `loadDirectory` stage 3 | last resort | - |
| `getTeamMembersWithExtendedProperties(projectId, teamId, 500)` | `loadDirectory` `harvest` | members of each team | `MAX_MEMBER_REQUESTS` 120, concurrency 6, whole scan 25 s |
| `WorkItemTrackingRestClient.getWorkItem(id, projectId)` | `resolveMention` kind `workitem` | title/type/state | errors -> fallback label |
| `GitRestClient.getPullRequestById(id, projectId)` | kind `pullrequest` | title/repo/status | same |
| `GitRestClient.getRepositories(projectId)` then `getCommit(sha, repoId, projectId)` | kind `commit` | bare sha has no repo, so up to `MAX_REPO_PROBES` (10) repositories are probed in order | same |

No retries, no rate limiting, and no caching beyond `memoiseResolver` (a size-capped map of 200 entries, evicting the oldest inserted - FIFO, not true LRU - and it also caches `undefined`/failed lookups for the life of the tab) and the directory cache. Timeouts (`withTimeout`, `withStoreTimeout`) reject the promise but do **not** cancel the underlying request, so a call reported as timed out may still complete. Azure DevOps throttling behaviour is UNKNOWN.

### The directory cascade (why the people picker works)

`collectionMembers()` runs in the background (`primeDirectory`) and stores a snapshot that interactive code reads *synchronously* via `directorySnapshot()` - a click must never wait on a scan. A stage only "wins" if it produced **people**; team stubs with failing member lists fall through (this exact mistake once produced an empty picker). Groups (`isContainer`) are skipped. Every stage appends a line to `result.log`. The picker's empty state shows only `result.error`, which is the **last** log line (`PeoplePicker.emptyReason` in `components.tsx`); the **full** log is available through `secureChatDiagnose().directory.log`. The identity search is the safety net when all REST stages fail.

## Mention resolution

`mentions.ts` parses tokens (pure). `devops.ts` `resolveMention` (:456) resolves lazily per chip: work item -> title + type + state + URL; PR -> title + repo + status + URL; commit -> first line of message + author + URL; user -> stored label; url -> itself. Any error returns the label captured at send time (`mention.label`) or `undefined`.
**Stored mention data is trusted at render (CONFIRMED in code):** for kind `url`, `resolveMention` returns `{label: value, url: value}` straight from the stored message, and the chip uses it as `href` and for `navigateTo`, with no scheme check. The *parser* only produces `https?://`, but a client that writes documents directly can store anything (`13_` KI-22).

**Defect (CONFIRMED in code, effect INFERRED):** the three URLs use `window.location.origin` and an unencoded project name (`devops.ts` :470, :481, :497). Inside the extension iframe that origin is probably not the Azure DevOps host. Prefer `hostBaseUrl()` + `encodeURIComponent(project.name)`. See `13_`.

## Menu actions (inbound integration)

| Contribution id | Targets (manifest) | Handler |
| --- | --- | --- |
| `discuss-work-item` | work item toolbar, query result menu, backlog item menu | `SDK.register("discuss-work-item", {execute})` in `Actions.ts` -> `firstWorkItemId(context)` |
| `discuss-commit` | commit details menu, commit list menu | `SDK.register("discuss-commit", ...)` -> `firstCommitId`, `repositoryId` |

Flow: the handler writes `{subject, title}` to the **user-scoped** setting `pending-subject`, then `navigateToHub("chat-hub")`. The hub, on load, reads and clears the setting and calls `openSubject` (deterministic id, so everyone lands in the same chat). Context shapes are guessed in `WorkItemActionContext`/`CommitActionContext` (`devops.ts` :526+); the real host payload was NOT TESTED. Menu text in the manifest still says "Discuss in Secure Chat".

## Internal "API": the ChatClient surface

The UI's contract is `ChatClient` (`client.ts`). Method list and semantics: `05_COMPONENT_REFERENCE.md`. Document shapes: `06_`. Change the surface only by editing `client.ts` and its callers in `Hub.tsx`; tests call the same methods, so they are the executable specification.

## Browser APIs relied on

`IndexedDB` is no longer used (it was for keys). Still used: `Notification` (permission requested at boot; blocked on plain HTTP by browsers), `createImageBitmap` (optional, for image sizes), `URL.createObjectURL`, `File/Blob`, `crypto.getRandomValues` (falls back to `Math.random` in non-browser runners), `btoa/atob`, `Intl.RelativeTimeFormat`.

## Not integrated (do not assume)

Pipelines/builds (`MentionKind` includes `"build"` but nothing parses or resolves it), email, external chat bridges, any non-Azure-DevOps network endpoint. The manifest `links.getstarted` and `links.support` point at `https://example.invalid/...` placeholders.
