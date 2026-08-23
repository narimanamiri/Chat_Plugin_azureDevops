/**
 * End-to-end tests against the emulated Azure DevOps environment.
 *
 * These drive the real ChatClient with several simulated users sharing one
 * document store. Every bug that reached a user was of this shape - two
 * clients, one store - and none were catchable by unit tests on pure
 * functions.
 *
 * Since 0.7.0 there is no key material, so the tests that covered key drift,
 * re-issue, rotation and recovery are gone. What replaced them is one blunt
 * assertion in several forms: a member can always send, and the other side
 * can always read it.
 */

import { createRequire } from "node:module";
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

const require = createRequire(import.meta.url);
const harness = require("./harness/index.cjs");
const core = harness.bootWorld();
const { COLLECTIONS, NAMESPACE } = require("./build/model.js");

const ALICE = { id: "user-alice", displayName: "Alice Example" };
const BOB = { id: "user-bob", displayName: "Bob Sample" };
const CAROL = { id: "user-carol", displayName: "Carol Absent" };

const asAlice = (fn, device = "device-alice") => harness.asUser(core, ALICE, device, fn);
const asBob = (fn, device = "device-bob") => harness.asUser(core, BOB, device, fn);

beforeEach(() => {
  harness.resetWorld();
  harness.addTeamMember("team-1", ALICE.id, ALICE.displayName);
  harness.addTeamMember("team-1", BOB.id, BOB.displayName);
  harness.addTeamMember("team-1", CAROL.id, CAROL.displayName);
});

/** Let the background directory crawl settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

/* ------------------------------------------------------------------ */
/* messaging                                                           */
/* ------------------------------------------------------------------ */

test("two users exchange a message", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "hello from Alice" });
    return doc.id;
  });

  await asBob(async (bob) => {
    const messages = await bob.recent(convId);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].body.text, "hello from Alice");
    assert.equal(messages[0].failed, undefined);
    assert.equal(messages[0].senderName, ALICE.displayName);
  });
});

test("send resolves on delivery, independent of any refresh", async () => {
  // The composer clears its text when send() resolves. When send also awaited
  // a view refresh, a failing refresh made a delivered message look like a
  // failed one and the text stayed in the box.
  const convId = await asAlice(async (alice) => (await alice.openDirect(BOB.id)).id);

  await asAlice(async (alice) => {
    const sent = await alice.send(convId, { text: "delivered" });
    assert.equal(sent.body.text, "delivered");
    assert.ok(sent.id, "send must return the stored message");
  });

  await asBob(async (bob) => {
    const messages = await bob.recent(convId);
    assert.ok(messages.some((m) => m.body.text === "delivered"));
  });
});

test("a message survives a reader whose device changed", async () => {
  // The scenario that broke every previous release. With no keys there is
  // nothing to go stale, so this is now unremarkable - which is the point.
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "before the device change" });
    return doc.id;
  });

  await asBob(async (bob) => {
    const messages = await bob.recent(convId);
    assert.equal(messages[0].body.text, "before the device change");
    await bob.send(convId, { text: "reply from a brand new device" });
  }, "device-bob-brand-new");

  await asAlice(async (alice) => {
    const messages = await alice.recent(convId);
    assert.ok(messages.some((m) => m.body.text === "reply from a brand new device"));
    assert.equal(messages.some((m) => m.failed), false);
  }, "device-alice-also-new");
});

test("no sequence of device changes can prevent sending or reading", async () => {
  const convId = await asAlice(async (alice) => (await alice.openDirect(BOB.id)).id);

  for (let round = 1; round <= 5; round++) {
    await asAlice(async (alice) => {
      await alice.send(convId, { text: `alice ${round}` });
    }, `device-alice-r${round}`);
    await asBob(async (bob) => {
      await bob.send(convId, { text: `bob ${round}` });
    }, `device-bob-r${round}`);
  }

  await asBob(async (bob) => {
    const messages = await bob.recent(convId);
    assert.equal(messages.length, 10, "every message must be present");
    assert.equal(messages.some((m) => m.failed), false, "nothing may be unreadable");
    assert.equal(messages[0].body.text, "alice 1", "and in order");
    assert.equal(messages[9].body.text, "bob 5");
  }, "device-bob-final");
});

