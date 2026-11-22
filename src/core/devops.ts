/**
 * devops.ts - the only module that talks to Azure DevOps REST APIs.
 *
 * Kept separate from mentions.ts so the parser stays a pure function and can
 * be unit tested outside a browser.
 */

import * as SDK from "azure-devops-extension-sdk";
import {
  CommonServiceIds,
  IHostNavigationService,
  ILocationService,
  IProjectInfo,
  IProjectPageService,
  getClient,
} from "azure-devops-extension-api";
import { CoreRestClient } from "azure-devops-extension-api/Core";
import { GitRestClient } from "azure-devops-extension-api/Git";
import {
  IVssIdentityService,
  IdentityServiceIds,
} from "azure-devops-extension-api/Identities";
import { WorkItemTrackingRestClient } from "azure-devops-extension-api/WorkItemTracking";

import type { Mention } from "./model";
import type { ResolvedRef, Resolver } from "./mentions";

let projectPromise: Promise<IProjectInfo | undefined> | undefined;

export function currentProject(): Promise<IProjectInfo | undefined> {
  if (!projectPromise) {
    projectPromise = SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService).then(
      (svc) => svc.getProject()
    );
  }
  return projectPromise;
}

/**
 * Base web URL of this Azure DevOps organisation or collection.
 *
 * NOT `window.location.origin`. An extension runs in a sandboxed iframe
 * served from a different origin than the product - `*.gallerycdn.vsassets.io`
 * on Services, a separate path on Server - so a URL built from our own
 * location points at the sandbox, not at Azure DevOps.
 *
 * The host tells us where it lives through the location service. The Core
 * resource area resolves to the collection root, which is exactly the prefix
 * a hub URL needs.
 */
export async function hostBaseUrl(): Promise<string> {
  const location = await SDK.getService<ILocationService>(CommonServiceIds.LocationService);
  const base = await location.getResourceAreaLocation(CoreRestClient.RESOURCE_AREA_ID);
  return base.replace(/\/+$/, "");
}

/**
 * Absolute URL of one of this extension's own hubs.
 *
 * `contribution` is the id as declared in the manifest, e.g. "chat-hub";
 * the publisher and extension parts come from the SDK at runtime, because
 * they differ between a dev build and a release.
 */
export async function hubUrl(contribution: string, projectName?: string): Promise<string> {
  const extensionId = SDK.getExtensionContext().id;
  const project = projectName ?? (await currentProject())?.name;
  const base = await hostBaseUrl();
  const scope = project ? `/${encodeURIComponent(project)}` : "";
  return `${base}${scope}/_apps/hub/${extensionId}.${contribution}`;
}

/**
 * Navigate to one of our hubs, tolerating a host that cannot resolve its
 * own location - in that case fall back to a page-relative guess rather
 * than doing nothing at all.
 */
export async function navigateToHub(contribution: string): Promise<void> {
  try {
    await navigateTo(await hubUrl(contribution));
  } catch (err) {
    console.warn("[team-chat] could not resolve the hub URL", err);
    const extensionId = SDK.getExtensionContext().id;
    const project = (await currentProject())?.name;
    const scope = project ? `/${encodeURIComponent(project)}` : "";
    await navigateTo(
      `${window.location.origin}${scope}/_apps/hub/${extensionId}.${contribution}`
    );
  }
}

export async function navigateTo(url: string): Promise<void> {
  const nav = await SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);
  nav.navigate(url);
}

/* ------------------------------------------------------------------ */
/* project directory                                                   */
/* ------------------------------------------------------------------ */

/**
 * Does this string look like a raw identity rather than a person's name?
 *
 * Azure DevOps identifies users by GUID on Services and by Windows SID on
 * Server. Either can end up standing in for a display name when a lookup
 * fails, and if such a value is ever *persisted* it becomes permanent: every
 * client reads it back and shows it. Detecting the shape is what stops that.
 */
export function looksLikeIdentityId(value: string | undefined | null): boolean {
  if (!value) return true;
  const v = value.trim();
  if (!v) return true;
  if (/^S-\d-\d+(-\d+)+$/i.test(v)) return true; // Windows SID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true; // GUID
  if (/^[0-9a-f]{32}$/i.test(v)) return true; // GUID without dashes
  return false;
}

export interface DirectoryEntry {
  id: string;
  displayName: string;
}

