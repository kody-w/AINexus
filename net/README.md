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
  `handlePeerData`'s `'chat'` case), and player counting are unchanged in
  shape. What they will no longer accept is covered below.
- Host-left semantics: a guest whose connection to the room id itself
  closes *after the host has spoken to it* gets `"Host left — room closed"` /
  the same error notification, because the host's tab *is* the room.

## What a peer is not allowed to do

Everything a peer sends arrives from another machine. `tests/browser/room.cjs`
holds each of these down against a real four-context PeerJS room:

- A position or rotation is only applied if every component is a finite
  number. A string, an array or a missing field is dropped, because a single
  NaN folded through `lerp()` poisons that avatar's matrix permanently — it
  never returns even after the peer starts telling the truth again.
- A relayed chat is clamped to 500 characters (every sender in this repo
  says less: `tell` clamps at 240, `displayChat` keeps 200) and metered at 20
  per five seconds per peer. The host is the only machine that turns one
  message into a room's worth of upload.
- A rename is applied at most once a second per peer; each one costs a
  canvas, a texture upload and a material, and the peer chooses the rate.
- The doorway holds at most 24 unproven channels, and a peer's second
  unproven channel closes its first rather than orphaning it.
- Cleanup belongs to the channel that closed, not to its peer id: a second
  channel from a member — which a signalling reconnect used to create — no
  longer evicts that member.
- A member who goes quiet on an open channel keeps their body. Only a peer
  with no live connection is reaped, because nothing rebuilds an avatar
  after the handshake.
- A joiner reads `"Connected"` only once the host has actually sent it
  something. A refused invite says it was refused, rather than blaming a
  host who never left.

## Drive it every frame

Same as the hub: call `worldNavigator.multiplayer.update()` in your
animation loop (broadcasts your position at the class's own throttle and
prunes players that haven't updated in 5s).

## Test page used to verify this drop-in

A throwaway page (`{camera, scene}` stub + peerjs + `net/multiplayer.js`,
calling `nexusJoin`) was built and run headlessly, then deleted before
committing — see the lane's task report for what it showed.
