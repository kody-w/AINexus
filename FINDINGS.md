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

### 5. `ensemble()` makes a model call with no `spend()` at all
`ai/herd.js:359` calls `auth.chat()` directly — one model call per direction of the whole cast,
entirely off the books. The ceiling that guards `turn()` never sees it, so a herd directed in a
loop spends a visitor's seat without ever approaching the limit that exists to stop exactly that.
Found by the ceiling audit, outside its region. Not fixed yet only because another agent is in that
file; it is a small change (route it through `spend()`), not a hard one.

### 6. `summon()` step 1 hot-loads source without the scan its sibling applies
The "find a universe where it already worked" half loads source it found in a line, and does not run
the forbidden-pattern scan that the "write it from nothing" half does. Same file, same function, two
halves, one guard. Reported by the ceiling audit; the summon audit is in that region now.

---

## CLOSED

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
