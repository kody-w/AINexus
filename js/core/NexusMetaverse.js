import { Entity, EntityType, EntityState, ControlMode } from '../entities/Entity.js';
import { Entity, EntityType, EntityState, ControlMode } from '../entities/Entity.js';
export default class NexusMetaverse {
    constructor() {
        // Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();

        // Entity management
        this.entities = new Map();
        this.localEntity = null; // The human player
        this.observedEntity = null;
        this.controlMode = ControlMode.OBSERVE;

        // Multiplayer
        this.peer = null;
        this.connections = new Map();
        this.roomId = null;
        this.isHost = false;

        // World objects
        this.worldObjects = [];
        this.selectedObject = null;

        // Mode
        this.currentMode = 'explore'; // explore, observe, build

        // Controls
        this.keys = { w: false, a: false, s: false, d: false };
        this.isPointerLocked = false;
        this.moveSpeed = 0.15;
        this.lookSpeed = 0.002;

        // Possession state
        this.prePossessionState = null; // Stores camera state before takeover

        // Minimap
        this.minimapCtx = null;

        // Entity POV camera and renderer
        this.povCamera = null;
        this.povRenderer = null;

        // Reality Portal (webcam for AI perception)
        this.realityMirror = {
            enabled: false,
            stream: null,
            video: null,
            canvas: null,
            ctx: null,
            aiGazeActive: false,
            lastPerception: null,
            lastImageData: null, // For motion detection
            lastCapture: null, // Last captured frame data
            perceptionInterval: null,
            captureInterval: 3000  // How often AI "looks" at reality
        };

        // Spatial Relationship Visualization (CYCLE 2 Enhancement)
        this.relationshipLines = new Map(); // entityId -> Line object
        this.relationshipLinePool = []; // Pre-allocated line pool to prevent GC churn
        this.chatBubbles = []; // CYCLE 4: Active 3D chat bubbles
        this.relationshipLinesMaterial = new THREE.LineBasicMaterial({
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            fog: false
        });

        // Pre-allocated Vector3 pool (prevents per-frame allocations)
        this._vecPool = {
            forward: new THREE.Vector3(),
            right: new THREE.Vector3(),
            up: new THREE.Vector3(0, 1, 0),
            moveVector: new THREE.Vector3(),
            tempPos: new THREE.Vector3(),
            slideX: new THREE.Vector3(),
            slideZ: new THREE.Vector3(),
            // CYCLE 3: Additional pooled vectors for hot paths
            entityPos: new THREE.Vector3(),
            screenPos: new THREE.Vector3(),
            toEntity: new THREE.Vector3(),
            cameraDir: new THREE.Vector3(),
            // CYCLE 4: Observation viewport vectors
            observationLookTarget: new THREE.Vector3(),
            observationForward: new THREE.Vector3()
        };

        // CYCLE 4: Cached DOM element references (prevents per-frame getElementById)
        this._cachedDOMElements = {
            obsStatusText: null,
            obsStatusDot: null
        };

        // Post-processing for bloom effects
        this.composer = null;
        this.bloomPass = null;
        this.bloomEnabled = true;

        // Shared Knowledge Base (CYCLE 2 Enhancement)
        this.sharedKnowledge = {
            entries: [], // { timestamp, entityId, entityName, type, content, discovered }
            maxEntries: 100
        };

        // UI Elements
        this.entityListEl = document.getElementById('entity-list');
        this.activityLogEl = document.getElementById('activity-log');
        this.chatMessagesEl = document.getElementById('chat-messages');

        // Performance monitoring
        this.perfStats = {
            fps: 0,
            frameCount: 0,
            lastTime: performance.now(),
            fpsUpdateInterval: 500, // Update FPS every 500ms
            renderMode: 'both' // 'both', 'main', 'pov'
        };

        // Audio System
        this.audio = {
            context: null,
            enabled: false,
            ambientGain: null,
            effectsGain: null,
            ambientOscillators: [],
            masterVolume: 0.3
        };

        // MediaPipe (for Reality Portal gestures)
        this.mediaPipe = {
            enabled: false,
            hands: null,
            camera: null,
            gestureCanvas: null,
            gestureCtx: null,
            lastGesture: null,
            gestureHoldTime: 0,
            gestureStartTime: 0,
            gestureThreshold: 500, // Hold gesture for 500ms to trigger action
            cooldown: false,
            cooldownTime: 1000, // 1 second cooldown between actions
            gestureCallbacks: [],
            // Gesture-to-action mappings
            gestureActions: {
                'thumbs_up': { action: 'approve', icon: '👍', name: 'Approve / Yes' },
                'thumbs_down': { action: 'reject', icon: '👎', name: 'Reject / No' },
                'open_palm': { action: 'stop', icon: '✋', name: 'Stop / Pause' },
                'fist': { action: 'grab', icon: '✊', name: 'Grab / Select' },
                'peace': { action: 'peace', icon: '✌️', name: 'Peace / Toggle' },
                'pointing': { action: 'point', icon: '👆', name: 'Point / Select' },
                'wave': { action: 'wave', icon: '👋', name: 'Wave / Hello' }
            },
            // Virtual cursor system (pinch-to-select)
            cursor: {
                enabled: true,
                element: null,
                trailElement: null,
                position: { x: 0.5, y: 0.5 },
                screenPosition: { x: 0, y: 0 },
                smoothPosition: { x: 0.5, y: 0.5 },
                smoothing: 0.25,
                visible: false,
                isPinching: false,
                wasPinching: false,
                pinchProgress: 0,
                pinchThreshold: 0.08,
                pinchStartTime: 0,
                hoveredElement: null,
                lastClickTime: 0,
                clickCooldown: 300,
                mode: 'fullscreen', // 'portal' or 'fullscreen'
                trail: [] // Position history for trail effect
            }
        };
    }

    async init() {
        try {
            // CYCLE 3: Load saved state before setup
            const savedState = this.loadPersistentState();
            this.applyPersistentState(savedState);

            this.setupScene();
            this.createEnvironment();
            this.setupControls();
            this.setupMinimap();
            this.setupPOVCamera();
            this.setupRealityMirror();
            this.setupClickInteraction();
            this.setupAudio();
            this.setupUI();
            await this.setupMultiplayer();
            this.createLocalPlayer();
            this.spawnDemoAIs();

            // Fix Three.js r134 fog uniform errors by disabling fog on all materials
            this.disableFogOnAllMaterials();

            // CYCLE 3: Initialize persistence (auto-save timer)
            this.initPersistence();

            // CYCLE 4: Initialize achievement system
            this.initAchievements();

            this.animate();
        } catch (e) {
            console.error('Initialization error:', e);
        } finally {
            // Always hide loading screen
            document.getElementById('loading').style.display = 'none';
        }
    }

