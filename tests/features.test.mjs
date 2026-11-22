/**
 * Tests for the 1.0.0 work: read cursors, reactions, search, typing,
 * presence, paging totals, editing, and the two cost regressions (the
 * blob-collection scan on delete, concurrent chunk IO).
 *
 * Same shape as integration.test.mjs - the real ChatClient, several
 * simulated users, one shared document store - because that is the only
 * configuration in which any of these bugs appear.
 */

import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

const require = createRequire(import.meta.url);
const harness = require("./harness/index.cjs");
const core = harness.bootWorld();
const { NAMESPACE } = require("./build/model.js");

const ALICE = { id: "user-alice", displayName: "Alice Example" };
const BOB = { id: "user-bob", displayName: "Bob Sample" };
const CAROL = { id: "user-carol", displayName: "Carol Absent" };

const asAlice = (fn, device = "device-alice") => harness.asUser(core, ALICE, device, fn);
const asBob = (fn, device = "device-bob") => harness.asUser(core, BOB, device, fn);

const THUMBS = "\u{1F44D}";
const EYES = "\u{1F440}";

const makeFile = (name, text, type = "text/plain") => new File([text], name, { type });

beforeEach(() => {
  harness.resetWorld();
  harness.addTeamMember("team-1", ALICE.id, ALICE.displayName);
  harness.addTeamMember("team-1", BOB.id, BOB.displayName);
  harness.addTeamMember("team-1", CAROL.id, CAROL.displayName);
});

/* ------------------------------------------------------------------ */
/* read cursors                                                        */
/* ------------------------------------------------------------------ */

test("marking two conversations read in one session does not 409", async () => {
  // The read-state document was cached together with the __etag from the
  // read that produced it, and written with `put`, which does not refresh
  // it. The first write succeeded and bumped the server's etag; the second
  // presented the stale one and failed with HTTP 409 after six retries.
  // Switching between two conversations was enough to trigger it.
  const [first, second] = await asAlice(async (alice) => {
    const dm = await alice.openDirect(BOB.id);
    const channel = await alice.createChannel("Both", [BOB.id]);
    await alice.send(dm.id, { text: "one" });
    await alice.send(channel.id, { text: "two" });
    return [dm.id, channel.id];
  });

  await asBob(async (bob) => {
    assert.equal(await bob.markRead(first), 1);
    // Before the fix this threw "Could not write ... after 6 attempts".
    assert.equal(await bob.markRead(second), 1);
    const { unread } = await bob.listConversations();
    assert.equal(unread.total, 0, "both cursors must have stuck");
  });
});

test("read cursors merge across tabs instead of clobbering", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "a" });
    return doc.id;
  });

  await harness.asUser(core, BOB, "device-bob", async (tabOne) => {
    await tabOne.markRead(convId);
  });
  await asAlice(async (alice) => {
    await alice.send(convId, { text: "b" });
  });
  await harness.asUser(core, BOB, "device-bob-2", async (tabTwo) => {
    assert.equal(await tabTwo.markRead(convId), 1, "only the new message was unread");
  });
});

test("markRead still writes nothing when the cursor has not moved", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "once" });
    return doc.id;
  });

  await asBob(async (bob) => {
    await bob.markRead(convId);
    const before = harness.state.calls.set;
    for (let i = 0; i < 5; i++) assert.equal(await bob.markRead(convId), 0);
    assert.equal(harness.state.calls.set, before, "an idle tick must not write");
  });
});

/* ------------------------------------------------------------------ */
/* reactions                                                           */
/* ------------------------------------------------------------------ */

test("reactions toggle and are visible to the other member", async () => {
  const [convId, messageId] = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const sent = await alice.send(doc.id, { text: "ship it" });
    return [doc.id, sent.id];
  });

  await asBob(async (bob) => {
    const after = await bob.react(convId, messageId, THUMBS);
    assert.deepEqual(after[THUMBS], [BOB.id]);
  });

  await asAlice(async (alice) => {
    const [message] = await alice.recent(convId);
    assert.deepEqual(message.reactions[THUMBS], [BOB.id], "the other side sees it");
    // Alice joins the same reaction rather than replacing it.
    const after = await alice.react(convId, messageId, THUMBS);
    assert.deepEqual([...after[THUMBS]].sort(), [ALICE.id, BOB.id].sort());
  });

  await asBob(async (bob) => {
    // Toggling removes only this user's own id.
    const after = await bob.react(convId, messageId, THUMBS);
    assert.deepEqual(after[THUMBS], [ALICE.id]);
  });

  await asAlice(async (alice) => {
    const after = await alice.react(convId, messageId, THUMBS);
    assert.equal(after[THUMBS], undefined, "an empty reaction is dropped, not left at zero");
    const [message] = await alice.recent(convId);
    assert.ok(
      message.reactions === undefined || message.reactions[THUMBS] === undefined,
      "nothing lingers on the stored message"
    );
  });
});

