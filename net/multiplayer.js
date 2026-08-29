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

    // `from` on a guest is whatever the HOST typed, and a host is only ever whoever
    // sent you a link. Every id that legitimately reaches this code was minted by the
    // broker, so it lives in this alphabet; anything else is a member being invented.
    const PEER_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;
    // Each avatar is a Group with its own geometries, material, light and a canvas
    // texture, all resident on the GPU. A host looping `from:'x'+i` spends nothing and
    // takes the guest's tab with it, so there is a ceiling far above any real room.
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

        // Rebuild after a fatal error, backing off so a server having a bad minute is not hammered
        // by every open tab. Four tries over about half a minute, then it stops and says so —
        // a retry loop that never gives up is indistinguishable from a hang.
        _rebuildPeerSoon() {
            const waits = [2000, 5000, 12000, 20000];
            this._rebuilds = this._rebuilds || 0;
            if (this._rebuilds >= waits.length) {
                this._givingUp = true;
                this.showError('The signalling server did not come back after four tries, so '
                    + 'multiplayer is off for now. Reload when you want to try again — nothing else '
                    + 'on this page depends on it.');
                return;
            }
            const wait = waits[this._rebuilds++];
            const wasHost = this.isHost, oldRoom = this.roomId;
            this.updateStatus('Reconnecting…', false);
            clearTimeout(this._rebuildTimer);
            this._rebuildTimer = setTimeout(() => {
                try { if (this.peer && !this.peer.destroyed) this.peer.destroy(); } catch (e) {}
                try {
                    this.initializePeer();
                    if (wasHost && oldRoom) {
                        // said once, plainly: the old link is dead and a new one exists
                        this.showNotification('The room was rebuilt after the connection dropped — '
                            + 'your previous invite link no longer works. Share the new one.');
                    }
                } catch (e) { this.showError('Could not rebuild the connection: ' + (e.message || 'no reason given')); }
            }, wait);
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
                    this._rebuilds = 0; this._givingUp = false;   // a good open clears the backoff
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

                    // SAY WHICH THING BROKE. The fall-through used to be
                    // 'Connection error: ' + err.message, and peerjs leaves message EMPTY on the
                    // most common real failure — so a visitor whose signalling server was down
                    // read the words "Connection error:" and nothing else, while the peer was
                    // destroyed, no invite could be minted, and nothing said whether it would
                    // come back. Observed live: {type:'server-error', message:''}.
                    const t = err && err.type;
                    if (t === 'peer-unavailable') {
                        this.showError('That room is not open — the host may have closed their tab.');
                    } else if (t === 'network' || t === 'socket-error' || t === 'socket-closed') {
                        this.showError('Lost the connection to the signalling server. '
                            + 'Reload to try again — the world itself still works.');
                    } else if (t === 'server-error' || t === 'unavailable-id') {
                        this.showError('The signalling server is not answering, so nobody can join '
                            + 'or be joined right now. This is not your connection and not this world — '
                            + 'reload in a minute. Everything single-player keeps working.');
                    } else if (t === 'browser-incompatible') {
                        this.showError('This browser cannot do peer-to-peer, so multiplayer is unavailable here.');
                    } else {
                        // Never print an empty reason. If peerjs gives us nothing, say that.
                        const why = (err && err.message) || (t ? 'reported as "' + t + '"' : 'with no reason given');
                        this.showError('Multiplayer stopped: ' + why + '. The world itself still works.');
                    }

                    this.updateStatus('Error', false);

                    // A FATAL PEER ERROR DESTROYS THE PEER, AND A DESTROYED PEER CANNOT RECONNECT.
                    // The 'disconnected' handler below calls reconnect(), which is right for a
                    // dropped socket and useless here: after server-error the object is dead, so
                    // multiplayer stayed dead for the rest of the page load even when the
                    // signalling server came back seconds later. Build a NEW one, with backoff.
                    //
                    // A rebuilt HOST gets a new id, and the id IS the room — so anyone holding the
                    // old invite can no longer arrive. That is worth saying out loud rather than
                    // stranding them silently, which is why the retry announces the change.
                    const fatal = (t === 'server-error' || t === 'socket-error' || t === 'network'
                                   || t === 'socket-closed' || t === 'unavailable-id');
                    if (fatal && !this._givingUp) this._rebuildPeerSoon();
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
            // ONE dial per room. `peer.on('open')` is not a once-in-a-lifetime event: PeerJS
            // re-emits it every time the signalling socket comes back (reconnect() → _initialize
            // → the server's OPEN → emit('open')), and this class asks for that reconnect itself
            // three seconds after every 'disconnected'. Each of those re-openings used to dial
            // the host AGAIN, and a second channel from a peer the host has already admitted is
            // a channel it can never accept — its `hello` is ignored because it is already a
            // member — so it died in `pending` eight seconds later and took the live one with
            // it (see the ownership guard in the close handler below).
            if (this.connections.has(hostId) || this.dialling) return;
            this.dialling = true;
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
                    // An open channel is not yet a place in the room — the host has not looked at
                    // the invite yet, and closes the door on a bad one without sending a byte.
                    // Saying "Connected" here was the UI answering a question it had not asked;
                    // the honest word arrives with the host's first message (handlePeerData).
                    this.updateStatus('Proving invite...', false);
                });

                // A failure that arrives BEFORE the ten seconds are up has to cancel the timer,
                // or the user is told "the host may be offline" long after being told what
                // actually happened — two explanations for one event, the later one wrong.
                conn.on('close', () => { clearTimeout(connectionTimeout); this.dialling = false; });
                conn.on('error', () => { clearTimeout(connectionTimeout); this.dialling = false; });

                this.handleNewConnection(conn, true);    // outbound: we dialled the host
            } catch (error) {
                this.dialling = false;
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
                    //
                    // An unproven channel is a whole WebRTC peer connection the host is paying
                    // for on a stranger's say-so. The doorway is not unlimited.
                    if (this.pending.size >= 24) {
                        console.warn('Too many unproven channels waiting; refusing:', peerId);
                        try { conn.close(); } catch (e) {}
                        return;
                    }
                    // `pending` is keyed by peer id, so a peer that opens a SECOND channel used to
                    // displace its own first one out of the map — and the displaced channel's
                    // timer then found someone else's conn under its key, declined to act, and
                    // left an open connection nobody held a reference to. Close what we drop.
                    const prior = this.pending.get(peerId);
                    if (prior && prior !== conn) {
                        if (prior.__authTimer) clearTimeout(prior.__authTimer);
                        try { prior.close(); } catch (e) {}
                    }
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
                if (this.pending.get(peerId) === conn) this.pending.delete(peerId);

                // CLEANUP BELONGS TO THE CHANNEL THAT DIED, NOT TO ITS PEER ID. A second channel
                // from the same peer — a re-dial, or an unproven one shutting after eight
                // seconds — closed with the live member's id on it and deleted that member: the
                // avatar vanished and the room stopped believing in somebody whose connection was
                // still open and still sending. The 'error' handler below has always checked
                // this; this one did not, and it is the one that runs far more often.
                if (this.connections.get(peerId) !== conn) return;

                this.removePlayer(peerId);
                this.connections.delete(peerId);
                if (this.isHost) this.relayDeparture(peerId);
                if (this.rates) for (const k of [...this.rates.keys()]) if (k.endsWith(':' + peerId)) this.rates.delete(k);
                this.updatePlayerCount();
                if (!this.isHost && peerId === this.roomId) {
                    // Two different endings used to be reported with the same sentence. If the
                    // host never said one word to us the tab did not close — the invite was
                    // refused, which the host does silently and immediately for a token that is
                    // wrong or from a room that has since restarted. Sending someone to ask for a
                    // new link when the host is sitting right there is a false statement.
                    if (this.heardFromHost) {
                        this.updateStatus('Host left — room closed', false);
                        this.showError('The host closed their tab, so this room no longer exists. Ask for a new invite link.');
                    } else {
                        this.updateStatus('Invite refused', false);
                        this.showError('The host did not accept this invite. It is probably from an older link, or from a room that has since restarted — ask for a fresh one.');
                    }
                    // and the next attempt starts from not having heard anything, the same as
                    // the first one did
                    this.heardFromHost = false;
                }
            });

            conn.on('error', (err) => {
                // An error does not always arrive with a 'close' behind it, and a connection
                // left in the map is a player who is still standing there to everyone else.
                console.error('Connection error with peer', peerId, ':', err);
                if (conn.__authTimer) clearTimeout(conn.__authTimer);
                if (this.pending.get(peerId) === conn) this.pending.delete(peerId);
                if (this.connections.get(peerId) === conn) {
                    this.connections.delete(peerId);
                    if (this.isHost) this.relayDeparture(peerId);
                    this.removePlayer(peerId);
                    if (this.rates) for (const k of [...this.rates.keys()]) if (k.endsWith(':' + peerId)) this.rates.delete(k);
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

        // A budget: at most `n` messages of one kind from one peer in any `ms` window. Beyond
        // that they are dropped, silently — a warning per drop would be the flood. This exists
        // because the host is the only machine in the room that turns one message into many, and
        // because every message that gets through here costs a DOM node for three seconds.
        allowRate(peerId, kind, n, ms) {
            const key = kind + ':' + peerId;
            const now = Date.now();
            const live = ((this.rates = this.rates || new Map()).get(key) || []).filter((t) => now - t < ms);
            this.rates.set(key, live);
            if (live.length >= n) return false;
            live.push(now);
            return true;
        }

        handlePeerData(peerId, data, conn) {
            // EVERYTHING BELOW ARRIVED FROM ANOTHER MACHINE. `null`, a number and a bare string
            // are all things a peer is free to send, and every one of them threw on `data.type`.
            // The throw was caught one level up, so nothing crashed — but a swallowed exception
            // is not a decision about hostile input, it is the absence of one.
            if (!data || typeof data !== 'object') return;

            // The first word from the host is what tells a joiner it is actually IN the room, as
            // opposed to holding an open channel the host has not judged yet. Both the status
            // line and the close message below turn on this one fact.
            if (!this.isHost && peerId === this.roomId && !this.heardFromHost) {
                this.heardFromHost = true;
                this.updateStatus('Connected', true);
            }

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
                    // Who this update is about, resolved FIRST because everything below is
                    // about that peer and not about the connection it arrived on. On the host
                    // the connection IS the author; a joiner hears about everyone except the
                    // host second-hand and takes the host's stamp, exactly as it does for chat.
                    // Keying the rename on the connection instead would have let a relayed
                    // update rename the HOST with somebody else's name.
                    const who = this.isHost ? peerId : (data.from || peerId);
                    if (typeof who !== 'string' || !PEER_ID_SHAPE.test(who)) break;
                    if (who === (this.peer && this.peer.id)) break;      // never a body for myself

                    // A rename is not free: it burns a canvas, a texture upload and a material
                    // every time, and the PEER chooses how often it happens. Twenty a second is
                    // not somebody correcting their name, it is somebody making the host draw.
                    const known = this.players.get(who);
                    if (data.username && known && Date.now() - (known.lastRename || 0) >= 1000) {
                        const claimed = this.uniqueName(who, data.username);
                        if (known.username !== claimed) {
                            known.lastRename = Date.now();
                            known.username = claimed;
                            try { if (known.avatar && this.createNameTag) {           // re-tag the body above their head
                                const old = known.avatar.getObjectByName('nametag');
                                if (old) { known.avatar.remove(old); this.disposeObject(old); }
                                const tag = this.createNameTag(who, { username: claimed });
                                if (tag) { tag.name = 'nametag'; tag.position.y = 3; known.avatar.add(tag); }
                            } } catch (e) {}
                        }
                    }
                    // A relayed peer has no connection here, so acceptConnection never ran for
                    // it and it has no body. Give it one the first time it is heard from —
                    // without this, chat crosses between two joiners but nothing else does:
                    // they share a room and remain invisible to each other.
                    if (!this.players.has(who)) {
                        if (this.players.size >= MAX_PLAYER_BODIES) {
                            if (!this.mintCapReported) {
                                this.mintCapReported = true;
                                console.warn('[nexus] refusing to build more than ' + MAX_PLAYER_BODIES
                                           + ' player bodies — this room claims more members than a room can have');
                            }
                        } else {
                            this.createPlayerAvatar(who, { username: data.username });
                            this.updatePlayerCount();
                        }
                    }
                    if (data.position) this.updatePlayerPosition(who, data.position, data.rotation);

                    // The room is a star: every joiner is wired only to the host. Presence has
                    // to be passed on for the same reason chat does, and on the same budget —
                    // it is the host's uplink either way.
                    if (this.isHost && this.allowRate(peerId, 'presence', 40, 5000)) {
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

                case 'playerLeft':
                    // Only the host is wired to everyone, so only the host can tell the room
                    // that somebody went. Without it a guest keeps a motionless body forever.
                    if (!this.isHost && typeof data.who === 'string' && PEER_ID_SHAPE.test(data.who)) {
                        this.removePlayer(data.who);
                        this.updatePlayerCount();
                    }
                    break;

                case 'chat': {
                    // A message may be addressed. Show it if it is for the room or for me...
                    const mine = this.peer && this.peer.id;
                    // `from` is a claim. The host knows better: the connection a message
                    // arrived on IS its author, so a joiner cannot dress a line up as someone
                    // else's. Only a joiner, which hears everything second-hand through the
                    // host, has to take the relayed attribution on trust.
                    const from = this.isHost ? peerId : (data.from || peerId);
                    // An address is a peer id or nothing. Anything else is not a message for
                    // somebody, and letting it fall through would have turned a junk `to` into a
                    // room-wide broadcast of a line meant to be private.
                    if (data.to != null && typeof data.to !== 'string') return;
                    const to = data.to || null;
                    // THE RELAY IS THE AMPLIFIER: one message in, one per member out, paid for by
                    // the host's uplink. It used to forward whatever arrived, at whatever length
                    // and whatever rate, so a single peer's five megabytes became five megabytes
                    // times the room. Nothing here ever says more than a couple of hundred
                    // characters — autodrive's `tell` clamps at 240, displayChat keeps 200 — so a
                    // 500-character wire is everything anyone can see and nothing they cannot.
                    const message = String(data.message == null ? '' : data.message).slice(0, 500);
                    if (this.isHost && !this.allowRate(peerId, 'chat', 20, 5000)) return;
                    if (!to || to === mine) this.displayChat(from, message);
                    // ...and if I am the host, pass it on: joiners are connected only to me, so
                    // without this relay two joiners can never hear each other at all.
                    if (this.isHost) {
                        this.connections.forEach((c, id) => {
                            if (id === peerId) return;
                            if (to && to !== id) return;
                            try { c.send({ type: 'chat', message, from, to }); } catch (e) {}
                        });
                    }
                    break;
                }

                case 'interaction':
                    if (!this.allowRate(peerId, 'interaction', 10, 5000)) break;
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

        // The same latent birth defect displayChat had: handlePeerData has dispatched every
        // 'interaction' message to this method since day one and nothing anywhere ever defined
        // it, so each one threw inside the data handler and was swallowed by the try/catch in
        // handleNewConnection. The feature has never once run in any copy of this class.
        showPlayerInteraction(peerId, target) {
            const who = this.players.get(peerId)?.username || String(peerId).slice(0, 6);
            const what = String(target == null ? 'something' : target).slice(0, 60);
            (this.interactions = this.interactions || []).push({ from: String(peerId).slice(0, 6), target: what });
            if (this.interactions.length > 12) this.interactions = this.interactions.slice(-12);
            this.showNotification(`${who} used ${what}`);
        }

        // scene.remove() unhooks an object; it does not give the GPU anything back. The host is
        // the tab that runs for hours across many joiners, and every avatar body, every point
        // light and every name-tag texture it ever built stayed resident — including one texture
        // per rename, which a peer decides the rate of.
        disposeObject(obj) {
            if (!obj) return;
            // Two things this has to get right, and both are about ownership rather than
            // thoroughness. A body and its head share ONE material, so a plain traversal
            // disposes it twice; and in three.js r128 every Sprite on the page shares one
            // module-level BufferGeometry, so releasing "this avatar's" nametag quad tears
            // down the buffers behind every other nametag AND every label the world itself
            // placed. The renderer re-uploads, so nothing stays blank — it just churns the
            // whole page's sprite buffers on every departure, which is the opposite of what
            // disposing is for. The material and its canvas texture ARE ours; the quad is not.
            const seen = new Set();
            const killMaterial = (m) => {
                if (!m || seen.has(m)) return;
                seen.add(m);
                if (m.map && m.map.dispose && !seen.has(m.map)) { seen.add(m.map); m.map.dispose(); }
                if (m.dispose) m.dispose();
            };
            const killOne = (o) => {
                const isSprite = o.isSprite || o.type === 'Sprite';
                if (!isSprite && o.geometry && o.geometry.dispose && !seen.has(o.geometry)) {
                    seen.add(o.geometry); o.geometry.dispose();
                }
                if (Array.isArray(o.material)) o.material.forEach(killMaterial);
                else killMaterial(o.material);
                if ((o.isLight || o.type === 'PointLight') && o.dispose && !seen.has(o)) {
                    seen.add(o); o.dispose();
                }
            };
            if (typeof obj.traverse === 'function') obj.traverse(killOne);
            else killOne(obj);
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

            // Name tag. It has to carry the name the rename path looks it up BY: without this
            // getObjectByName('nametag') found nothing the first time somebody changed their
            // name, so the new label was hung beside the original instead of replacing it and
            // the old name stayed legible underneath it for the rest of the session.
            const nameTag = this.createNameTag(peerId, metadata);
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

            // EVERY NUMBER HERE CAME FROM ANOTHER MACHINE, AND ONE OF THEM IS PERMANENT. A NaN
            // or an Infinity does not make an avatar jump: lerp() folds it straight back into
            // .position, and from that frame on the body's matrix is NaN forever — it never
            // returns even when the peer starts telling the truth again, it is culled out of the
            // scene, and index.html clones that same position into the scene recorder every
            // frame. A missing field was a different kind of loss: `position.x` threw, and the
            // catch one level up ate the whole message including the rotation.
            const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
            const px = num(position && position.x);
            const py = num(position && position.y);
            const pz = num(position && position.z);
            if (px === null || py === null || pz === null) return;

            // Smooth interpolation
            const targetPos = new THREE.Vector3(px, py, pz);
            player.avatar.position.lerp(targetPos, 0.3);

            // Update rotation
            const ry = num(rotation && rotation.y);
            if (ry !== null) player.avatar.rotation.y = ry;

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
                        // `type` last, not first. Spread over it and any caller handing this a
                        // payload with its own `type` field was silently sending a message of
                        // whatever kind it liked through the AI-presence door — including one
                        // the host would relay.
                        conn.send(Object.assign({}, aiData, { type: 'ai_companion' }));
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

        // The host is the only tab wired to everyone, so a departure reaches the rest of
        // the room only if the host passes it on — the presence twin of the chat relay.
        relayDeparture(goneId) {
            this.connections.forEach((c, id) => {
                if (id === goneId) return;
                try { c.send({ type: 'playerLeft', who: goneId }); } catch (e) {}
            });
        }

        updatePlayerCount() {
            // Everyone I know of: the peers I am wired to, plus the ones the host has told
            // me about. On the host those are the same set; on a joiner they are not, and
            // counting only my own wires reported "2 players" in a room of three.
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

        removePlayer(peerId) {
            const player = this.players.get(peerId);
            if (player) {
                this.world.scene.remove(player.avatar);
                this.disposeObject(player.avatar);
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

            // Remove inactive players — meaning players with no LIVE channel behind them.
            // Silence on an open connection is not absence, and reaping on it alone was a one-way
            // door: nothing in this class builds an avatar after the handshake, so once the body
            // was deleted updatePlayerPosition returned early on every message that peer sent for
            // the rest of the room's life. Five seconds is nothing — a backgrounded tab throttles
            // the frame loop that sends these — and the count went on counting the person who had
            // just been made invisible.
            //
            // A channel that died without ever saying 'close' is the other half, and it is why
            // this looks at `conn.open` rather than merely at the map: a member whose data
            // channel is gone must stop being counted, not just stop being drawn.
            const now = Date.now();
            this.players.forEach((player, peerId) => {
                if (now - player.lastUpdate <= 5000) return;
                const conn = this.connections.get(peerId);
                if (conn && conn.open !== false) return;
                if (conn) { this.connections.delete(peerId); this.updatePlayerCount(); }
                this.removePlayer(peerId);
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
