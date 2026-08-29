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

    // Parsed once, used by every Peer this page makes — a host on one broker and
    // a guest on another are two networks that can never meet.
    function brokerOptions() {
        let raw = '';
        try {
            raw = new URLSearchParams(location.search).get('broker')
               || (typeof window !== 'undefined' && window.NEXUS_BROKER)
               || localStorage.getItem('nexus-broker') || '';
        } catch (e) { raw = ''; }
        raw = String(raw || '').trim();
        if (!raw) return undefined;                       // the cloud, unchanged
        try {
            const u = new URL(raw.includes('://') ? raw : 'https://' + raw);
            const opts = { host: u.hostname, secure: u.protocol === 'https:' };
            if (u.port) opts.port = +u.port;
            if (u.pathname && u.pathname !== '/') opts.path = u.pathname;
            // a broker on localhost is almost always plain http
            if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname) && !raw.includes('://')) {
                opts.secure = false;
            }
            console.info('[nexus] signalling broker:', opts);
            return opts;
        } catch (e) {
            console.warn('[nexus] unusable broker "' + raw + '" — using the default cloud');
            return undefined;
        }
    }

    // A guest learns who an update is about from `data.from`, a field the HOST fills in —
    // and a host is only ever "whoever sent me a link". Two things bound what that can cost.
    // First: the id has to look like a peer id. Every id that legitimately reaches this code
    // was minted by the broker (PeerJS hands out UUIDs) or is a room id copied from one, so
    // it lives in [A-Za-z0-9_-]. Anything else is not a peer that exists anywhere; it is a
    // map key somebody is inventing.
    const PEER_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
    function isPlausiblePeerId(id) {
        return typeof id === 'string' && PEER_ID_SHAPE.test(id);
    }

    // Second: a ceiling on how many bodies one receiver will ever mint. Each avatar is a
    // Group carrying its own geometries, material, a PointLight and a 256x64 canvas texture,
    // all of it resident on the GPU; a host looping `from:'x'+i` up to 50000 spends nothing
    // and takes the guest's tab with it. 64 is far above any room this has ever held — a
    // PeerJS star saturates the host's uplink around a dozen guests, long before this — and
    // far below the point where the allocations hurt.
    const MAX_PLAYER_BODIES = 64;

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

        // ── which signalling broker? ────────────────────────────────────────
        // The default is PeerJS's free cloud, which is fine until it is not:
        // on some networks the HTTPS endpoint answers 200 while the WEBSOCKET
        // upgrade is refused (measured: 403 on upgrade, 200 on GET, and a
        // minimal two-peer test failing with PeerJS 'network' in 2s). A room
        // cannot form and nothing in the app is wrong.
        //
        // So the broker is configurable, and pointing at one you run is the
        // answer for any room you actually depend on:
        //     npx peerjs --port 9000 --key peerjs
        //     ...then open the world with ?broker=localhost:9000
        // Accepted as ?broker=host:port/path, or window.NEXUS_BROKER, or
        // localStorage 'nexus-broker'. Empty/absent = the cloud, as before.
        initializePeer() {
            // Secure invite: #join=<hostId>.<token>. A URL fragment is never sent to a web
            // server by the browser — but that alone does not keep the secret off the network:
            // it used to ride in the PeerJS connection METADATA, which passes through the
            // public signaling server in clear. It no longer does. The joiner now proves the
            // invite in its first message over the encrypted data channel, after the peer
            // connection is up (see handleNewConnection / the 'hello' case).
            // Remembered from a previous pass: the fragment is erased below, so a
            // retry has nothing left to read and would otherwise silently host.
            const remembered = this.invite || null;
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
                // keep it in memory, out of the URL
                this.invite = { host: inviteHost, token: this.joinToken,
                                as: this.declaredUsername };
                history.replaceState(null, '', window.location.pathname + window.location.search);
            } else if (remembered) {
                // a retry: the URL no longer carries the invite, but we still do
                inviteHost = remembered.host;
                this.joinToken = remembered.token;
                if (!this.declaredUsername) this.declaredUsername = remembered.as;
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
                    this.peer = new Peer(undefined, brokerOptions());

                    this.peer.on('open', (id) => {
                        this.peerOpen = true;
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
                    this.peer = new Peer(undefined, brokerOptions());

                    this.peer.on('open', (id) => {
                        this.peerOpen = true;
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

                    // A busy free broker answers `server-error` before it ever
                    // emits `open`, so roomId is never assigned and this tab is
                    // silently alone — the failure that makes a room of four
                    // read as four rooms of one. It is transient, so retry it a
                    // few times with backoff instead of giving up on the first.
                    if ((err.type === 'server-error' || err.type === 'network') && !this.peerOpen) {
                        this.brokerTries = (this.brokerTries || 0) + 1;
                        if (this.brokerTries <= 3) {
                            const wait = 400 * this.brokerTries;
                            this.updateStatus('Broker busy — retry ' + this.brokerTries + '/3', false);
                            console.warn('[nexus] broker ' + err.type + '; retrying in ' + wait + 'ms');
                            setTimeout(() => {
                                try { if (this.peer && !this.peer.destroyed) this.peer.destroy(); } catch (e) {}
                                try { this.initializePeer(); } catch (e) {
                                    console.warn('[nexus] retry failed', e);
                                }
                            }, wait);
                            return;
                        }
                        this.showError('The peer broker refused us ' + this.brokerTries +
                                       ' times — this tab is alone. Nothing else is wrong.');
                        this.updateStatus('Alone (broker refused)', false);
                        return;
                    }

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

                    // Try to reconnect — but only if this handler still belongs to
                    // the CURRENT peer. A retry replaces this.peer, and the old
                    // one's timer firing later would reconnect a socket nobody reads.
                    const mine = this.peer;
                    setTimeout(() => {
                        if (this.peer !== mine) return;      // superseded by a retry
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
                // conn.metadata on THIS side is what I sent, not what the host sent, so
                // passing it here dressed the host's avatar in my own name — an AI joiner
                // made the host's nametag read "…(AI) (2)". The host's real name arrives
                // on its first playerUpdate, which re-tags the body.
                this.acceptConnection(conn, {});
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
                if (this.isHost) this.relayDeparture(peerId);
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
                    if (this.isHost) this.relayDeparture(peerId);
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
                case 'playerUpdate': {
                    // Who this update is actually about. On the host the connection IS the
                    // author, so `from` is ignored; a joiner hears about everyone except the
                    // host second-hand and has to take the host's stamp, exactly as for chat.
                    const who = this.isHost ? peerId : (data.from || peerId);
                    // On the host `who` is the connection itself and cannot be anything else.
                    // On a guest it is whatever the host typed, and it is about to be used as
                    // a map key and a scene identity — so it stops here unless it could be a
                    // real peer id.
                    if (!isPlausiblePeerId(who)) break;
                    const mineId = this.peer && this.peer.id;
                    if (who === mineId) break;                    // never grow a body for myself
                    if (data.username) {
                        const known = this.players.get(who);
                        const claimed = this.uniqueName(who, data.username);
                        if (known && known.username !== claimed) {
                            known.username = claimed;
                            try { if (known.avatar && this.createNameTag) {           // re-tag the body above their head
                                const old = known.avatar.getObjectByName('nametag');
                                // The discarded sprite owns a canvas texture of its own, and a
                                // rename is not rare — nothing stops a host claiming a new name
                                // on every update, which is a texture per message.
                                if (old) { known.avatar.remove(old); this.disposeAvatar(old); }
                                const tag = this.createNameTag(who, { username: claimed });
                                if (tag) { tag.name = 'nametag'; tag.position.y = 3; known.avatar.add(tag); }
                            } } catch (e) {}
                        }
                    }
                    // A relayed peer has no connection here, so acceptConnection never ran for
                    // it and it has no body. Give it one the first time it is heard from —
                    // without this two joiners stay permanently invisible to each other.
                    if (!this.players.has(who)) {
                        if (this.players.size >= MAX_PLAYER_BODIES) {
                            // Said once, not once per message: the flood that reaches this
                            // arrives as fast as the channel will carry it, and a warn per
                            // message is its own way to hang the tab. Everything else in the
                            // case still runs — a host must keep relaying for the peers it
                            // does know about.
                            if (!this.mintCapReported) {
                                this.mintCapReported = true;
                                console.warn('[nexus] refusing to build more than ' + MAX_PLAYER_BODIES +
                                             ' player bodies — this room is claiming more members than a room can have');
                            }
                        } else {
                            this.createPlayerAvatar(who, { username: data.username });
                            this.updatePlayerCount();
                        }
                    }
                    if (data.position) this.updatePlayerPosition(who, data.position, data.rotation);
                    // The room is a star: every joiner is wired only to the host. Presence has
                    // to be passed on for the same reason chat does, or each guest sees the
                    // host and nobody else.
                    if (this.isHost) {
                        this.connections.forEach((c, id) => {
                            if (id === peerId) return;
                            try {
                                c.send({ type: 'playerUpdate', from: peerId, username: data.username,
                                         position: data.position, rotation: data.rotation });
                            } catch (e) {}
                        });
                    }
                    break;
                }

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

                case 'playerLeft':
                    // Only the host is wired to everyone, so only the host can tell the room
                    // that somebody went. Without it a guest keeps a motionless body forever.
                    if (!this.isHost && data.who) { this.removePlayer(data.who); this.updatePlayerCount(); }
                    break;

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
            // The rename path finds this by name and REPLACES it. Without the name it
            // could never find it, so every rename welded a second label on top of the
            // first and the host floated two stacked sprites in every joining tab.
            nameTag.name = 'nametag';
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

            // The caller checks that `position` arrived; nothing ever checked that `rotation`
            // did. On a guest this message is relayed, so its shape is the host's choice and
            // not the sender's — a field that simply isn't there has to mean "unchanged"
            // rather than a throw halfway through the presence loop.
            if (rotation && typeof rotation.y === 'number') player.avatar.rotation.y = rotation.y;

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

        // The host is the only tab connected to everyone. Passing a departure on is the
        // presence twin of the chat relay above.
        relayDeparture(goneId) {
            this.connections.forEach((c, id) => {
                if (id === goneId) return;
                try { c.send({ type: 'playerLeft', who: goneId }); } catch (e) {}
            });
        }

        updatePlayerCount() {
            // Everyone I know of: the peers I am wired to, plus the ones the host has told me
            // about. On the host those are the same set; on a joiner they are not, and counting
            // only my own wires is what made every guest in a full room report "2 players".
            const seen = new Set(this.connections.keys());
            this.players.forEach((_, id) => seen.add(id));
            const mineId = this.peer && this.peer.id;
            if (mineId) seen.delete(mineId);
            const count = seen.size + 1; // +1 for self
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

        // Everything under an avatar group is minted per avatar in createPlayerAvatar: its own
        // CylinderGeometry and SphereGeometry, one MeshStandardMaterial worn by both the body
        // and the head (hence the seen-set — the same object is reached twice), the PointLight,
        // and the 256x64 CanvasTexture behind the nametag's SpriteMaterial. Nothing here is
        // shared with another player, and none of it leaves the GPU when the group leaves the
        // scene. That was survivable while removal was one-way. It stopped being survivable
        // when first sight started rebuilding bodies: a backgrounded tab suspends rAF and so
        // stops sending at all, gets pruned at 5 seconds, and is rebuilt the moment it comes
        // back — every round trip leaking a full set.
        disposeAvatar(avatar) {
            if (!avatar || typeof avatar.traverse !== 'function') return;
            const seen = new Set();
            const release = (thing) => {
                if (!thing || seen.has(thing)) return;
                seen.add(thing);
                if (thing.map) release(thing.map);      // the canvas texture under a SpriteMaterial
                if (typeof thing.dispose === 'function') {
                    try { thing.dispose(); } catch (e) {}
                }
            };
            avatar.traverse((obj) => {
                release(obj.geometry);
                if (Array.isArray(obj.material)) obj.material.forEach(release);
                else release(obj.material);
                if (obj.isLight || obj.type === 'PointLight') release(obj);
            });
        }

        removePlayer(peerId) {
            const player = this.players.get(peerId);
            if (player) {
                this.world.scene.remove(player.avatar);
                this.disposeAvatar(player.avatar);
                this.players.delete(peerId);
                this.showNotification(`Player left: ${player.username}`);
                this.updatePlayerCount();
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