test("a reaction disturbs neither the message nor the order", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    for (const text of ["one", "two", "three"]) await alice.send(doc.id, { text });
    return doc.id;
  });

  await asBob(async (bob) => {
    const before = await bob.recent(convId);
    await bob.react(convId, before[1].id, EYES);
    const after = await bob.recent(convId);
    assert.deepEqual(
      after.map((m) => m.body.text),
      ["one", "two", "three"]
    );
    assert.deepEqual(
      after.map((m) => m.seq),
      before.map((m) => m.seq)
    );
    assert.equal(after[1].body.editedAt, undefined, "a reaction is not an edit");
  });
});

test("a deleted message cannot be reacted to", async () => {
  const [convId, messageId] = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const sent = await alice.send(doc.id, { text: "gone soon" });
    await alice.deleteMessage(doc.id, sent.id);
    return [doc.id, sent.id];
  });

  await asBob(async (bob) => {
    const result = await bob.react(convId, messageId, THUMBS);
    assert.deepEqual(result, {}, "a tombstone takes no reactions");
    const [message] = await bob.recent(convId);
    assert.equal(message.deleted, true);
  });
});

/* ------------------------------------------------------------------ */
/* search                                                              */
/* ------------------------------------------------------------------ */

test("search finds text and attachment names across conversations", async () => {
  await asAlice(async (alice) => {
    const dm = await alice.openDirect(BOB.id);
    const channel = await alice.createChannel("Release", [BOB.id]);
    await alice.send(dm.id, { text: "the deployment script is broken" });
    await alice.send(channel.id, { text: "unrelated chatter" });
    const manifest = await alice.uploadAttachment(
      channel.id,
      makeFile("deployment-notes.txt", "notes")
    );
    await alice.send(channel.id, { text: "see attached", attachments: [manifest] });
  });

  await asBob(async (bob) => {
    const { hits } = await bob.searchMessages("deployment");
    assert.equal(hits.length, 2, "one body match and one filename match");
    assert.deepEqual(
      hits.map((h) => h.convTitle).sort(),
      [ALICE.displayName, "Release"].sort()
    );
    for (const hit of hits) assert.ok(hit.message.id, "a hit carries the message itself");

    assert.equal((await bob.searchMessages("nothing-here-at-all")).hits.length, 0);
    assert.equal((await bob.searchMessages("d")).hits.length, 0, "one character is not a search");
  });
});

test("search is case-insensitive and skips deleted messages", async () => {
  const [convId, doomedId] = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const doomed = await alice.send(doc.id, { text: "SECRET plan" });
    await alice.send(doc.id, { text: "keep this Secret too" });
    return [doc.id, doomed.id];
  });

  await asAlice(async (alice) => {
    await alice.deleteMessage(convId, doomedId);
    const { hits } = await alice.searchMessages("secret");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].message.body.text, "keep this Secret too");
  });
});

test("search only looks inside conversations the user is in", async () => {
  // Carol is in a channel Bob is not. Bob's search must not reach it, even
  // though the documents are in the same collection and readable.
  await asAlice(async (alice) => {
    const private_ = await alice.createChannel("Alice and Carol", [CAROL.id]);
    await alice.send(private_.id, { text: "mango smoothie recipe" });
    const shared = await alice.openDirect(BOB.id);
    await alice.send(shared.id, { text: "mango season soon" });
  });

  await asBob(async (bob) => {
    const { hits } = await bob.searchMessages("mango");
    assert.equal(hits.length, 1);
    assert.equal(hits[0].message.body.text, "mango season soon");
  });
});

test("search returns newest first", async () => {
  await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "alpha one" });
    await alice.send(doc.id, { text: "alpha two" });
    await alice.send(doc.id, { text: "alpha three" });
  });

  await asBob(async (bob) => {
    const { hits } = await bob.searchMessages("alpha");
    assert.deepEqual(
      hits.map((h) => h.message.body.text),
      ["alpha three", "alpha two", "alpha one"]
    );
  });
});

/* ------------------------------------------------------------------ */
/* typing and presence                                                 */
/* ------------------------------------------------------------------ */

