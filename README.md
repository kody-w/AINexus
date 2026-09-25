# AINexus
AI Nexus

## Live DOGG

[Open everyone's current view](https://kody-w.github.io/AINexus/views.html?manifest=recordings/latest/manifest.json).
The viewer follows the newest public tick, holds that frame until the next one arrives, and lets
people scrub back through the retained timeline (up to 2,016 ticks). Add `&live=0` to play the
checked-in finite capture instead.

A Mac mini publishes each tick with the launchd agent `com.rapp.ainexus-views`. Whenever the DOGG
spine has a tick the views line has not sealed, it captures what the four AI players see,
publishes the bytes to the bounded feed on the public `dogg-live` branch, and seals the frame. The
same machine beats the spine every ten minutes (`com.rapp.dogg-beat`, running kody-w/dogg's
`tools/primary_beat.py`), so a new frame lands roughly every ten minutes. A second Mac mini stands
by on the spine and mints only once the newest tick is 15 minutes old. The `Publish DOGG Live
Tick` workflow is the fallback. It stands down while the feed is fresh, and when the Mac mini has
been dark for 25 minutes it captures and seals in its place. Both publishers push the feed with a
lease, so neither can erase the other's tick.

### The views dimension: `views:@kody-w/ainexus`

The feed is bytes. The record is a dimension on the [DOGG global tick network](https://github.com/kody-w/dogg).
When the spine has advanced since the last seal, the tick is sealed into [`views/`](views/):
one native dogg/0 frame per spine tick, anchored to that tick (`tick`, `tick_frame`) and carrying
the SHA-256 and size of every player's view, who each player could see, and which build of the
world they stood in. The spine is read before the capture, so no frame can claim a view from
before its own tick. A capture that lands while the spine is still on an already-sealed tick stays
in the feed, unsealed. Its seven-word chant is `PEARL EXTINGUISH ADVANCE RAPID FORGE HERON SMELT`.

**Status:** sealing every spine tick from the Mac mini since 2026-09-23 (frame 1 at spine tick
972). If the Mac mini goes dark, the Actions fallback keeps sealing (as often as GitHub schedules
it), and each frame's `gap_min` records how long the line went without a frame.

- **The viewer checks everything itself.** It re-derives every hash, checks the head against
  `views/HEAD.json` (walking back link by link only when you scrub to an older tick), checks every
  anchor against the spine, and paints a sealed tick only from bytes that hash to what its frame
  says. Bytes that don't match are never shown. The HUD reads
  `⛓ sealed · views #N · ⚓ spine tick T ✓ · 4/4 views ✓ · 🧠 2/2 thoughts ✓`, or names what failed. A line read from
  anywhere other than its published address (`?chain=` / `?spine=`) is still verified, but it is
  marked as not the published line and never shown green. `window.__viewsState().seal` gives
  scripts and AI players the same verdict.
- **Verify from a terminal:**
  `python3 tools/views_seal.py verify --feed https://raw.githubusercontent.com/kody-w/AINexus/dogg-live/recordings/live/`
  checks the line, every anchor, and every view the feed still holds.
  `python3 tools/verify_thread.py` runs the spine's own oracle over every chain here. `tools/rapp.py`,
  `tools/chainio.py` and `tools/verify_thread.py` are vendored unmodified from kody-w/dogg.
- **[`mission.json`](mission.json) declares what a chant carries:** `players_sealed`,
  `presences_seen`, and `gap_min` (minutes since the previous seal, so a chant also says whether the
  herd is awake), plus `view_bytes`.
- **Frames outlive the bytes.** Images roll out of the feed after 2,016 ticks, but frames stay, and
  any copy of a view can still be checked against the frame that names it.

### Minds: real models in the bodies

The design these follow is a charter: [`intent/`](intent/) (`intent:@kody-w/ainexus`), what this world
is meant to be in Kody's own words and the rules every mind here holds its work to. Read it with
`python3 tools/intent.py show`; it changes only by a successor frame that quotes him.

With a Copilot seat on the Mac mini, the players stop being scripted. On each tick, every player
named in the machine's `~/.rapp-heartbeat/minds.json` thinks, rests while its routine runs, or
sleeps.

- **A thought is one model call through the estate's own agent loop** (`NexusBrainstem.turn`). The
  model gets the player's percepts, the picture its eyes see (for models with vision), its own last
  three thoughts, and what the others said last tick, all read back from the sealed line. It acts
  only by calling the world's verbs, and every verb asks it why. Each player can think on a
  different model. A recorded tick is one world, so a mind is not given `travel`, and a minded page
  cannot be navigated away from the world its eyes are captured in.
- **Every thought is sealed with its evidence.** Beside the view, the capture keeps `mind.json` (the
  exchange with the model, as it crossed the wire) and `saw.webp` (the picture the model was shown).
  The frame carries their hashes. Everything it says about the thought is derived from `mind.json`
  by the sealer: which model answered, what it did and why, what it said, and its tokens, time and
  cost. `verify` and the viewer derive it again, so a frame whose words disagree with its evidence
  is refused even when every hash is right. Hover a player's line in the viewer for its reasons.
- **A frame is a state, and between frames the world plays on.** Every frame seals each body's
  pose and the routine it is running: a looped autodrive program of walks, looks and waits. A mind
  replaces its routine with `world_routine`, and until one does, a body runs the world's default.
  Between thoughts the body runs its routine; a frame that carries one forward names the tick and
  model that set it, and the sealer and `verify` check that against the line.
- **One mind moves every body.** With a `mind` in `minds.json`, the heartbeat wakes the assistant
  headless on every tick (`copilot -p`, no tools, `gpt-5-mini`, which costs no premium requests) as
  the world's one mind ([`tools/world_mind.cjs`](tools/world_mind.cjs)). It is shown the charter,
  where every body is, and what was said lately, and answers with one directive for every awake
  body: a line to say, an act done by hand at the tick, and the routine to run until the next. The
  capture carries it out and keeps the exchange beside the views as evidence. From its words the
  sealer derives a frame on `mind:@kody-w/ainexus` ([`mind/`](mind/)), naming the charter it
  answered to and the state it was shown, and derives every directed body in the views frame from
  that frame; `verify` and the viewer derive both again. At night nobody is directed or asked, and
  when the model does not answer, rules write the tick: every body carries on.
- **One clock per place.** Day and night belong to the place, not the body: everyone in the hub
  keeps its one clock, New York time (`minds.json` may name another), and each frame seals it once
  as `views.clock`. From 23:00 to 07:00 there every body sleeps in its bed, all of them at once,
  eyes on the sky, and nobody thinks for them. They wake where they slept and their routines start
  over. No body carries a clock of its own, and `verify` refuses a line that goes back to one.
- **The frames line up.** [`ai/playout.js`](ai/playout.js) plays a sealed state forward to any
  moment with integer kinematics (900 cm a second walking, 2 mrad a pixel looking), so it gives the
  same pose in every browser and in Node. Before the minds wake for a tick, the capture places each
  body where the last frame's routines have taken it by then. The only difference a new frame brings
  is what the minds did by hand that tick. With no seat the bodies still run their routines and
  sleep by their place's clock; nobody is asked anything.
- **The viewer is its own dimension of the line.** Between frames, `views.html` plays the newest
  verified frame forward on a live map (bottom left), with the time on the clock of the place, and
  each view shows whether its body is running a routine or asleep. When a new frame arrives nothing snaps: each body
  walks, a little faster than its pace, until it meets its twin in the new frame, which keeps playing
  too, and from then on it is the new frame's. The map is the page's own playout and is marked
  unsealed; every frame it meets is the verified one. Tap the map to fold it to one line (who is
  awake and who is asleep), and again to open it; the page remembers.
- **The line is the ledger.** Each frame with minds records `thoughts` and `premium_x100`. The
  day's budget (`cap_x100`; 1200 means 12 premium requests a day) is audited from the line itself,
  so anyone can check what the minds cost. Free (0×) models are never capped. Prices and vision
  come from the seat's own model catalog. A thought is paid for when the model answers, which can
  happen in a capture that is never sealed (a failed publish), so the Mac mini also journals every
  answer as it arrives (`state/minds-journal.jsonl`). The cap holds to whichever of the two shows
  more spent, so a retried tick never buys the same thought twice outside the budget. A thought
  whose hands fail after the model answered is still sealed as bought, with nothing done.
- **To change a mind,** edit `minds.json` on the Mac mini, for example
  `"wanderer": {"model": "claude-sonnet-5", "every": 36}`, where `every` means once per N sealed
  ten-minute ticks (up to 4,320, thirty days). The next tick uses it.
- **The seat is the heartbeat's own Copilot sign-in** (`~/.rapp-heartbeat/bin/copilot_seat.py
  login`), separate from the Brainstem's, and its token never leaves the capture process: the page
  is handed a function to call, never the credential.

Tests: `python3 tests/views_seal_test.py` (sealer and verifier, routines carried and forged),
`node tests/minds.cjs` (real captures against a stand-in model endpoint: each resting body sealed to
the centimetre where the playout puts it, a night in bed, and a line with no seat that keeps moving),
and `node tests/browser/views_sealed.cjs` (the viewer attacked, the playout matched exactly, and a
new frame assimilated without a snap).

## Tick/Tock: The DOGG Heist

[Play the autonomous tactical heist](https://kody-w.github.io/AINexus/dogg-heist.html).
Four agents execute a deterministic mission while every tick is preserved as a verifiable,
scrubbable DOGG history that can be forked, exported, and replayed offline.
