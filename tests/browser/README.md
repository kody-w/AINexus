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
| `vbrainstem_python.cjs` | Pyodide really loads and the grail's agents really run — a memory written and read back through Python |
| `copilot_auth.cjs` | the device flow starts and returns a live code (it deliberately does NOT complete the sign-in) |
| `overlay.cjs` | portals draw no overlay, a faced person gets a reticle, a distant one stays a dot |
| `tiles.cjs` | wearing: the same key wears byte-identical tiles from a record, a word is a key, twelve keys give twelve distinct starting conditions |
| `slosh.cjs` | pouring in both directions — a world through lenses, an organism through worlds — and the order mattering in each |
| `spiral.cjs` | crossing and selecting: how much of a child neither parent had, and whether six routes crossed beat the best single one |
| `chat_tile.cjs` | a conversation worn into a tile, and its shape in time genuinely changing what is forged from it |
| `forge.cjs` | worlds adapted from real published ones, sha256-verified, refused on mismatch |
| `tick_loop.cjs` | a player ticking on its own clock, sealing a rapp/1 frame per tick |
| `holo_calibration.cjs` | whether matching frames actually lands the projection closer to the truth |
| `views_live.cjs` | the public DOGG edge holds between ticks, advances when the manifest grows, and leaves a scrubbed viewer in history |
| `dimension_seed.cjs` | the same seed walking the same walk |

`turn.cjs`, `orbs_and_gaze.cjs`, `dialogue_ring.cjs` and `overlay.cjs` need no credentials at all.
`vbrainstem_python.cjs` needs the network. `copilot_auth.cjs` reaches the live worker.