export interface DirectoryResult {
  people: DirectoryEntry[];
  /** Which stage produced people, if any. */
  source: "collection" | "projects" | "project" | "none";
  teamsScanned: number;
  truncated: boolean;
  /** One line per stage: what was tried, what it returned, what failed. */
  log: string[];
  error?: string;
}

/**
 * Bounds. A collection with hundreds of teams would otherwise turn one
 * directory load into thousands of sequential round-trips, which is exactly
 * how an interactive click ends up waiting minutes.
 */
const MAX_TEAMS = 200;
const MAX_PROJECTS = 50;
/** Hard ceiling on member requests, whatever the team count says. */
const MAX_MEMBER_REQUESTS = 120;
/** Requests in flight at once. */
const CONCURRENCY = 6;
/** Any single REST call that has not answered by now is treated as failed. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Whole-scan deadline; partial results are returned rather than hanging. */
const SCAN_DEADLINE_MS = 25_000;

let membersCache: Promise<DirectoryResult> | undefined;

const EMPTY_DIRECTORY: DirectoryResult = {
  people: [],
  source: "none",
  teamsScanned: 0,
  truncated: false,
  log: ["directory scan has not finished yet"],
};

/**
 * Last completed scan. Interactive code reads THIS, synchronously, and never
 * awaits the scan itself - a people picker must not be able to block a click.
 */
let membersSnapshot: DirectoryResult = EMPTY_DIRECTORY;

export const directorySnapshot = (): DirectoryResult => membersSnapshot;

/** Start (or restart) the scan in the background. Never throws, never awaited. */
export function primeDirectory(force = false): void {
  void collectionMembers(force).catch((err) =>
    console.warn("[secure-chat] directory scan failed", err)
  );
}

/** Test-only: forget cached directory/project state between simulated users. */
export function __resetDirectoryForTests(): void {
  membersCache = undefined;
  membersSnapshot = EMPTY_DIRECTORY;
  projectPromise = undefined;
  repoCache = undefined;
}

const errText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err ?? "unknown error");

/** Reject rather than hang. A stalled socket must not stall the whole scan. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Bounded-concurrency worker pool that honours a stop condition. */
async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !shouldStop()) {
      await worker(items[next++]);
    }
  });
  await Promise.all(runners);
}

/**
 * Everyone in the **project collection**, gathered from every team the
 * current user can see.
 *
 * A cascade, not a single call, because the surface differs by server
 * version and permission set:
 *
 *   1. getAllTeams            - one call, whole collection
 *   2. getProjects + getTeams - per-project, same coverage, older surface
 *   3. current project only   - last resort
 *
 * A stage only wins if it produced PEOPLE. Producing team stubs whose member
 * lists all fail must fall through, not report an empty success - that exact
 * mistake made 0.4.0's picker empty with no explanation.
 *
 * Every stage appends to `log`, which travels into the picker's empty state
 * and into `secureChatDiagnose()`, so a failure names itself.
 */
export function collectionMembers(force = false): Promise<DirectoryResult> {
  if (force) membersCache = undefined;
  if (!membersCache) {
    membersCache = loadDirectory().then((result) => {
      membersSnapshot = result;
      return result;
    });
  }
  return membersCache;
}