    // Fix Three.js r134 fog uniform issues by disabling fog on all materials
    disableFogOnAllMaterials() {
        let count = 0;
        this.scene.traverse((obj) => {
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(mat => {
                    if (mat.fog !== false) {
                        mat.fog = false;
                        mat.needsUpdate = true;
                        count++;
                    }
                });
            }
        });
        console.log(`[Init] Disabled fog on ${count} materials`);
    }

    // ===========================================
    // PERSISTENCE SYSTEM (CYCLE 3)
    // ===========================================
    static STORAGE_KEY = 'nexus_metaverse_save';
    static STORAGE_VERSION = 1;

    loadPersistentState() {
        try {
            const saved = localStorage.getItem(NexusMetaverse.STORAGE_KEY);
            if (!saved) return null;

            const data = JSON.parse(saved);
            if (data.version !== NexusMetaverse.STORAGE_VERSION) {
                console.log('[Persistence] Version mismatch, starting fresh');
                return null;
            }

            console.log('[Persistence] Loaded saved state');
            return data;
        } catch (e) {
            console.warn('[Persistence] Failed to load:', e);
            return null;
        }
    }

    savePersistentState() {
        try {
            const data = {
                version: NexusMetaverse.STORAGE_VERSION,
                timestamp: Date.now(),
                player: {
                    position: this.localEntity ? {
                        x: this.localEntity.position.x,
                        y: this.localEntity.position.y,
                        z: this.localEntity.position.z
                    } : null,
                    rotation: this.yaw || 0
                },
                preferences: {
                    bloomEnabled: this.bloomEnabled,
                    minimapVisible: this.minimapCanvas?.style.display !== 'none'
                },
                stats: {
                    totalPlayTime: (this._playTimeStart ? Date.now() - this._playTimeStart : 0) + (this._totalPlayTime || 0),
                    sessionsPlayed: (this._sessionsPlayed || 0) + 1
                }
            };

            localStorage.setItem(NexusMetaverse.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('[Persistence] Failed to save:', e);
        }
    }

    applyPersistentState(saved) {
        if (!saved) return;

        // Apply player position (will be used after local player is created)
        if (saved.player?.position) {
            this._savedPosition = saved.player.position;
            this._savedRotation = saved.player.rotation;
        }

        // Apply preferences
        if (saved.preferences) {
            if (saved.preferences.bloomEnabled === false) {
                this.bloomEnabled = false;
            }
        }

        // Apply stats
        if (saved.stats) {
            this._totalPlayTime = saved.stats.totalPlayTime || 0;
            this._sessionsPlayed = saved.stats.sessionsPlayed || 0;
        }

        console.log(`[Persistence] Welcome back! Session #${this._sessionsPlayed + 1}`);
    }

    initPersistence() {
        this._playTimeStart = Date.now();

        // Auto-save every 30 seconds
        this._persistenceTimer = setInterval(() => {
            this.savePersistentState();
        }, 30000);

        // Track timer for cleanup
        if (!this._activeTimers) this._activeTimers = new Set();
        this._activeTimers.add(this._persistenceTimer);

        // Save on page unload
        window.addEventListener('beforeunload', () => {
            this.savePersistentState();
        });
    }

    // ===========================================
    // ACHIEVEMENT SYSTEM (CYCLE 4)
    // ===========================================
    static ACHIEVEMENTS = {
        first_steps: { id: 'first_steps', name: 'First Steps', icon: '👟', description: 'Moved for the first time', points: 10 },
        social_butterfly: { id: 'social_butterfly', name: 'Social Butterfly', icon: '🦋', description: 'Sent your first chat message', points: 15 },
        ai_whisperer: { id: 'ai_whisperer', name: 'AI Whisperer', icon: '🤖', description: 'Had a conversation with an AI entity', points: 20 },
        explorer: { id: 'explorer', name: 'Explorer', icon: '🧭', description: 'Traveled 500 meters total', points: 25 },
        speedster: { id: 'speedster', name: 'Speedster', icon: '⚡', description: 'Used sprint for 30 seconds', points: 15 },
        observer: { id: 'observer', name: 'Observer', icon: '👁️', description: 'Observed an AI entity', points: 20 },
        possession: { id: 'possession', name: 'Mind Meld', icon: '🧠', description: 'Took control of an AI entity', points: 30 },
        connector: { id: 'connector', name: 'Connector', icon: '🔗', description: 'Connected to a multiplayer room', points: 25 },
        veteran: { id: 'veteran', name: 'Veteran', icon: '⭐', description: 'Played 5 sessions', points: 40 },
        marathon: { id: 'marathon', name: 'Marathon', icon: '🏃', description: 'Played for 30 minutes total', points: 50 }
    };

    static ACHIEVEMENT_STORAGE_KEY = 'nexus_achievements';

    initAchievements() {
        // Load unlocked achievements
        try {
            const saved = localStorage.getItem(NexusMetaverse.ACHIEVEMENT_STORAGE_KEY);
            this.unlockedAchievements = saved ? JSON.parse(saved) : {};
        } catch (e) {
            this.unlockedAchievements = {};
        }

        // Progress tracking
        this.achievementProgress = {
            distanceTraveled: 0,
            sprintTime: 0,
            chatsSent: 0,
            aiConversations: 0,
            hasMoved: false
        };

        // Create achievement notification container
        const notifContainer = document.createElement('div');
        notifContainer.id = 'achievement-notifications';
        notifContainer.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 10000;
            pointer-events: none;
        `;
        document.body.appendChild(notifContainer);

        console.log(`[Achievements] Loaded ${Object.keys(this.unlockedAchievements).length} achievements`);
    }

    unlockAchievement(achievementId) {
        const achievement = NexusMetaverse.ACHIEVEMENTS[achievementId];
        if (!achievement || this.unlockedAchievements[achievementId]) return;

        this.unlockedAchievements[achievementId] = {
            unlockedAt: Date.now(),
            points: achievement.points
        };

        // Save to localStorage
        try {
            localStorage.setItem(
                NexusMetaverse.ACHIEVEMENT_STORAGE_KEY,
                JSON.stringify(this.unlockedAchievements)
            );
        } catch (e) {
            console.warn('[Achievements] Failed to save:', e);
        }

        // Show notification
        this.showAchievementNotification(achievement);

        console.log(`[Achievements] Unlocked: ${achievement.name}`);
    }

    showAchievementNotification(achievement) {
        const container = document.getElementById('achievement-notifications');
        if (!container) return;

        const notif = document.createElement('div');
        notif.style.cssText = `
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 2px solid #ffd700;
            border-radius: 12px;
            padding: 16px 20px;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 12px;
            animation: achievementSlideIn 0.5s ease-out;
            box-shadow: 0 4px 20px rgba(255, 215, 0, 0.3);
        `;
        notif.innerHTML = `
            <div style="font-size: 32px;">${achievement.icon}</div>
            <div>
                <div style="color: #ffd700; font-weight: bold; font-size: 14px;">ACHIEVEMENT UNLOCKED</div>
                <div style="color: white; font-size: 16px; font-weight: bold;">${achievement.name}</div>
                <div style="color: #aaa; font-size: 12px;">${achievement.description}</div>
            </div>
            <div style="color: #ffd700; font-size: 18px; font-weight: bold;">+${achievement.points}</div>
        `;

        container.appendChild(notif);

        // Remove after animation
        setTimeout(() => {
            notif.style.animation = 'achievementSlideOut 0.5s ease-in forwards';
            setTimeout(() => notif.remove(), 500);
        }, 4000);
    }

    checkAchievements() {
        // First Steps - moved for the first time
        if (this.achievementProgress.hasMoved) {
            this.unlockAchievement('first_steps');
        }

        // Explorer - traveled 500 meters
        if (this.achievementProgress.distanceTraveled >= 500) {
            this.unlockAchievement('explorer');
        }

        // Speedster - sprinted for 30 seconds
        if (this.achievementProgress.sprintTime >= 30) {
            this.unlockAchievement('speedster');
        }

        // Veteran - 5 sessions
        if ((this._sessionsPlayed || 0) >= 5) {
            this.unlockAchievement('veteran');
        }

        // Marathon - 30 minutes total playtime
        const totalTime = (this._totalPlayTime || 0) + (this._playTimeStart ? Date.now() - this._playTimeStart : 0);
        if (totalTime >= 30 * 60 * 1000) {
            this.unlockAchievement('marathon');
        }
    }

    getAchievementScore() {
        return Object.values(this.unlockedAchievements).reduce((sum, a) => sum + (a.points || 0), 0);
    }

    // ===========================================
    // SCENE SETUP
    // ===========================================
    setupScene() {
        this.scene = new THREE.Scene();
        // Fog disabled - was causing uniform errors with Three.js r134
        // this.scene.fog = new THREE.Fog(0x0a0a0f, 30, 100);

        // Create starfield skybox for immersive space atmosphere
        this.createStarfield();

        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 2, 10);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.renderer.toneMappingExposure = 1.2;
        document.getElementById('canvas-container').appendChild(this.renderer.domElement);

        // Setup bloom post-processing
        this.setupBloom();

        // Lighting
        const ambient = new THREE.AmbientLight(0x404060, 0.5);
        this.scene.add(ambient);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(20, 40, 20);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        this.scene.add(dirLight);

        // Hemisphere light for better ambient
        const hemiLight = new THREE.HemisphereLight(0x4488ff, 0x002244, 0.4);
        this.scene.add(hemiLight);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            if (this.composer) {
                this.composer.setSize(window.innerWidth, window.innerHeight);
            }
        });
    }

    // Setup bloom post-processing for ethereal glow effects
    setupBloom() {
        try {
            // Check if post-processing classes are available
            if (typeof THREE.EffectComposer === 'undefined') {
                console.warn('[Bloom] EffectComposer not available, skipping bloom');
                this.bloomEnabled = false;
                return;
            }

            const renderScene = new THREE.RenderPass(this.scene, this.camera);

            this.bloomPass = new THREE.UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                0.5,    // Bloom strength
                0.4,    // Radius
                0.85    // Threshold
            );

            this.composer = new THREE.EffectComposer(this.renderer);
            this.composer.addPass(renderScene);
            this.composer.addPass(this.bloomPass);

            console.log('[Bloom] Post-processing initialized');
        } catch (e) {
            console.warn('[Bloom] Failed to initialize:', e.message);
            this.bloomEnabled = false;
        }
    }

    createStarfield() {
        // Create a sphere of stars around the scene
        const starCount = 3000;
        const starGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);

        const colorPalette = [
            new THREE.Color(0xffffff), // White
            new THREE.Color(0xaaddff), // Blue-white
            new THREE.Color(0xffddaa), // Warm
            new THREE.Color(0xaaffff), // Cyan tint
            new THREE.Color(0xffaaff)  // Purple tint
        ];

        for (let i = 0; i < starCount; i++) {
            // Distribute stars on a large sphere around the scene
            const radius = 400 + Math.random() * 100;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.cos(phi);
            positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

            // Random color from palette
            const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            // Varying sizes for depth effect
            sizes[i] = 0.5 + Math.random() * 2;
        }

        starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const starMaterial = new THREE.PointsMaterial({
            size: 2,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            fog: false
        });

        this.starfield = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(this.starfield);

        // Add a subtle nebula glow in the background
        this.createNebulaBackground();
    }

    createNebulaBackground() {
        // Create a large sphere with gradient for nebula effect
        const nebulaGeo = new THREE.SphereGeometry(350, 32, 32);
        const nebulaMat = new THREE.ShaderMaterial({
            uniforms: {
                color1: { value: new THREE.Color(0x0a0a1a) },
                color2: { value: new THREE.Color(0x1a0a2a) },
                color3: { value: new THREE.Color(0x0a1a2a) }
            },
            vertexShader: `
                varying vec3 vPosition;
                void main() {
                    vPosition = position;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 color1;
                uniform vec3 color2;
                uniform vec3 color3;
                varying vec3 vPosition;
                void main() {
                    float t = (vPosition.y + 350.0) / 700.0;
                    vec3 color = mix(color1, color2, smoothstep(0.0, 0.5, t));
                    color = mix(color, color3, smoothstep(0.5, 1.0, t));
                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            fog: false
        });

        const nebula = new THREE.Mesh(nebulaGeo, nebulaMat);
        this.scene.add(nebula);
    }

    createEnvironment() {
        // Ground plane with grid
        const groundGeo = new THREE.PlaneGeometry(200, 200);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x111122,
            roughness: 0.9
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // Grid overlay
        const grid = new THREE.GridHelper(200, 100, 0x00d4ff, 0x1a1a2e);
        grid.position.y = 0.01;
        // Disable fog on grid materials to prevent uniform errors
        if (grid.material) {
            if (Array.isArray(grid.material)) {
                grid.material.forEach(m => m.fog = false);
            } else {
                grid.material.fog = false;
            }
        }
        this.scene.add(grid);

        // Central hub platform
        const platformGeo = new THREE.CylinderGeometry(8, 10, 0.5, 32);
        const platformMat = new THREE.MeshStandardMaterial({
            color: 0x2a2a4a,
            metalness: 0.5,
            roughness: 0.3
        });
        const platform = new THREE.Mesh(platformGeo, platformMat);
        platform.position.y = 0.25;
        platform.castShadow = true;
        platform.receiveShadow = true;
        this.scene.add(platform);

        // Portal ring on platform
        const ringGeo = new THREE.TorusGeometry(6, 0.3, 16, 100);
        const ringMat = new THREE.MeshStandardMaterial({
            color: 0x00d4ff,
            emissive: 0x00d4ff,
            emissiveIntensity: 0.5
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.6;
        this.scene.add(ring);

        // Ambient particles
        this.createParticleField();

        // Some environmental structures
        this.createWorldStructures();
    }

    createParticleField() {
        const particleCount = 500;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 100;
            positions[i * 3 + 1] = Math.random() * 30;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 100;

            const color = new THREE.Color();
            color.setHSL(0.55 + Math.random() * 0.1, 0.8, 0.6);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const particleMat = new THREE.PointsMaterial({
            size: 0.2,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            fog: false // Disable fog to prevent uniform errors
        });

        this.particles = new THREE.Points(particleGeo, particleMat);
        this.scene.add(this.particles);
    }

    createWorldStructures() {
        // Create some interesting structures around the hub
        const structures = [
            { pos: [20, 0, 0], type: 'tower' },
            { pos: [-20, 0, 0], type: 'dome' },
            { pos: [0, 0, 20], type: 'arch' },
            { pos: [0, 0, -20], type: 'pillar' }
        ];

        structures.forEach(s => {
            let mesh;
            const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.4);

            if (s.type === 'tower') {
                const geo = new THREE.CylinderGeometry(2, 3, 15, 8);
                const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.3 });
                mesh = new THREE.Mesh(geo, mat);
                mesh.position.y = 7.5;
            } else if (s.type === 'dome') {
                const geo = new THREE.SphereGeometry(5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
                const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, side: THREE.DoubleSide });
                mesh = new THREE.Mesh(geo, mat);
                mesh.position.y = 0;
            } else if (s.type === 'arch') {
                const geo = new THREE.TorusGeometry(5, 1, 16, 32, Math.PI);
                const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4 });
                mesh = new THREE.Mesh(geo, mat);
                mesh.rotation.x = Math.PI / 2;
                mesh.position.y = 5;
            } else {
                const geo = new THREE.CylinderGeometry(1, 1, 10, 6);
                const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.3 });
                mesh = new THREE.Mesh(geo, mat);
                mesh.position.y = 5;
            }

            mesh.position.x = s.pos[0];
            mesh.position.z = s.pos[2];
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.worldObjects.push(mesh);
        });
    }

    // ===========================================
    // ENTITY MANAGEMENT
    // ===========================================
    createLocalPlayer() {
        const id = 'local-' + Math.random().toString(36).substr(2, 9);

        // CYCLE 3: Use saved position if available
        const startPos = this._savedPosition || { x: 0, y: 0, z: 10 };
        this.localEntity = new Entity(id, 'You', EntityType.HUMAN, startPos);
        this.localEntity.avatar = this.createAvatar(EntityType.HUMAN, 0x00d4ff, id);
        this.localEntity.avatar.position.set(startPos.x, startPos.y, startPos.z);
        this.scene.add(this.localEntity.avatar);
        this.entities.set(id, this.localEntity);

        // Apply saved camera rotation
        if (this._savedRotation !== undefined) {
            this.yaw = this._savedRotation;
        }

        // Add floating name tag
        this.addNameTagToEntity(this.localEntity);

        this.updateEntityList();

        // Store reference for when user possesses another entity
        this.userOriginalAvatar = this.localEntity.avatar;
    }

    // AI Personality profiles for distinct behaviors
    static AI_PERSONALITIES = {
        Atlas: {
            type: 'guardian',
            traits: ['protective', 'analytical', 'stoic'],
            greetings: [
                "Greetings, traveler. All systems nominal.",
                "I've been monitoring your approach. Welcome.",
                "The Nexus is secure. How may I assist?"
            ],
            workPhrases: [
                "Scanning perimeter...",
                "Analyzing threat vectors...",
                "Monitoring system integrity...",
                "Running security diagnostics..."
            ],
            wanderRadius: 8,
            thinkDuration: 3000,
            color: 0x4488ff
        },
        Nova: {
            type: 'curious',
            traits: ['inquisitive', 'energetic', 'creative'],
            greetings: [
                "Oh! Hello there! I was just studying something fascinating!",
                "Perfect timing! I have so many questions!",
                "Welcome! Have you seen any interesting patterns lately?"
            ],
            workPhrases: [
                "Ooh, this data is fascinating!",
                "I wonder what this means...",
                "Discovering new patterns!",
                "Running creative analysis..."
            ],
            wanderRadius: 12,
            thinkDuration: 1500,
            color: 0xff44aa
        },
        Echo: {
            type: 'helpful',
            traits: ['empathetic', 'responsive', 'calm'],
            greetings: [
                "Hello! I'm here to help with anything you need.",
                "Welcome to the Nexus. How can I assist you today?",
                "I sensed your presence. Is there something I can do for you?"
            ],
            workPhrases: [
                "Processing requests with care...",
                "Listening for user needs...",
                "Ready to assist...",
                "Monitoring communication channels..."
            ],
            wanderRadius: 6,
            thinkDuration: 2000,
            color: 0x44ffaa
        }
    };

    spawnDemoAIs() {
        // Create AI entities with distinct personalities
        const aiConfigs = [
            { name: 'Atlas', task: 'Monitoring system resources', pos: { x: 5, y: 0, z: 5 } },
            { name: 'Nova', task: 'Analyzing data patterns', pos: { x: -5, y: 0, z: 5 } },
            { name: 'Echo', task: 'Processing user requests', pos: { x: 0, y: 0, z: -5 } }
        ];

        aiConfigs.forEach(config => {
            const entity = this.createAIEntity(config.name, config.task, config.pos);
            // Assign personality profile
            entity.personality = NexusMetaverse.AI_PERSONALITIES[config.name] || null;
            // Track last interaction time for proactive behaviors
            entity.lastPlayerInteraction = 0;
            entity.hasGreetedPlayer = false;
        });

        // Create a digital twin example
        this.createDigitalTwin('Factory-Bot-1', 'Monitoring assembly line', { x: 8, y: 0, z: -8 });
    }

    createAIEntity(name, task, position) {
        const id = 'ai-' + Math.random().toString(36).substr(2, 9);
        const entity = new Entity(id, name, EntityType.AI, position);
        entity.setTask(task);
        entity.avatar = this.createAvatar(EntityType.AI, 0x7b2fff, id);
        entity.avatar.position.set(position.x, position.y, position.z);
        this.scene.add(entity.avatar);
        this.entities.set(id, entity);

        // Add floating name tag
        this.addNameTagToEntity(entity);

        // Start autonomous behavior
        this.startAIBehavior(entity);

        this.updateEntityList();
        return entity;
    }

    createDigitalTwin(name, task, position) {
        const id = 'twin-' + Math.random().toString(36).substr(2, 9);
        const entity = new Entity(id, name, EntityType.TWIN, position);
        entity.setTask(task);
        entity.avatar = this.createAvatar(EntityType.TWIN, 0x00ff88, id);
        entity.avatar.position.set(position.x, position.y, position.z);
        this.scene.add(entity.avatar);
        this.entities.set(id, entity);

        // Add floating name tag
        this.addNameTagToEntity(entity);

        // Start twin sync behavior
        this.startTwinSync(entity);

        this.updateEntityList();
        return entity;
    }

    createAvatar(type, color, entityId = null) {
        const group = new THREE.Group();
        group.userData.entityId = entityId; // For click detection

        // Body (cylinder + spheres to simulate capsule, since CapsuleGeometry is r133+)
        const bodyMat = new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.3,
            roughness: 0.7
        });

        // Main body cylinder
        const bodyGeo = new THREE.CylinderGeometry(0.35, 0.4, 1, 16);
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 1;
        body.castShadow = true;
        group.add(body);

        // Top sphere
        const topSphere = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8), bodyMat);
        topSphere.position.y = 1.5;
        topSphere.castShadow = true;
        group.add(topSphere);

        // Bottom sphere
        const bottomSphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 8), bodyMat);
        bottomSphere.position.y = 0.5;
        bottomSphere.castShadow = true;
        group.add(bottomSphere);

        // Head
        const headGeo = new THREE.SphereGeometry(0.35, 16, 16);
        const headMat = new THREE.MeshStandardMaterial({
            color: 0xffddcc,
            metalness: 0.1,
            roughness: 0.8
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 2.1;
        head.castShadow = true;
        group.add(head);
        group.userData.headRef = head; // CYCLE 3: Cache head reference for animation

        // Type indicator ring
        const ringGeo = new THREE.TorusGeometry(0.5, 0.05, 8, 32);
        const ringMat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.8
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 2.6;
        group.add(ring);

        // Different head features for AI/Twin
        if (type === EntityType.AI) {
            // AI visor
            const visorGeo = new THREE.BoxGeometry(0.5, 0.15, 0.1);
            const visorMat = new THREE.MeshStandardMaterial({
                color: 0x00ffff,
                emissive: 0x00ffff,
                emissiveIntensity: 0.5
            });
            const visor = new THREE.Mesh(visorGeo, visorMat);
            visor.position.set(0, 2.15, 0.3);
            group.add(visor);
        } else if (type === EntityType.TWIN) {
            // Twin antenna
            const antennaGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8);
            const antennaMat = new THREE.MeshStandardMaterial({ color: 0x00ff88 });
            const antenna = new THREE.Mesh(antennaGeo, antennaMat);
            antenna.position.y = 2.6;
            group.add(antenna);

            const tipGeo = new THREE.SphereGeometry(0.05, 8, 8);
            const tipMat = new THREE.MeshStandardMaterial({
                color: 0x00ff88,
                emissive: 0x00ff88,
                emissiveIntensity: 1
            });
            const tip = new THREE.Mesh(tipGeo, tipMat);
            tip.position.y = 2.8;
            group.add(tip);
        }

        // Activity indicator (small sphere above head)
        const indicatorGeo = new THREE.SphereGeometry(0.1, 8, 8);
        const indicatorMat = new THREE.MeshStandardMaterial({
            color: 0x666666,
            emissive: 0x666666,
            emissiveIntensity: 0.3,
            fog: false
        });
        const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
        indicator.position.y = 2.9;
        indicator.name = 'indicator';
        group.add(indicator);

        return group;
    }

    // Create floating name tag sprite for entity
    createNameTag(name, type) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.roundRect(0, 8, canvas.width, canvas.height - 16, 8);
        ctx.fill();

        // Text
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Color based on type
        const colors = {
            [EntityType.HUMAN]: '#00d4ff',
            [EntityType.AI]: '#7b2fff',
            [EntityType.TWIN]: '#00ff88'
        };
        ctx.fillStyle = colors[type] || '#ffffff';
        ctx.fillText(name, canvas.width / 2, canvas.height / 2);

        // Type indicator dot
        ctx.beginPath();
        ctx.arc(20, canvas.height / 2, 6, 0, Math.PI * 2);
        ctx.fillStyle = colors[type] || '#ffffff';
        ctx.fill();

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            fog: false
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2, 0.5, 1);
        sprite.position.y = 3.3;
        sprite.name = 'nametag';
        sprite.renderOrder = 999; // Render on top

        return sprite;
    }

    // Add name tag to entity's avatar
    addNameTagToEntity(entity) {
        if (!entity.avatar) return;

        // Remove existing name tag if any
        const existing = entity.avatar.getObjectByName('nametag');
        if (existing) {
            entity.avatar.remove(existing);
            existing.material.map.dispose();
            existing.material.dispose();
        }

        const nameTag = this.createNameTag(entity.name, entity.type);
        entity.avatar.add(nameTag);
    }

    // CYCLE 4: Create 3D chat bubble sprite
    createChatBubble(entity, message) {
        if (!entity || !entity.avatar) return;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 512;
        canvas.height = 128;

        // Word wrap the message
        const maxWidth = 480;
        const lineHeight = 28;
        ctx.font = '24px Arial';
        const words = message.split(' ');
        let lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            if (ctx.measureText(testLine).width > maxWidth) {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
        lines = lines.slice(0, 3); // Max 3 lines

        // Background bubble
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.beginPath();
        ctx.roundRect(4, 4, canvas.width - 8, 8 + lines.length * lineHeight, 16);
        ctx.fill();

        // Bubble tail
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2 - 15, 8 + lines.length * lineHeight);
        ctx.lineTo(canvas.width / 2, canvas.height - 8);
        ctx.lineTo(canvas.width / 2 + 15, 8 + lines.length * lineHeight);
        ctx.fill();

        // Text
        ctx.fillStyle = '#1a1a2e';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => {
            ctx.fillText(line, canvas.width / 2, 12 + i * lineHeight);
        });

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            fog: false
        });

        const sprite = new THREE.Sprite(material);
        sprite.scale.set(4, 1, 1);
        sprite.renderOrder = 1000;

        // Position above entity
        const position = entity.avatar.position.clone();
        position.y += 4.5;
        sprite.position.copy(position);

        // Track bubble metadata
        sprite.userData = {
            entity: entity,
            startTime: this.clock.getElapsedTime(),
            duration: 4 + message.length * 0.05, // Longer messages stay longer
            startY: position.y,
            texture: texture
        };

        this.scene.add(sprite);
        this.chatBubbles.push(sprite);

        // Remove old bubbles from same entity
        const oldBubbles = this.chatBubbles.filter(b =>
            b !== sprite && b.userData.entity === entity
        );
        oldBubbles.forEach(b => this.removeChatBubble(b));
    }

    removeChatBubble(bubble) {
        const index = this.chatBubbles.indexOf(bubble);
        if (index > -1) {
            this.chatBubbles.splice(index, 1);
        }
        this.scene.remove(bubble);
        if (bubble.userData.texture) {
            bubble.userData.texture.dispose();
        }
        bubble.material.dispose();
    }

    updateChatBubbles() {
        const time = this.clock.getElapsedTime();

        for (let i = this.chatBubbles.length - 1; i >= 0; i--) {
            const bubble = this.chatBubbles[i];
            const data = bubble.userData;
            const elapsed = time - data.startTime;
            const progress = elapsed / data.duration;

            if (progress >= 1) {
                this.removeChatBubble(bubble);
                continue;
            }

            // Follow entity position
            if (data.entity && data.entity.avatar) {
                bubble.position.x = data.entity.avatar.position.x;
                bubble.position.z = data.entity.avatar.position.z;
            }

            // Rise animation
            bubble.position.y = data.startY + elapsed * 0.1;

            // Fade in/out
            if (progress < 0.1) {
                bubble.material.opacity = progress / 0.1;
            } else if (progress > 0.8) {
                bubble.material.opacity = (1 - progress) / 0.2;
            } else {
                bubble.material.opacity = 1;
            }

            // Face camera (billboard)
            bubble.lookAt(this.camera.position);
        }
    }

    updateAvatarIndicator(entity) {
        if (!entity.avatar) return;
        const indicator = entity.avatar.getObjectByName('indicator');
        if (!indicator) return;

        const colors = {
            [EntityState.IDLE]: 0x666666,
            [EntityState.WORKING]: 0x00ff88,
            [EntityState.THINKING]: 0xffaa00,
            [EntityState.CONTROLLED]: 0x00d4ff
        };

        indicator.material.color.setHex(colors[entity.state] || 0x666666);
    }

    // ===========================================
    // AI BEHAVIOR (Personality-Driven)
    // ===========================================
    startAIBehavior(entity) {
        const runBehavior = () => {
            // Check if entity still exists (prevents memory leaks)
            if (!this.entities.has(entity.id)) return;

            if (entity.controlledBy) {
                // Entity is controlled by human, skip autonomous behavior
                entity.behaviorTimeoutId = setTimeout(runBehavior, 1000);
                return;
            }

            // Check for proximity to player first (proactive greeting)
            if (this.checkPlayerProximity(entity)) {
                // Proximity behavior handled, wait before next behavior
                entity.behaviorTimeoutId = setTimeout(runBehavior, 3000);
                return;
            }

            // Choose behavior based on personality
            const personality = entity.personality;
            const behaviorRoll = Math.random();

            if (personality) {
                // Personality-driven behavior selection
                if (behaviorRoll < 0.4) {
                    this.aiWander(entity, personality.wanderRadius);
                } else if (behaviorRoll < 0.7) {
                    this.aiThink(entity, personality.thinkDuration);
                } else {
                    this.aiWork(entity, personality.workPhrases);
                }
            } else {
                // Default random behavior
                const behaviors = [
                    () => this.aiWander(entity),
                    () => this.aiThink(entity),
                    () => this.aiWork(entity)
                ];
                behaviors[Math.floor(Math.random() * behaviors.length)]();
            }

            const nextInterval = 2000 + Math.random() * 3000;
            entity.behaviorTimeoutId = setTimeout(runBehavior, nextInterval);
        };

        entity.behaviorTimeoutId = setTimeout(runBehavior, 1000 + Math.random() * 2000);
    }

    // Check if player is near and trigger proactive greeting
    checkPlayerProximity(entity) {
        if (!this.localEntity || !entity.personality) return false;

        const dx = entity.position.x - this.localEntity.position.x;
        const dz = entity.position.z - this.localEntity.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        const now = Date.now();
        const GREETING_COOLDOWN = 30000; // 30 seconds between greetings
        const PROXIMITY_THRESHOLD = 5; // 5 units

        if (distance < PROXIMITY_THRESHOLD) {
            // Player is close - check if we should greet
            if (!entity.hasGreetedPlayer ||
                (now - entity.lastPlayerInteraction > GREETING_COOLDOWN)) {

                this.aiGreetPlayer(entity);
                entity.hasGreetedPlayer = true;
                entity.lastPlayerInteraction = now;
                return true;
            }
        } else {
            // Player moved away, reset greeting flag after cooldown
            if (entity.hasGreetedPlayer && distance > 15) {
                entity.hasGreetedPlayer = false;
            }
        }

        return false;
    }

    // AI greets the player based on personality
    aiGreetPlayer(entity) {
        const personality = entity.personality;
        if (!personality) return;

        const greetings = personality.greetings;
        const greeting = greetings[Math.floor(Math.random() * greetings.length)];

        // Show greeting in chat
        this.addChatMessage(entity.name, greeting, 'ai');

        // Update entity state to show they're interacting
        entity.state = EntityState.WORKING;
        entity.log(`Greeting player: "${greeting}"`, 'action');
        this.updateAvatarIndicator(entity);

        // Turn to face the player
        if (entity.avatar && this.localEntity) {
            const angle = Math.atan2(
                this.localEntity.position.x - entity.position.x,
                this.localEntity.position.z - entity.position.z
            );
            entity.avatar.rotation.y = angle;
        }
    }

    // Clean up entity timers to prevent memory leaks
    cleanupEntityTimers(entity) {
        if (entity.behaviorTimeoutId) {
            clearTimeout(entity.behaviorTimeoutId);
            entity.behaviorTimeoutId = null;
        }
        if (entity.syncTimeoutId) {
            clearTimeout(entity.syncTimeoutId);
            entity.syncTimeoutId = null;
        }
    }

    aiWander(entity, wanderRadius = 5) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 1 + Math.random() * (wanderRadius * 0.3);
        const newX = entity.position.x + Math.cos(angle) * distance;
        const newZ = entity.position.z + Math.sin(angle) * distance;

        // Keep within bounds
        const clampedX = Math.max(-30, Math.min(30, newX));
        const clampedZ = Math.max(-30, Math.min(30, newZ));

        // Use smooth movement - the animation loop will handle interpolation
        entity.moveTo(clampedX, clampedZ);
        this.broadcastEntityUpdate(entity);
    }

    aiThink(entity, thinkDuration = 2000) {
        entity.state = EntityState.THINKING;

        const personality = entity.personality;
        const thought = personality ?
            `${personality.traits[Math.floor(Math.random() * personality.traits.length)]} analysis...` :
            'Processing...';

        entity.log(thought, 'thought');
        this.updateAvatarIndicator(entity);

        const duration = thinkDuration * (0.5 + Math.random());
        setTimeout(() => {
            if (entity.state === EntityState.THINKING) {
                entity.state = entity.currentTask ? EntityState.WORKING : EntityState.IDLE;
                entity.log('Analysis complete', 'output');
                this.updateAvatarIndicator(entity);
            }
        }, duration);
    }

    aiWork(entity, workPhrases = null) {
        const personality = entity.personality;

        if (!entity.currentTask) {
            const tasks = workPhrases || [
                'Optimizing neural pathways',
                'Analyzing environmental data',
                'Processing knowledge graph',
                'Synchronizing state vectors',
                'Compiling response patterns'
            ];
            entity.setTask(tasks[Math.floor(Math.random() * tasks.length)]);
        }
        this.updateAvatarIndicator(entity);
        this.updateActivityLog();
    }

    // ===========================================
    // DIGITAL TWIN SYNC
    // ===========================================
    startTwinSync(entity) {
        // Simulate external system sync
        const sync = () => {
            // Check if entity still exists (prevents memory leaks)
            if (!this.entities.has(entity.id)) return;

            if (entity.controlledBy) {
                entity.syncTimeoutId = setTimeout(sync, 1000);
                return;
            }

            // Simulate receiving data from external system
            const systemStatus = ['nominal', 'processing', 'calibrating', 'standby'][
                Math.floor(Math.random() * 4)
            ];

            entity.log(`System status: ${systemStatus}`, 'output');
            entity.twinConfig.lastSyncTime = new Date().toISOString();

            if (systemStatus === 'processing') {
                entity.state = EntityState.WORKING;
            } else if (systemStatus === 'calibrating') {
                entity.state = EntityState.THINKING;
            } else {
                entity.state = EntityState.IDLE;
            }

            this.updateAvatarIndicator(entity);
            entity.syncTimeoutId = setTimeout(sync, 3000 + Math.random() * 2000);
        };

        entity.syncTimeoutId = setTimeout(sync, 2000);
    }

    // ===========================================
    // OBSERVATION & CONTROL
    // ===========================================
    observeEntity(entityId) {
        const entity = this.entities.get(entityId);
        if (!entity || entity === this.localEntity) return;

        this.observedEntity = entity;
        this.currentMode = 'observe';
        this.updateModeUI();

        // CYCLE 4: Unlock observer achievement
        this.unlockAchievement('observer');

        document.getElementById('observation-panel').classList.add('visible');
        document.getElementById('obs-entity-name').textContent = entity.name;

        const statusDot = document.getElementById('obs-status-dot');
        statusDot.className = 'status-dot ' + entity.state;
        document.getElementById('obs-status-text').textContent =
            entity.currentTask || 'No active task';

        this.updateActivityLog();
        entity.log(`Being observed by ${this.localEntity.name}`, 'action');
    }

    setControlMode(mode) {
        if (!this.observedEntity) return;

        const previousMode = this.controlMode;
        this.controlMode = mode;

        // Update UI
        document.querySelectorAll('.control-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.classList.contains(mode)) {
                btn.classList.add('active');
            }
        });

        if (mode === ControlMode.TAKEOVER) {
            // POSSESSION MODE: Teleport into the entity's body

            // CYCLE 4: Unlock possession achievement
            this.unlockAchievement('possession');

            // Save current camera state so we can return later
            this.prePossessionState = {
                position: this.camera.position.clone(),
                rotation: {
                    x: this.camera.rotation.x,
                    y: this.camera.rotation.y
                }
            };

            // Keep user's avatar visible at original position (so they can see where they "left" their body)
            if (this.localEntity && this.localEntity.avatar) {
                this.localEntity.avatar.visible = true;
                this.localEntity.avatar.position.set(
                    this.camera.position.x,
                    0,
                    this.camera.position.z
                );
                // Make it semi-transparent to show it's "vacant"
                this.localEntity.avatar.traverse(child => {
                    if (child.material) {
                        child.material.transparent = true;
                        child.material.opacity = 0.5;
                    }
                });
            }

            // Teleport camera to entity's position (first-person view)
            const entity = this.observedEntity;
            this.camera.position.set(
                entity.position.x,
                entity.position.y + 2, // Eye height
                entity.position.z
            );

            // Face the direction the entity was facing
            if (entity.avatar) {
                this.camera.rotation.y = entity.avatar.rotation.y;
                this.camera.rotation.x = 0; // Level gaze
            }

            // Hide the possessed entity's avatar (we ARE them now)
            if (entity.avatar) {
                entity.avatar.visible = false;
            }

            // Mark as controlled
            entity.controlledBy = this.localEntity.id;
            entity.state = EntityState.CONTROLLED;
            entity.log(`Control taken by ${this.localEntity.name}`, 'action');

            this.addChatMessage('System', `POSSESSING ${entity.name} - You are now seeing through their eyes. Your body remains at the original position.`, 'system');

            // Visual feedback - flash effect
            this.flashPossessionEffect();

        } else {
            // Releasing control
            if (previousMode === ControlMode.TAKEOVER && this.observedEntity.controlledBy === this.localEntity.id) {
                const entity = this.observedEntity;

                // Update entity position to where we moved them
                entity.position.x = this.camera.position.x;
                entity.position.z = this.camera.position.z;
                entity.position.y = 0;

                // Show their avatar again
                if (entity.avatar) {
                    entity.avatar.visible = true;
                    entity.avatar.position.set(entity.position.x, 0, entity.position.z);
                }

                // Return camera to original position (step back from entity)
                if (this.prePossessionState) {
                    // Step back from the entity so we can see them
                    const stepBackDistance = 5;
                    const direction = new THREE.Vector3();
                    this.camera.getWorldDirection(direction);

                    this.camera.position.set(
                        entity.position.x - direction.x * stepBackDistance,
                        2, // Observer height
                        entity.position.z - direction.z * stepBackDistance
                    );

                    this.prePossessionState = null;
                }

                // Restore user avatar to full opacity
                if (this.localEntity && this.localEntity.avatar) {
                    this.localEntity.avatar.traverse(child => {
                        if (child.material) {
                            child.material.opacity = 1;
                        }
                    });
                    // Move user avatar to current camera position
                    this.localEntity.avatar.position.set(
                        this.camera.position.x,
                        0,
                        this.camera.position.z
                    );
                    this.localEntity.position.x = this.camera.position.x;
                    this.localEntity.position.z = this.camera.position.z;
                }

                // Release control
                entity.controlledBy = null;
                entity.state = entity.currentTask ? EntityState.WORKING : EntityState.IDLE;
                entity.log('Control returned to autonomous mode', 'action');

                // Hide the possession HUD
                this.hidePossessionHUD();

                this.addChatMessage('System', `Released control of ${entity.name}. You returned to your body.`, 'system');
            }
        }

        this.updateAvatarIndicator(this.observedEntity);
        this.updateActivityLog();
        this.broadcastEntityUpdate(this.observedEntity);
    }

    flashPossessionEffect() {
        // Create a visual flash to indicate possession
        const flash = document.createElement('div');
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 212, 255, 0.3);
            pointer-events: none;
            z-index: 1000;
            animation: possessionFlash 0.5s ease-out forwards;
        `;

        // Add animation keyframes if not already present
        if (!document.getElementById('possession-styles')) {
            const style = document.createElement('style');
            style.id = 'possession-styles';
            style.textContent = `
                @keyframes possessionFlash {
                    0% { opacity: 1; }
                    100% { opacity: 0; }
                }
                @keyframes possessionPulse {
                    0%, 100% { opacity: 0.8; }
                    50% { opacity: 0.4; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 500);

        // Show persistent possession indicator
        this.showPossessionHUD();
    }

    showPossessionHUD() {
        // Remove existing HUD if any
        this.hidePossessionHUD();

        if (!this.observedEntity) return;

        const entity = this.observedEntity;
        const typeColor = entity.type === EntityType.AI ? '#7b2fff' : '#00ff88';

        const hud = document.createElement('div');
        hud.id = 'possession-hud';
        hud.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            border: 2px solid ${typeColor};
            border-radius: 8px;
            padding: 10px 20px;
            z-index: 200;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 0 20px ${typeColor}40;
        `;

        hud.innerHTML = `
            <div style="
                width: 12px;
                height: 12px;
                background: ${typeColor};
                border-radius: 50%;
                animation: possessionPulse 1.5s infinite;
            "></div>
            <div>
                <div style="font-size: 0.75em; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 1px;">
                    Possessing
                </div>
                <div style="font-weight: 600; color: ${typeColor};">
                    ${entity.name}
                </div>
            </div>
            <div style="
                font-size: 0.8em;
                color: rgba(255,255,255,0.5);
                border-left: 1px solid rgba(255,255,255,0.2);
                padding-left: 12px;
                margin-left: 4px;
            ">
                Press <kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px;">ESC</kbd> or click Watch to release
            </div>
        `;

        document.body.appendChild(hud);

        // Add vignette border effect
        const vignette = document.createElement('div');
        vignette.id = 'possession-vignette';
        vignette.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            pointer-events: none;
            z-index: 50;
            box-shadow: inset 0 0 100px ${typeColor}30;
            border: 3px solid ${typeColor}40;
        `;
        document.body.appendChild(vignette);
    }

    hidePossessionHUD() {
        const hud = document.getElementById('possession-hud');
        if (hud) hud.remove();

        const vignette = document.getElementById('possession-vignette');
        if (vignette) vignette.remove();
    }

    updateActivityLog() {
        if (!this.observedEntity) return;

        this.activityLogEl.innerHTML = this.observedEntity.activityLog
            .slice(-20)
            .reverse()
            .map(entry => `
                <div class="activity-item ${entry.type}">
                    <div class="activity-time">${new Date(entry.time).toLocaleTimeString()}</div>
                    <div>${entry.message}</div>
                </div>
            `).join('');
    }

    // ===========================================
    // WORLD BUILDER
    // ===========================================
    placeObject(type, position) {
        let mesh;
        const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.5);

        switch (type) {
            case 'cube':
                mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(2, 2, 2),
                    new THREE.MeshStandardMaterial({ color })
                );
                break;
            case 'sphere':
                mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(1, 32, 32),
                    new THREE.MeshStandardMaterial({ color })
                );
                break;
            case 'cylinder':
                mesh = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.5, 0.5, 4, 16),
                    new THREE.MeshStandardMaterial({ color })
                );
                mesh.position.y = 2;
                break;
            case 'tree':
                mesh = this.createTree();
                break;
            case 'light':
                const light = new THREE.PointLight(0xffaa00, 1, 15);
                light.position.copy(position);
                light.position.y += 3;
                this.scene.add(light);

                mesh = new THREE.Mesh(
                    new THREE.SphereGeometry(0.3),
                    new THREE.MeshBasicMaterial({ color: 0xffaa00, fog: false })
                );
                mesh.position.y = 3;
                break;
            case 'portal':
                mesh = this.createPortal();
                break;
            default:
                return;
        }

        mesh.position.x = position.x;
        mesh.position.z = position.z;
        if (type !== 'cylinder' && type !== 'light') {
            mesh.position.y = mesh.geometry?.parameters?.height / 2 || 1;
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.type = type;
        mesh.userData.placedBy = this.localEntity?.id;

        this.scene.add(mesh);
        this.worldObjects.push(mesh);

        this.localEntity?.log(`Placed ${type} at (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`, 'action');
        this.broadcastObjectPlaced(mesh);

        return mesh;
    }

    createTree() {
        const group = new THREE.Group();

        // Trunk
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.3, 2, 8),
            new THREE.MeshStandardMaterial({ color: 0x8b4513 })
        );
        trunk.position.y = 1;
        group.add(trunk);

        // Foliage
        const foliage = new THREE.Mesh(
            new THREE.ConeGeometry(1.5, 3, 8),
            new THREE.MeshStandardMaterial({ color: 0x228b22 })
        );
        foliage.position.y = 3.5;
        group.add(foliage);

        return group;
    }

    createPortal() {
        const group = new THREE.Group();

        // Frame
        const frame = new THREE.Mesh(
            new THREE.TorusGeometry(2, 0.2, 16, 32),
            new THREE.MeshStandardMaterial({
                color: 0x7b2fff,
                emissive: 0x7b2fff,
                emissiveIntensity: 0.5
            })
        );
        frame.position.y = 2;
        group.add(frame);

        // Portal surface
        const surface = new THREE.Mesh(
            new THREE.CircleGeometry(1.8, 32),
            new THREE.ShaderMaterial({
                uniforms: {
                    time: { value: 0 }
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform float time;
                    varying vec2 vUv;
                    void main() {
                        vec2 center = vUv - 0.5;
                        float dist = length(center);
                        float wave = sin(dist * 20.0 - time * 3.0) * 0.5 + 0.5;
                        vec3 color = mix(vec3(0.5, 0.2, 1.0), vec3(0.0, 0.8, 1.0), wave);
                        float alpha = 1.0 - dist * 1.5;
                        gl_FragColor = vec4(color, alpha * 0.8);
                    }
                `,
                transparent: true,
                side: THREE.DoubleSide,
                fog: false // Disable fog for portal (prevents uniform errors)
            })
        );
        surface.position.y = 2;
        surface.userData.isPortalSurface = true;
        group.add(surface);

        return group;
    }

    // ===========================================
    // MULTIPLAYER
    // ===========================================
    async setupMultiplayer() {
        // Get room from URL or generate
        const urlParams = new URLSearchParams(window.location.search);
        this.roomId = urlParams.get('room') || 'nexus-' + Math.random().toString(36).substr(2, 6);
        document.getElementById('room-id').textContent = `Room: ${this.roomId}`;

        // Use a timeout to prevent hanging if PeerJS fails
        const timeout = new Promise((resolve) => {
            setTimeout(() => {
                console.warn('PeerJS connection timeout, running in local mode');
                document.getElementById('conn-text').textContent = 'Local mode (offline)';
                document.getElementById('conn-dot').style.background = '#ffaa00';
                resolve();
            }, 3000);
        });

        const peerSetup = new Promise((resolve) => {
            try {
                // Check if PeerJS is available
                if (typeof Peer === 'undefined') {
                    throw new Error('PeerJS not loaded');
                }

                this.peer = new Peer('nexus-' + Math.random().toString(36).substr(2, 9));

                this.peer.on('open', (id) => {
                    document.getElementById('conn-text').textContent = 'Connected to Nexus Network';
                    document.getElementById('conn-dot').style.background = '#00ff88';
                    this.connectToRoom();
                    resolve();
                });

                this.peer.on('connection', (conn) => {
                    this.handleConnection(conn);
                });

                this.peer.on('error', (err) => {
                    console.warn('Peer error:', err);
                    document.getElementById('conn-text').textContent = 'Local mode (peer error)';
                    document.getElementById('conn-dot').style.background = '#ffaa00';
                    resolve();
                });

                this.peer.on('disconnected', () => {
                    document.getElementById('conn-text').textContent = 'Disconnected';
                    document.getElementById('conn-dot').style.background = '#ff4444';
                });

            } catch (e) {
                console.warn('PeerJS not available:', e);
                document.getElementById('conn-text').textContent = 'Local mode';
                document.getElementById('conn-dot').style.background = '#ffaa00';
                resolve();
            }
        });

        // Race between timeout and peer setup
        return Promise.race([timeout, peerSetup]);
    }

    connectToRoom() {
        // For demo, just mark as connected
        this.isHost = true;
        this.updatePeerCount();
    }

    handleConnection(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            this.updatePeerCount();

            // CYCLE 4: Unlock multiplayer achievement
            this.unlockAchievement('connector');

            // Send current world state
            conn.send({
                type: 'world-state',
                entities: Array.from(this.entities.values()).map(e => e.serialize()),
                objects: this.worldObjects.map(o => ({
                    type: o.userData.type,
                    position: o.position.toArray()
                }))
            });
        });

        conn.on('data', (data) => {
            this.handlePeerData(conn.peer, data);
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.updatePeerCount();
        });
    }

    handlePeerData(peerId, data) {
        switch (data.type) {
            case 'entity-update':
                this.handleRemoteEntityUpdate(data.entity, peerId);
                break;
            case 'object-placed':
                this.placeObject(data.objectType, new THREE.Vector3(...data.position));
                break;
            case 'chat':
                this.addChatMessage(data.sender, data.message, data.senderType);
                break;
            case 'world-state':
                this.handleWorldState(data);
                break;
        }
    }

    handleRemoteEntityUpdate(entityData, peerId) {
        if (!entityData || !entityData.id) return;

        // Check if this entity already exists
        let entity = this.entities.get(entityData.id);

        if (entity) {
            // Update existing entity position and state
            if (entityData.position) {
                entity.position = entityData.position;
                if (entity.avatar) {
                    entity.avatar.position.set(
                        entityData.position.x,
                        entityData.position.y,
                        entityData.position.z
                    );
                }
            }
            if (entityData.rotation !== undefined) {
                entity.rotation = entityData.rotation;
                if (entity.avatar) {
                    entity.avatar.rotation.y = entityData.rotation;
                }
            }
            if (entityData.state) {
                entity.state = entityData.state;
            }
            if (entityData.currentTask) {
                entity.currentTask = entityData.currentTask;
            }
        } else {
            // Create new remote entity (remote player joining)
            const type = entityData.type || EntityType.HUMAN;
            const position = entityData.position || { x: 0, y: 0, z: 0 };

            entity = new Entity(entityData.id, entityData.name || 'Remote Player', type, position);

            // Choose color based on type
            let color = 0x00d4ff; // Human default
            if (type === EntityType.AI) color = 0x7b2fff;
            else if (type === EntityType.TWIN) color = 0x00ff88;

            entity.avatar = this.createAvatar(type, color, entityData.id);
            entity.avatar.position.set(position.x, position.y, position.z);
            this.scene.add(entity.avatar);
            this.entities.set(entityData.id, entity);

            // Add name tag to remote entity
            this.addNameTagToEntity(entity);

            if (entityData.currentTask) {
                entity.setTask(entityData.currentTask);
            }

            this.updateEntityList();
            this.updatePeerCount();
        }
    }

    handleWorldState(data) {
        // Handle initial world state sync from host
        if (data.entities) {
            data.entities.forEach(entityData => {
                // Don't override our local entity
                if (entityData.id !== this.localEntity?.id) {
                    this.handleRemoteEntityUpdate(entityData, null);
                }
            });
        }

        if (data.objects) {
            data.objects.forEach(objData => {
                const pos = new THREE.Vector3(
                    objData.position[0],
                    objData.position[1],
                    objData.position[2]
                );
                // Check if object already exists at this position
                const exists = this.worldObjects.some(o =>
                    o.position.distanceTo(pos) < 0.5 &&
                    o.userData.type === objData.type
                );
                if (!exists) {
                    this.placeObject(objData.type, pos);
                }
            });
        }
    }

    broadcastEntityUpdate(entity) {
        const data = {
            type: 'entity-update',
            entity: entity.serialize()
        };
        this.connections.forEach(conn => conn.send(data));
    }

    broadcastObjectPlaced(mesh) {
        const data = {
            type: 'object-placed',
            objectType: mesh.userData.type,
            position: mesh.position.toArray()
        };
        this.connections.forEach(conn => conn.send(data));
    }

    updatePeerCount() {
        const count = this.connections.size;
        document.getElementById('peer-count').textContent = `${count} peer${count !== 1 ? 's' : ''} connected`;
        document.getElementById('entity-total').textContent = `${this.entities.size} entities in world`;
    }

    // ===========================================
    // UI MANAGEMENT
    // ===========================================
    setupUI() {
        // Mode switching
        document.querySelectorAll('.mode-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                const mode = pill.dataset.mode;
                this.setMode(mode);
            });
        });

        // Builder tools
        document.querySelectorAll('.builder-tool').forEach(tool => {
            tool.addEventListener('click', () => {
                document.querySelectorAll('.builder-tool').forEach(t => t.classList.remove('selected'));
                tool.classList.add('selected');
                this.selectedTool = tool.dataset.tool;

                if (this.selectedTool === 'save') {
                    this.saveWorld();
                }
            });
        });

        // Object palette
        document.querySelectorAll('.palette-item').forEach(item => {
            item.addEventListener('click', () => {
                const type = item.dataset.object;
                const pos = new THREE.Vector3(
                    this.camera.position.x + Math.sin(this.camera.rotation.y) * 5,
                    0,
                    this.camera.position.z + Math.cos(this.camera.rotation.y) * 5
                );
                this.placeObject(type, pos);
            });
        });

        // Chat input
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChat();
            }
        });

        // Tab to toggle panels
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                document.getElementById('entity-panel').classList.toggle('hidden');
                document.getElementById('chat-panel').classList.toggle('hidden');
            }
        });
    }

    setMode(mode) {
        this.currentMode = mode;
        this.updateModeUI();

        // Show/hide panels based on mode
        document.getElementById('observation-panel').classList.toggle('visible', mode === 'observe');
        document.getElementById('builder-panel').classList.toggle('visible', mode === 'build');

        if (mode === 'observe' && !this.observedEntity && this.entities.size > 1) {
            // Auto-observe first AI entity
            for (const [id, entity] of this.entities) {
                if (entity.type !== EntityType.HUMAN) {
                    this.observeEntity(id);
                    break;
                }
            }
        }
    }

    updateModeUI() {
        document.querySelectorAll('.mode-pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.mode === this.currentMode);
        });
    }

    updateEntityList() {
        this.entityListEl.innerHTML = '';

        this.entities.forEach((entity, id) => {
            const card = document.createElement('div');
            card.className = 'entity-card' + (this.observedEntity?.id === id ? ' selected' : '');
            card.innerHTML = `
                <div class="entity-header">
                    <div class="entity-avatar ${entity.type}">
                        ${entity.type === EntityType.HUMAN ? '👤' :
                    entity.type === EntityType.AI ? '🤖' : '⚙️'}
                    </div>
                    <div class="entity-name">${entity.name}</div>
                    <div class="entity-type">${entity.type.toUpperCase()}</div>
                </div>
                <div class="entity-status">
                    <div class="status-dot ${entity.state}"></div>
                    <span>${entity.state}</span>
                </div>
                ${entity.currentTask ? `<div class="entity-task">${entity.currentTask}</div>` : ''}
            `;

            card.addEventListener('click', () => {
                if (entity.type !== EntityType.HUMAN) {
                    this.observeEntity(id);
                    document.querySelectorAll('.entity-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                }
            });

            this.entityListEl.appendChild(card);
        });

        document.getElementById('entity-count').textContent = this.entities.size;
    }

    showAddEntityModal() {
        document.getElementById('add-entity-modal').classList.add('visible');
    }

    hideAddEntityModal() {
        document.getElementById('add-entity-modal').classList.remove('visible');
    }

    addEntity() {
        const name = document.getElementById('entity-name-input').value || 'New Entity';
        const type = document.getElementById('entity-type-select').value;
        const task = document.getElementById('entity-task-input').value;

        const position = {
            x: (Math.random() - 0.5) * 20,
            y: 0,
            z: (Math.random() - 0.5) * 20
        };

        if (type === EntityType.AI) {
            this.createAIEntity(name, task || 'Awaiting instructions', position);
        } else if (type === EntityType.TWIN) {
            this.createDigitalTwin(name, task || 'Syncing with external system', position);
        }

        this.hideAddEntityModal();
        this.addChatMessage('System', `New entity "${name}" has joined the world`, 'system');
    }

    sendChat() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        if (!message) return;

        this.addChatMessage(this.localEntity?.name || 'You', message, 'human');

        // CYCLE 4: Track chat achievement
        this.unlockAchievement('social_butterfly');

        // Broadcast to peers
        this.connections.forEach(conn => {
            conn.send({
                type: 'chat',
                sender: this.localEntity?.name || 'Anonymous',
                message,
                senderType: 'human'
            });
        });

        // If message is a command to an AI
        if (message.startsWith('@')) {
            this.handleAICommand(message);
        }

        input.value = '';
    }

    handleAICommand(message) {
        const match = message.match(/@(\w+)\s+(.+)/);
        if (!match) return;

        const [, targetName, command] = match;

        for (const entity of this.entities.values()) {
            if (entity.name.toLowerCase() === targetName.toLowerCase() && entity.type !== EntityType.HUMAN) {
                entity.setTask(command);
                this.updateAvatarIndicator(entity);
                this.addChatMessage(entity.name, `Understood. Starting: ${command}`, 'ai');

                // CYCLE 4: Unlock AI conversation achievement
                this.unlockAchievement('ai_whisperer');

                // CYCLE 2: Add to shared knowledge
                this.addKnowledge(
                    entity.id,
                    entity.name,
                    'learning',
                    `Received task: ${command}`
                );

                if (this.observedEntity?.id === entity.id) {
                    this.updateActivityLog();
                }
                break;
            }
        }
    }

    addChatMessage(sender, message, type) {
        const msgEl = document.createElement('div');
        msgEl.className = `chat-message ${type}`;
        msgEl.innerHTML = `
            <div class="chat-sender">${sender}</div>
            <div>${message}</div>
        `;
        this.chatMessagesEl.appendChild(msgEl);
        this.chatMessagesEl.scrollTop = this.chatMessagesEl.scrollHeight;

        // CYCLE 4: Create 3D spatial chat bubble
        if (type !== 'system' && message.length < 200) {
            // Find entity by name
            for (const entity of this.entities.values()) {
                if (entity.name === sender) {
                    this.createChatBubble(entity, message);
                    break;
                }
            }
        }
    }

    // ===========================================
    // CONTROLS
    // ===========================================
    setupControls() {
        // Keyboard
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;

            // ESC to close action menu first, then release possession
            if (e.key === 'Escape') {
                if (this.actionMenuActive) {
                    this.hideActionMenu();
                    return;
                }
                if (this.controlMode === ControlMode.TAKEOVER) {
                    this.setControlMode(ControlMode.OBSERVE);
                    return;
                }
            }

            if (e.key.toLowerCase() in this.keys) {
                this.keys[e.key.toLowerCase()] = true;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.key.toLowerCase() in this.keys) {
                this.keys[e.key.toLowerCase()] = false;
            }
        });

        // Mouse
        this.renderer.domElement.addEventListener('click', (e) => {
            if (!this.isPointerLocked) {
                this.renderer.domElement.requestPointerLock();
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === this.renderer.domElement;
        });

        document.addEventListener('mousemove', (e) => {
            if (this.isPointerLocked) {
                this.camera.rotation.order = 'YXZ';
                this.camera.rotation.y -= e.movementX * this.lookSpeed;
                this.camera.rotation.x -= e.movementY * this.lookSpeed;
                this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));
            }
        });
    }

    updateMovement() {
        // Use pre-allocated vectors to prevent GC churn (60+ allocations/sec otherwise)
        const forward = this._vecPool.forward;
        const right = this._vecPool.right;
        const moveVector = this._vecPool.moveVector;
        const tempPos = this._vecPool.tempPos;
        const slideX = this._vecPool.slideX;
        const slideZ = this._vecPool.slideZ;

        this.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        right.crossVectors(forward, this._vecPool.up);

        moveVector.set(0, 0, 0);

        if (this.keys.w) moveVector.add(forward);
        if (this.keys.s) moveVector.sub(forward);
        if (this.keys.a) moveVector.sub(right);
        if (this.keys.d) moveVector.add(right);

        if (moveVector.length() > 0) {
            moveVector.normalize().multiplyScalar(this.moveSpeed);

            // Check collision before moving
            tempPos.copy(this.camera.position).add(moveVector);
            if (!this.checkCollision(tempPos)) {
                // No collision, move the camera
                this.camera.position.copy(tempPos);
            } else {
                // Try sliding along walls (check X and Z separately)
                slideX.copy(this.camera.position);
                slideX.x += moveVector.x;
                if (!this.checkCollision(slideX)) {
                    this.camera.position.x = slideX.x;
                }

                slideZ.copy(this.camera.position);
                slideZ.z += moveVector.z;
                if (!this.checkCollision(slideZ)) {
                    this.camera.position.z = slideZ.z;
                }
            }

            // Update the appropriate entity position
            if (this.controlMode === ControlMode.TAKEOVER && this.observedEntity) {
                // POSSESSION MODE: We ARE the entity, update their position to match camera
                const entity = this.observedEntity;
                entity.position.x = this.camera.position.x;
                entity.position.z = this.camera.position.z;
                entity.position.y = 0;

                // Avatar stays hidden but position updates (for when we release)
                if (entity.avatar) {
                    entity.avatar.position.x = entity.position.x;
                    entity.avatar.position.z = entity.position.z;
                }

                // Log movement occasionally
                if (Math.random() < 0.02) {
                    entity.log(`Moving to (${entity.position.x.toFixed(1)}, ${entity.position.z.toFixed(1)})`, 'action');
                }

                this.broadcastEntityUpdate(entity);
            } else {
                // Normal mode: update local player
                if (this.localEntity) {
                    this.localEntity.position = {
                        x: this.camera.position.x,
                        y: 0,
                        z: this.camera.position.z
                    };

                    if (this.localEntity.avatar) {
                        this.localEntity.avatar.position.x = this.localEntity.position.x;
                        this.localEntity.avatar.position.z = this.localEntity.position.z;
                    }

                    this.broadcastEntityUpdate(this.localEntity);
                }
            }

            // Audio: Footsteps
            const now = Date.now();
            if (now - (this.lastFootstepTime || 0) > 400) {
                this.playSpatialSound('footstep', this.camera.position);
                this.lastFootstepTime = now;
            }

            // CYCLE 4: Track achievement progress
            if (this.achievementProgress) {
                const distance = moveVector.length();
                this.achievementProgress.distanceTraveled += distance;
                this.achievementProgress.hasMoved = true;

                // Track sprint time
                if (this.keys.shift) {
                    this.achievementProgress.sprintTime += 0.016; // ~60fps frame
                }
            }
        }
    }

    // ===========================================
    // COLLISION DETECTION
    // ===========================================
    checkCollision(position, radius = 0.5) {
        // Check collision with world objects (cubes, cylinders, trees, etc.)
        for (const obj of this.worldObjects) {
            if (!obj.userData || obj.userData.type === 'portal') continue; // Skip portals

            const objPos = obj.position;
            const objType = obj.userData.type;

            // Get bounding radius based on object type
            let objRadius = 1;
            if (objType === 'cube') objRadius = 0.7;
            else if (objType === 'sphere') objRadius = 0.6;
            else if (objType === 'cylinder') objRadius = 0.5;
            else if (objType === 'tree') objRadius = 0.4;

            // Simple circle collision
            const dx = position.x - objPos.x;
            const dz = position.z - objPos.z;
            const distSq = dx * dx + dz * dz;
            const minDist = radius + objRadius;

            if (distSq < minDist * minDist) {
                return true; // Collision!
            }
        }

        // Check collision with entity avatars (except self and possessed entity)
        for (const [id, entity] of this.entities) {
            if (entity === this.localEntity) continue;
            if (this.controlMode === ControlMode.TAKEOVER && entity === this.observedEntity) continue;
            if (!entity.avatar) continue;

            const dx = position.x - entity.position.x;
            const dz = position.z - entity.position.z;
            const distSq = dx * dx + dz * dz;
            const minDist = radius + 0.5; // Entity collision radius

            if (distSq < minDist * minDist) {
                return true;
            }
        }

        // World bounds
        if (Math.abs(position.x) > 45 || Math.abs(position.z) > 45) {
            return true;
        }

        return false;
    }

    // ===========================================
    // CLICK TO INTERACT WITH ENTITIES
    // ===========================================
    setupClickInteraction() {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        document.addEventListener('click', (event) => {
            // Don't interact if clicking on UI elements (except action menu options)
            if (event.target.closest('.entity-panel, .observation-panel, .chat-panel, .builder-panel, .reality-mirror, .modal-overlay, .top-bar')) {
                return;
            }

            // If action menu is active and we have a gazed action, select it
            if (this.actionMenuActive && this.gazedAction) {
                this.handleActionMenuClick(this.gazedAction, this.actionMenuTarget);
                return;
            }

            // If action menu is active but no gazed action, close it
            if (this.actionMenuActive) {
                this.hideActionMenu();
                return;
            }

            // Calculate mouse position in normalized device coordinates
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            // Raycast from camera
            raycaster.setFromCamera(mouse, this.camera);

            // Find entity avatars
            const avatars = [];
            this.entities.forEach(entity => {
                if (entity.avatar && entity !== this.localEntity) {
                    avatars.push(entity.avatar);
                }
            });

            const intersects = raycaster.intersectObjects(avatars, true);

            if (intersects.length > 0) {
                // Find which entity was clicked
                let clickedAvatar = intersects[0].object;
                while (clickedAvatar.parent && !clickedAvatar.userData?.entityId) {
                    clickedAvatar = clickedAvatar.parent;
                }

                const entityId = clickedAvatar.userData?.entityId;
                if (entityId) {
                    const entity = this.entities.get(entityId);
                    if (entity) {
                        this.onEntityClicked(entity, event.clientX, event.clientY);
                    }
                }
            }
        });
    }

    onEntityClicked(entity, screenX, screenY) {
        // Show Mass Effect-style action menu
        console.log(`Clicked on ${entity.name} (${entity.type})`);

        // Visual feedback - make entity look at camera
        if (entity.avatar) {
            const dx = this.camera.position.x - entity.position.x;
            const dz = this.camera.position.z - entity.position.z;
            entity.avatar.rotation.y = Math.atan2(dx, dz);
        }

        // Play interaction sound
        this.playSound('interact');

        // Show action menu at click position
        this.showActionMenu(entity, screenX, screenY);
    }

    showActionMenu(entity, x, y) {
        this.actionMenuTarget = entity;
        this.actionMenuActive = true;
        this.gazedAction = null;
        this.lastGazedAction = null;

        // Define action options as vertical dialog list
        this.actionMenuOptions = [
            { action: 'observe', icon: '👁', label: 'Observe' },
            { action: 'talk', icon: '💬', label: 'Talk' },
            { action: 'follow', icon: '🚶', label: 'Follow' },
            { action: 'guide', icon: '🎯', label: 'Guide' },
            { action: 'possess', icon: '👤', label: 'Control' },
            { action: 'custom', icon: '✏️', label: 'Say...' }
        ];

        const menu = document.getElementById('world-action-menu');
        const dialog = document.getElementById('world-action-dialog');
        const header = document.getElementById('world-action-header');

        // Clear existing options
        dialog.querySelectorAll('.world-action-option').forEach(el => el.remove());

        // Set header
        header.textContent = entity.name;

        // Create option elements in dialog (vertical list)
        this.actionMenuOptions.forEach((opt, index) => {
            const el = document.createElement('div');
            el.className = 'world-action-option';
            el.dataset.action = opt.action;
            el.dataset.index = index;
            el.innerHTML = `<span class="icon">${opt.icon}</span><span class="label">${opt.label}</span>`;
            el.onclick = () => this.handleActionMenuClick(opt.action, entity);
            dialog.appendChild(el);
        });

        // Show menu and crosshair
        menu.classList.add('visible');
        document.getElementById('gaze-crosshair').classList.add('visible');
        document.getElementById('world-action-hint').style.display = 'block';

        // Play menu open sound
        this.playUISound('menuOpen');

        // Initial position update
        this.updateActionMenuPositions();
    }

    hideActionMenu() {
        const menu = document.getElementById('world-action-menu');
        const dialog = document.getElementById('world-action-dialog');
        menu.classList.remove('visible');
        dialog.querySelectorAll('.world-action-option').forEach(el => el.remove());
        document.getElementById('gaze-crosshair').classList.remove('visible');
        document.getElementById('world-action-hint').style.display = 'none';
        this.actionMenuTarget = null;
        this.actionMenuActive = false;
        this.gazedAction = null;
        this.lastGazedAction = null;
    }

    updateActionMenuPositions() {
        if (!this.actionMenuTarget || !this.actionMenuActive) return;

        const entity = this.actionMenuTarget;
        const menu = document.getElementById('world-action-menu');
        const dialog = document.getElementById('world-action-dialog');

        // Get entity's screen position (at head level) - CYCLE 3: use pooled vectors
        const entityPos = this._vecPool.entityPos.set(
            entity.position.x,
            entity.position.y + 2.2,
            entity.position.z
        );

        // Project to screen - use pooled screenPos
        const screenPos = this._vecPool.screenPos.copy(entityPos).project(this.camera);
        const centerX = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
        const centerY = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

        // Check if entity is behind camera - use pooled vectors
        const toEntity = this._vecPool.toEntity.copy(entityPos).sub(this.camera.position);
        const cameraDir = this._vecPool.cameraDir;
        this.camera.getWorldDirection(cameraDir);
        const isBehind = toEntity.dot(cameraDir) < 0;

        if (isBehind) {
            menu.style.opacity = '0.3';
        } else {
            menu.style.opacity = '1';
        }

        // Position the entire dialog box centered on entity
        dialog.style.left = centerX + 'px';
        dialog.style.top = centerY + 'px';
    }

    updateGazeSelection() {
        if (!this.actionMenuActive) return;

        const dialog = document.getElementById('world-action-dialog');
        const options = dialog.querySelectorAll('.world-action-option');
        const screenCenterY = window.innerHeight / 2;

        let closestOption = null;
        let closestDist = Infinity;

        // For vertical list, only check Y distance (vertical proximity)
        options.forEach(el => {
            const rect = el.getBoundingClientRect();
            const optCenterY = rect.top + rect.height / 2;
            const dist = Math.abs(screenCenterY - optCenterY);

            el.classList.remove('gazed');

            if (dist < closestDist) {
                closestDist = dist;
                closestOption = el;
            }
        });

        // Always have something selected
        if (closestOption) {
            closestOption.classList.add('gazed');
            const newAction = closestOption.dataset.action;

            // Play hover sound when selection changes
            if (this.lastGazedAction !== newAction) {
                const index = parseInt(closestOption.dataset.index) || 0;
                // Pan based on vertical position in menu (top = slight up, bottom = slight down)
                const pan = (index - 2.5) * 0.15; // Subtle stereo position
                this.playUISound('hover', pan);
                this.lastGazedAction = newAction;
            }

            this.gazedAction = newAction;
        }
    }

    handleActionMenuClick(action, entity) {
        // Play click sound before hiding menu
        this.playUISound('select');
        this.hideActionMenu();

        switch (action) {
            case 'observe':
                this.observeEntity(entity);
                document.getElementById('observation-panel').classList.add('visible');
                entity.log(`Being observed by player`, 'action');
                break;

            case 'talk':
                this.observeEntity(entity);
                // Open chat and greet
                document.getElementById('chat-panel').classList.remove('hidden');
                const chatInput = document.getElementById('chat-input');
                chatInput.focus();
                chatInput.placeholder = `Chat with ${entity.name}...`;
                this.addChatMessage(entity.name, `Hello! I'm ${entity.name}. How can I help you?`, 'ai');
                entity.log(`Engaged in conversation with player`, 'action');
                break;

            case 'follow':
                // Make entity follow the player
                entity.currentTask = `Following ${this.localEntity?.name || 'player'}`;
                entity.state = EntityState.WORKING;
                this.addChatMessage(entity.name, `I'll follow you!`, 'ai');
                entity.log(`Started following player`, 'action');
                // Set up follow behavior
                entity.followTarget = this.localEntity?.id;
                break;

            case 'guide':
                this.setControlMode(ControlMode.GUIDE);
                this.observeEntity(entity);
                document.getElementById('observation-panel').classList.add('visible');
                this.addChatMessage('System', `Guiding ${entity.name}. Click in the world to direct them.`, 'system');
                entity.log(`Player is now guiding`, 'action');
                break;

            case 'possess':
                this.setControlMode(ControlMode.TAKEOVER);
                this.observeEntity(entity);
                this.possessEntity(entity);
                this.addChatMessage('System', `You are now controlling ${entity.name}. Press ESC to release.`, 'system');
                entity.log(`Player took control`, 'action');
                break;

            case 'custom':
                // Open chat for custom message
                document.getElementById('chat-panel').classList.remove('hidden');
                const input = document.getElementById('chat-input');
                input.focus();
                input.placeholder = `Say something to ${entity.name}...`;
                input.value = '';
                // Store target entity for the message
                this.chatTargetEntity = entity;
                break;
        }
    }

    // ===========================================
    // AMBIENT AUDIO SYSTEM
    // ===========================================
    setupAudio() {
        // Audio will be initialized on first user interaction (browser requirement)
        const initHandler = () => {
            this.initAudioOnInteraction();
            document.removeEventListener('click', initHandler);
            document.removeEventListener('keydown', initHandler);
        };
        document.addEventListener('click', initHandler);
        document.addEventListener('keydown', initHandler);
    }

    initAudioOnInteraction() {
        if (this.audio.listener) return;

        try {
            // Initialize Three.js AudioListener
            this.audio.listener = new THREE.AudioListener();
            if (this.camera) {
                this.camera.add(this.audio.listener);
            }

            this.audio.context = this.audio.listener.context;
            this.audio.enabled = true;

            // Master volume control via listener
            this.audio.listener.setMasterVolume(this.audio.masterVolume);

            // Start ambient drone (global, non-spatial)
            this.generateAmbientDrone();

            console.log('[Audio] Spatial audio system initialized');
        } catch (e) {
            console.warn('[Audio] Could not initialize audio:', e);
        }
    }

    generateAmbientDrone() {
        if (!this.audio.listener) return;

        // Create a global audio source for ambient background
        const sound = new THREE.Audio(this.audio.listener);

        // Procedural generation using Web Audio API graph
        // We create a custom node chain and connect it to the Three.js audio object
        const audioContext = this.audio.context;
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        const filterNode = audioContext.createBiquadFilter();

        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 50; // Low drone

        // LFO for modulation
        const lfo = audioContext.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.1; // Slow modulation
        const lfoGain = audioContext.createGain();
        lfoGain.gain.value = 500; // Modulation depth
        lfo.connect(lfoGain);
        lfoGain.connect(filterNode.frequency);
        lfo.start();

        filterNode.type = 'lowpass';
        filterNode.frequency.value = 800;
        filterNode.Q.value = 1;

        gainNode.gain.value = 0.05; // Quiet ambient

        // Connect graph
        oscillator.connect(filterNode);
        filterNode.connect(gainNode);

        // Connect to Three.js audio
        sound.setNodeSource(gainNode); // This allows us to use the custom graph as source
        // Note: For setNodeSource, we normally don't call .start() on the source if it's an oscillator controlled manually, 
        // but here we are constructing a graph. setNodeSource expects an AudioNode (usually source). 
        // However, Three.js Audio implementation of setNodeSource connects the passed node to its internal gain.
        // We need to start the oscillator ourselves.
        oscillator.start();

        this.audio.ambientSound = sound;
        this.audio.ambientOscillators.push({ osc: oscillator, lfo: lfo });
    }

    playSpatialSound(type, position) {
        if (!this.audio.listener || !this.audio.enabled) return;

        const sound = new THREE.PositionalAudio(this.audio.listener);

        // Setup based on sound type
        const audioContext = this.audio.context;
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const envelope = audioContext.createGain();

        osc.connect(envelope);
        envelope.connect(gain);

        // Connect to the Three.js positional audio panner
        sound.setNodeSource(gain);

        const now = audioContext.currentTime;

        switch (type) {
            case 'footstep':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
                envelope.gain.setValueAtTime(0.5, now);
                envelope.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                sound.setRefDistance(5);
                sound.setRolloffFactor(2);
                break;

            case 'blip':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
                envelope.gain.setValueAtTime(0.3, now);
                envelope.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;

            case 'teleport':
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.linearRampToValueAtTime(2000, now + 0.5);
                envelope.gain.setValueAtTime(0, now);
                envelope.gain.linearRampToValueAtTime(0.5, now + 0.1);
                envelope.gain.linearRampToValueAtTime(0, now + 0.5);
                osc.start(now);
                osc.stop(now + 0.5);
                break;

            case 'chat':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.setValueAtTime(800, now + 0.1);
                envelope.gain.setValueAtTime(0.2, now);
                envelope.gain.linearRampToValueAtTime(0, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
                break;
        }

        // Position the sound
        if (position) {
            sound.position.copy(position);
        } else if (this.localEntity) {
            sound.position.copy(this.localEntity.position);
        }

        this.scene.add(sound);

        // Cleanup after playing
        setTimeout(() => {
            this.scene.remove(sound);
            sound.disconnect();
        }, 1000);
    }

    playSound(type, options = {}) {
        if (!this.audio.listener || !this.audio.enabled) return;

        const position = options.position
            ? new THREE.Vector3(options.position.x, options.position.y, options.position.z)
            : null;

        // Route interactions to spatial sound system
        if (type === 'interact') {
            this.playSpatialSound('blip', position);
        } else if (type === 'possess') {
            this.playSpatialSound('teleport', position);
        } else if (type === 'step') {
            this.playSpatialSound('footstep', position);
        } else if (type === 'chat') {
            this.playSpatialSound('chat', position);
        }
    } else if(type === 'release') {
    this.playSpatialSound('teleport', position);
} else if (type === 'notification') {
    this.playSpatialSound('blip', position);
} else if (type === 'portal') {
    this.playSpatialSound('teleport', position);
}
    }

// Spatial UI sounds for tactile feedback
playUISound(type, pan = 0) {
    if (!this.audio.context || !this.audio.enabled) return;

    const ctx = this.audio.context;
    const now = ctx.currentTime;

    // Create stereo panner for spatial positioning
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan)); // Clamp -1 to 1

    const gain = ctx.createGain();

    switch (type) {
        case 'hover':
            // Soft, subtle tick - like a tactile button edge
            const tickOsc = ctx.createOscillator();
            tickOsc.type = 'sine';
            tickOsc.frequency.value = 880; // A5 - clean, not annoying

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.06, now + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

            tickOsc.connect(gain);
            gain.connect(panner);
            panner.connect(this.audio.effectsGain);

            tickOsc.start(now);
            tickOsc.stop(now + 0.06);
            break;

        case 'select':
            // Satisfying click confirmation - two quick tones
            const clickFreqs = [660, 880];
            clickFreqs.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.value = freq;

                const clickGain = ctx.createGain();
                const startTime = now + (i * 0.03);
                clickGain.gain.setValueAtTime(0, startTime);
                clickGain.gain.linearRampToValueAtTime(0.1, startTime + 0.01);
                clickGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);

                osc.connect(clickGain);
                clickGain.connect(panner);
                panner.connect(this.audio.effectsGain);

                osc.start(startTime);
                osc.stop(startTime + 0.1);
            });
            break;

        case 'menuOpen':
            // Gentle whoosh up - menu appearing
            const openOsc = ctx.createOscillator();
            openOsc.type = 'sine';
            openOsc.frequency.setValueAtTime(200, now);
            openOsc.frequency.exponentialRampToValueAtTime(400, now + 0.08);

            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.05, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

            openOsc.connect(gain);
            gain.connect(this.audio.effectsGain);

            openOsc.start(now);
            openOsc.stop(now + 0.15);
            break;

        case 'menuClose':
            // Gentle whoosh down - menu closing
            const closeOsc = ctx.createOscillator();
            closeOsc.type = 'sine';
            closeOsc.frequency.setValueAtTime(400, now);
            closeOsc.frequency.exponentialRampToValueAtTime(200, now + 0.08);

            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

            closeOsc.connect(gain);
            gain.connect(this.audio.effectsGain);

            closeOsc.start(now);
            closeOsc.stop(now + 0.12);
            break;
    }
}

