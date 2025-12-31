# AINexus v2 - Federated World Explorer

A decentralized network of interconnected 3D worlds. Fork this repo to create your own nexus and connect it to others across the network.

## Quick Start

1. **Fork this repository** on GitHub
2. **Enable GitHub Pages** (Settings > Pages > Deploy from main branch)
3. **Edit `nexus.json`** to customize your nexus identity
4. **Add worlds** to `worlds/` directory
5. **Link to other nexuses** via the Federation Browser

Your nexus will be live at: `https://YOUR-USERNAME.github.io/AINexus/v2/`

## Directory Structure

```
v2/
├── index.html              # Main federated hub
├── nexus.json              # Your nexus configuration
├── README.md               # This file
└── worlds/
    ├── template-world.html # Blank template for new worlds
    └── example-world.html  # Documented example world
```

## Customizing Your Nexus

### nexus.json Configuration

Edit `nexus.json` to define your nexus:

```json
{
  "identity": {
    "id": "my-nexus",
    "name": "My Custom Nexus",
    "description": "Your nexus description",
    "icon": "🌐",
    "owner": {
      "name": "your-username",
      "url": "https://github.com/your-username"
    }
  },
  "github": {
    "owner": "your-username",
    "repo": "AINexus"
  },
  "theme": {
    "colors": {
      "primary": "#00ffff",
      "secondary": "#ff00ff"
    },
    "worldDefaults": {
      "ambientColor": "0a0a0a",
      "fogColor": "000033",
      "portalColor1": "00ffff",
      "portalColor2": "ff00ff"
    }
  },
  "worlds": {
    "local": [
      {
        "id": "my-world",
        "file": "worlds/my-world.html",
        "name": "My World",
        "description": "Description of my world",
        "icon": "✨"
      }
    ],
    "external": []
  },
  "federation": {
    "linkedNexuses": []
  }
}
```

### Adding Worlds

1. Copy `worlds/template-world.html` to `worlds/your-world.html`
2. Edit the `WORLD_CONFIG` object:

```javascript
const WORLD_CONFIG = {
    id: 'your-world-id',
    name: 'Your World Name',
    icon: '🌍',
    description: 'What makes your world unique',

    // Visual Theme
    ambientColor: 0x0a0a0a,
    fogColor: 0x000033,
    groundColor: 0x1a1a2e,
    skyColor: 0x16213e,
    portalColor1: 0x00ffff,
    portalColor2: 0xff00ff,

    // Settings
    particleCount: 1000,
    cameraHeight: 2,
    moveSpeed: 0.15
};
```

3. Customize the `createEnvironment()` method to add your 3D content
4. Add your world to `nexus.json`:

```json
"worlds": {
  "local": [
    {
      "id": "your-world",
      "file": "worlds/your-world.html",
      "name": "Your World Name",
      "description": "World description",
      "icon": "🌍"
    }
  ]
}
```

## Federation

### Linking to Other Nexuses

Add other nexuses to your `nexus.json`:

```json
"federation": {
  "linkedNexuses": [
    {
      "id": "friend-user/AINexus",
      "name": "Friend's Nexus",
      "url": "https://friend-user.github.io/AINexus/v2/",
      "icon": "🤝"
    }
  ]
}
```

Or use the **Federation Browser** (globe icon) in the hub to add nexuses dynamically.

### Nexus Addressing

Worlds can be addressed using the nexus URI format:

```
nexus://owner/repo/world-id
```

Example: `nexus://kody-w/AINexus/crystal-caves`

This resolves to the GitHub Pages URL automatically.

### Cross-Fork Multiplayer

Multiplayer sessions work across different forks. Room IDs include the fork identity:

```
owner/repo:room-id
```

Players from any fork can join the same session by sharing the room URL.

## Features

### Hub Features (index.html)
- **Portal Network**: Browse and enter all available worlds
- **Federation Browser**: Connect to other nexuses
- **AI Companion**: Chat with an AI guide
- **Multiplayer**: Real-time multiplayer with PeerJS
- **QR Code Sharing**: Share session links easily

### World Features (template)
- **3D Navigation**: WASD + mouse look (desktop) or touch controls (mobile)
- **Visual Inheritance**: Portal colors and themes carry between worlds
- **Back Navigation**: Easy return to hub
- **Custom Content**: Full Three.js access for custom 3D scenes

## Controls

### Desktop
- **WASD** - Move
- **Mouse** - Look around (click to lock pointer)
- **Click on portal** - Enter world

### Mobile
- **Left joystick** - Move
- **Touch & drag** - Look around
- **Tap portal** - Enter world

### Gamepad
- **Left stick** - Move
- **Right stick** - Look
- **A button** - Enter portal

## Technical Details

### Stack
- **Three.js r128** - 3D rendering
- **PeerJS** - WebRTC multiplayer
- **Single-file HTML** - No build process, fully self-contained

### URL Parameters

When traveling between worlds, these parameters are passed:

| Parameter | Description |
|-----------|-------------|
| `from` | Source world filename |
| `fromName` | Source world display name |
| `fromNexus` | Source nexus (owner/repo) |
| `nexusReturn` | Full return address |
| `host` | Multiplayer room ID |
| `ambientColor` | Hex color for ambient light |
| `fogColor` | Hex color for fog |
| `portalColor1` | Primary portal color |
| `portalColor2` | Secondary portal color |
| `userId` | Persistent user ID |
| `userName` | Display username |

### Identity Persistence

User identity is stored in localStorage and persists across sessions:

```javascript
{
  id: "uuid",
  username: "GeneratedName123",
  avatarColor: "hsl(180, 70%, 60%)",
  originFork: { owner: "username", repo: "AINexus" }
}
```

## Backward Compatibility

v2 is fully compatible with v1 worlds:

- **v2 can link to v1**: Add v1 world URLs as external worlds in nexus.json
- **v1 can link to v2**: Add v2/index.html as a portal destination
- **Shared multiplayer**: Same PeerJS rooms work across v1 and v2
- **Visual inheritance**: URL parameters work identically

## Troubleshooting

### Worlds not appearing in hub
- Check that world is listed in `nexus.json` under `worlds.local`
- Verify the file path is correct (relative to v2/)
- Check browser console for loading errors

### Federation not working
- Ensure target nexus has CORS enabled (GitHub Pages does by default)
- Check that target nexus has a valid `nexus.json`
- Verify nexus ID format: `owner/repo`

### Multiplayer issues
- Check that PeerJS is loaded (CDN must be accessible)
- Ensure room ID is correctly formatted
- Try refreshing if connection times out

## Examples

See `worlds/example-world.html` for a fully documented example showing:
- Custom color schemes
- Animated floating objects
- Collectible items with scoring
- Multiple portal connections
- Custom particle effects

## License

MIT - Feel free to fork, modify, and create your own nexus!
