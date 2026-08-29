# browser tests

These drive the real pages in a real browser. They exist because every serious defect in this
repo was found by exercising the live thing, and none of them by reading it.

    NODE_PATH=<somewhere with playwright> node tests/browser/<name>.cjs

Each test serves this repo **at `https://kody-w.github.io/AINexus/`** through Playwright's own
request interception — no listening socket, and, more importantly, the production origin. That
is not cosmetic: the Copilot auth worker's CORS admits only `kody-w.github.io`, so a page tested
from any other host cannot reach it and the auth path silently appears broken.

**A zero from one of these is more often the CDN than the code.** Every test that touches Python
downloads Pyodide (~10MB) into a fresh browser context, so running the whole suite back to back
occasionally times one out. Re-run the individual test before believing a failure — and if it
fails twice, then it is real.

| test | what it holds down |
|---|---|
| `turn.cjs` | the agentic loop, with a scripted mind and no token: a line spoken alongside a tool call is kept, a verb that fails is reported as failed, an invented verb is refused before it is dispatched |
| `orbs_and_gaze.cjs` | a person is only addressable when faced, a username made of markup does not execute, the ring closes itself when they leave, a brow raise selects |
| `dialogue_ring.cjs` | options generated from what is true, rebuilt when they answer, and the floor holding when no mind is available |
| `vbrainstem_python.cjs` | Pyodide really loads and every agent the module declares is resident; every verb offered to a model names a method the hands actually have; a memory written comes back out of Python word for word |
| `copilot_auth.cjs` | the device flow either starts or says out loud that it could not — never neither — and the sign-in is deliberately NOT completed; a live rate limit is weather, so the code returning is never asserted |
| `token_path.cjs` | the other half of the auth surface, with the door replaced by a stub so every answer a real one gives can be held still: the visitor's credential leaves in an Authorization header to the ONE address fixed in the file and appears in no URL, body, log, error or attribute; the host the worker is told to forward to is checked rather than believed, so a stranger written into the shared `rapp_settings` key by any other tool on this origin never becomes the address a seat is posted to; a 200 carrying a refusal instead of a code is a refusal; twelve polls in a tight loop knock once and a `slow_down` widens the wait; and a credential revoked mid-session surfaces once, clears itself, and is never re-presented to the live door |
| `overlay.cjs` | portals draw no overlay, a faced person gets a reticle, a distant one stays a dot |
| `tiles.cjs` | wearing: the same key wears byte-identical tiles from a record, a word is a key, twelve keys give twelve distinct starting conditions |
| `slosh.cjs` | pouring in both directions — a world through lenses, an organism through worlds — and the order mattering in each |
| `spiral.cjs` | crossing and selecting: how much of a child neither parent had, and whether six routes crossed beat the best single one |
| `chat_tile.cjs` | a conversation worn into a tile, and its shape in time genuinely changing what is forged from it |
| `forge.cjs` | worlds adapted from real published ones, sha256-verified, refused on mismatch |
| `proof_red.cjs` | proof.html catches lies about itself: a lie inside a frame goes red, a lie beside the frame changes nothing because the page must not read it, an unsupported repeatability claim goes red |
| `tick_seal_on_error.cjs` | a tick that throws still seals exactly one frame carrying what went wrong — the moments worth recording most are the ones that failed |
| `holo_wire.cjs` | a hologram crosses a real WebRTC data channel between two isolated browser contexts, not just two tabs sharing a bus; junk from a peer is dropped and a markup name arrives inert |
| `tick_loop.cjs` | a player ticking on its own clock, sealing a rapp/1 frame per tick |
| `holo_calibration.cjs` | whether matching frames actually lands the projection closer to the truth |
| `views_live.cjs` | the public DOGG edge holds between ticks, advances when the manifest grows, and leaves a scrubbed viewer in history |
| `dimension_seed.cjs` | the same seed walking the same walk |
| `herd.cjs` | one runtime shared by many players under deliberately overlapping turns: nobody speaks through another's body, one player's memory is invisible to the next, and the spend ceiling refuses |
| `ensemble.cjs` | one model call directing everyone, then free movement that costs nothing — a directive for someone who is not there dropped, an intent nobody has becoming stillness, one keyframe putting every object in the same epoch |
| `world_frame.cjs` | each player carrying its own hot-loaded agents on the shared runtime, and the world frame choosing who wakes — nobody in a still world, the one who was spoken to when there is a reason — on its own verifiable chain |
| `hotload.cjs` | the world itself as an agent the brainstem can call, and a brand-new python agent taught from source into a running player and usable on its next thought, with no reload |
| `time_travel.cjs` | a recorded session replayed twice with no model in the loop, frame for frame and epoch for epoch; a live player woken inside an ancient frame; going back forking a new dimension rather than editing the old line |
| `room.cjs` | the room under a member who lies and a member who goes quiet: a position made of strings never reaching a THREE matrix, a rename replacing one label rather than hanging a second, a relayed chat bounded in length and rate, a duplicate channel closing without evicting the member whose id it carries, five seconds of silence not deleting somebody permanently, and a refused invite saying so instead of blaming a host who never left |
| `peer_errors.cjs` | every peerjs error type produces a message a person can act on — peerjs leaves `message` empty on its commonest real failure, and the fall-through used to print "Connection error:" and nothing else |
| `stay_signed_in.cjs` | a saved sign-in survives an unreachable service and a proxy 403, and is only discarded when GitHub itself answers about the credential — the reported "can't stay signed in" |
| `scripted_mind.cjs` | an NPC drives the whole machinery from a written script — real verbs, real refusals, real rapp/1 frames, no model bought — and the same script runs the same way twice |
| `ceiling.cjs` | the three ceilings, driven past on a scripted mind so it costs nothing: the SPEND ceiling bites at exactly its limit and refuses with a code a caller can branch on rather than a sentence to regex, four thousand free NPC turns leave the visitor's seat untouched, an operator raising a ceiling that has already bitten actually raises it, and a halt binds even a mind that costs nothing; the ROUND cap holds a mind that never stops calling to MAX_ROUNDS and says so; and the LOOP ends for a reason it can name — its maxTicks, an exhausted budget, hands that went away, a mind that died, or a world that threw twenty times running — sealing one frame per tick throughout, with stop() reaching inside the thought it interrupted so nothing more is bought after the button |
| `summoning.cjs` | the two halves of `summon()`, driven for the first time by a mind that can ask for a tool nobody has — and be the mind that writes it, so the whole path runs without buying a thought: every name a mind can send comes back an honest sentence and none of them moves the hands (a name JavaScript answers to on its own — `world_toString`, `constructor` — used to be performed and to skip summoning entirely; a name that is not a string used to come back as this module's stack trace); the denylist in front of a written agent refuses every class it claims to, including a module it never named, and the refusal REACHES the mind and the frame instead of a log call nobody reads; what a written agent hands back is untrusted — enormous, malformed, markup, or claiming its own call failed — and none of it ends the tick or forges a ✗ into a sealed frame; and the proven half is found only where a line really shows it working, counted once per frame, marked `universe` rather than `generated`, and NOT resurrected from storage after a reload |
| `npc_program.cjs` | an NPC runs a program's `mind` step with nobody signed in and no brainstem reachable — branching on what it sees, which a fixed choreography cannot do, and the receipt names the door the thought came through |
| `agent_contract.cjs` | the eight python agents against the arguments a MODEL sends: every parameter perform() reads is declared and every one declared is read, nothing sent crashes one, the lenses are byte-identical twice and emit no floats, and a player's memory cannot be reached through a crafted key |
| `frames_conformance.cjs` | `ai/frames.js` against the standard rather than against itself: 18 JCS vectors — non-BMP member names, the 2^53-1 boundary, escaping, empty containers, null against absent — hashing byte-identically here and in kody-w/rapp-1's `rapp.py`, the §5 tags really in the pre-image, and a battery of chains that must be REFUSED (a genesis that is not seq 0, a segment spliced in from another stream, a twelfth key hashed in, a calendar that does not exist) |
| `everyday_input.cjs` | the other direction from `frames_conformance.cjs`: the refusals the audit added must never fire on an ordinary evening, so this drives the REAL seal path with the text people type — emoji, CJK, right-to-left, combining marks, a pasted astral character, a name like `小明` or `🦖rex` — plus real coordinates, sixty people in the room, and a session run past its 500-frame window; it holds down that a tick whose error message was cut through the middle of an emoji still seals its frame (it did not: §4 refused the lone surrogate, and the tick that went wrong was once again the tick with no record), that a tile can be worn from a record the tick loop actually sealed rather than only from a hand-built one, and that going back starts another line that is ONE stream; and on the other side of the seam, that the NO-MIND path is untouched — same refusal, same resolution, one call charged, `mind:undefined` and `mind:null` not a third path — that a scripted mind is free and a paid one cannot answer its way out of being charged, and that lines(), summon(), a replayed transcript, a shared script object, a script that throws and a `do` that is not a list cannot confuse an NPC out of its scene |
| `slow_frames.cjs` | the camera modules on a machine that is not fast: the same second of looking read at 4, 6, 10, 15, 30 and 60 frames a second landing in ONE place — the origin used to lock after a fixed count of frames, so a slow runner pinned the pointer dead centre and then learned whatever pose it found as straight ahead — one raise still one press at every rate, a missed detection not costing a held look its origin, a NaN landmark not smoothed into the pointer forever, and the pulse refusing an exposure ramp and a slow sway that both used to be reported, confidently, as 42 bpm |
| `absent_and_infinite.cjs` | the four small modules — cameras, hands, the ring, the AI body — against a subject that is not there and a number that is not a number: a POV camera looking where its resident looks rather than 180° the other way, a presence made of NaN in nobody’s shot instead of inside every camera at once, a blind camera saying so and eventually leaving instead of handing back a picture of the room somebody left, a hand of NaN landmarks reading as no hand, the ring naming the portal that is actually nearest rather than the one that never measured itself, and one Infinity from a mind refused instead of writing NaN into the world camera for the life of the page |
| `autodrive_hands.cjs` | the hands (`ai/autodrive.js`) under the numbers a MODEL chooses and the one button that has to work: `walk(600000)` bounded rather than ten minutes of a held key, a walk already in stride ended by a stop with the key coming back up, a direction the hands do not have refused instead of dispatched as a keystroke, a stop that also puts the camera down — its own frame loop, and the reason the world's legs were stubbed out — and hands the pointer back, a mind that answers after a stop neither speaking nor acting, a program no longer ending silently at its first thought with the mind's own move on the receipt as its own turn, `travel` refusing to claim a door the crosshair is not on, `ask` reporting false when the page never took the message, and a looping program of synchronous steps leaving the page still answering |
| `fail_closed.cjs` | the three doors that were made to fail closed last night, driven through every way a network actually fails rather than the one that is easy to simulate — a 500, a 404, a reset mid-request, a 200 of truncated bytes, a 200 of HTML, a 200 of valid JSON that is not the registry at all, and an answer that arrives long after anybody was waiting for it. The question is never whether it refuses; it is whether the ability COMES BACK. The published fingerprint list refuses a hot-load under all seven, names itself in the refusal, and is re-read on the very next attempt; two hot-loads overlapping the one fetch both get its answer instead of the second reading the pessimism the first raised on its way in; a list that parsed is never read again. An agent refused at boot now has where it came from written down, so the residency pass every turn already makes brings all eight back and the world agent answers again — one 503 on `state/agent_templates.json` used to cost `NexusWorld` until reload, and a two-second outage cost all eight. `initPyodide` finishes booting when NOTHING loaded from the grail, which used to be a DEADLOCK: its own hot-loads asked it for the runtime and were handed its still-pending boot promise, so the page said “loading agents…” for the life of the tab. Autodrive's one `<script>` dependency on `ai/frames.js` is retried on demand, so a program can run again once the file returns rather than never; a chain or a program that could not be READ says which file and what happened to it, instead of `Unexpected token '<'` or an accusation that the seal was broken. And a Copilot endpoint that is not a `*.githubcopilot.com` host is discarded OUT LOUD |

`turn.cjs`, `orbs_and_gaze.cjs`, `dialogue_ring.cjs`, `overlay.cjs`, `frames_conformance.cjs`,
`ceiling.cjs`, `everyday_input.cjs`, `slow_frames.cjs` and `absent_and_infinite.cjs` need no credentials at all — and `slow_frames.cjs`
needs no camera or network either, because it drives the two modules as the pure functions they are.
The eleven that load Pyodide — `vbrainstem_python.cjs`, `slosh.cjs`, `spiral.cjs`, `chat_tile.cjs`,
`forge.cjs`, `herd.cjs`, `ensemble.cjs`, `world_frame.cjs`, `hotload.cjs`, `time_travel.cjs` and
`agent_contract.cjs` — need the network. `fail_closed.cjs` loads Pyodide too but deliberately blocks
`raw.githubusercontent.com` throughout: nobody's test should depend on somebody else's server, and a
page that cannot reach the grail is an ordinary Tuesday for a visitor behind a proxy — it was also
the condition that exposed the deadlock. It is slow on purpose (an 11s stall and an 8s give-up are
two of the failures under test) and it FAILS on a hang rather than waiting for one. `copilot_auth.cjs` reaches the live worker; `token_path.cjs`
deliberately does not — it replaces the door inside the page, so it needs no credential and no
network, and neither of them ever completes a sign-in.
`absent_and_infinite.cjs` boots the real AI player with Pyodide stubbed at the CDN, so it drives
the drop-in through its own boot path without pulling the 10MB runtime.
`ceiling.cjs` buys nothing and proves it: every mind in it is scripted, it aborts any request to a
model endpoint, and it fails if one was even attempted. It opens frontier.html a second time in a
same-origin frame on purpose — to hold down that the spend ceiling is one counter per frame.

`holo_wire.cjs` and `room.cjs` need the network for one particular thing: the public PeerJS
signalling server, because they hold a REAL peer room rather than a simulated one. Both say so
out loud and exit 1 if that server cannot be reached, rather than passing on an empty room.

## The other half: the live origin

These suites serve the repo from disk through request interception, which is what makes them
fast and repeatable — and it means none of them can see a page that is broken only once it is
deployed. `node tools/smoke_live.cjs` loads all 64 published pages from kody-w.github.io with
nothing intercepted and requires a 200, no page error, and no subresource that 404s. It found
eight pages whose portals had nothing to offer because they were fetching a world tree from a
repo that does not exist — every visitor, every load, and no page error to show for it.
