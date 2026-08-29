# ai/ai_player.js — drop-in AI player

`AIPlayerManager` + the `window.nexusAI` bridge, extracted out of `index.html`
so the AI's mind survives portal travel between world pages instead of dying
every time the tab navigates.

## Contract

Include the script once, **before** a world page's own init `<script>` block:

```html
<script src="ai/ai_player.js"></script>
```

It is inert until both of these are true:
- the page was invited with `&ai=brainstem` in the URL fragment (it parses
  this itself, independently, before anything else on the page gets a chance
  to strip the hash — no other wiring required), and
- `window.worldNavigator` exists and has a live `.multiplayer` (a
  `MultiplayerManager` instance) — it polls for this every 150ms for ~30s.

When both are true it does `window.worldNavigator.aiPlayer = new
AIPlayerManager(window.worldNavigator)` on its own. No call site needed.

Movement is the drop-in's own job: on attach it starts a
`requestAnimationFrame` loop that steps the body every frame, whatever the
page's loop does. A page author adds nothing for the `move` agent to work.

The ten pages it ships in: `index.html`, `index2.0.html`, `index_heavy.html`,
`newindex.html`, `nexusAIBattles.html`, `ancient-library-world.html`,
`crystal-caverns.html`, `floating-gardens.html`, `galaxy-zoo-world.html`,
`neon-arcade-world.html`.

No page needs to call `update()` itself. The script steps the body from its own
`requestAnimationFrame` loop once it attaches, and `update()` measures elapsed
time rather than counting calls, so an extra call from a page's `animate()` costs
about zero seconds. (The four original pages did carry
`this.aiPlayer?.update();`, and while `update()` still stepped a fixed amount per
*call* those four walked at twice the speed of the other six — the same mind
moving at two speeds depending which world it had travelled into. Both halves of
that are gone: the call was removed from all four, and the step is time-based.)

## Travelling through a portal

When the AI's `travel` agent is dispatched with a portal name, it looks the
name up in `world.portals` (the same list `fastTravel`/portal-click
navigation uses) for the portal's real URL, then navigates there carrying:

- `&ai=brainstem` — so the new page re-boots the mind, and
- `&join=<host>.<token>` — the *same* room invite this tab was launched
  with (captured at parse time, before any page's `MultiplayerManager` can
  strip the hash), so the AI rejoins the same host's room as a guest from
  the new page instead of starting a fresh, empty one.

The host's tab is the room and it never moves; only the AI's tab travels.
If the AI has no invite (it was booted standalone, not as someone's guest),
it still carries `&ai=brainstem` forward so its own mind survives the trip
solo.
