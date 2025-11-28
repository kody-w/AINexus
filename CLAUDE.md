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
- **MultiplayerManager**: PeerJS-based multiplayer with host/client architecture
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
- `.github/workflows/ghost-host.yml` - GitHub Action to keep multiplayer rooms alive

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
4. Test multiplayer: open multiple tabs with same `?host=room-id` parameter

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
- Rooms identified by URL parameter `?host=room-id`
- First visitor becomes host, others become clients
- Permanent room: `nexus-permanent-world` (kept alive by ghost-host workflow)

### Controls
- **Desktop**: WASD movement, mouse look (pointer lock), Space to jump
- **Mobile**: Touch joystick, touch drag for camera
- **Gamepad**: Full controller support with analog sticks

## Claude Code Agents

Custom agents in `.claude/agents/` for common tasks:
- `quantum-world-generator.md` - Creates new 3D worlds with P2P networking
- `local-first-app-builder.md` - Builds self-contained HTML applications
