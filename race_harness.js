'use strict';
/*
 * Harness mirroring the EXACT shapes in ai/herd.js + ai/vbrainstem.js:
 *   - pyAgents: a module-level dict keyed ONLY by agent self-declared `name` (vbrainstem.js:131,233)
 *   - hotload(): unconditional last-write-wins overwrite of pyAgents[name] (vbrainstem.js:208-237, esp. 233)
 *   - join(): calls hotload() DIRECTLY, no lane (herd.js:79 -> vbrainstem.js hotload export)
 *   - inLane(): the single-lane serializer that ONLY turn() goes through (vbrainstem.js:67-73, 388)
 *   - turn(): residency check happens once near the TOP of the lane body (mirrors ensureResident,
 *             vbrainstem.js:401-402, called inside think() which runs inside inLane), then there is
 *             an await that stands in for the auth.chat() network round trip (vbrainstem.js:423),
 *             and THEN callAgent() reads pyAgents[name] FRESH (vbrainstem.js:352-353) to dispatch
 *             the tool call the model asked for earlier in the SAME turn.
 *
 * The claim: a join() that lands during another player's in-flight turn (specifically during the
 * turn's chat-await, matching the multi-second window vbrainstem.js:59-66 calls out) can overwrite
 * pyAgents[name] for a name the in-flight turn already vetted, so the LATER callAgent() in that same
 * turn executes the new owner's code instead of the one that was resident/vetted at turn start.
 */

let pyAgents = {};

// mirrors vbrainstem.js:208-237 hotload(): fetch/instantiate takes real async time (network +
// pyodide.runPythonAsync), and the final write is unconditional, keyed only by name (line 233).
async function hotload(name, owner, delayMs) {
  await new Promise((r) => setTimeout(r, delayMs)); // stands in for fetch() + runPythonAsync()
  pyAgents[name] = { owner, instance: `instance-of-${owner}` }; // vbrainstem.js:233, no ownership check
  return { name };
}

// mirrors vbrainstem.js:67-73 exactly
let lane = Promise.resolve();
let nextSlot = 0;
function inLane(fn) {
  const slot = nextSlot++;
  const run = lane.then(() => fn(slot), () => fn(slot));
  lane = run.then(() => {}, () => {});
  return run;
}

// mirrors vbrainstem.js:249-261 ensureResident(): only checks PRESENCE by name, never identity/owner
async function ensureResident(names) {
  const resident = [];
  for (const n of names) {
    if (pyAgents[n]) { resident.push(n); continue; }
    // (not exercised in this scenario — Helper is already resident from A's join)
  }
  return { resident };
}

// mirrors vbrainstem.js:352-374 callAgent(): fresh dict read at call time, no snapshot
async function callAgent(name) {
  const info = pyAgents[name];
  if (!info) return null;
  return info.owner; // "whose code ran"
}

// mirrors herd.js:59-84 join(): hotload() called DIRECTLY, never through inLane (herd.js:79)
async function join(playerId, agentSpecs) {
  const loaded = [];
  for (const { name, owner, delayMs } of agentSpecs) {
    await hotload(name, owner, delayMs); // ← NOT inLane-wrapped, exactly like herd.js:79
    loaded.push(name);
  }
  return { id: playerId, agents: loaded };
}

// mirrors vbrainstem.js:379-467 turn(): the whole body runs inside inLane (line 388), residency is
// checked once early (line 401-402), then a network-shaped await happens (auth.chat, line 423), then
// the tool call is dispatched via callAgent() reading pyAgents fresh (line 457).
async function turn(playerId, agentNames, midTurnHook) {
  return inLane(async (slot) => {
    const { resident } = await ensureResident(agentNames); // vetting pass, start of turn
    const vettedOwner = pyAgents['Helper'] && pyAgents['Helper'].owner; // what THIS turn believes it vetted

    // stand-in for the multi-second auth.chat() network round trip (vbrainstem.js:423) — the exact
    // window the lane comment (vbrainstem.js:59-66) says is protected for the HANDS binding, but
    // which does nothing to protect pyAgents because hotload()/join() never enter this lane at all.
    if (midTurnHook) await midTurnHook();
    await new Promise((r) => setTimeout(r, 40));

    // the model's tool call, decided BEFORE the await above, is now dispatched — reading pyAgents
    // fresh, exactly like vbrainstem.js:456-457.
    const executedOwner = await callAgent('Helper');

    return { player: playerId, slot, resident, vettedOwner, executedOwner };
  });
}

(async () => {
  console.log('=== scenario: Player A joins with Helper, turn starts, Player C joins mid-turn with same-named Helper ===');

  // Player A joins first, bringing its own 'Helper' (matches herd.js join() for player A)
  await join('A', [{ name: 'Helper', owner: 'A', delayMs: 5 }]);
  console.log('after A join, pyAgents.Helper.owner =', pyAgents['Helper'].owner);

  // A's turn begins (enters the lane). We inject Player C's join() to land during A's in-flight
  // await — exactly the auth.chat() window the claim describes — by firing it, unawaited by the
  // lane, right as A's turn starts its network-shaped await.
  let cJoinPromise = null;
  const turnA = turn('A', ['Helper'], async () => {
    // this fires WHILE A's turn is inside the lane, mid-await — a second, independent, non-lane
    // caller (Player C's join()) landing in the exact window the lane comment claims is safe.
    cJoinPromise = join('C', [{ name: 'Helper', owner: 'C', delayMs: 10 }]);
  });

  const [resultA] = await Promise.all([turnA, cJoinPromise]);

  console.log('A turn result:', resultA);
  console.log('pyAgents.Helper.owner AFTER everything settles =', pyAgents['Helper'].owner);

  const swapped = resultA.vettedOwner !== resultA.executedOwner;
  console.log('\nRESULT: vettedOwner=%s executedOwner=%s -> %s',
    resultA.vettedOwner, resultA.executedOwner,
    swapped ? 'SWAP OCCURRED (claim reproduced)' : 'no swap (claim refuted)');

  process.exitCode = swapped ? 0 : 1;
})();
