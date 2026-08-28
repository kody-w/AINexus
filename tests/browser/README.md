# browser tests

These drive the real pages in a real browser. They exist because every serious defect in this
repo was found by exercising the live thing, and none of them by reading it.

    NODE_PATH=<somewhere with playwright> node tests/browser/<name>.cjs

Each test serves this repo **at `https://kody-w.github.io/AINexus/`** through Playwright's own
request interception — no listening socket, and, more importantly, the production origin. That
is not cosmetic: the Copilot auth worker's CORS admits only `kody-w.github.io`, so a page tested
from any other host cannot reach it and the auth path silently appears broken.

| test | what it holds down |
|---|---|
| `turn.cjs` | the agentic loop, with a scripted mind and no token: a line spoken alongside a tool call is kept, a verb that fails is reported as failed, an invented verb is refused before it is dispatched |
| `orbs_and_gaze.cjs` | a person is only addressable when faced, a username made of markup does not execute, the ring closes itself when they leave, a brow raise selects |
| `dialogue_ring.cjs` | options generated from what is true, rebuilt when they answer, and the floor holding when no mind is available |
| `vbrainstem_python.cjs` | Pyodide really loads and the grail's agents really run — a memory written and read back through Python |
| `copilot_auth.cjs` | the device flow starts and returns a live code (it deliberately does NOT complete the sign-in) |
| `overlay.cjs` | portals draw no overlay, a faced person gets a reticle, a distant one stays a dot |

`turn.cjs`, `orbs_and_gaze.cjs`, `dialogue_ring.cjs` and `overlay.cjs` need no credentials at all.
`vbrainstem_python.cjs` needs the network. `copilot_auth.cjs` reaches the live worker.