test("concurrent sends all survive", async () => {
  const convId = await asAlice(async (alice) => (await alice.openDirect(BOB.id)).id);
  await asAlice(async (alice) => {
    await Promise.all([
      alice.send(convId, { text: "one" }),
      alice.send(convId, { text: "two" }),
      alice.send(convId, { text: "three" }),
    ]);
    assert.equal((await alice.recent(convId)).length, 3);
  });
});

/* ------------------------------------------------------------------ */
/* naming                                                              */
/* ------------------------------------------------------------------ */

test("names resolve without waiting for the directory crawl", async () => {
  // Regression: the conversation list rendered raw identity ids - SIDs or
  // GUIDs on a real server - while the background crawl was still running.
  await asBob(async () => undefined); // Bob publishes a profile
  await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const { views } = await alice.listConversations();
    const view = views.find((v) => v.id === doc.id);
    assert.equal(view.title, BOB.displayName, `got "${view.title}"`);
    assert.notEqual(view.title, BOB.id);
  });
});

test("a participant who never opened the chat is still named", async () => {
  await asAlice(async (alice) => {
    await settle();
    await alice.people(true);
    const doc = await alice.openDirect(CAROL.id);
    const { views } = await alice.listConversations();
    const view = views.find((v) => v.id === doc.id);
    assert.equal(view.title, CAROL.displayName);
  });
});

test("sender names are resolved at render time, never frozen", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "who sent this?" });
    return doc.id;
  });
  await asBob(async (bob) => {
    const messages = await bob.recent(convId);
    assert.equal(messages[0].senderName, ALICE.displayName);
    assert.notEqual(messages[0].senderName, ALICE.id);
  });
});

/* ------------------------------------------------------------------ */
/* conversations                                                       */
/* ------------------------------------------------------------------ */

test("delete then recreate a direct message works", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "first life" });
    return doc.id;
  });
  await asBob(async (bob) => {
    assert.equal((await bob.recent(convId))[0].body.text, "first life");
  });

  await asAlice(async (alice) => {
    await alice.deleteConversation(convId);
    const doc = await alice.openDirect(BOB.id);
    assert.equal(doc.id, convId, "DM ids are deterministic, so the id is reused");
    await alice.send(doc.id, { text: "second life" });
  });

  await asBob(async (bob) => {
    const messages = await bob.recent(convId);
    assert.equal(messages.length, 1, "the deleted message must be gone");
    assert.equal(messages[0].body.text, "second life");
  });
});

test("two people opening the same DM at once converge on one conversation", async () => {
  // Deterministic ids make this a genuine write collision, not a theoretical one.
  await asAlice(async (alice) => {
    await alice.openDirect(BOB.id);
  });
  await asBob(async (bob) => {
    await bob.openDirect(ALICE.id);
    const { views } = await bob.listConversations();
    assert.equal(views.length, 1, "there must be exactly one conversation");
  });
});

test("deleting a conversation removes its pages and attachment chunks", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const file = new File([new Uint8Array(200)], "big.bin", { type: "application/octet-stream" });
    const manifest = await alice.uploadAttachment(doc.id, file);
    await alice.send(doc.id, { text: "with attachment", attachments: [manifest] });
    return doc.id;
  });

  const collection = harness.state.documents.get("default");
  assert.ok(collection.get(COLLECTIONS.pages).size > 0);
  assert.ok(collection.get(COLLECTIONS.blobs).size > 0);

  await asAlice(async (alice) => {
    const report = await alice.deleteConversation(convId);
    assert.ok(report.pagesRemoved >= 1);
  });

  assert.equal(collection.get(COLLECTIONS.conversations).size, 0);
  assert.equal(collection.get(COLLECTIONS.pages).size, 0);
  assert.equal(collection.get(COLLECTIONS.blobs).size, 0);
});

