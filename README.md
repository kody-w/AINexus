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
`tools/primary_beat.py`), so a new frame lands roughly every ten minutes. The `Publish DOGG Live
Tick` workflow is disabled while the Mac mini is primary, because it force-pushes the feed and
would erase the Mac mini's ticks. It comes back as a staleness-gated fallback once that workflow
edit lands.

### The views dimension: `views:@kody-w/ainexus`

The feed is bytes. The record is a dimension on the [DOGG global tick network](https://github.com/kody-w/dogg).
When the spine has advanced since the last seal, the tick is sealed into [`views/`](views/):
one native dogg/0 frame per spine tick, anchored to that tick (`tick`, `tick_frame`) and carrying
the SHA-256 and size of every player's view, who each player could see, and which build of the
world they stood in. The spine is read before the capture, so no frame can claim a view from
before its own tick. A capture that lands while the spine is still on an already-sealed tick stays
in the feed, unsealed. Its seven-word chant is `PEARL EXTINGUISH ADVANCE RAPID FORGE HERON SMELT`.

**Status:** sealing every spine tick from the Mac mini since 2026-09-23 (frame 1 at spine tick
972). The Actions publisher is not yet a sealing fallback: that edit needs a token with the
`workflow` scope. If the Mac mini goes dark, the line sleeps and the next frame's `gap_min`
records for how long.

- **The viewer checks everything itself.** It re-derives every hash, checks the head against
  `views/HEAD.json` (walking back link by link only when you scrub to an older tick), checks every
  anchor against the spine, and paints a sealed tick only from bytes that hash to what its frame
  says. Bytes that don't match are never shown. The HUD reads
  `⛓ sealed · views #N · ⚓ spine tick T ✓ · 4/4 views ✓`, or names what failed. A line read from
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

## Tick/Tock: The DOGG Heist

[Play the autonomous tactical heist](https://kody-w.github.io/AINexus/dogg-heist.html).
Four agents execute a deterministic mission while every tick is preserved as a verifiable,
scrubbable DOGG history that can be forked, exported, and replayed offline.
