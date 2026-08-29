# net/multiplayer.js — MultiplayerManager drop-in

Extracted, byte-faithful copy of the `MultiplayerManager` class that lives
inline in `index.html` (the portal plaza). Any destination world page can
include it to rejoin the PeerJS room a player (human or the AI in
`ai/ai_player.js`) carried through a portal as `#join=<roomId>.<secret>`
(plus `&ai=brainstem` for an AI guest).

## Include

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.2/peerjs.min.js"></script>
<script src="net/multiplayer.js"></script>
<!-- optional, before net/multiplayer.js, only if this page isn't in kody-w/AINexus: -->
<!-- <script>window.NEXUS_REPO_OWNER = 'you'; window.NEXUS_REPO_NAME = 'your-repo';</script> -->
<script>
  window.worldNavigator = myWorldInstance; // see contract below
  window.nexusJoin(window.worldNavigator);
</script>
```

Include it after `THREE` and `Peer` are on `window`, and after your world
instance exists (it reads `window.location.hash` and touches `.camera` /
`.scene` the moment it's constructed).

## Contract a world page must satisfy

`window.nexusJoin(worldInstance)` constructs a `MultiplayerManager` against
`worldInstance` and assigns `worldInstance.multiplayer = <the manager>` —
the exact field `ai/ai_player.js` polls for before it attaches itself as
`window.worldNavigator.aiPlayer`. So:

- Assign your world object to `window.worldNavigator` yourself (this file
  never does that for you — only the field it hangs off).
- That object **must** have:
  - `.camera` — a THREE.js camera-like object with `.position` (`x`, `y`,
    `z`) and `.rotation.y`, read/written every tick to broadcast and to
    place remote avatars relative to.
  - `.scene` — a THREE.js `Object3D`-like container with `.add()` /
    `.remove()`, where remote player avatars get added and removed.
- Everything else is optional and guarded — a plain world page that has
  only `camera` + `scene` and none of the hub's own helpers still works:
  - `worldInstance.getCurrentWorldData()` — if present, its return value is
    sent as `metadata.worldData` when connecting to a host; if absent, that
    field is simply `undefined`.
  - `worldInstance.worlds` / `worldInstance.portals` — if present, sent to
    a newly-joined guest as `worldSync` state (host only); if absent, an
    empty world/portal set is sent instead of throwing.
  - `worldInstance.generateQRCode(url)` — called only if it exists, to
    regenerate a QR code for the invite link.
  - DOM ids `qr-url`, `share-button`, `multiplayer-info`, `status-text`,
    `status-indicator`, `player-count` — all optional; each lookup is
    null-checked, so a world page with none of the hub's UI chrome still
    works silently.

## What's preserved exactly

- Fragment parsing: `#join=<hostId>.<token>` (token ≥ 8 chars of
  `[A-Za-z0-9_-]`), same regex as the hub and as `ai/ai_player.js`'s own
  early parse.
- Legacy `?host=` query param is rejected with the same "ask the host for a
  fresh link" notice — old-style unauthenticated invites don't work here
  either.
- Host-side token verification: the token does NOT travel in connection
  metadata — that rides the public signalling server, where anyone dialling
  the room could read it. A new connection is held unopened until it sends a
  `hello` on the data channel carrying the token; a host that doesn't get a
  matching `roomSecret` within 8s closes it, before any avatar is created or
  any data is sent. A joiner is equally strict in the other direction: it
  refuses any connection that isn't the host it dialled.
- Avatar creation (`createPlayerAvatar`/`createNameTag`), position
  interpolation (`updatePlayerPosition`), chat (`displayChat`,
  `handlePeerData`'s `'chat'` case), and player counting are unchanged.
- Host-left semantics: a guest whose connection to the room id itself
  closes gets `"Host left — room closed"` / the same error notification,
  because the host's tab *is* the room.

## Drive it every frame

Same as the hub: call `worldNavigator.multiplayer.update()` in your
animation loop (broadcasts your position at the class's own throttle and
prunes players that haven't updated in 5s).

## Test page used to verify this drop-in

A throwaway page (`{camera, scene}` stub + peerjs + `net/multiplayer.js`,
calling `nexusJoin`) was built and run headlessly, then deleted before
committing — see the lane's task report for what it showed.
