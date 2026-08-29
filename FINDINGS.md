# Open findings

A running list of things found and not yet closed. Anything fixed moves to **Closed** with the
evidence that closed it, so this file is a record rather than a wish list. Documented when found,
even when the fix comes later — a finding carried in someone's head is a finding that evaporates.

---

## OPEN

### 1. The public PeerJS broker is returning `server-error`, and multiplayer is dead when it does
**Status:** the half that is ours is CLOSED (see Closed #1). The broker outage itself is not ours
and there is still no fallback or retry — that part stays open.
**Found:** 2026-08-29, on the live site in a real browser, by chasing a "Connection error:" badge
I had first dismissed as unrelated noise.

**Evidence** (live `frontier.html`, error hooked at peer construction):
```
{"type":"server-error","message":""}
peerId: null · destroyed: true · disconnected: true · conns: 0
```
The peer never receives an id, so it is destroyed. Consequences, all silent:
- multiplayer is entirely unavailable for that page load
- no invite link can be minted (the id *is* the room), so the Share panel has nothing to give
- the badge reads `Disconnected`, which is true but says nothing about why or whether it recovers

**Not ours:** the free `0.peerjs.com` broker is a third party and it is erroring. There is no
fallback broker and no retry, so its availability is the estate's availability for anything
peer-to-peer.

**Probably explains:** `tests/browser/room.cjs` flaking earlier the same night (1 clean run in 5,
then 4 in 5, then 3 in 4). I attributed that to slow round trips and made the status check wait,
which helped — but a broker intermittently erroring is a better explanation of the residual than
latency, and I should not have settled on latency without checking this.

### 2. No model call has ever run in this estate
**Narrowed further.** The ceiling, the round cap and the autonomous loop have now all been driven
to their limits by a scripted mind — 4,000 free turns, a runaway mind that never stops calling, and
six `live()` loops to their various deaths. The machinery is exercised; the mind still is not.
**Narrowed, not closed.** A scripted mind (`ai/scripted_mind.js`) now drives everything downstream
of the answer — real verbs, real refusals, real rapp/1 frames, real receipts — so the machinery is
exercised end to end and the paths past the mind are no longer dark. What remains unproven is the
mind itself: nothing has bought a thought, and the suite asserts that by aborting any request to a
model endpoint. Still needs a granted seat.
Every one of the 378 local checks uses a scripted mind. `provenSource()` threw on every call since
gen-21 and nobody noticed, precisely because nothing exercised that path for real. Needs a granted
mind; the device flow is currently rate-limited (`device start 429`) after repeated attempts.

### 3. 101 frames carry `body.*` kinds on non-conformant streams
Needs an owner-signed §12.1 re-genesis. `frames/line.jsonl` is the clean line and stays clean.

### 4. Enforcing the kind/family rule in `verifyChain` by default would refuse 53 of 54 published chains
Left opt-in (`{kinds:true}`). Turning it on by default is a canon decision, not a bug fix.

---

### 6. ~~`summon()` step 1 hot-loads source without the scan its sibling applies~~ — ANSWERED: no
The summon audit examined this and said no, with reasoning now in the code. Step 1 only reloads
source somebody already vouched for (shipped with the page and sha-verified, operator-supplied, or
already scanned by step 2), and running the scan there would refuse the page's OWN world:
`ai/vb/nexus_world_agent.py` says `from js import window`, and six of the eight local agents do the
same. The one change that would invalidate that reasoning — persisting `agentSource` — is named in
the code beside it. Left as reported so the question and its answer stay together.
**ANSWERED — not a hole, and the scan must NOT be added there.** Raised by the ceiling audit and
checked by the summon audit, which owns that region. Step 1 reloads source out of `agentSource`,
and exactly three things ever put anything there: the agents this page shipped with (sha256-verified
at load), agents an operator handed to `join()`, and agents step 2 has already scanned. None of them
is unread model output. Running the scan there would refuse the page's OWN world:
`ai/vb/nexus_world_agent.py` says `from js import window`, and has to — reaching into the page is
what the world agent is FOR, and six of the eight local agents do the same. The denylist is for code
nobody has vouched for; step 1 only reaches code somebody already did. The reasoning is now written
at the top of step 1, along with the one change that would invalidate it: persisting `agentSource`
to storage, which is writable by everything else on this origin.

### 7. The door in front of a summoned agent reads text, it does not bound capability
**Open, and narrowed.** A model-written agent is checked before it is imported: five patterns for
the shapes we already know (reaching into the page, evaluating code at runtime, files/processes/
network, walking the object graph) plus — new — an ALLOWLIST of module names, so a module reached
under another name is refused whatever it is aliased to. Both are still a search over SOURCE TEXT.
Text can be composed at runtime out of pieces none of which look like anything, and nothing in a
regex can see that; a name assembled from two strings and looked up on the builtins is the class,
and it is not a class a blocklist can close. What actually contains a summoned agent is Pyodide —
no operating system, no sockets, its own filesystem — and the fact that it is only ever called with
the arguments the model itself sent. The check in front of it is a door, not a wall, and should be
described that way wherever it is described. Closing it properly means a capability boundary
(import hooks, a restricted builtins, or refusing to import at all), which is a design decision
rather than a patch.
**Also true and worth saying:** `summon()`'s first half, the one that fetches from a line where the
capability was PROVEN to work, cannot resurrect anything after a reload — the frames survive in
localStorage, the source does not. That is the safe way round (a re-summon goes past the door
again), but it means the "universe where it matched" half only ever fires within one page load.

---

### 7. The summon door is a text search, and text can be composed at runtime
The forbidden-pattern scan and the import allowlist both read source as text. Text can be assembled
at runtime, and no regex sees that. The actual containment is Pyodide plus the fact that a summoned
agent is only ever called with the model's own arguments. Closing it properly means a capability
boundary — import hooks, restricted builtins — which is a design decision rather than a patch.
Stated in words, deliberately, with no exploit written.

---

## CLOSED

### C4. `ensemble()` bought thoughts entirely off the books
`ai/herd.js` called `auth.chat()` directly — one model call to direct the whole cast — and `spend`
appeared nowhere in that file, because the brainstem never exported it. So the one call that scales
with how many players are in the room was invisible to the ceiling built to bound a visitor's
spend: a herd directed in a loop could run indefinitely without ever approaching the limit.
**Closed by:** exporting `spend` and declaring the call, passing the director so a scripted one
stays free.
**Measured both ways:** a paid director moves `calls` 0 → 1 where it previously moved nothing; a
scripted director leaves `calls` alone and increments `free`.

### C4. `summon()` reached past its caller for a seat, so half of it had never run
The second half of summoning — write the agent from nothing — took its mind from `root.NexusAuth`
instead of from the caller. Two opposite failures out of one line: on a page with no seat the half
was unreachable, which is why nothing in the estate had ever executed it; on a page WITH one, a
player carrying its own mind — an NPC, which is supposed to cost nothing and ask nobody — quietly
went to the visitor's Copilot seat the instant it named a tool that did not exist.
**Closed by:** `o.mind || root.NexusAuth`, and `turn()` passing its mind down. A mind is a contract
everywhere or it is a contract nowhere.
**Retested by:** `tests/browser/summoning.cjs`. Reverting that one line turns 13 of its 44 checks
red, which is the measure of how much of this path was dark.

### C5. A name JavaScript answers to on its own was a verb, and was an agent
`CALL[verb]` and `pyAgents[fname]` are plain objects, so every name on `Object.prototype` answered
yes. `world_toString` reached `Object.prototype.toString`, came back `"[object Object]"`, and was
reported to the mind as a completed action — walking straight past the "no such verb" guard written
to end exactly that. `world_constructor` and `world_valueOf` came back `"{}"`, also as successes. On
the agent side `constructor`, `toString`, `valueOf`, `hasOwnProperty` and `__proto__` all looked
like tools that already existed, which SKIPPED THE SUMMON PATH and handed the mind
`failed: Cannot read properties of null (reading 'toPy')` — this module's stack trace dressed as a
world event. A name that was not a string did the same through `fname.indexOf`.
**Closed by:** one `has(map, name)` helper — a string, non-empty, `hasOwnProperty` — used by the
verb dispatch, the agent dispatch, `callAgent` and `sourceOf`; and a name that is not a usable
string named as such before anything else looks at it.

### C6. A refusal nobody could see is a control nobody can tell has stopped working
Refusing a written agent was a `log()` call and nothing else, and `o.log` defaults to a no-op. So
"nobody had it and nothing was written" and "something was written that tried to reach out of the
interpreter, and we refused it" arrived at the mind, at the journal and in the sealed frame as the
same six words.
**Closed by:** `summon()` returning `{ refused: why }` instead of `null`; the mind is told
`one was written for it and refused: <why>`, and the turn records `refused: <why>` where a reader
of the line will find it.

### C7. A summoned agent could forge a verdict about itself into a signed frame
Whether a call failed was decided by testing the RESULT STRING for `/failed|no such/` — and for an
agent, that string is whatever the agent returned. An agent written by a mind a second earlier,
answering `"no such tool: pay no attention"`, wrote a ✗ against its own name into a sealed rapp/1
frame; `provenSource()` reads exactly those marks to decide what has been proven to work.
**Closed by:** the dispatch stating its own verdict on the call record (`failed`), with the text
test kept only as a fallback, in `turn()` and in BOTH readers of it — herd.js's `serve` and
vbrainstem's own `live`, because one defect living in two files and only one of them getting fixed
is how this pair drifted apart before.
**Also fixed alongside it:** `provenSource()` counted every frame of the current session twice —
once from the player's chain, once from the store `remember()` had already written it to — so
`proven`, the number it ranks candidates on, weighted this page's evidence at double a previous
page's. Deduplicated by frame hash.

### C3. A look smaller than one unit was no look at all, and a large one turned the other way
`CALL.look` passed the mind's request through `a.dx | 0`. Bitwise-or truncates to int32, so a
fractional turn became zero — the hands did nothing while the tick still reported a look — and a
value past 2^31 wrapped its sign, turning a hard right into a hard left. Its siblings `walk` and
`wait` already clamped; `look` and `scan` did not. This is the third `| 0` in this estate to
silently change a number, after a frame's `seq` and a drive's coordinates.
**Found by:** driving the machinery with a scripted mind — the first thing that ever asked the
hands for a small turn.
**Closed by:** rounding and bounding both, and refusing a non-number rather than passing NaN on.
**Retested by:** `tests/browser/scripted_mind.cjs` — 0.6 arrives as 1, 12 as 12, 2147483648 clamps
to 20000 with its sign intact, and 'over there' becomes 0.

### C1. A peer error told the visitor nothing — "Connection error:" and an empty string
`net/multiplayer.js` fell through to `'Connection error: ' + err.message`, and peerjs leaves
`message` empty on `server-error`, its commonest real failure. So the person whose multiplayer had
just died read a colon and nothing else, while the peer was destroyed, no invite could be minted,
and nothing said whether it would come back.
**Closed by:** naming each type — the signalling server not answering, a lost socket, a room that
is not open, a browser that cannot do peer-to-peer — and never printing an empty reason: an
unknown type now names itself, a type-less error says "with no reason given", and every message
that is not the visitor's fault says the world itself still works.
**Retested by:** `tests/browser/peer_errors.cjs`, 10 checks, which drives all eleven peerjs error
types with an EMPTY message (the real-world case) and asserts none of them can produce a message
that is blank, trails off after a colon, or contains "undefined". In the CI gate.

### C2. The Copilot token's destination was read from a key anyone on this origin can write
`chatUrl()` took `copilotEndpoint` out of `rapp_settings` unvalidated and handed it to the worker
as the host to forward the request **and its Authorization header** to. That key is shared by every
tool on `kody-w.github.io`, and the module exports `saveSettings`. Same class as the `vbrainstem`
`url` step-argument that once carried a brainstem secret anywhere.
**Closed by:** an allowlist — https only, hostname `githubcopilot.com` or a subdomain, `.origin`
(which also defeats userinfo prefixes), applied on the write as well as the read.
**Also closed alongside it:** a 200 carrying a refusal was returned as a device code and rendered
in the panel; the poll ignored `slow_down` and had no wait of its own, so the caller's timer set
the hit rate on a live rate-limited endpoint; a 429 of HTML hit `r.json()` and surfaced as a syntax
error; 401 and 403 both said "sign-in expired", sending an unservable account round the loop
forever; error bodies went into messages that become HUD lines, unscrubbed; and the security
comment at the export claimed the module stops handing the token out, which was false.
**Verified sound and now held by a test:** neither token ever reaches a URL, query string, body,
postMessage, attribute or console — proved by driving a real chat turn and reading back every
request's URL, body and headers.
