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
| `agent_contract.cjs` | the eight python agents against the arguments a MODEL sends: every parameter perform() reads is declared and every one declared is read, nothing sent crashes one, the lenses are byte-identical twice and emit no floats, and a player's memory cannot be reached through a crafted key |
| `frames_conformance.cjs` | `ai/frames.js` against the standard rather than against itself: 18 JCS vectors — non-BMP member names, the 2^53-1 boundary, escaping, empty containers, null against absent — hashing byte-identically here and in kody-w/rapp-1's `rapp.py`, the §5 tags really in the pre-image, and a battery of chains that must be REFUSED (a genesis that is not seq 0, a segment spliced in from another stream, a twelfth key hashed in, a calendar that does not exist) |
| `slow_frames.cjs` | the camera modules on a machine that is not fast: the same second of looking read at 4, 6, 10, 15, 30 and 60 frames a second landing in ONE place — the origin used to lock after a fixed count of frames, so a slow runner pinned the pointer dead centre and then learned whatever pose it found as straight ahead — one raise still one press at every rate, a missed detection not costing a held look its origin, a NaN landmark not smoothed into the pointer forever, and the pulse refusing an exposure ramp and a slow sway that both used to be reported, confidently, as 42 bpm |

`turn.cjs`, `orbs_and_gaze.cjs`, `dialogue_ring.cjs`, `overlay.cjs`, `frames_conformance.cjs` and
`slow_frames.cjs` need no credentials at all — and `slow_frames.cjs` needs no camera or network
either, because it drives the two modules as the pure functions they are.
The eleven that load Pyodide — `vbrainstem_python.cjs`, `slosh.cjs`, `spiral.cjs`, `chat_tile.cjs`,
`forge.cjs`, `herd.cjs`, `ensemble.cjs`, `world_frame.cjs`, `hotload.cjs`, `time_travel.cjs` and
`agent_contract.cjs` — need the network. `copilot_auth.cjs` reaches the live worker.

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