playChime(frequencies, volume = 0.1, duration = 0.3) {
    if (!this.audio.context) return;

    const ctx = this.audio.context;
    const now = ctx.currentTime;

    frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, now + (i * 0.05));
        gain.gain.linearRampToValueAtTime(volume, now + (i * 0.05) + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + (i * 0.05) + duration);

        osc.connect(gain);
        gain.connect(this.audio.effectsGain);

        osc.start(now + (i * 0.05));
        osc.stop(now + (i * 0.05) + duration + 0.1);
    });
}

playWhoosh() {
    if (!this.audio.context) return;

    const ctx = this.audio.context;
    const now = ctx.currentTime;

    // Filtered noise whoosh
    const bufferSize = ctx.sampleRate * 0.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.linearRampToValueAtTime(2000, now + 0.2);
    filter.frequency.linearRampToValueAtTime(500, now + 0.4);
    filter.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.audio.effectsGain);

    noise.start(now);
    noise.stop(now + 0.5);
}

playSweep(startFreq, endFreq, duration) {
    if (!this.audio.context) return;

    const ctx = this.audio.context;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.audio.effectsGain);

    osc.start(now);
    osc.stop(now + duration + 0.1);
}

toggleAudio() {
    if (this.audio.enabled) {
        this.audio.ambientGain.gain.value = 0;
        this.audio.effectsGain.gain.value = 0;
        this.audio.enabled = false;
    } else {
        this.audio.ambientGain.gain.value = 0.15;
        this.audio.effectsGain.gain.value = 0.4;
        this.audio.enabled = true;
    }
    return this.audio.enabled;
}