test("typing is published, seen by the other member, and expires", async () => {
  const convId = await asAlice(async (alice) => (await alice.openDirect(BOB.id)).id);

  await asAlice(async (alice) => {
    await alice.setTyping(convId, true);
  });

  await asBob(async (bob) => {
    await bob.people();
    const conv = await bob.getConversation(convId);
    assert.deepEqual(bob.typersIn(conv), [ALICE.displayName]);
    // Our own flag never shows as somebody typing at us.
    assert.deepEqual(bob.typersIn({ typing: { [BOB.id]: new Date().toISOString() } }), []);
    // A stale flag is ignored without anybody having to clear it, which is
    // what happens when a tab is closed mid-sentence.
    const stale = new Date(Date.now() - 60_000).toISOString();
    assert.deepEqual(bob.typersIn({ typing: { [ALICE.id]: stale } }), []);
    // Somebody whose name has not resolved yet is dropped, never rendered
    // as a raw identity id.
    assert.deepEqual(
      bob.typersIn({ typing: { "S-1-5-21-99-99-99-1234": new Date().toISOString() } }),
      []
    );
  });

  await asAlice(async (alice) => {
    await alice.setTyping(convId, false);
  });

  await asBob(async (bob) => {
    const conv = await bob.getConversation(convId);
    assert.deepEqual(bob.typersIn(conv), [], "clearing is never throttled");
  });
});

test("typing never reorders the conversation list", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "hi" });
    return doc.id;
  });

  const before = await asAlice(
    async (alice) => (await alice.getConversation(convId)).lastActivityAt
  );
  await asBob(async (bob) => {
    await bob.setTyping(convId, true);
  });
  const after = await asAlice(
    async (alice) => (await alice.getConversation(convId)).lastActivityAt
  );
  assert.equal(after, before, "a typing write must not look like activity");
});

test("repeated typing writes are throttled", async () => {
  const convId = await asAlice(async (alice) => (await alice.openDirect(BOB.id)).id);

  await asAlice(async (alice) => {
    await alice.setTyping(convId, true);
    const after = harness.state.calls.set;
    // Every keystroke calls this; only the first within the window writes.
    for (let i = 0; i < 10; i++) await alice.setTyping(convId, true);
    assert.equal(harness.state.calls.set, after, "a burst of keystrokes is one write");
  });
});

test("presence is published coarsely and read back", async () => {
  await asAlice(async (alice) => {
    await alice.openDirect(BOB.id);
  });

  await asBob(async (bob) => {
    // Presence arrives with the profiles, so they have to be loaded first.
    await bob.people();
    const presence = bob.presenceOf(ALICE.id);
    assert.ok(presence.lastSeenAt, "Alice published a lastSeenAt");
    assert.equal(presence.online, true);
    assert.equal(bob.presenceOf("nobody-at-all").online, false);
  });
});

/* ------------------------------------------------------------------ */
/* paging and editing                                                  */
/* ------------------------------------------------------------------ */

test("a window read reports the true total, so paging knows when to stop", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    for (let i = 0; i < 5; i++) await alice.send(doc.id, { text: `m${i}` });
    return doc.id;
  });

  await asBob(async (bob) => {
    // Asking for exactly as many messages as exist used to leave the UI
    // offering a "load earlier" button that could never load anything,
    // because "the page came back full" was the only signal available.
    const exact = await bob.recentWindow(convId, 5);
    assert.equal(exact.items.length, 5);
    assert.equal(exact.total, 5);

    const partial = await bob.recentWindow(convId, 2);
    assert.equal(partial.items.length, 2);
    assert.equal(partial.total, 5, "the total is the conversation's, not the page's");
    assert.deepEqual(
      partial.items.map((m) => m.body.text),
      ["m3", "m4"],
      "a partial window holds the NEWEST messages"
    );
  });
});

test("editing keeps attachments, marks the message, and refuses non-authors", async () => {
  const [convId, messageId] = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const manifest = await alice.uploadAttachment(doc.id, makeFile("diagram.png", "pixels"));
    const sent = await alice.send(doc.id, { text: "typo heer", attachments: [manifest] });
    return [doc.id, sent.id];
  });

  await asAlice(async (alice) => {
    const [original] = await alice.recent(convId);
    await alice.editMessage(convId, messageId, { ...original.body, text: "typo here" });
    const [edited] = await alice.recent(convId);
    assert.equal(edited.body.text, "typo here");
    assert.ok(edited.body.editedAt, "an edit is disclosed, never silent");
    assert.equal(
      edited.body.attachments?.[0]?.name,
      "diagram.png",
      "an edit must not drop the attachment"
    );
  });

  await asBob(async (bob) => {
    await assert.rejects(
      () => bob.editMessage(convId, messageId, { text: "I rewrote your message" }),
      /Only the author/
    );
  });
});

