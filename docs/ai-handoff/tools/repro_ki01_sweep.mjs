// Reproduction of KI-01 (13_KNOWN_ISSUES_AND_TECHNICAL_DEBT.md): ChatClient.sweepOrphanChunks
// deletes attachments of conversations the caller is not a member of.
//
// Safe: runs entirely against the in-memory emulator in tests/harness. Nothing real is touched.
//
//     ./node_modules/.bin/tsc -p tsconfig.test.json && node -e "require('fs').writeFileSync('tests/build/package.json', JSON.stringify({type: 'commonjs'}))"
//     node docs/ai-handoff/tools/repro_ki01_sweep.mjs
//
// While KI-01 is unfixed this prints "RESULT: attachment DESTROYED". After a correct fix it
// must print "RESULT: attachment survived" - turn this script into a test in tests/features.test.mjs.

import { createRequire } from "node:module";

const require = createRequire(new URL("../../../tests/repro.mjs", import.meta.url));
const harness = require("./harness/index.cjs");
const core = harness.bootWorld();

const ALICE = { id: "user-alice", displayName: "Alice Example" };
const BOB = { id: "user-bob", displayName: "Bob Sample" };
const CAROL = { id: "user-carol", displayName: "Carol Absent" };

harness.resetWorld();
for (const u of [ALICE, BOB, CAROL]) harness.addTeamMember("team-1", u.id, u.displayName);
const file = (name, text) => new File([text], name, { type: "text/plain" });

// Alice and Bob share a conversation containing an attachment. Carol is NOT in it.
const convId = await harness.asUser(core, ALICE, "device-a", async (alice) => {
  const doc = await alice.openDirect(BOB.id);
  const manifest = await alice.uploadAttachment(doc.id, file("private-report.txt", "alice's real attachment"));
  await alice.send(doc.id, { text: "see attached", attachments: [manifest] });
  return doc.id;
});

// Carol runs the console maintenance helper (window.secureChatSweep calls this).
const removed = await harness.asUser(core, CAROL, "device-c", (carol) => carol.sweepOrphanChunks());
console.log("chunks removed by Carol's sweep:", removed);

await harness.asUser(core, BOB, "device-b", async (bob) => {
  const [message] = await bob.recent(convId);
  try {
    const blob = await bob.downloadAttachment(message.body.attachments[0]);
    console.log("RESULT: attachment survived, text =", await blob.text());
  } catch (err) {
    console.log("RESULT: attachment DESTROYED ->", err.message);
  }
});
