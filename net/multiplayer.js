// net/multiplayer.js — MultiplayerManager, extracted from the portal plaza
// (index.html) so a destination world page can rejoin the same PeerJS room
// an AI or human carried through a portal (#join=<roomId>.<secret>&ai=brainstem).
//
// Behaviour is byte-faithful to the hub's class: same fragment parsing
// (#join=<hostId>.<token>, same legacy ?host= rejection notice), same
// host-side token verification before accepting a connection, same avatar
// creation / position updates / chat, same host-left semantics.
//
// The only change from the hub's inline version: a few calls into
// `this.world.*` that assume the *hub's own* WorldNavigator shape
// (getCurrentWorldData(), .worlds, .portals) are now guarded so this class
// also runs correctly against a plain world page whose instance exposes
// only `.camera` and `.scene` — see net/README.md for the exact contract.
//
// Drop-in usage on a world page:
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.2/peerjs.min.js"></script>
//   <script src="net/multiplayer.js"></script>
//   <script>
//     window.worldNavigator = myWorldInstance; // needs .camera, .scene
//     window.nexusJoin(window.worldNavigator);
//   </script>

(function (global) {
    'use strict';

    // Same GitHub Pages coordinates the hub uses to build its share URL.
    // A world page can override these before net/multiplayer.js loads by
    // setting window.NEXUS_REPO_OWNER / window.NEXUS_REPO_NAME.
    const REPO_OWNER = global.NEXUS_REPO_OWNER || 'kody-w';
    const REPO_NAME = global.NEXUS_REPO_NAME || 'AINexus';

    class MultiplayerManager {
        constructor(worldInstance) {
            this.world = worldInstance;
            this.peer = null;
            this.connections = new Map();
            this.players = new Map();
            this.pending = new Map();   // channels open but not yet proven to hold an invite
            this.isHost = false;
            this.roomId = null;

            // Player update frequency (ms)
            this.updateInterval = 50;
            this.lastUpdate = 0;

            // Initialize peer connection
            this.initializePeer();
        }

        initializePeer() {
            // Secure invite: #join=<hostId>.<token>. A URL fragment is never sent to a web
            // server by the browser — but that alone does not keep the secret off the network:
            // it used to ride in the PeerJS connection METADATA, which passes through the
            // public signaling server in clear. It no longer does. The joiner now proves the
            // invite in its first message over the encrypted data channel, after the peer
            // connection is up (see handleNewConnection / the 'hello' case).
            this.joinToken = null;
            this.declaredUsername = null;
            let inviteHost = null;
            const rawHash = window.location.hash || '';
            const frag = rawHash.match(/[#&]join=([^.&]+)\.([A-Za-z0-9_-]{8,})/);
            const aiFlag = rawHash.match(/[#&]ai=([a-z]+)/);
            if (aiFlag) window.NEXUS_AI_MODE = aiFlag[1];
            // Read the declared identity BEFORE the fragment is stripped below. Missing this
            // is why a JOINING AI silently lost its label while a HOSTING one kept it: the host
            // has no #join= fragment, so nothing wiped its #as=.
            const asFlag = rawHash.match(/[#&]as=([^&]+)/);
            if (asFlag) {
                try { this.declaredUsername = decodeURIComponent(asFlag[1]).slice(0, 40); }
                catch (e) { this.declaredUsername = String(asFlag[1]).slice(0, 40); }
            }
            if (frag) {
                inviteHost = frag[1];
                this.joinToken = frag[2];
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }
            const urlParams = new URLSearchParams(window.location.search);
            if (!inviteHost && urlParams.get('host')) {
                this.showError('This invite link is from an older version. Ask the host for a fresh link — invites now carry a secret handshake.');
            }
            const hostId = inviteHost;

            try {
                if (hostId) {
                    // Joining someone's world
                    this.roomId = hostId;
                    this.peer = new Peer();

                    this.peer.on('open', (id) => {
                        console.log('My peer ID:', id);
                        console.log('Attempting to join room:', this.roomId);

                        // Delay connection attempt to ensure host is ready
                        setTimeout(() => {
                            this.connectToHost(this.roomId);
                        }, 1000);

                        this.updateStatus('Connecting...', false);
                    });
                } else {
                    // Creating a new room — mint the room secret (host is whoever
                    // entered first; the room lives exactly as long as this tab)
                    this.isHost = true;
                    const rnd = new Uint8Array(16);
                    crypto.getRandomValues(rnd);
                    this.roomSecret = btoa(String.fromCharCode(...rnd)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                    this.peer = new Peer();

                    this.peer.on('open', (id) => {
                        this.roomId = id;
                        console.log('Created room with ID:', this.roomId);
                        this.updateShareUrl();
                        this.updateStatus('Hosting', true);
                    });
                }

                // Handle incoming connections
                this.peer.on('connection', (conn) => {
                    console.log('Incoming connection from:', conn.peer);
                    this.handleNewConnection(conn, false);   // inbound: somebody dialled us
                });

                // Handle errors
                this.peer.on('error', (err) => {
                    console.error('Peer error:', err);

                    // Handle specific error types
                    if (err.type === 'peer-unavailable') {
                        this.showError('Host not found. Make sure the host is online.');
                    } else if (err.type === 'network') {
                        this.showError('Network error. Check your connection.');
                    } else {
                        this.showError('Connection error: ' + err.message);
                    }

                    this.updateStatus('Error', false);
                });

                // Handle disconnection
                this.peer.on('disconnected', () => {
                    console.log('Disconnected from peer server');
                    this.updateStatus('Disconnected', false);

                    // Try to reconnect
                    setTimeout(() => {
                        if (!this.peer.destroyed) {
                            console.log('Attempting to reconnect...');
                            this.peer.reconnect();
                        }
                    }, 3000);
                });

            } catch (error) {
                console.error('Failed to initialize peer:', error);
                this.showError('Failed to initialize multiplayer');
            }
        }

        connectToHost(hostId) {
            try {
                console.log('Connecting to host:', hostId);

                const conn = this.peer.connect(hostId, {
                    reliable: true,
                    serialization: 'json',
                    metadata: {
                        username: (this.username = this.username || this.generateUsername()),
                        // NO token here: connection metadata travels through the public
                        // signaling server. The invite is proven over the data channel instead.
                        worldData: (typeof this.world.getCurrentWorldData === 'function')
                            ? this.world.getCurrentWorldData()
                            : undefined
                    }
                });

                // Set connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (conn.open === false) {
                        console.error('Connection timeout');
                        this.showError('Connection timeout. Host may be offline.');
                        conn.close();
                    }
                }, 10000);

                conn.on('open', () => {
                    clearTimeout(connectionTimeout);
                    console.log('Connected to host successfully');
                    this.updateStatus('Connected', true);
                });

                this.handleNewConnection(conn, true);    // outbound: we dialled the host
            } catch (error) {
                console.error('Failed to connect to host:', error);
                this.showError('Failed to connect to host');
            }
        }

        handleNewConnection(conn, outbound) {
            const peerId = conn.peer;

            // A JOINER MUST ONLY EVER TALK TO THE HOST IT WAS INVITED TO. Anyone who learns a
            // joiner's peer id can dial it, and until this check existed that stranger was
            // handed the room's invite token in the hello — the joiner would have leaked the
            // very secret the handshake exists to protect, and admitted them besides.
            if (!this.isHost && (!outbound || peerId !== this.roomId)) {
                console.warn('Refusing a connection that is not the host of this room:', peerId);
                try { conn.close(); } catch (e) {}
                return;
            }

            conn.on('open', () => {
                if (this.isHost) {
                    // Hold it. An open channel is not yet a member: the joiner has to present
                    // the invite over this encrypted channel first, and gets a few seconds to
                    // do it before the door shuts.
                    this.pending.set(peerId, conn);
                    conn.__authTimer = setTimeout(() => {
                        if (this.pending.get(peerId) === conn) {
                            console.warn('Join timed out without presenting an invite:', peerId);
                            this.pending.delete(peerId);
                            try { conn.close(); } catch (e) {}
                        }
                    }, 8000);
                    return;
                }
                // A joiner presents the invite as its very first message, then behaves normally.
                try {
                    conn.send({ type: 'hello', token: this.joinToken,
                                username: (this.username = this.username || this.generateUsername()) });
                } catch (e) {}
                this.acceptConnection(conn, conn.metadata);
            });

            conn.on('data', (data) => {
                try {
                    this.handlePeerData(peerId, data, conn);
                } catch (error) {
                    console.error('Error handling peer data:', error);
                }
            });

            conn.on('close', () => {
                console.log('Peer disconnected:', peerId);
                if (conn.__authTimer) clearTimeout(conn.__authTimer);
                this.pending.delete(peerId);
                this.removePlayer(peerId);
                this.connections.delete(peerId);
                this.updatePlayerCount();
                if (!this.isHost && peerId === this.roomId) {
                    // the host's tab is the room — when it closes, the room is gone
                    this.updateStatus('Host left — room closed', false);
                    this.showError('The host closed their tab, so this room no longer exists. Ask for a new invite link.');
                }
            });

            conn.on('error', (err) => {
                // An error does not always arrive with a 'close' behind it, and a connection
                // left in the map is a player who is still standing there to everyone else.
                console.error('Connection error with peer', peerId, ':', err);
                if (conn.__authTimer) clearTimeout(conn.__authTimer);
                this.pending.delete(peerId);
                if (this.connections.get(peerId) === conn) {
                    this.connections.delete(peerId);
                    this.removePlayer(peerId);
                    this.updatePlayerCount();
                }
            });
        }

        // A connection becomes a member here, and only here.
        acceptConnection(conn, meta) {
            const peerId = conn.peer;
            if (this.connections.has(peerId)) return;
            console.log('Connection opened with peer:', peerId);
            this.connections.set(peerId, conn);
            this.sendPlayerData(conn);
            this.createPlayerAvatar(peerId, meta);
            this.showNotification(`Player joined: ${(meta && meta.username) || 'Anonymous'}`);
            this.updatePlayerCount();
            if (this.isHost) this.sendWorldState(conn);
        }

        // Nobody in a peer-to-peer room can PROVE who they are — every name is a claim its
        // owner types. What the host can do is refuse to let two claims be identical, so a
        // newcomer cannot quietly wear the name of someone already standing there (including
        // by copying an "(AI)" label, or by copying yours).
        uniqueName(peerId, name) {
            const want = String(name || 'Anonymous').slice(0, 40);
            const taken = (n) => {
                if (this.username === n) return true;
                for (const [pid, pl] of this.players) if (pid !== peerId && pl.username === n) return true;
                return false;
            };
            if (!taken(want)) return want;
            for (let i = 2; i < 60; i++) if (!taken(`${want} (${i})`)) return `${want} (${i})`;
            return `${want} (?)`;
        }

        displayChat(peerId, message) {
            // chat arrives from peers; this method was called but never defined — latent since birth
            (this.chatLog = this.chatLog || []).push({ from: String(peerId).slice(0, 6), text: String(message).slice(0, 200) });
            if (this.chatLog.length > 12) this.chatLog = this.chatLog.slice(-12);
            this.showNotification(`${this.players.get(peerId)?.username || String(peerId).slice(0, 6)}: ${String(message).slice(0, 120)}`);
        }

        handlePeerData(peerId, data, conn) {
            // THE DOOR. Until a peer has presented the invite over this channel it is not in
            // the room, and the only sentence it is allowed to say is the one that lets it in.
            if (this.isHost && !this.connections.has(peerId)) {
                const held = this.pending.get(peerId);
                if (!held) return;
                if (data.type !== 'hello') return;
                if (!data.token || data.token !== this.roomSecret) {
                    console.warn('Rejected join without a valid invite token:', peerId);
                    this.showNotification('Rejected a join attempt without a valid invite');
                    this.pending.delete(peerId);
                    if (held.__authTimer) clearTimeout(held.__authTimer);
                    try { held.close(); } catch (e) {}
                    return;
                }
                if (held.__authTimer) clearTimeout(held.__authTimer);
                this.pending.delete(peerId);
                this.acceptConnection(held, { username: data.username });
                return;
            }
            if (data.type === 'hello') return;      // a joiner never needs to admit anybody
            switch (data.type) {
                case 'playerUpdate':
                    if (data.username) {
                        const known = this.players.get(peerId);
                        const claimed = this.uniqueName(peerId, data.username);
                        if (known && known.username !== claimed) {
                            known.username = claimed;
                            try { if (known.avatar && this.createNameTag) {           // re-tag the body above their head
                                const old = known.avatar.getObjectByName('nametag');
                                if (old) known.avatar.remove(old);
                                const tag = this.createNameTag(peerId, { username: claimed });
                                if (tag) { tag.name = 'nametag'; tag.position.y = 3; known.avatar.add(tag); }
                            } } catch (e) {}
                        }
                    }
                    this.updatePlayerPosition(peerId, data.position, data.rotation);
                    break;

                case 'chat': {
                    // A message may be addressed. Show it if it is for the room or for me...
                    const mine = this.peer && this.peer.id;
                    // `from` is a claim. The host knows better: the connection a message
                    // arrived on IS its author, so a joiner cannot dress a line up as someone
                    // else's. Only a joiner, which hears everything second-hand through the
                    // host, has to take the relayed attribution on trust.
                    const from = this.isHost ? peerId : (data.from || peerId);
                    if (!data.to || data.to === mine) this.displayChat(from, data.message);
                    // ...and if I am the host, pass it on: joiners are connected only to me, so
                    // without this relay two joiners can never hear each other at all.
                    if (this.isHost) {
                        this.connections.forEach((c, id) => {
                            if (id === peerId) return;
                            if (data.to && data.to !== id) return;
                            try { c.send({ type: 'chat', message: data.message, from, to: data.to }); } catch (e) {}
                        });
                    }
                    break;
                }

                case 'interaction':
                    this.showPlayerInteraction(peerId, data.target);
                    break;

                case 'worldSync':
                    if (!this.isHost) {
                        this.syncWorldState(data.worldState);
                    }
                    break;

                case 'ai_companion':
                    this.handleAICompanionData(peerId, data);
                    break;
            }
        }

        sendWorldState(conn) {
            // Send current world state to new player. worlds/portals are hub-only
            // concepts (the plaza's own portal registry); a plain world page has
            // neither, so this degrades to an empty world state rather than throwing.
            // Keep this SMALL. Every page already loads the world list itself from committed
            // static data (Article XXIV), so shipping all ~50 worlds peer-to-peer was both
            // redundant and over PeerJS's message limit — joiners were greeted with
            // {"type":"message-too-big"}. Send names and positions; the bytes stay put.
            const worldState = {
                type: 'worldSync',
                worldState: {
                    worldCount: Object.keys(this.world.worlds || {}).length,
                    portals: (this.world.portals || []).slice(0, 24).map(portal => ({
                        position: portal.parent ? portal.parent.position : portal.position,
                        name: (portal.userData && portal.userData.name) || '',
                        url: (portal.userData && portal.userData.url) || ''
                    }))
                }
            };

            if (conn && conn.open) {
                conn.send(worldState);
            }
        }

        syncWorldState(worldState) {
            // Sync world state from host
            console.log('Syncing world state from host');
            // Implementation depends on your world structure
        }

        handleAICompanionData(peerId, data) {
            // Handle AI companion presence from other players
            console.log(`AI companion data from ${peerId}:`, data);
            // Could show AI companions from other players here
        }

        createPlayerAvatar(peerId, metadata) {
            // a claimed name, made unambiguous before anyone sees it
            metadata = Object.assign({}, metadata, { username: this.uniqueName(peerId, metadata && metadata.username) });
            // Create a simple avatar for the player
            const avatarGroup = new THREE.Group();

            // Body (capsule-like shape)
            const bodyGeometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 8);
            const bodyMaterial = new THREE.MeshStandardMaterial({
                color: this.getPlayerColor(peerId),
                metalness: 0.3,
                roughness: 0.7
            });
            const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
            body.position.y = 1;
            avatarGroup.add(body);

            // Head
            const headGeometry = new THREE.SphereGeometry(0.3, 8, 6);
            const head = new THREE.Mesh(headGeometry, bodyMaterial);
            head.position.y = 2.3;
            avatarGroup.add(head);

            // Name tag
            const nameTag = this.createNameTag(peerId, metadata);
            nameTag.position.y = 3;
            avatarGroup.add(nameTag);

            // Glow effect
            const light = new THREE.PointLight(this.getPlayerColor(peerId), 0.5, 5);
            light.position.y = 1.5;
            avatarGroup.add(light);

            // Add to scene
            this.world.scene.add(avatarGroup);
            this.players.set(peerId, {
                avatar: avatarGroup,
                lastUpdate: Date.now(),
                username: metadata?.username || 'Anonymous'
            });
        }

        createNameTag(peerId, metadata) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(0, 0, 256, 64);

            ctx.font = '32px Arial';
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.fillText(metadata?.username || this.getPlayerName(peerId), 128, 40);

            const texture = new THREE.CanvasTexture(canvas);
            const material = new THREE.SpriteMaterial({ map: texture });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(2, 0.5, 1);

            return sprite;
        }

        updatePlayerPosition(peerId, position, rotation) {
            const player = this.players.get(peerId);
            if (!player) return;

            // Smooth interpolation
            const targetPos = new THREE.Vector3(position.x, position.y, position.z);
            player.avatar.position.lerp(targetPos, 0.3);

            // Update rotation
            player.avatar.rotation.y = rotation.y;

            player.lastUpdate = Date.now();
        }

        sendPlayerData(conn) {
            const data = {
                type: 'playerUpdate',
                // Carry the name on every update. A HOST never calls connect(), so its
                // metadata never reaches a joiner — without this, an AI host appears to
                // everyone else under a random human-looking name, and "every AI is
                // labelled" is true only in its own window.
                username: this.username || this.generateUsername(),
                position: {
                    x: this.world.camera.position.x,
                    y: this.world.camera.position.y,
                    z: this.world.camera.position.z
                },
                rotation: {
                    x: this.world.camera.rotation.x,
                    y: this.world.camera.rotation.y
                }
            };

            if (conn && conn.open) {
                try {
                    conn.send(data);
                } catch (error) {
                    console.error('Failed to send player data:', error);
                }
            }
        }

        broadcastPlayerUpdate() {
            const now = Date.now();
            if (now - this.lastUpdate < this.updateInterval) return;

            this.connections.forEach((conn) => {
                this.sendPlayerData(conn);
            });

            this.lastUpdate = now;
        }

        broadcastAIPresence(aiData) {
            this.connections.forEach((conn) => {
                if (conn && conn.open) {
                    try {
                        conn.send({
                            type: 'ai_companion',
                            ...aiData
                        });
                    } catch (error) {
                        console.error('Failed to broadcast AI presence:', error);
                    }
                }
            });
        }

        // Builds the same secret-bearing invite link used for the QR/copy flow,
        // so any caller (e.g. the "Invite an AI player" button) can reuse the
        // host's current room id + secret without duplicating the format.
        getShareUrl() {
            const currentFile = window.location.pathname.split('/').pop() || 'index.html';
            return `https://${REPO_OWNER}.github.io/${REPO_NAME}/${currentFile}#join=${this.roomId}.${this.roomSecret}`;
        }

        updateShareUrl() {
            // Update QR code to include host parameter
            const shareUrl = this.getShareUrl();

            // Update QR code
            const qrUrlElement = document.getElementById('qr-url');
            if (qrUrlElement) {
                qrUrlElement.textContent = shareUrl;
            }

            // Regenerate QR code
            if (this.world.generateQRCode) {
                this.world.generateQRCode(shareUrl);
            }

            // Update share button to show multiplayer status
            const shareButton = document.getElementById('share-button');
            if (shareButton) {
                shareButton.classList.add('multiplayer');
            }

            // Show multiplayer info in modal
            const multiplayerInfo = document.getElementById('multiplayer-info');
            if (multiplayerInfo) {
                multiplayerInfo.style.display = 'block';
            }
        }

        updateStatus(status, connected) {
            const statusText = document.getElementById('status-text');
            const statusIndicator = document.getElementById('status-indicator');

            if (statusText) statusText.textContent = status;
            if (statusIndicator) {
                statusIndicator.classList.toggle('connected', connected);
                statusIndicator.classList.toggle('hosting', this.isHost);
            }
        }

        updatePlayerCount() {
            const count = this.connections.size + 1; // +1 for self
            const playerCountEl = document.getElementById('player-count');
            if (playerCountEl) playerCountEl.textContent = count;
        }

        getPlayerColor(peerId) {
            // Generate consistent color based on peer ID
            const colors = [0xff006e, 0x06ffa5, 0x3a86ff, 0xffaa00, 0xff00ff];
            const index = peerId.charCodeAt(0) % colors.length;
            return colors[index];
        }

        getPlayerName(peerId) {
            const player = this.players.get(peerId);
            return player?.username || 'Player ' + peerId.substr(0, 4);
        }

        generateUsername() {
            // The name other people see comes from the metadata sent at connect time, so an AI's
            // label has to exist BEFORE the handshake — relabelling afterwards only renames it in
            // its own window, and everyone else keeps seeing a human-looking name. That is the
            // difference between "labelled as an AI" and merely believing you labelled it.
            const declared = this.declaredUsername
                || (typeof window !== 'undefined' && window.NEXUS_USERNAME);
            if (declared) return String(declared).slice(0, 40);

            const adjectives = ['Swift', 'Neon', 'Cyber', 'Quantum', 'Digital'];
            const nouns = ['Explorer', 'Wanderer', 'Voyager', 'Pilot', 'Navigator'];
            const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
            const noun = nouns[Math.floor(Math.random() * nouns.length)];
            return `${adj}${noun}${Math.floor(Math.random() * 100)}`;
        }

        removePlayer(peerId) {
            const player = this.players.get(peerId);
            if (player) {
                this.world.scene.remove(player.avatar);
                this.players.delete(peerId);
                this.showNotification(`Player left: ${player.username}`);
            }
        }

        showNotification(message) {
            // Create notification element
            const notification = document.createElement('div');
            notification.className = 'multiplayer-notification';
            notification.textContent = message;

            document.body.appendChild(notification);

            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        }

        showError(message) {
            console.error(message);
            this.showNotification('⚠️ ' + message);
        }

        // Call this in the animation loop
        update() {
            this.broadcastPlayerUpdate();

            // Remove inactive players
            const now = Date.now();
            this.players.forEach((player, peerId) => {
                if (now - player.lastUpdate > 5000) {
                    this.removePlayer(peerId);
                }
            });
        }
    }

    global.NexusMultiplayer = MultiplayerManager;

    // Boot helper for a world page that isn't the hub: constructs the manager
    // against `worldInstance` (needs .camera + .scene — see net/README.md) and
    // assigns worldInstance.multiplayer, exactly the field ai/ai_player.js
    // polls for before it attaches and starts driving the AI.
    global.nexusJoin = function nexusJoin(worldInstance) {
        const mp = new MultiplayerManager(worldInstance);
        worldInstance.multiplayer = mp;
        return mp;
    };
})(window);