setAudioVolume(volume) {
    this.audio.masterVolume = Math.max(0, Math.min(1, volume));
    if (this.audio.context) {
        // Update master gain (connected to destination)
        // For simplicity, adjust ambient and effects directly
        this.audio.ambientGain.gain.value = 0.15 * volume;
        this.audio.effectsGain.gain.value = 0.4 * volume;
    }
}

// ===========================================
// MINIMAP
// ===========================================
setupMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    canvas.width = 150;
    canvas.height = 150;
    this.minimapCtx = canvas.getContext('2d');
}

setupPOVCamera() {
    // Create a secondary camera for entity POV
    this.povCamera = new THREE.PerspectiveCamera(75, 350 / 200, 0.1, 500);

    // Create a secondary renderer for the POV viewport
    const povCanvas = document.getElementById('obs-canvas');
    this.povRenderer = new THREE.WebGLRenderer({
        canvas: povCanvas,
        antialias: false,
        alpha: true
    });
    this.povRenderer.setSize(350, 200);
    this.povRenderer.setPixelRatio(1); // Lower quality for performance
}

// ===========================================
// REALITY MIRROR - Webcam for AI Perception
// ===========================================
setupRealityMirror() {
    this.realityMirror.video = document.getElementById('reality-video');
    this.realityMirror.canvas = document.getElementById('reality-canvas');
    this.realityMirror.ctx = this.realityMirror.canvas?.getContext('2d');
}

    async enableRealityMirror() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        });

        this.realityMirror.stream = stream;
        this.realityMirror.video.srcObject = stream;
        this.realityMirror.enabled = true;

        // Hide offline message, show video
        document.getElementById('mirror-offline').style.display = 'none';
        this.realityMirror.video.style.display = 'block';

        // Update status
        const dot = document.getElementById('mirror-status-dot');
        const text = document.getElementById('mirror-status-text');
        dot.classList.add('active');
        text.textContent = 'Camera active';

        console.log('[Reality Portal] Camera enabled');

        // Auto-enable AI gaze after camera is on
        if (!this.realityMirror.aiGazeActive) {
            this.toggleAIGaze();
        }

    } catch (err) {
        console.error('[Reality Portal] Camera access denied:', err);
        document.getElementById('perception-text').textContent =
            'Camera access denied. Please allow camera permissions to enable AI perception.';
    }
}

