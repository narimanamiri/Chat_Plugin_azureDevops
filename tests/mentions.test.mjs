/** Parser tests. Pure functions, no network, no DOM. */

import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseMentions, segment } = require("./build/mentions.js");

const PEOPLE = {
  knownUsers: [
    { userId: "u-jane", displayName: "Jane Doe" },
    { userId: "u-jan", displayName: "Jan" },
  ],
};

test("work item tokens", () => {
  const found = parseMentions("fixed in #4213 today");
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "workitem");
  assert.equal(found[0].value, "4213");
  assert.equal("fixed in #4213 today".slice(found[0].start, found[0].start + found[0].length), "#4213");
});

test("pull request tokens", () => {
  const found = parseMentions("see !77 for the fix");
  assert.equal(found[0].kind, "pullrequest");
  assert.equal(found[0].value, "77");
});

test("commit shas", () => {
  const text = "broken by 9f2a1c4 I think";
  const found = parseMentions(text);
  assert.equal(found[0].kind, "commit");
  assert.equal(found[0].value, "9f2a1c4");
  assert.equal(text.slice(found[0].start, found[0].start + found[0].length), "9f2a1c4");
});

test("a six character hex token is not a commit", () => {
  assert.equal(parseMentions("colour #ff00aa").filter((m) => m.kind === "commit").length, 0);
});

test("longest user name wins", () => {
  const found = parseMentions("ping @Jane Doe please", PEOPLE);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "user");
  assert.equal(found[0].value, "u-jane");
  assert.equal(found[0].label, "Jane Doe");
});

test("a shorter name still matches when it stands alone", () => {
  const found = parseMentions("hi @Jan", PEOPLE);
  assert.equal(found[0].value, "u-jan");
});

test("urls are captured and do not double count shas inside them", () => {
  const text = "https://server/_git/repo/commit/9f2a1c4d5e6f7a8b";
  const found = parseMentions(text);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "url");
});

test("several references in one message keep their offsets", () => {
  const text = "@Jane Doe please look at #12 and !34";
  const found = parseMentions(text, PEOPLE);
  assert.deepEqual(
    found.map((m) => m.kind),
    ["user", "workitem", "pullrequest"]
  );
  for (const mention of found) {
    assert.equal(text.slice(mention.start, mention.start + mention.length), mention.raw);
  }
});

test("segment reassembles the original text exactly", () => {
  const text = "@Jane Doe please look at #12 and !34 plus 9f2a1c4";
  const parts = segment(text, parseMentions(text, PEOPLE));
  const rebuilt = parts
    .map((p) => (p.type === "text" ? p.text : p.mention.raw))
    .join("");
  assert.equal(rebuilt, text);
});

test("no references means one literal segment", () => {
  const parts = segment("plain text", []);
  assert.deepEqual(parts, [{ type: "text", text: "plain text" }]);
});