test("a deleted message keeps its position in the order", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    for (const text of ["first", "second", "third"]) await alice.send(doc.id, { text });
    return doc.id;
  });

  await asAlice(async (alice) => {
    const before = await alice.recent(convId);
    await alice.deleteMessage(convId, before[1].id);
    const after = await alice.recent(convId);
    assert.equal(after.length, 3);
    assert.equal(after[1].deleted, true, "the tombstone stays where the message was");
    assert.equal(after[0].body.text, "first");
    assert.equal(after[2].body.text, "third");
    // The tombstone used to be rebuilt without its seq, dropping it back to
    // the timestamp fallback for ordering.
    assert.equal(after[1].seq, before[1].seq);
  });
});

test("renaming a channel is visible to the other members", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.createChannel("Old name", [BOB.id]);
    await alice.renameConversation(doc.id, "New name");
    return doc.id;
  });

  await asBob(async (bob) => {
    const { views } = await bob.listConversations();
    assert.equal(views.find((v) => v.id === convId).title, "New name");
  });
});

/* ------------------------------------------------------------------ */
/* cost                                                                */
/* ------------------------------------------------------------------ */

test("deleting a conversation does not read the whole blob collection", async () => {
  const [doomed, kept] = await asAlice(async (alice) => {
    const a = await alice.createChannel("Doomed", [BOB.id]);
    const b = await alice.createChannel("Kept", [BOB.id]);
    const m1 = await alice.uploadAttachment(a.id, makeFile("a.bin", "x".repeat(200_000)));
    await alice.send(a.id, { text: "with file", attachments: [m1] });
    const m2 = await alice.uploadAttachment(b.id, makeFile("b.bin", "y".repeat(10_000)));
    await alice.send(b.id, { text: "keep me", attachments: [m2] });
    return [a.id, b.id];
  });

  await asAlice(async (alice) => {
    harness.state.byCollection = new Map();
    await alice.deleteConversation(doomed);

    const blobs =
      harness.state.byCollection.get(`${NAMESPACE}_blobs`) ??
      { get: 0, list: 0, set: 0, delete: 0 };
    // getDocuments on the blob collection downloads every chunk in the
    // whole project collection, base64 payload included - megabytes of
    // transfer to free kilobytes.
    assert.equal(blobs.list, 0, "the delete path must never list the blob collection");
    assert.ok(blobs.delete > 0, "but it must still delete this conversation's chunks");

    // The other conversation's attachment is untouched and still readable.
    const [message] = await alice.recent(kept);
    const blob = await alice.downloadAttachment(message.body.attachments[0]);
    assert.equal(blob.size, 10_000);
  });
});

test("a multi-chunk attachment round-trips despite concurrent chunk IO", async () => {
  // Chunks are written and read four at a time, so they complete out of
  // order. Reassembling in completion order would corrupt the file.
  const body = Array.from({ length: 300_000 }, (_, i) =>
    String.fromCharCode(33 + (i % 90))
  ).join("");

  await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const manifest = await alice.uploadAttachment(doc.id, makeFile("big.txt", body));
    assert.ok(manifest.chunks > 4, "the file must span more chunks than the pool is wide");
    await alice.send(doc.id, { text: "big one", attachments: [manifest] });
  });

  await asBob(async (bob) => {
    const convId = (await bob.openDirect(ALICE.id)).id;
    const [message] = await bob.recent(convId);
    const blob = await bob.downloadAttachment(message.body.attachments[0]);
    assert.equal(blob.size, body.length);
    assert.equal(await blob.text(), body, "byte-exact after a concurrent reassembly");
  });
});

test("the sweep removes orphan chunks and leaves live ones alone", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const live = await alice.uploadAttachment(doc.id, makeFile("live.txt", "keep"));
    await alice.send(doc.id, { text: "attached", attachments: [live] });
    // An upload whose message write never happened: what an interrupted
    // send leaves behind.
    await alice.uploadAttachment(doc.id, makeFile("orphan.txt", "drop"));
    return doc.id;
  });

  await asAlice(async (alice) => {
    const removed = await alice.sweepOrphanChunks();
    assert.ok(removed > 0, "the orphan is collected");
    const [message] = await alice.recent(convId);
    const blob = await alice.downloadAttachment(message.body.attachments[0]);
    assert.equal(await blob.text(), "keep", "the live attachment still opens");
  });
});