async function loadDirectory(): Promise<DirectoryResult> {
  const core = getClient(CoreRestClient);
  const seen = new Map<string, string>();
  const log: string[] = [];
  const deadline = Date.now() + SCAN_DEADLINE_MS;

  let teamsScanned = 0;
  let truncated = false;
  let requests = 0;
  let source: DirectoryResult["source"] = "none";

  const outOfBudget = (): boolean => Date.now() > deadline || requests >= MAX_MEMBER_REQUESTS;

  const harvest = async (projectId: string, teamId: string): Promise<void> => {
    requests++;
    const members = await withTimeout(
      core.getTeamMembersWithExtendedProperties(projectId, teamId, 500),
      REQUEST_TIMEOUT_MS,
      "team members"
    );
    for (const member of members) {
      const identity = member.identity;
      // `isContainer` marks groups; they cannot hold keys, so skip them.
      if (!identity?.id || identity.isContainer) continue;
      seen.set(identity.id, identity.displayName ?? identity.id);
    }
  };

  const scan = async (
    label: string,
    teams: { id: string }[],
    projectIdOf: (team: { id: string }) => string
  ): Promise<void> => {
    let readable = 0;
    let failed = 0;
    let firstError = "";
    if (teams.length > MAX_TEAMS) truncated = true;
    const slice = teams.slice(0, MAX_TEAMS);

    await pool(
      slice,
      CONCURRENCY,
      async (team) => {
        try {
          await harvest(projectIdOf(team), team.id);
          readable++;
        } catch (err) {
          failed++;
          if (!firstError) firstError = errText(err);
        }
      },
      outOfBudget
    );

    teamsScanned += readable + failed;
    if (outOfBudget()) truncated = true;
    log.push(
      `${label}: ${teams.length} teams, ${readable} readable, ${failed} failed` +
        (firstError ? ` (first error: ${firstError})` : "") +
        `; people so far: ${seen.size}`
    );
  };

  // Stage 1: every team in the collection, one call.
  try {
    const teams = await withTimeout(
      core.getAllTeams(false, MAX_TEAMS + 1),
      REQUEST_TIMEOUT_MS,
      "getAllTeams"
    );
    await scan("getAllTeams", teams, (t) => (t as unknown as { projectId: string }).projectId);
    if (seen.size > 0) source = "collection";
  } catch (err) {
    log.push(`getAllTeams failed: ${errText(err)}`);
  }

  // Stage 2: enumerate projects, then each project's teams.
  if (seen.size === 0 && !outOfBudget()) {
    try {
      const projects = await withTimeout(core.getProjects(), REQUEST_TIMEOUT_MS, "getProjects");
      log.push(`getProjects: ${projects.length} projects`);
      for (const project of [...projects].slice(0, MAX_PROJECTS)) {
        if (outOfBudget()) {
          log.push("stopped: scan budget exhausted");
          break;
        }
        try {
          const teams = await withTimeout(
            core.getTeams(project.id, false, MAX_TEAMS),
            REQUEST_TIMEOUT_MS,
            "getTeams"
          );
          await scan(`getTeams(${project.name})`, teams, () => project.id);
        } catch (err) {
          log.push(`getTeams(${project.name}) failed: ${errText(err)}`);
        }
      }
      if (seen.size > 0) source = "projects";
    } catch (err) {
      log.push(`getProjects failed: ${errText(err)}`);
    }
  }

  // Stage 3: just the project this page is open in.
  if (seen.size === 0 && !outOfBudget()) {
    try {
      const project = await currentProject();
      if (!project) {
        log.push("no project context");
      } else {
        const teams = await withTimeout(
          core.getTeams(project.id, false, MAX_TEAMS),
          REQUEST_TIMEOUT_MS,
          "getTeams"
        );
        await scan(`current project (${project.name})`, teams, () => project.id);
        if (seen.size > 0) source = "project";
      }
    } catch (err) {
      log.push(`current-project scan failed: ${errText(err)}`);
    }
  }

  const result: DirectoryResult = {
    people: [...seen].map(([id, displayName]) => ({ id, displayName })),
    source,
    teamsScanned,
    truncated,
    log,
  };
  if (seen.size === 0) {
    result.error = log[log.length - 1] ?? "No directory source succeeded.";
  }
  console.info("[secure-chat] directory:", log.join(" | "));
  return result;
}

/* ------------------------------------------------------------------ */
/* identity search (host service)                                      */
/* ------------------------------------------------------------------ */

const GUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

/**
 * Search people through the HOST's identity picker service - the same one
 * that powers the product's own @-mention and reviewer pickers. It does not
 * depend on any REST scope of ours or on team enumeration working, so it
 * functions wherever the product UI itself can find people.
 *
 * This is the safety net under the directory cascade: even if every REST
 * stage fails, typing a name in the picker still finds the person.
 */