/* ------------------------------------------------------------------ */
/* attachments                                                         */
/* ------------------------------------------------------------------ */

test("an attachment round-trips between two users", async () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const file = new File([payload], "trace.log", { type: "text/plain" });
    const manifest = await alice.uploadAttachment(doc.id, file);
    await alice.send(doc.id, { text: "log attached", attachments: [manifest] });
    return doc.id;
  });

  await asBob(async (bob) => {
    const manifest = (await bob.recent(convId))[0].body.attachments[0];
    assert.equal(manifest.name, "trace.log");
    const blob = await bob.downloadAttachment(manifest);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.deepEqual(Array.from(bytes), Array.from(payload));
  });
});

test("a corrupted attachment chunk is detected, not silently returned", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    const file = new File([new Uint8Array([1, 2, 3])], "x.bin");
    const manifest = await alice.uploadAttachment(doc.id, file);
    await alice.send(doc.id, { text: "file", attachments: [manifest] });
    return doc.id;
  });

  const blobs = harness.state.documents.get("default").get(COLLECTIONS.blobs);
  const [key, doc] = [...blobs.entries()][0];
  blobs.set(key, { ...doc, data: Buffer.from([9, 9, 9]).toString("base64") });

  await asBob(async (bob) => {
    const manifest = (await bob.recent(convId))[0].body.attachments[0];
    await assert.rejects(
      () => bob.downloadAttachment(manifest),
      /integrity check/,
      "a tampered or truncated chunk must not be handed back as the file"
    );
  });
});

/* ------------------------------------------------------------------ */
/* startup and storage                                                 */
/* ------------------------------------------------------------------ */

test("startup is fast even with a slow server and a populated collection", async () => {
  for (let i = 0; i < 6; i++) {
    const user = { id: `user-slow-${i}`, displayName: `Slow User ${i}` };
    harness.addTeamMember("team-1", user.id, user.displayName);
    await harness.asUser(core, user, `device-slow-${i}`, async () => undefined);
  }
  await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    for (let i = 0; i < 5; i++) await alice.send(doc.id, { text: `m${i}` });
  });

  harness.state.latencyMs = 40;
  const started = Date.now();
  await asAlice(async () => undefined);
  const elapsed = Date.now() - started;
  harness.state.latencyMs = 0;
  assert.ok(elapsed < 500, `startup must not wait on background work; took ${elapsed}ms`);
});

test("many users do not break startup", async () => {
  for (let i = 0; i < 8; i++) {
    const user = { id: `user-crowd-${i}`, displayName: `Crowd ${i}` };
    harness.addTeamMember("team-1", user.id, user.displayName);
    await harness.asUser(core, user, `device-crowd-${i}`, async () => undefined);
  }
  await asAlice(async (alice) => {
    const people = await alice.people(true);
    assert.ok(people.length >= 8, `expected the crowd in the directory, saw ${people.length}`);
  });
});

test("a permanent write failure is not retried as if it were a conflict", async () => {
  const convId = await asAlice(async (alice) => (await alice.openDirect(BOB.id)).id);
  await asAlice(async (alice) => {
    harness.state.failWritesWithStatus = 400;
    const before = harness.state.calls.set;
    const started = Date.now();
    await assert.rejects(() => alice.send(convId, { text: "never lands" }));
    const attempts = harness.state.calls.set - before;
    const elapsed = Date.now() - started;
    harness.state.failWritesWithStatus = 0;
    assert.equal(attempts, 1, `a permanent 400 must be attempted once, saw ${attempts}`);
    assert.ok(elapsed < 1000, `must fail fast, took ${elapsed}ms`);
  });
});

