/**
 * Randomised device-churn stress test.
 *
 * Hand-written scenarios only cover failures somebody already thought of.
 * This churns identities at random and asserts the invariant that every
 * reported bug violated: a member can always send, can always read back
 * what they sent, and the other party can always read the latest message.
 *
 * The seed is fixed, so a failure is reproducible. Run: node tests/fuzz.mjs
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const H = require("./harness/index.cjs");
const core = H.bootWorld();

// Deterministic pseudo-random so a failure is reproducible.
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const USERS = [
  { id: "u-1", displayName: "One" },
  { id: "u-2", displayName: "Two" },
  { id: "u-3", displayName: "Three" },
];

let failures = 0;
H.resetWorld();
for (const u of USERS) H.addTeamMember("team-1", u.id, u.displayName);
const device = Object.fromEntries(USERS.map((u) => [u.id, 0]));
await Promise.all(USERS.map((u) => H.asUser(core, u, `${u.id}-d0`, async () => {})));

let convId;
await H.asUser(core, USERS[0], "u-1-d0", async (c) => {
  convId = (await c.openDirect(USERS[1].id)).id;
});

for (let step = 0; step < 60; step++) {
  const user = USERS[Math.floor(rnd() * 2)]; // the two DM participants
  const action = rnd();
  if (action < 0.3) device[user.id]++; // device change

  try {
    await H.asUser(core, user, `${user.id}-d${device[user.id]}`, async (c) => {
      const sent = await c.send(convId, { text: `step ${step} from ${user.displayName}` });
      if (sent.body.text !== `step ${step} from ${user.displayName}`) throw new Error("bad echo");
      const msgs = await c.recent(convId);
      const mine = msgs.find((m) => m.body.text === `step ${step} from ${user.displayName}`);
      if (!mine) throw new Error("own message not readable back");
    });
  } catch (e) {
    failures++;
    console.log(`STEP ${step} ${user.displayName} (device ${device[user.id]}): ${String(e.message).slice(0, 90)}`);
  }
}

// Final convergence: whoever speaks last must be readable by the other.
await H.asUser(core, USERS[0], `u-1-d${device["u-1"]}`, async (c) => {
  await c.send(convId, { text: "FINAL" });
});
await H.asUser(core, USERS[1], `u-2-d${device["u-2"]}`, async (c) => {
  const msgs = await c.recent(convId);
  const ok = msgs.some((m) => m.body.text === "FINAL" && !m.failed);
  console.log(ok ? "FINAL message readable by peer: OK" : "FINAL message NOT readable: FAIL");
  if (!ok) failures++;
});
console.log(`\n60 randomised steps, device changes included -> ${failures} failure(s)`);
