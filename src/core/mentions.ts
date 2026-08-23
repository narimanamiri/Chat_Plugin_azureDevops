/**
 * mentions.ts - turning typed tokens into rich references.
 *
 * Grammar (deliberately close to what Azure DevOps already uses in commit
 * messages and PR descriptions, so nobody has to learn a second syntax):
 *
 *   #1234          work item
 *   !1234          pull request
 *   @Display Name  user, resolved against the Secure Chat keyring
 *   a1b2c3d        git commit, 7 to 40 hex characters
 *   https://...    any Azure DevOps URL, unfurled to its object
 *
 * Parsing is a pure function with no DOM and no network, which is what makes
 * it testable (see tests/mentions.test.mjs). Resolution - fetching the work
 * item title, the commit subject - is separate and lazy.
 *
 * Privacy note: mention *labels* are captured at send time and travel inside
 * the encrypted payload, so history stays readable even if the work item is
 * later deleted. Resolving a reference for display does hit the Azure DevOps
 * REST API, which tells the server which objects a reader is looking at. That
 * is unavoidable and is no worse than browsing to the item directly.
 */

import type { Mention, MentionKind } from "./model";

const WORK_ITEM = /(?:^|[\s(])#(\d{1,9})\b/g;
const PULL_REQUEST = /(?:^|[\s(])!(\d{1,9})\b/g;
const COMMIT = /(?:^|[\s(])([0-9a-f]{7,40})\b/g;
const URL = /https?:\/\/[^\s<>"']+/g;

export interface ParseContext {
  /** Display names that may follow an "@". Longest match wins. */
  knownUsers: { userId: string; displayName: string }[];
}

/** Extract every reference in `text`, sorted by position, without overlaps. */
export function parseMentions(text: string, ctx: ParseContext = { knownUsers: [] }): Mention[] {
  const found: Mention[] = [];

  const push = (m: Mention) => {
    // Reject anything overlapping an already accepted mention. Earlier
    // matchers therefore win, which is why users are matched first.
    const end = m.start + m.length;
    if (found.some((x) => m.start < x.start + x.length && x.start < end)) return;
    found.push(m);
  };

  // 1. users - longest display name first so "@Ann Lee" beats "@Ann"
  const users = [...ctx.knownUsers].sort((a, b) => b.displayName.length - a.displayName.length);
  for (const user of users) {
    const needle = `@${user.displayName}`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      const before = at === 0 ? " " : text[at - 1];
      if (/[\s(]/.test(before)) {
        push({
          kind: "user",
          raw: needle,
          value: user.userId,
          label: user.displayName,
          start: at,
          length: needle.length,
        });
      }
      from = at + needle.length;
    }
  }

  // 2. urls before the bare-token matchers, so a sha inside a link is not
  //    double counted
  for (const match of text.matchAll(URL)) {
    push({
      kind: "url",
      raw: match[0],
      value: match[0],
      start: match.index ?? 0,
      length: match[0].length,
    });
  }

  const simple: [RegExp, MentionKind, string][] = [
    [WORK_ITEM, "workitem", "#"],
    [PULL_REQUEST, "pullrequest", "!"],
    [COMMIT, "commit", ""],
  ];
  for (const [pattern, kind, sigil] of simple) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const token = match[1];
      const raw = `${sigil}${token}`;
      // match[0] may include the leading separator that the lookbehind-free
      // pattern had to consume, so locate the token inside the match.
      const start = (match.index ?? 0) + match[0].lastIndexOf(raw);
      push({ kind, raw, value: token, start, length: raw.length });
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

/** Split text into alternating literal / mention segments for rendering. */
export type Segment = { type: "text"; text: string } | { type: "mention"; mention: Mention };

export function segment(text: string, mentions: Mention[]): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (mention.start > cursor) out.push({ type: "text", text: text.slice(cursor, mention.start) });
    out.push({ type: "mention", mention });
    cursor = mention.start + mention.length;
  }
  if (cursor < text.length) out.push({ type: "text", text: text.slice(cursor) });
  return out;
}

/* ------------------------------------------------------------------ */
/* resolution                                                          */
/* ------------------------------------------------------------------ */

export interface ResolvedRef {
  label: string;
  sublabel?: string;
  url?: string;
  state?: string;
}

/**
 * Resolve a mention to something displayable. Implemented in `devops.ts` so
 * that this module stays free of Azure DevOps imports and remains testable
 * outside a browser.
 */
export type Resolver = (mention: Mention) => Promise<ResolvedRef | undefined>;

/** Small LRU so a channel full of "#4213" does not issue 40 REST calls. */
export function memoiseResolver(inner: Resolver, max = 200): Resolver {
  const cache = new Map<string, Promise<ResolvedRef | undefined>>();
  return (mention) => {
    const key = `${mention.kind}:${mention.repositoryId ?? ""}:${mention.value}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const promise = inner(mention);
    cache.set(key, promise);
    if (cache.size > max) cache.delete(cache.keys().next().value as string);
    return promise;
  };
}
