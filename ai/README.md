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

## The one-line change `index.html` still needs

`index.html` owns its own copy of `AIPlayerManager` inline (this file is a
byte-for-byte extraction of it, plus the traversal fix below) and explicitly
constructs it in `WorldNavigator.init()`:

```js
// An AI inhabits this tab when invited with &ai=brainstem
if (window.NEXUS_AI_MODE === 'brainstem') {
    this.aiPlayer = new AIPlayerManager(this);
}
```

To pick up the traversal fix without duplicating the class, replace that
inline `class AIPlayerManager { ... }` definition (and the block above) with
a single include, placed before `index.html`'s own big inline `<script>`
(next to the other library `<script src>` tags — three.js / peerjs):

```html
<script src="ai/ai_player.js"></script>
```

...then delete the inline `class AIPlayerManager { ... }` block and the
`if (window.NEXUS_AI_MODE === 'brainstem') { this.aiPlayer = new
AIPlayerManager(this); }` call in `init()` — `ai/ai_player.js` boots itself
once `window.worldNavigator` exists, so no call site is needed there either.
`index.html`'s `animate()` already calls `this.aiPlayer.update()`
unconditionally; change that one line to `this.aiPlayer?.update();` since
`aiPlayer` is no longer guaranteed to exist yet at the time `animate()`
first runs (the script now attaches it asynchronously, on the next poll
tick, rather than synchronously inside `init()`).

## What changed vs. the version still inline in `index.html`

The `travel` agent no longer refuses every portal. When the AI's travel
agent is dispatched with a portal name, it looks the name up in
`world.portals` (the same list `fastTravel`/portal-click navigation uses)
for the portal's real URL, then navigates there carrying:

- `&ai=brainstem` — so the new page re-boots the mind, and
- `&join=<host>.<token>` — the *same* room invite this tab was launched
  with (captured at parse time, before any page's `MultiplayerManager` can
  strip the hash), so the AI rejoins the same host's room as a guest from
  the new page instead of starting a fresh, empty one.

The host's tab is the room and it never moves; only the AI's tab travels.
If the AI has no invite (it was booted standalone, not as someone's guest),
it still carries `&ai=brainstem` forward so its own mind survives the trip
solo.
