# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AINexus is a collection of self-contained HTML worlds - interactive 3D web experiences built with Three.js. Each HTML file is a standalone application featuring:
- 3D navigation and exploration
- AI companion integration (connects to Azure Functions API)
- Multiplayer functionality via PeerJS
- Scene recording/replay capabilities
- Portal system for linking between worlds

**Live site**: https://kody-w.github.io/AINexus/

## Architecture

### Single-File Design
Each world is a complete, self-contained HTML file with inline CSS and JavaScript. This means:
- No build process or bundler
- No external JavaScript modules to manage
- Each file can be opened directly in a browser or served statically
- All Three.js code is inline (no CDN dependencies for offline support)

### Core Classes (found in index.html and hub files)
- **WorldNavigator**: Main controller for 3D scene, camera, and navigation
- **AIManager**: Handles AI companion chat via Azure Functions endpoint
- **MultiplayerManager**: PeerJS multiplayer, host/client — extracted out to `net/multiplayer.js`, which `index.html` loads
- **SceneRecorder**: Records and replays scene interactions
- **WorldCreator**: Creates new portal worlds from camera captures
- **PortalManager**: Manages inter-world portal connections
- **TaskManager**: Conversation replay and task management

### Key Technologies
- **Three.js**: 3D rendering and scene management (inline, r128+)
- **PeerJS**: WebRTC-based peer-to-peer multiplayer
- **Azure Functions**: AI backend at `https://azfbusinessbot.azurewebsites.net/api/aidialog`

## File Structure

- `index.html` - Main hub (full-featured)
- `index_slim.html` - Lightweight hub variant
- `index_heavy.html`, `index2.0.html` - Feature-rich hub variants
- `*-world.html` - Themed 3D worlds (galaxy-zoo-world, crystal-caves-world, etc.)
- `archive/` - Older versions and experimental worlds
- `.claude/agents/` - Custom Claude Code agents (quantum-world-generator, local-first-app-builder, etc.)
- `.github/workflows/ghost-host.yml` - retired ghost host (rooms can no longer be pinned to a URL); now guards that premise

## Development

### Running Locally
```bash
python -m http.server 8000
# Open http://localhost:8000/index.html
```

Or simply open any HTML file directly in a browser.

### Testing Changes
1. Open the HTML file in browser
2. Test navigation (WASD/arrow keys, touch controls, gamepad)
3. Test AI companion (requires API key via URL param or prompt)
4. Test multiplayer: one tab hosts; take its invite from the Share panel or `worldNavigator.multiplayer.getShareUrl()` in the console, then open a second tab with that link's `#join=...` fragment on your own URL - `http://localhost:8000/index.html#join=<roomId>.<token>`. Only the fragment matters; the printed origin is always github.io

## Common Patterns

### Adding New Worlds
1. Copy an existing world HTML file (e.g., `crystal-caves-world.html`)
2. Modify the `CURRENT_WORLD` configuration object:
```javascript
const CURRENT_WORLD = {
    id: 'world-id',
    name: 'World Name',
    icon: '🌍',
    description: 'World description',
    color: '#hexcolor'
};
```
3. Customize the 3D scene setup in the world initialization code

### AI Integration
POST to `https://azfbusinessbot.azurewebsites.net/api/aidialog`:
```javascript
{
    user_query: "message",
    user_guid: "unique-user-id",
    api_key: "optional-key"
}
// Response: { assistant_response: "...", agent_log: "..." }
```

### Multiplayer
Implemented once in `net/multiplayer.js` (loaded by `index.html` and any world page via `nexusJoin`).
- Every page opens as its own host: the room id is whatever the PeerJS server assigns, and the host mints a room secret with `crypto.getRandomValues`. Neither can be chosen or preset.
- The invite is the URL **fragment** `#join=<roomId>.<token>` (a fragment is never sent to a web server). A joiner scrubs it from the address bar on arrival, proves the token over the encrypted data channel in a `hello` message — never in PeerJS connection metadata, which crosses the public signaling server — and refuses any connection that is not the host it was invited to.
- The host holds an unproven channel in `pending` for 8s; a wrong or missing token is closed, never admitted.
- The host's tab **is** the room: when it closes, joiners get "Host left — room closed".
- Legacy `?host=room-id` links are dead — they surface "This invite link is from an older version" and the page just hosts a fresh room of its own.
- No permanent room exists, and none can: a fixed URL would need a fixed room id and a known secret, and the code allows neither. `.github/workflows/ghost-host.yml` is retired for that reason.

### Controls
- **Desktop**: WASD movement, mouse look (pointer lock), Space to jump
- **Mobile**: Touch joystick, touch drag for camera
- **Gamepad**: Full controller support with analog sticks

## Claude Code Agents

Custom agents in `.claude/agents/` for common tasks:
- `quantum-world-generator.md` - Creates new 3D worlds with P2P networking
- `local-first-app-builder.md` - Builds self-contained HTML applications
