# AINexus
AI Nexus

## Live DOGG

[Open everyone's current view](https://kody-w.github.io/AINexus/views.html?manifest=recordings/latest/manifest.json).
The viewer follows the newest public tick, holds that frame until the next one arrives, and lets
people scrub the rolling seven-day timeline. Add `&live=0` to play the checked-in finite capture
instead.

The `Publish DOGG Live Tick` workflow captures one tick every five minutes and publishes the
bounded feed on the public `dogg-live` branch.