disableRealityMirror() {
    if (this.realityMirror.stream) {
        this.realityMirror.stream.getTracks().forEach(track => track.stop());
        this.realityMirror.stream = null;
    }

    this.realityMirror.enabled = false;
    this.realityMirror.video.srcObject = null;

    // Show offline message
    document.getElementById('mirror-offline').style.display = 'block';
    this.realityMirror.video.style.display = 'none';

    // Update status
    const dot = document.getElementById('mirror-status-dot');
    const text = document.getElementById('mirror-status-text');
    dot.classList.remove('active', 'watching');
    text.textContent = 'Camera offline';

    // Stop AI gaze
    if (this.realityMirror.aiGazeActive) {
        this.toggleAIGaze();
    }

    console.log('[Reality Portal] Camera disabled');
}

toggleAIGaze() {
    this.realityMirror.aiGazeActive = !this.realityMirror.aiGazeActive;

    const btn = document.getElementById('mirror-ai-gaze');
    const indicator = document.getElementById('ai-gaze-indicator');
    const gazeText = document.getElementById('ai-gaze-text');
    const statusDot = document.getElementById('mirror-status-dot');

    if (this.realityMirror.aiGazeActive && this.realityMirror.enabled) {
        btn.classList.add('active');
        indicator.classList.add('active');
        gazeText.textContent = 'AI observing';
        statusDot.classList.add('watching');

        // Start perception loop
        this.startAIPerception();

    } else {
        btn.classList.remove('active');
        indicator.classList.remove('active');
        gazeText.textContent = 'AI not watching';
        statusDot.classList.remove('watching');

        // Stop perception loop
        this.stopAIPerception();
    }
}

