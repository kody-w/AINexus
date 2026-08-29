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

For the AI to actually move (the `move` agent), a world page's `animate()`
loop should call `this.aiPlayer?.update();` once per frame — harmless if
`aiPlayer` was never created. The four world pages this script now ships in
(`index_heavy.html`, `index2.0.html`, `newindex.html`, `nexusAIBattles.html`)
already have that line.

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