test("storage lives under a versioned namespace", async () => {
  assert.equal(NAMESPACE, "v3");
  for (const name of Object.values(COLLECTIONS)) {
    assert.ok(name.startsWith(`${NAMESPACE}_`), `${name} must be namespaced`);
  }
  await asAlice(async (alice) => {
    await alice.openDirect(BOB.id);
  });
  for (const collection of harness.state.documents.get("default").keys()) {
    assert.ok(collection.startsWith("v3_"), `unexpected collection ${collection}`);
  }
});

test("a re-read stays cheap", async () => {
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    for (let i = 0; i < 10; i++) await alice.send(doc.id, { text: `message ${i}` });
    return doc.id;
  });
  await asBob(async (bob) => {
    await bob.recent(convId);
    const before = { ...harness.state.calls };
    await bob.recent(convId);
    const reads = harness.state.calls.get - before.get;
    assert.ok(reads <= 3, `a re-read should be a couple of reads, saw ${reads}`);
    assert.equal(harness.state.calls.set - before.set, 0, "re-reading must not write");
  });
});

/* ------------------------------------------------------------------ */
/* identity ids must never masquerade as names                         */
/* ------------------------------------------------------------------ */

test("an identity id is recognised as such", () => {
  const { looksLikeIdentityId } = require("./build/devops.js");
  // Windows SID (Azure DevOps Server) and GUID (Services).
  assert.equal(looksLikeIdentityId("S-1-5-21-1004336348-1177238915-682003330-512"), true);
  assert.equal(looksLikeIdentityId("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), true);
  assert.equal(looksLikeIdentityId("3f2504e04f8911d39a0c0305e82c3301"), true);
  assert.equal(looksLikeIdentityId(""), true);
  assert.equal(looksLikeIdentityId(undefined), true);
  // Real names must not be mistaken for ids.
  assert.equal(looksLikeIdentityId("Alice Example"), false);
  assert.equal(looksLikeIdentityId("Nariman"), false);
  assert.equal(looksLikeIdentityId("O'Brien-Smith"), false);
});

test("a nameless SDK context never persists an id as a display name", async () => {
  // The reported failure: one page load where the SDK hands back a user
  // context with no display name wrote the SID into the shared profile, and
  // every client then read it back as that person's name - permanently.
  const SID = { id: "S-1-5-21-99-88-77-1001", displayName: "Dave Server" };
  harness.addTeamMember("team-1", SID.id, SID.displayName);

  harness.state.sdkUserHasNoName = true;
  const convId = await harness.asUser(core, SID, "device-sid", async (dave) => {
    const doc = await dave.openDirect(BOB.id);
    await dave.send(doc.id, { text: "who am I?" });
    return doc.id;
  });
  harness.state.sdkUserHasNoName = false;

  const profiles = harness.state.documents.get("default").get(COLLECTIONS.profiles);
  const stored = profiles?.get(SID.id);
  if (stored) {
    assert.notEqual(stored.displayName, SID.id, "a SID must never be stored as a name");
  }

  await asBob(async (bob) => {
    const { views } = await bob.listConversations();
    assert.equal(views[0].title, SID.displayName, `got "${views[0].title}"`);
    const messages = await bob.recent(convId);
    assert.equal(messages[0].senderName, SID.displayName);
  });
});

test("a profile poisoned by an older build is ignored in favour of the directory", async () => {
  await asBob(async () => undefined);
  const convId = await asAlice(async (alice) => {
    const doc = await alice.openDirect(BOB.id);
    await alice.send(doc.id, { text: "hello" });
    return doc.id;
  });

  // Simulate the damage 0.7.0 could previously do to the shared store.
  const profiles = harness.state.documents.get("default").get(COLLECTIONS.profiles);
  profiles.set(ALICE.id, {
    id: ALICE.id,
    userId: ALICE.id,
    displayName: ALICE.id,
    updatedAt: new Date().toISOString(),
    __etag: 1,
  });

  await asBob(async (bob) => {
    await settle();
    await bob.people(true);
    const messages = await bob.recent(convId);
    assert.equal(
      messages[0].senderName,
      ALICE.displayName,
      `a poisoned profile must not win over the directory, got "${messages[0].senderName}"`
    );
  });
});