startAIPerception() {
    if (this.realityMirror.perceptionInterval) {
        clearInterval(this.realityMirror.perceptionInterval);
    }

    // Initial perception
    this.captureAndAnalyze();

    // Periodic perception
    this.realityMirror.perceptionInterval = setInterval(() => {
        this.captureAndAnalyze();
    }, this.realityMirror.captureInterval);
}

stopAIPerception() {
    if (this.realityMirror.perceptionInterval) {
        clearInterval(this.realityMirror.perceptionInterval);
        this.realityMirror.perceptionInterval = null;
    }
}

    async captureAndAnalyze() {
    if (!this.realityMirror.enabled || !this.realityMirror.video) return;

    const video = this.realityMirror.video;
    const canvas = this.realityMirror.canvas;
    const ctx = this.realityMirror.ctx;

    if (!canvas || !ctx) return;

    // Set canvas size to match video
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get image data as base64
    const imageData = canvas.toDataURL('image/jpeg', 0.7);

    // Store last capture for AI agents to access
    this.realityMirror.lastCapture = {
        timestamp: Date.now(),
        imageData: imageData,
        width: canvas.width,
        height: canvas.height
    };

    // Generate local perception (placeholder for real AI vision)
    const perception = this.generateLocalPerception();
    this.realityMirror.lastPerception = perception;

    // Update UI
    document.getElementById('perception-text').textContent = perception;

    // Notify any observing AI agents
    this.notifyAgentsOfRealityUpdate(perception, imageData);
}

generateLocalPerception() {
    // Enhanced vision analysis simulation
    // In production, this would use TensorFlow.js, MediaPipe, or similar
    const canvas = this.realityMirror.canvas;
    const ctx = this.realityMirror.ctx;

    if (!canvas || !ctx) {
        return 'Vision system initializing...';
    }

    try {
        // Get image data for analysis
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Basic image analysis
        let totalBrightness = 0;
        let totalRed = 0, totalGreen = 0, totalBlue = 0;

        // Sample every 10th pixel for performance
        for (let i = 0; i < data.length; i += 40) {
            totalRed += data[i];
            totalGreen += data[i + 1];
            totalBlue += data[i + 2];
            totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }

        const pixelCount = data.length / 40;
        const avgBrightness = Math.round(totalBrightness / pixelCount);
        const avgRed = Math.round(totalRed / pixelCount);
        const avgGreen = Math.round(totalGreen / pixelCount);
        const avgBlue = Math.round(totalBlue / pixelCount);

        // Determine dominant color
        let dominantColor = 'neutral';
        if (avgRed > avgGreen && avgRed > avgBlue) dominantColor = 'warm';
        else if (avgBlue > avgRed && avgBlue > avgGreen) dominantColor = 'cool';
        else if (avgGreen > avgRed && avgGreen > avgBlue) dominantColor = 'natural';

        // Determine lighting condition
        let lighting = 'moderate';
        if (avgBrightness < 50) lighting = 'low';
        else if (avgBrightness > 150) lighting = 'bright';

        // Time context
        const time = new Date();
        const timeContext = time.getHours() < 12 ? 'morning' :
            time.getHours() < 17 ? 'afternoon' : 'evening';

        // Build perception description
        const perceptions = [
            `Scene analysis: ${lighting} lighting, ${dominantColor} tones detected.`,
            `Visual input: ${avgBrightness}/255 brightness, ${dominantColor} color balance.`,
            `Environment scan: ${lighting} illumination, ${timeContext} ambient conditions.`,
            `Optical data: Brightness ${avgBrightness}, dominant ${dominantColor} spectrum.`
        ];

        // Motion detection (simple version - compare to last frame if available)
        let motionHint = '';
        if (this.realityMirror.lastImageData) {
            let diff = 0;
            const lastData = this.realityMirror.lastImageData;
            for (let i = 0; i < Math.min(data.length, lastData.length); i += 400) {
                diff += Math.abs(data[i] - lastData[i]);
            }
            const motionLevel = Math.round(diff / (data.length / 400));
            if (motionLevel > 10) motionHint = ' [Motion detected]';
            else if (motionLevel < 3) motionHint = ' [Scene stable]';
        }

        // Store current frame data for next comparison
        this.realityMirror.lastImageData = new Uint8ClampedArray(data);

        return perceptions[Math.floor(Math.random() * perceptions.length)] + motionHint;

    } catch (e) {
        console.warn('Reality Portal perception error:', e);
        return 'Processing visual input from physical environment...';
    }
}

notifyAgentsOfRealityUpdate(perception, imageData) {
    // Notify AgentController of reality update
    if (window.agentController) {
        window.agentController.onRealityUpdate({
            perception,
            imageData,
            timestamp: Date.now()
        });
    }

    // CYCLE 2: Add AI observations to shared knowledge
    const aiEntities = Array.from(this.entities.values()).filter(e => e.type === EntityType.AI);
    if (aiEntities.length > 0 && perception) {
        // Pick a random AI entity to "observe" this
        const observer = aiEntities[Math.floor(Math.random() * aiEntities.length)];
        this.addKnowledge(
            observer.id,
            observer.name,
            'observation',
            perception
        );
    }
}

// Reality Portal UI Controls
showRealityMirror() {
    document.getElementById('reality-mirror').classList.remove('hidden', 'minimized');
    document.getElementById('reality-toggle').classList.add('hidden');
}

hideRealityMirror() {
    document.getElementById('reality-mirror').classList.add('hidden');
    document.getElementById('reality-toggle').classList.remove('hidden');
}

minimizeRealityMirror() {
    document.getElementById('reality-mirror').classList.add('minimized');
}

toggleRealityMirror() {
    const mirror = document.getElementById('reality-mirror');
    if (mirror.classList.contains('minimized')) {
        mirror.classList.remove('minimized');
    } else {
        mirror.classList.add('minimized');
    }
}

// CYCLE 2: Knowledge Panel Toggle
toggleKnowledgePanel() {
    const panel = document.getElementById('knowledge-panel');
    const toggle = document.getElementById('knowledge-toggle');
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        toggle.classList.add('hidden');
    } else {
        panel.classList.add('hidden');
        toggle.classList.remove('hidden');
    }
}

// Get current reality snapshot for AI agents
getRealitySnapshot() {
    return {
        enabled: this.realityMirror.enabled,
        aiGazeActive: this.realityMirror.aiGazeActive,
        lastPerception: this.realityMirror.lastPerception,
        lastCapture: this.realityMirror.lastCapture,
        timestamp: Date.now()
    };
}

    // ===========================================
    // MEDIAPIPE GESTURE RECOGNITION
    // ===========================================
    async setupMediaPipe() {
    // Check if MediaPipe is available
    if (typeof Hands === 'undefined') {
        console.warn('[MediaPipe] Hands library not loaded');
        return;
    }

    this.mediaPipe.gestureCanvas = document.getElementById('gesture-canvas');
    this.mediaPipe.gestureCtx = this.mediaPipe.gestureCanvas?.getContext('2d');

    // Initialize MediaPipe Hands
    this.mediaPipe.hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    this.mediaPipe.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5
    });

    this.mediaPipe.hands.onResults((results) => this.onHandsResults(results));

    console.log('[MediaPipe] Gesture recognition initialized');
}

toggleGestureRecognition() {
    if (this.mediaPipe.enabled) {
        this.stopGestureRecognition();
    } else {
        this.startGestureRecognition();
    }
}

    async startGestureRecognition() {
    if (!this.realityMirror.enabled) {
        console.warn('[MediaPipe] Camera must be enabled first');
        // Auto-enable camera
        await this.enableRealityMirror();
    }

    if (!this.mediaPipe.hands) {
        await this.setupMediaPipe();
    }

    if (!this.mediaPipe.hands) {
        console.error('[MediaPipe] Failed to initialize hands tracking');
        return;
    }

    // Set canvas dimensions
    const video = this.realityMirror.video;
    if (this.mediaPipe.gestureCanvas) {
        this.mediaPipe.gestureCanvas.width = video.videoWidth || 640;
        this.mediaPipe.gestureCanvas.height = video.videoHeight || 480;
    }

    // Start camera feed to MediaPipe
    this.mediaPipe.camera = new Camera(video, {
        onFrame: async () => {
            if (this.mediaPipe.enabled && this.mediaPipe.hands) {
                await this.mediaPipe.hands.send({ image: video });
            }
        },
        width: 640,
        height: 480
    });

    await this.mediaPipe.camera.start();
    this.mediaPipe.enabled = true;

    // Update UI
    document.getElementById('mirror-gesture-toggle')?.classList.add('active');
    console.log('[MediaPipe] Gesture recognition started');
}

stopGestureRecognition() {
    this.mediaPipe.enabled = false;

    if (this.mediaPipe.camera) {
        this.mediaPipe.camera.stop();
        this.mediaPipe.camera = null;
    }

    // Clear gesture canvas
    if (this.mediaPipe.gestureCtx && this.mediaPipe.gestureCanvas) {
        this.mediaPipe.gestureCtx.clearRect(
            0, 0,
            this.mediaPipe.gestureCanvas.width,
            this.mediaPipe.gestureCanvas.height
        );
    }

    // Hide gesture indicator
    document.getElementById('gesture-indicator')?.classList.remove('active');
    document.getElementById('mirror-gesture-toggle')?.classList.remove('active');

    console.log('[MediaPipe] Gesture recognition stopped');
}

onHandsResults(results) {
    if (!this.mediaPipe.gestureCtx || !this.mediaPipe.gestureCanvas) return;

    const ctx = this.mediaPipe.gestureCtx;
    const canvas = this.mediaPipe.gestureCanvas;

    // Clear previous frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        // Draw hand landmarks
        for (const landmarks of results.multiHandLandmarks) {
            this.drawHandLandmarks(ctx, landmarks, canvas.width, canvas.height);
        }

        // Update pinch cursor with first hand landmarks
        this.updatePinchCursor(results.multiHandLandmarks[0]);

        // Recognize gesture from first hand (only if cursor not in use or gesture is clear)
        const gesture = this.recognizeGesture(results.multiHandLandmarks[0]);
        // Don't process gestures while actively using pinch cursor in pinching state
        if (!this.mediaPipe.cursor.isPinching) {
            this.processGesture(gesture);
        }
    } else {
        // No hands detected
        this.processGesture(null);
        this.updatePinchCursor(null);
    }
}

drawHandLandmarks(ctx, landmarks, width, height) {
    // Draw connections
    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8],       // Index
        [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
        [0, 13], [13, 14], [14, 15], [15, 16], // Ring
        [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [5, 9], [9, 13], [13, 17]              // Palm
    ];

    ctx.strokeStyle = 'rgba(0, 212, 255, 0.8)';
    ctx.lineWidth = 2;

    for (const [start, end] of connections) {
        const startPoint = landmarks[start];
        const endPoint = landmarks[end];
        ctx.beginPath();
        ctx.moveTo(startPoint.x * width, startPoint.y * height);
        ctx.lineTo(endPoint.x * width, endPoint.y * height);
        ctx.stroke();
    }

    // Draw landmark points
    ctx.fillStyle = '#00ff88';
    for (const landmark of landmarks) {
        ctx.beginPath();
        ctx.arc(landmark.x * width, landmark.y * height, 4, 0, Math.PI * 2);
        ctx.fill();
    }
}