export async function searchPeople(query: string): Promise<DirectoryEntry[]> {
  if (query.trim().length < 2) return [];
  try {
    const service = await SDK.getService<IVssIdentityService>(
      IdentityServiceIds.IdentityService
    );
    const found = await service.searchIdentitiesAsync(query.trim(), ["user"], ["ims", "source"]);
    const out: DirectoryEntry[] = [];
    for (const raw of found ?? []) {
      // The declared IIdentity is minimal; runtime objects carry more. The
      // id that matches SDK.getUser().id (our storage key) is the local
      // identity guid - prefer it, then a guid inside entityId, then originId.
      const extra = raw as unknown as Record<string, unknown>;
      const id =
        (typeof extra.localId === "string" && extra.localId) ||
        GUID_RE.exec(raw.entityId ?? "")?.[0] ||
        raw.originId;
      const displayName =
        (typeof extra.displayName === "string" && extra.displayName) ||
        (typeof extra.providerDisplayName === "string" && extra.providerDisplayName) ||
        id;
      if (id) out.push({ id, displayName });
    }
    return out;
  } catch (err) {
    console.warn("[secure-chat] identity search failed", err);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* reference resolution                                                */
/* ------------------------------------------------------------------ */

let repoCache: Promise<{ id: string; name: string }[]> | undefined;

async function repositories(): Promise<{ id: string; name: string }[]> {
  if (!repoCache) {
    repoCache = (async () => {
      const project = await currentProject();
      if (!project) return [];
      const client = getClient(GitRestClient);
      const repos = await client.getRepositories(project.id);
      return repos.map((r) => ({ id: r.id, name: r.name }));
    })();
  }
  return repoCache;
}

/**
 * A bare sha carries no repository, so try the project's repositories in
 * order and stop at the first hit. Capped, because a project with 200 repos
 * would otherwise issue 200 requests for one unresolvable token.
 */
const MAX_REPO_PROBES = 10;

export const resolveMention: Resolver = async (mention: Mention): Promise<ResolvedRef | undefined> => {
  const project = await currentProject();
  if (!project) return undefined;

  try {
    switch (mention.kind) {
      case "workitem": {
        const client = getClient(WorkItemTrackingRestClient);
        const wi = await client.getWorkItem(Number(mention.value), project.id);
        const fields = wi.fields as Record<string, unknown>;
        return {
          label: String(fields["System.Title"] ?? `Work item ${mention.value}`),
          sublabel: String(fields["System.WorkItemType"] ?? ""),
          state: String(fields["System.State"] ?? ""),
          url: `${window.location.origin}/${project.name}/_workitems/edit/${mention.value}`,
        };
      }

      case "pullrequest": {
        const client = getClient(GitRestClient);
        const pr = await client.getPullRequestById(Number(mention.value), project.id);
        return {
          label: pr.title,
          sublabel: pr.repository?.name,
          state: String(pr.status),
          url: `${window.location.origin}/${project.name}/_git/${pr.repository?.name}/pullrequest/${mention.value}`,
        };
      }

      case "commit": {
        const client = getClient(GitRestClient);
        const repos = mention.repositoryId
          ? [{ id: mention.repositoryId, name: "" }]
          : (await repositories()).slice(0, MAX_REPO_PROBES);
        for (const repo of repos) {
          try {
            const commit = await client.getCommit(mention.value, repo.id, project.id);
            if (!commit) continue;
            return {
              label: commit.comment?.split("\n")[0] ?? mention.value.slice(0, 8),
              sublabel: commit.author?.name,
              url: `${window.location.origin}/${project.name}/_git/${repo.name || repo.id}/commit/${commit.commitId}`,
            };
          } catch {
            /* not in this repository, keep probing */
          }
        }
        return undefined;
      }

      case "user":
        return { label: mention.label ?? mention.value };

      case "url":
        return { label: mention.value, url: mention.value };

      default:
        return undefined;
    }
  } catch {
    // A reference the reader has no permission to see must not break the
    // message; fall back to the label captured at send time.
    return mention.label ? { label: mention.label } : undefined;
  }
};

/* ------------------------------------------------------------------ */
/* context passed in from menu actions                                 */
/* ------------------------------------------------------------------ */

export interface WorkItemActionContext {
  id?: number;
  workItemId?: number;
  ids?: number[];
  workItemIds?: number[];
}

export interface CommitActionContext {
  commitId?: string;
  commitIds?: string[];
  repositoryId?: string;
  gitRepository?: { id: string; name: string };
}

export function firstWorkItemId(context: WorkItemActionContext): number | undefined {
  return context.id ?? context.workItemId ?? context.ids?.[0] ?? context.workItemIds?.[0];
}

export function firstCommitId(context: CommitActionContext): string | undefined {
  return context.commitId ?? context.commitIds?.[0];
}