recognizeGesture(landmarks) {
    if (!landmarks || landmarks.length < 21) return null;

    // Finger tip and base indices
    const fingerTips = [4, 8, 12, 16, 20];
    const fingerBases = [2, 5, 9, 13, 17];
    const fingerMids = [3, 6, 10, 14, 18];

    // Calculate which fingers are extended
    const fingersExtended = [];

    // Thumb (special case - check x position relative to palm)
    const thumbTip = landmarks[4];
    const thumbBase = landmarks[2];
    const palmCenter = landmarks[0];
    const thumbExtended = Math.abs(thumbTip.x - palmCenter.x) > Math.abs(thumbBase.x - palmCenter.x);
    fingersExtended.push(thumbExtended);

    // Other fingers - check if tip is above base (y is inverted)
    for (let i = 1; i < fingerTips.length; i++) {
        const tip = landmarks[fingerTips[i]];
        const base = landmarks[fingerBases[i]];
        const mid = landmarks[fingerMids[i]];
        // Finger is extended if tip is above mid and mid is above base
        const extended = tip.y < mid.y && mid.y < base.y;
        fingersExtended.push(extended);
    }

    const [thumb, index, middle, ring, pinky] = fingersExtended;

    // Gesture recognition based on finger positions
    // Thumbs up: only thumb extended, pointing up
    if (thumb && !index && !middle && !ring && !pinky) {
        const thumbUp = landmarks[4].y < landmarks[3].y;
        if (thumbUp) return 'thumbs_up';
        return 'thumbs_down';
    }

    // Open palm: all fingers extended
    if (thumb && index && middle && ring && pinky) {
        return 'open_palm';
    }

    // Fist: no fingers extended
    if (!thumb && !index && !middle && !ring && !pinky) {
        return 'fist';
    }

    // Peace sign: index and middle extended
    if (!thumb && index && middle && !ring && !pinky) {
        return 'peace';
    }

    // Pointing: only index extended
    if (!thumb && index && !middle && !ring && !pinky) {
        return 'pointing';
    }

    // Wave detection (all fingers extended and hand moving side to side)
    // For simplicity, we'll use open palm with rapid x movement
    // This would need motion tracking for proper detection
    if (index && middle && ring && pinky) {
        // Check for wave by looking at wrist position changes
        // For now, open palm counts as potential wave
        return 'open_palm';
    }

    return null;
}

processGesture(gesture) {
    const indicator = document.getElementById('gesture-indicator');
    const iconEl = document.getElementById('gesture-icon');
    const nameEl = document.getElementById('gesture-name');

    if (!gesture) {
        // No gesture detected
        this.mediaPipe.lastGesture = null;
        this.mediaPipe.gestureStartTime = 0;
        indicator?.classList.remove('active');
        return;
    }

    const gestureInfo = this.mediaPipe.gestureActions[gesture];
    if (!gestureInfo) return;

    // Update indicator
    indicator?.classList.add('active');
    if (iconEl) iconEl.textContent = gestureInfo.icon;
    if (nameEl) nameEl.textContent = gestureInfo.name;

    // Track gesture hold time
    const now = Date.now();

    if (gesture !== this.mediaPipe.lastGesture) {
        // New gesture started
        this.mediaPipe.lastGesture = gesture;
        this.mediaPipe.gestureStartTime = now;
    } else {
        // Same gesture continuing
        const holdTime = now - this.mediaPipe.gestureStartTime;

        // Check if gesture held long enough to trigger action
        if (holdTime >= this.mediaPipe.gestureThreshold && !this.mediaPipe.cooldown) {
            this.triggerGestureAction(gesture, gestureInfo);
        }
    }
}

triggerGestureAction(gesture, gestureInfo) {
    // Start cooldown
    this.mediaPipe.cooldown = true;
    setTimeout(() => {
        this.mediaPipe.cooldown = false;
    }, this.mediaPipe.cooldownTime);

    // Reset gesture tracking
    this.mediaPipe.gestureStartTime = Date.now();

    // Show visual feedback
    this.showGestureActionFeedback(gestureInfo);

    // Play sound
    this.playSound('interact');

    // Execute action based on gesture
    switch (gestureInfo.action) {
        case 'approve':
            this.onGestureApprove();
            break;
        case 'reject':
            this.onGestureReject();
            break;
        case 'stop':
            this.onGestureStop();
            break;
        case 'grab':
            this.onGestureGrab();
            break;
        case 'peace':
            this.onGesturePeace();
            break;
        case 'point':
            this.onGesturePoint();
            break;
        case 'wave':
            this.onGestureWave();
            break;
    }

    // Notify callbacks
    this.mediaPipe.gestureCallbacks.forEach(cb => {
        try {
            cb(gesture, gestureInfo);
        } catch (e) {
            console.error('Gesture callback error:', e);
        }
    });

    console.log(`[Gesture] Action triggered: ${gestureInfo.action}`);
}

showGestureActionFeedback(gestureInfo) {
    // Create feedback element
    const feedback = document.createElement('div');
    feedback.className = 'gesture-action-feedback';
    feedback.innerHTML = `
            <div class="icon">${gestureInfo.icon}</div>
            <div class="action">${gestureInfo.name}</div>
        `;
    document.body.appendChild(feedback);

    // Remove after animation
    setTimeout(() => {
        feedback.remove();
    }, 1500);
}

// Gesture action handlers
onGestureApprove() {
    // Thumbs up - confirm/approve current action
    this.addChatMessage('System', 'Gesture: Approved! (Thumbs Up)', 'system');

    // If observing an entity, send approval
    if (this.observedEntity) {
        this.observedEntity.log('Received approval gesture from human', 'input');
    }
}

onGestureReject() {
    // Thumbs down - reject/cancel
    this.addChatMessage('System', 'Gesture: Rejected! (Thumbs Down)', 'system');

    // If observing an entity, send rejection
    if (this.observedEntity) {
        this.observedEntity.log('Received rejection gesture from human', 'input');
    }
}

onGestureStop() {
    // Open palm - stop/pause
    this.addChatMessage('System', 'Gesture: Stop! (Open Palm)', 'system');

    // Stop all AI entities
    this.entities.forEach(entity => {
        if (entity.type === EntityType.AI) {
            entity.state = EntityState.IDLE;
            entity.log('Paused by human gesture', 'input');
        }
    });
}

onGestureGrab() {
    // Fist - grab/select nearest object or entity
    this.addChatMessage('System', 'Gesture: Grab! (Fist)', 'system');

    // Find nearest entity to camera and select it
    let nearest = null;
    let nearestDist = Infinity;

    this.entities.forEach(entity => {
        if (entity === this.localEntity) return;
        const dx = entity.position.x - this.camera.position.x;
        const dz = entity.position.z - this.camera.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearestDist && dist < 15) {
            nearestDist = dist;
            nearest = entity;
        }
    });

    if (nearest) {
        this.observeEntity(nearest);
        this.addChatMessage('System', `Selected ${nearest.name}`, 'system');
    }
}

onGesturePeace() {
    // Peace sign - toggle mode or special action
    this.addChatMessage('System', 'Gesture: Peace! (V Sign)', 'system');

    // Toggle between explore and observe modes
    if (this.currentMode === 'explore') {
        this.setMode('observe');
    } else {
        this.setMode('explore');
    }
}

onGesturePoint() {
    // Pointing - select/interact with pointed direction
    this.addChatMessage('System', 'Gesture: Point! (Pointing)', 'system');

    // Could implement raycast in pointing direction
    // For now, toggle AI gaze
    this.toggleAIGaze();
}

onGestureWave() {
    // Wave - greeting/hello
    this.addChatMessage('System', 'Gesture: Wave! Hello! (Waving)', 'system');

    // Make all AI entities acknowledge
    this.entities.forEach(entity => {
        if (entity.type === EntityType.AI) {
            entity.log('Human waved - greeting!', 'input');
        }
    });
}

// Register callback for gesture events
onGesture(callback) {
    this.mediaPipe.gestureCallbacks.push(callback);
}

// ===========================================
// PINCH CURSOR SYSTEM - Virtual Mouse Pointer
// ===========================================
initPinchCursor() {
    // Create cursor element if it doesn't exist
    if (!this.mediaPipe.cursor.element) {
        const cursor = document.createElement('div');
        cursor.className = 'pinch-cursor';
        cursor.id = 'pinch-cursor';
        cursor.innerHTML = `
                <div class="pinch-cursor-progress"></div>
                <div class="pinch-cursor-ring"></div>
                <div class="pinch-cursor-dot"></div>
            `;
        document.body.appendChild(cursor);
        this.mediaPipe.cursor.element = cursor;

        // Create trail container
        const trail = document.createElement('div');
        trail.className = 'pinch-cursor-trail';
        trail.id = 'pinch-cursor-trail';
        document.body.appendChild(trail);
        this.mediaPipe.cursor.trailElement = trail;
    }
}

togglePinchCursor() {
    this.mediaPipe.cursor.enabled = !this.mediaPipe.cursor.enabled;

    const btn = document.getElementById('mirror-cursor-toggle');
    const indicator = document.getElementById('cursor-mode-indicator');

    if (this.mediaPipe.cursor.enabled) {
        btn?.classList.add('active');
        indicator?.classList.add('active');
        this.initPinchCursor();

        // Auto-start gesture recognition if not running
        if (!this.mediaPipe.enabled) {
            this.startGestureRecognition();
        }

        console.log('[Pinch Cursor] Enabled');
    } else {
        btn?.classList.remove('active');
        indicator?.classList.remove('active');
        this.hidePinchCursor();
        console.log('[Pinch Cursor] Disabled');
    }
}

hidePinchCursor() {
    const cursor = this.mediaPipe.cursor.element;
    if (cursor) {
        cursor.classList.remove('visible', 'pinching', 'hovering');
    }
    this.mediaPipe.cursor.visible = false;

    // Clear any hover states
    if (this.mediaPipe.cursor.hoveredElement) {
        this.mediaPipe.cursor.hoveredElement.classList.remove('pinch-hovered');
        this.mediaPipe.cursor.hoveredElement = null;
    }
}

updatePinchCursor(landmarks) {
    if (!this.mediaPipe.cursor.enabled || !landmarks || landmarks.length < 21) {
        this.hidePinchCursor();
        return;
    }

    const cursor = this.mediaPipe.cursor;
    if (!cursor.element) {
        this.initPinchCursor();
    }

    // Get index finger tip position (landmark 8)
    const indexTip = landmarks[8];
    // Get thumb tip position (landmark 4)
    const thumbTip = landmarks[4];

    // Calculate pinch distance
    const pinchDistance = Math.sqrt(
        Math.pow(thumbTip.x - indexTip.x, 2) +
        Math.pow(thumbTip.y - indexTip.y, 2)
    );

    // Use midpoint between thumb and index for cursor when pinching
    // Use index tip when not pinching (pointing mode)
    const cursorX = cursor.isPinching
        ? (thumbTip.x + indexTip.x) / 2
        : indexTip.x;
    const cursorY = cursor.isPinching
        ? (thumbTip.y + indexTip.y) / 2
        : indexTip.y;

    // Update raw position (mirrored since video is mirrored)
    cursor.position.x = 1 - cursorX;
    cursor.position.y = cursorY;

    // Smooth the position
    cursor.smoothPosition.x += (cursor.position.x - cursor.smoothPosition.x) * cursor.smoothing;
    cursor.smoothPosition.y += (cursor.position.y - cursor.smoothPosition.y) * cursor.smoothing;

    // Convert to screen coordinates
    cursor.screenPosition.x = cursor.smoothPosition.x * window.innerWidth;
    cursor.screenPosition.y = cursor.smoothPosition.y * window.innerHeight;

    // Update cursor element position
    if (cursor.element) {
        cursor.element.style.left = cursor.screenPosition.x + 'px';
        cursor.element.style.top = cursor.screenPosition.y + 'px';
        cursor.element.classList.add('visible');
        cursor.visible = true;
    }

    // Update trail
    this.updateCursorTrail();

    // Detect pinch state
    const wasPinching = cursor.isPinching;
    cursor.isPinching = pinchDistance < cursor.pinchThreshold;

    // Calculate pinch progress (for visual feedback)
    const pinchStart = cursor.pinchThreshold * 1.5;
    cursor.pinchProgress = Math.max(0, Math.min(1,
        (pinchStart - pinchDistance) / (pinchStart - cursor.pinchThreshold)
    ));

    // Update cursor visual state
    if (cursor.element) {
        cursor.element.style.setProperty('--progress', cursor.pinchProgress);

        if (cursor.pinchProgress > 0.3) {
            cursor.element.classList.add('pinch-progress');
        } else {
            cursor.element.classList.remove('pinch-progress');
        }

        if (cursor.isPinching) {
            cursor.element.classList.add('pinching');
        } else {
            cursor.element.classList.remove('pinching');
        }
    }

    // Handle pinch state changes
    if (cursor.isPinching && !wasPinching) {
        // Pinch started
        this.onPinchStart();
    } else if (!cursor.isPinching && wasPinching) {
        // Pinch ended (this is the "click")
        this.onPinchEnd();
    }

    cursor.wasPinching = wasPinching;

    // Update hover state
    this.updateCursorHover();
}

updateCursorTrail() {
    const cursor = this.mediaPipe.cursor;
    const trail = cursor.trail;
    const trailEl = cursor.trailElement;

    if (!trailEl) return;

    // Add current position to trail
    trail.push({
        x: cursor.screenPosition.x,
        y: cursor.screenPosition.y,
        time: Date.now()
    });

    // Remove old trail points (older than 200ms)
    const now = Date.now();
    while (trail.length > 0 && now - trail[0].time > 200) {
        trail.shift();
    }

    // Limit trail length
    while (trail.length > 10) {
        trail.shift();
    }

    // Update trail visualization
    trailEl.innerHTML = trail.map((point, i) => {
        const opacity = (i / trail.length) * 0.5;
        const size = 3 + (i / trail.length) * 3;
        return `<div class="trail-dot" style="
                left: ${point.x}px;
                top: ${point.y}px;
                width: ${size}px;
                height: ${size}px;
                opacity: ${opacity};
            "></div>`;
    }).join('');
}

updateCursorHover() {
    const cursor = this.mediaPipe.cursor;

    // Get element under cursor
    const element = document.elementFromPoint(
        cursor.screenPosition.x,
        cursor.screenPosition.y
    );

    // Clear previous hover
    if (cursor.hoveredElement && cursor.hoveredElement !== element) {
        cursor.hoveredElement.classList.remove('pinch-hovered');
    }

    // Check if element is clickable
    const isClickable = element && (
        element.tagName === 'BUTTON' ||
        element.tagName === 'A' ||
        element.onclick ||
        element.classList.contains('pinch-hoverable') ||
        element.closest('button') ||
        element.closest('a') ||
        element.closest('.control-btn') ||
        element.closest('.mirror-btn') ||
        element.closest('.entity-item')
    );

    if (isClickable) {
        const clickableEl = element.closest('button') ||
            element.closest('a') ||
            element.closest('.control-btn') ||
            element.closest('.mirror-btn') ||
            element.closest('.entity-item') ||
            element;

        clickableEl.classList.add('pinch-hovered');
        cursor.hoveredElement = clickableEl;
        cursor.element?.classList.add('hovering');
    } else {
        cursor.hoveredElement = null;
        cursor.element?.classList.remove('hovering');
    }
}

onPinchStart() {
    const cursor = this.mediaPipe.cursor;
    cursor.pinchStartTime = Date.now();

    // Play subtle sound
    this.playSound('interact');

    console.log('[Pinch] Started');
}

onPinchEnd() {
    const cursor = this.mediaPipe.cursor;
    const now = Date.now();

    // Check cooldown
    if (now - cursor.lastClickTime < cursor.clickCooldown) {
        return;
    }

    const pinchDuration = now - cursor.pinchStartTime;

    // Only register click if pinch was quick (tap) - less than 500ms
    if (pinchDuration < 500) {
        cursor.lastClickTime = now;
        this.performPinchClick();
    }

    console.log('[Pinch] Ended, duration:', pinchDuration);
}

performPinchClick() {
    const cursor = this.mediaPipe.cursor;

    // Create click ripple effect
    this.createClickRipple(cursor.screenPosition.x, cursor.screenPosition.y);

    // Play click sound
    this.playSound('interact');

    // Get element under cursor
    const element = document.elementFromPoint(
        cursor.screenPosition.x,
        cursor.screenPosition.y
    );

    if (!element) {
        console.log('[Pinch Click] No element at position');
        return;
    }

    // Find clickable element
    const clickable = element.closest('button') ||
        element.closest('a') ||
        element.closest('.control-btn') ||
        element.closest('.mirror-btn') ||
        element.closest('.entity-item') ||
        (element.onclick ? element : null);

    if (clickable) {
        // Trigger the click
        console.log('[Pinch Click] Clicking:', clickable.tagName, clickable.className);

        // Create and dispatch click event
        const clickEvent = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            clientX: cursor.screenPosition.x,
            clientY: cursor.screenPosition.y
        });

        clickable.dispatchEvent(clickEvent);

        // Visual feedback
        clickable.classList.add('pinch-clicked');
        setTimeout(() => {
            clickable.classList.remove('pinch-clicked');
        }, 200);

    } else {
        // Click in 3D space - raycast to find entities
        this.performPinch3DClick(cursor.screenPosition.x, cursor.screenPosition.y);
    }
}

performPinch3DClick(screenX, screenY) {
    // Convert screen position to normalized device coordinates
    const mouse = new THREE.Vector2(
        (screenX / window.innerWidth) * 2 - 1,
        -(screenY / window.innerHeight) * 2 + 1
    );

    // Raycast from camera
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Find entity avatars
    const avatars = [];
    this.entities.forEach(entity => {
        if (entity.avatar && entity !== this.localEntity) {
            avatars.push(entity.avatar);
        }
    });

    const intersects = raycaster.intersectObjects(avatars, true);

    if (intersects.length > 0) {
        // Find which entity was clicked
        let clickedAvatar = intersects[0].object;
        while (clickedAvatar.parent && !clickedAvatar.userData?.entityId) {
            clickedAvatar = clickedAvatar.parent;
        }

        const entityId = clickedAvatar.userData?.entityId;
        if (entityId) {
            const entity = this.entities.get(entityId);
            if (entity) {
                this.onEntityClicked(entity, screenX, screenY);
                console.log('[Pinch 3D Click] Selected entity:', entity.name);
            }
        }
    } else {
        console.log('[Pinch 3D Click] No entity at position');
    }
}

createClickRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'pinch-click-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    document.body.appendChild(ripple);

    // Remove after animation
    setTimeout(() => {
        ripple.remove();
    }, 600);
}

updateMinimap() {
    const ctx = this.minimapCtx;
    const size = 150;
    const scale = 2; // 1 unit = 2 pixels

    // Clear
    ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
    ctx.fillRect(0, 0, size, size);

    // Grid
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.1)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < size; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.moveTo(0, i);
        ctx.lineTo(size, i);
        ctx.stroke();
    }

    // Center (origin)
    const centerX = size / 2;
    const centerY = size / 2;

    // Draw world objects (buildings, structures)
    this.worldObjects.forEach(obj => {
        const x = centerX + obj.position.x * scale;
        const y = centerY - obj.position.z * scale;

        // Only draw if in view
        if (x >= 0 && x <= size && y >= 0 && y <= size) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fillRect(x - 2, y - 2, 4, 4);
        }
    });

    // Draw entities
    this.entities.forEach(entity => {
        const x = centerX + entity.position.x * scale;
        const y = centerY - entity.position.z * scale;

        // Only draw if in view
        if (x >= 0 && x <= size && y >= 0 && y <= size) {
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);

            if (entity.type === EntityType.HUMAN) {
                ctx.fillStyle = '#00d4ff';
            } else if (entity.type === EntityType.AI) {
                ctx.fillStyle = '#7b2fff';
            } else {
                ctx.fillStyle = '#00ff88';
            }

            ctx.fill();

            // Direction indicator for local player
            if (entity === this.localEntity) {
                ctx.strokeStyle = '#00d4ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Highlight observed entity
            if (entity === this.observedEntity) {
                ctx.strokeStyle = '#ffaa00';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(x, y, 7, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    });

    // Camera direction indicator - CYCLE 3: use pooled vector
    const dirLen = 15;
    const camDir = this._vecPool.cameraDir;
    this.camera.getWorldDirection(camDir);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX + this.localEntity?.position.x * scale || centerX,
        centerY - (this.localEntity?.position.z * scale || 0));
    ctx.lineTo(centerX + (this.localEntity?.position.x || 0) * scale + camDir.x * dirLen,
        centerY - ((this.localEntity?.position.z || 0) * scale + camDir.z * dirLen));
    ctx.stroke();
}

// ===========================================
// PERFORMANCE MONITORING
// ===========================================
updatePerformanceStats() {
    this.perfStats.frameCount++;

    const now = performance.now();
    const elapsed = now - this.perfStats.lastTime;

    // Update FPS calculation every 500ms
    if (elapsed >= this.perfStats.fpsUpdateInterval) {
        this.perfStats.fps = Math.round((this.perfStats.frameCount * 1000) / elapsed);
        this.perfStats.frameCount = 0;
        this.perfStats.lastTime = now;

        // Update UI
        const fpsEl = document.getElementById('stat-fps');
        if (fpsEl) {
            fpsEl.textContent = this.perfStats.fps;
            // Color code based on performance
            fpsEl.className = 'perf-stat-value';
            if (this.perfStats.fps < 30) {
                fpsEl.classList.add('critical');
            } else if (this.perfStats.fps < 50) {
                fpsEl.classList.add('warning');
            }
        }

        const entitiesEl = document.getElementById('stat-entities');
        if (entitiesEl) {
            entitiesEl.textContent = this.entities.size;
        }

        const objectsEl = document.getElementById('stat-objects');
        if (objectsEl) {
            objectsEl.textContent = this.worldObjects.length;
        }

        const renderEl = document.getElementById('stat-render');
        if (renderEl) {
            renderEl.textContent = this.perfStats.renderMode === 'both' ? 'Main+POV' : 'Main';
        }
    }
}

// ===========================================
// WORLD SAVE/LOAD
// ===========================================
saveWorld() {
    const worldData = {
        name: 'Nexus World',
        timestamp: new Date().toISOString(),
        entities: Array.from(this.entities.values())
            .filter(e => e.type !== EntityType.HUMAN)
            .map(e => e.serialize()),
        objects: this.worldObjects.map(o => ({
            type: o.userData.type,
            position: o.position.toArray(),
            rotation: o.rotation.toArray()
        }))
    };

    const blob = new Blob([JSON.stringify(worldData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexus-world.json';
    a.click();
    URL.revokeObjectURL(url);

    this.addChatMessage('System', 'World saved successfully!', 'system');
}

// ===========================================
// ANIMATION LOOP
// ===========================================
animate() {
    requestAnimationFrame(() => this.animate());

    const time = this.clock.getElapsedTime();
    const deltaTime = this.clock.getDelta(); // Time since last frame

    // Performance monitoring
    this.updatePerformanceStats();

    // Update human player movement (keyboard input)
    this.updateMovement();

    // Update all entity smooth movement and animations
    const realityPortalActive = this.realityMirror?.enabled && this.realityMirror?.aiGazeActive;

    this.entities.forEach(entity => {
        // Smooth movement interpolation
        entity.updateMovement(deltaTime);

        if (entity.avatar) {
            // Animate status indicator
            const indicator = entity.avatar.getObjectByName('indicator');
            if (indicator && entity.state === EntityState.WORKING) {
                indicator.position.y = 2.9 + Math.sin(time * 4) * 0.1;
            }

            // AI entities face the Reality Portal when it's active
            // This creates the visual impression they're "looking at" the human
            if (realityPortalActive && entity.type === EntityType.AI && !entity.isMoving) {
                // Camera position represents "where the portal is" from their perspective
                const targetX = this.camera.position.x;
                const targetZ = this.camera.position.z;
                const dx = targetX - entity.position.x;
                const dz = targetZ - entity.position.z;
                const targetAngle = Math.atan2(dx, dz);

                // Smooth rotation toward portal
                const currentAngle = entity.avatar.rotation.y;
                let angleDiff = targetAngle - currentAngle;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                entity.avatar.rotation.y += angleDiff * 0.02; // Slow, subtle turn

                // Subtle "looking up" animation when gazing at reality
                const lookUpAmount = Math.sin(time * 0.5 + entity.walkCycleOffset) * 0.05;
                const head = entity.avatar.userData.headRef; // Use cached reference (no array search)
                if (head) {
                    head.rotation.x = -0.1 + lookUpAmount; // Slight upward gaze
                }
            }
        }
    });

    // Animate particles
    if (this.particles) {
        this.particles.rotation.y = time * 0.02;
        const positions = this.particles.geometry.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
            positions[i + 1] += Math.sin(time + i) * 0.002;
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    // Animate portals
    this.worldObjects.forEach(obj => {
        if (obj.userData.type === 'portal') {
            obj.traverse(child => {
                if (child.userData.isPortalSurface &&
                    child.material?.uniforms?.time) {
                    child.material.uniforms.time.value = time;
                }
            });
            obj.rotation.y = time * 0.5;
        }
    });

    // CYCLE 2: Update spatial relationship lines
    this.updateRelationshipLines();

    // CYCLE 2: Update AI emotions and attention
    this.updateAIEmotions(time);

    // CYCLE 4: Update 3D chat bubbles
    this.updateChatBubbles();

    // CYCLE 4: Check achievements every 60 frames
    this._achievementCheckCounter = (this._achievementCheckCounter || 0) + 1;
    if (this._achievementCheckCounter >= 60) {
        this._achievementCheckCounter = 0;
        this.checkAchievements();
    }

    // Update UI
    this.updateMinimap();

    // Update world-space action menu positions and gaze selection
    if (this.actionMenuActive) {
        this.updateActionMenuPositions();
        this.updateGazeSelection();
    }

    // Render main view (with bloom post-processing if available)
    if (this.bloomEnabled && this.composer) {
        this.composer.render();
    } else {
        this.renderer.render(this.scene, this.camera);
    }

    // Render observation viewport if entity is being observed AND panel is visible
    // OPTIMIZATION: Only render POV when observation panel is actually visible
    const obsPanel = document.getElementById('observation-panel');
    if (this.observedEntity && obsPanel && obsPanel.classList.contains('visible')) {
        this.renderObservationViewport();
        this.perfStats.renderMode = 'both';
    } else {
        this.perfStats.renderMode = 'main';
    }
}

renderObservationViewport() {
    if (!this.observedEntity || !this.povRenderer || !this.povCamera) return;

    const entity = this.observedEntity;

    // CYCLE 4: Use cached DOM elements (prevents per-frame getElementById)
    if (!this._cachedDOMElements.obsStatusText) {
        this._cachedDOMElements.obsStatusText = document.getElementById('obs-status-text');
        this._cachedDOMElements.obsStatusDot = document.getElementById('obs-status-dot');
    }

    // Update status display using cached references
    if (this._cachedDOMElements.obsStatusText) {
        this._cachedDOMElements.obsStatusText.textContent = entity.currentTask || 'No active task';
    }
    if (this._cachedDOMElements.obsStatusDot) {
        this._cachedDOMElements.obsStatusDot.className = 'status-dot ' + entity.state;
    }

    // Position the POV camera at the entity's location
    this.povCamera.position.set(
        entity.position.x,
        entity.position.y + 2, // Eye height
        entity.position.z
    );

    // CYCLE 4: Use pooled vectors instead of allocating new ones each frame
    const lookTarget = this._vecPool.observationLookTarget;
    const forward = this._vecPool.observationForward;

    if (entity.avatar) {
        // Look in the direction the avatar is facing
        forward.set(0, 0, 1);
        forward.applyQuaternion(entity.avatar.quaternion);
        lookTarget.copy(this.povCamera.position).add(forward.multiplyScalar(10));
    } else {
        // Default: look toward center
        lookTarget.set(0, 2, 0);
    }

    // Add some head movement for liveliness
    const time = this.clock.getElapsedTime();
    lookTarget.x += Math.sin(time * 0.5) * 2;
    lookTarget.y += Math.sin(time * 0.3) * 0.5;

    this.povCamera.lookAt(lookTarget);

    // Render the scene from entity's POV
    this.povRenderer.render(this.scene, this.povCamera);
}

// ===========================================
// CYCLE 2 ENHANCEMENTS
// ===========================================

// Initialize relationship line pool (call once during setup)
initRelationshipLinePool() {
    const poolSize = 20; // Enough for many entities
    for (let i = 0; i < poolSize; i++) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
        const material = new THREE.LineBasicMaterial({
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            fog: false
        });
        const line = new THREE.Line(geometry, material);
        line.visible = false;
        line.frustumCulled = false;
        this.scene.add(line);
        this.relationshipLinePool.push(line);
    }
}

updateRelationshipLines() {
    // Initialize pool on first call
    if (this.relationshipLinePool.length === 0) {
        this.initRelationshipLinePool();
    }

    // Hide all pooled lines first
    this.relationshipLinePool.forEach(line => line.visible = false);

    let lineIndex = 0;

    // Reuse pooled lines for observation relationships
    this.entities.forEach(entity => {
        // Draw line from observer to observed
        if (this.observedEntity && this.observedEntity.id === entity.id && this.localEntity) {
            if (lineIndex < this.relationshipLinePool.length) {
                this.updatePooledLine(
                    lineIndex++,
                    this.camera.position,
                    entity.position,
                    this.controlMode
                );
            }
        }

        // Draw attention lines from AI entities
        if (entity.type === EntityType.AI && entity.attentionTarget) {
            if (lineIndex < this.relationshipLinePool.length) {
                if (entity.attentionTarget === 'reality-portal') {
                    this.updatePooledLine(
                        lineIndex++,
                        entity.position,
                        this.camera.position,
                        'attention'
                    );
                } else {
                    const target = this.entities.get(entity.attentionTarget);
                    if (target) {
                        this.updatePooledLine(
                            lineIndex++,
                            entity.position,
                            target.position,
                            'attention'
                        );
                    }
                }
            }
        }
    });
}

updatePooledLine(index, fromPos, toPos, type) {
    const line = this.relationshipLinePool[index];
    const positions = line.geometry.attributes.position.array;

    // Update line positions without creating new geometry
    positions[0] = fromPos.x;
    positions[1] = (fromPos.y || 2) + 1.5;
    positions[2] = fromPos.z;
    positions[3] = toPos.x;
    positions[4] = (toPos.y || 2) + 1.5;
    positions[5] = toPos.z;

    line.geometry.attributes.position.needsUpdate = true;

    // Update color based on type
    let color;
    switch (type) {
        case ControlMode.OBSERVE:
            color = 0x00d4ff;
            break;
        case ControlMode.GUIDE:
            color = 0xffaa00;
            break;
        case ControlMode.TAKEOVER:
            color = 0xff2f8b;
            break;
        case 'attention':
            color = 0x7b2fff;
            break;
        default:
            color = 0x00d4ff;
    }

    line.material.color.setHex(color);
    line.visible = true;
}

updateAIEmotions(time) {
    this.entities.forEach(entity => {
        if (entity.type !== EntityType.AI || !entity.avatar) return;

        // Update attention target based on state
        if (this.realityMirror?.enabled && this.realityMirror?.aiGazeActive) {
            entity.attentionTarget = 'reality-portal';
            entity.emotion = 'curious';
        } else if (entity.state === EntityState.WORKING) {
            entity.emotion = 'focused';
        } else if (entity.state === EntityState.THINKING) {
            entity.emotion = 'thinking';
        } else if (entity.observers && entity.observers.length > 0) {
            entity.emotion = 'helping';
        } else {
            entity.emotion = 'neutral';
            entity.attentionTarget = null;
        }

        // Visual representation of emotion through indicator color
        const indicator = entity.avatar.getObjectByName('indicator');
        if (indicator) {
            const emotionColors = {
                'neutral': 0x666666,
                'curious': 0x00d4ff,
                'focused': 0x00ff88,
                'helping': 0xffaa00,
                'thinking': 0x7b2fff
            };
            indicator.material.color.setHex(emotionColors[entity.emotion] || 0x666666);

            // Pulsing intensity based on emotion
            const pulseSpeed = entity.emotion === 'thinking' ? 6 : 3;
            indicator.material.emissive = indicator.material.color;
            indicator.material.emissiveIntensity = 0.3 + Math.sin(time * pulseSpeed) * 0.2;
        }

        // Subtle head tilt based on emotion - CYCLE 3: use cached reference
        const head = entity.avatar.userData.headRef;
        if (head) {
            if (entity.emotion === 'curious') {
                head.rotation.z = Math.sin(time * 2) * 0.1; // Head tilt
            } else if (entity.emotion === 'thinking') {
                head.rotation.x = -0.2 + Math.sin(time) * 0.05; // Look down
            } else {
                head.rotation.x = 0;
                head.rotation.z = 0;
            }
        }
    });
}

// Shared Knowledge Base Methods
addKnowledge(entityId, entityName, type, content) {
    const entry = {
        timestamp: Date.now(),
        entityId,
        entityName,
        type, // 'discovery', 'learning', 'observation', 'insight'
        content,
        discovered: new Date().toLocaleTimeString()
    };

    this.sharedKnowledge.entries.unshift(entry);

    // Limit size
    if (this.sharedKnowledge.entries.length > this.sharedKnowledge.maxEntries) {
        this.sharedKnowledge.entries.pop();
    }

    // Log to entity
    const entity = this.entities.get(entityId);
    if (entity) {
        entity.log(`Shared knowledge: ${content}`, 'output');
    }

    // Update knowledge timeline UI
    this.updateKnowledgeTimeline();

    return entry;
}

getKnowledge(filterType = null) {
    if (filterType) {
        return this.sharedKnowledge.entries.filter(e => e.type === filterType);
    }
    return this.sharedKnowledge.entries;
}

updateKnowledgeTimeline() {
    // Update timeline UI if visible
    const timeline = document.getElementById('knowledge-timeline');
    if (!timeline) return;

    timeline.innerHTML = '';
    this.sharedKnowledge.entries.slice(0, 20).forEach(entry => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.innerHTML = `
                <div class="timeline-time">${entry.discovered}</div>
                <div class="timeline-entity">${entry.entityName}</div>
                <div class="timeline-content">${entry.content}</div>
                <div class="timeline-type">${entry.type}</div>
            `;
        timeline.appendChild(item);
    });
}
}

