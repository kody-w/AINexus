import { EntityType, ControlMode } from '../entities/Entity.js';
import { EntityType, ControlMode } from '../entities/Entity.js';
export default class NexusAPI {
    constructor(nexusInstance, agentController) {
        this.nexus = nexusInstance;
        this.agents = agentController;
    }

    // ========== AGENT API ==========
    // These methods allow AI agents to participate as first-class citizens

    /**
     * Register a new AI agent
     * @param {Object} config - Agent configuration
     * @param {string} config.name - Agent name
     * @param {string} config.type - 'ai' or 'twin'
     * @param {string} config.personality - Agent personality description
     * @param {boolean} config.autonomous - Whether agent runs decision loop
     * @param {number} config.decisionInterval - MS between decisions
     * @param {string} config.externalEndpoint - URL for external AI control
     * @param {string} config.initialTask - Starting task
     * @returns {Object} { agentId, authToken, entityId, name }
     */
    registerAgent(config) {
        return this.agents.registerAgent(config);
    }

    /**
     * Get all registered agents
     */
    getAgents() {
        return this.agents.getAllAgents();
    }

    /**
     * Get a specific agent's status
     */
    getAgentStatus(agentId) {
        const session = this.agents.getAgent(agentId);
        if (!session) return null;

        const entity = this.agents.getAgentEntity(agentId);
        return {
            agentId: session.agentId,
            name: session.name,
            entityId: session.entityId,
            type: session.type,
            state: session.state,
            autonomous: session.autonomous,
            lastActivity: session.lastActivity,
            goals: session.goals,
            position: entity ? { ...entity.position } : null,
            currentTask: entity?.currentTask,
            memorySize: session.memory.length,
            observationCount: session.observations.length
        };
    }

    /**
     * Get an agent's world view (what they can see)
     */
    getAgentWorldView(agentId) {
        return this.agents.getAgentWorldView(agentId);
    }

    /**
     * Execute an action as an agent (for remote AI control)
     * @param {string} authToken - Agent's auth token
     * @param {Object} action - Action to execute
     */
    async agentAction(authToken, action) {
        const session = this.agents.authenticate(authToken);
        if (!session) {
            return { success: false, error: 'Invalid auth token' };
        }

        try {
            await this.agents.executeAgentAction(session.agentId, action);
            return { success: true, agentId: session.agentId };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Move an agent's entity
     */
    async agentMove(authToken, direction, duration = 300) {
        return this.agentAction(authToken, { action: 'move', direction, duration });
    }

    /**
     * Send a chat message as an agent
     */
    agentChat(authToken, message) {
        return this.agentAction(authToken, { action: 'chat', message });
    }

    /**
     * Set an agent's task
     */
    agentSetTask(authToken, task) {
        return this.agentAction(authToken, { action: 'setTask', task });
    }

    /**
     * Place an object as an agent
     */
    agentBuild(authToken, objectType, x, z) {
        return this.agentAction(authToken, {
            action: 'build',
            objectType,
            position: { x, z }
        });
    }

    /**
     * Set goals for an agent
     */
    setAgentGoals(authToken, goals) {
        const session = this.agents.authenticate(authToken);
        if (!session) return { success: false, error: 'Invalid auth token' };

        this.agents.setAgentGoals(session.agentId, goals);
        return { success: true };
    }

    /**
     * Send a command to an agent (from another entity or system)
     */
    commandAgent(agentId, command) {
        return this.agents.sendCommand(agentId, command);
    }

    /**
     * Pause an agent's autonomous behavior
     */
    pauseAgent(authToken) {
        const session = this.agents.authenticate(authToken);
        if (!session) return { success: false, error: 'Invalid auth token' };

        return { success: this.agents.pauseAgent(session.agentId) };
    }

    /**
     * Resume an agent's autonomous behavior
     */
    resumeAgent(authToken) {
        const session = this.agents.authenticate(authToken);
        if (!session) return { success: false, error: 'Invalid auth token' };

        return { success: this.agents.resumeAgent(session.agentId) };
    }

    /**
     * Unregister an agent (remove from world)
     */
    unregisterAgent(authToken) {
        const session = this.agents.authenticate(authToken);
        if (!session) return { success: false, error: 'Invalid auth token' };

        return { success: this.agents.unregisterAgent(session.agentId) };
    }

    /**
     * Get agent's memory (for context/debugging)
     */
    getAgentMemory(authToken) {
        const session = this.agents.authenticate(authToken);
        if (!session) return null;

        return {
            memory: session.memory.slice(-20),
            observations: session.observations.slice(-10),
            goals: session.goals
        };
    }

    /**
     * Trigger a single decision cycle for an agent
     * (useful for step-by-step debugging or manual control)
     */
    async triggerAgentDecision(authToken) {
        const session = this.agents.authenticate(authToken);
        if (!session) return { success: false, error: 'Invalid auth token' };

        await this.agents.runAgentDecisionCycle(session.agentId);
        return { success: true };
    }

    // ========== STATE QUERIES ==========

    /** Check if the metaverse is fully loaded and ready */
    isReady() {
        return this.nexus !== null &&
               this.nexus.scene !== null &&
               this.nexus.localEntity !== null;
    }

    /** Get loading state */
    isLoading() {
        return document.getElementById('loading').style.display !== 'none';
    }

    /** Get all entities as serializable objects */
    getEntities() {
        const entities = [];
        this.nexus.entities.forEach((entity, id) => {
            entities.push({
                id: entity.id,
                name: entity.name,
                type: entity.type,
                state: entity.state,
                position: { ...entity.position },
                currentTask: entity.currentTask,
                isControlled: entity.controlledBy !== null,
                controlledBy: entity.controlledBy,
                isObserved: this.nexus.observedEntity?.id === entity.id
            });
        });
        return entities;
    }

    /** Get a specific entity by ID or name */
    getEntity(idOrName) {
        for (const [id, entity] of this.nexus.entities) {
            if (entity.id === idOrName || entity.name === idOrName) {
                return {
                    id: entity.id,
                    name: entity.name,
                    type: entity.type,
                    state: entity.state,
                    position: { ...entity.position },
                    currentTask: entity.currentTask,
                    isControlled: entity.controlledBy !== null,
                    controlledBy: entity.controlledBy,
                    activityLog: entity.activityLog.slice(-10)
                };
            }
        }
        return null;
    }

    /** Get the local player entity */
    getLocalPlayer() {
        if (!this.nexus.localEntity) return null;
        return this.getEntity(this.nexus.localEntity.id);
    }

    /** Get currently observed entity */
    getObservedEntity() {
        if (!this.nexus.observedEntity) return null;
        return this.getEntity(this.nexus.observedEntity.id);
    }

    /** Get current control mode */
    getControlMode() {
        return this.nexus.controlMode;
    }

    /** Check if currently possessing an entity */
    isPossessing() {
        return this.nexus.controlMode === ControlMode.TAKEOVER &&
               this.nexus.observedEntity !== null;
    }

    /** Get camera position and rotation */
    getCameraState() {
        return {
            position: {
                x: this.nexus.camera.position.x,
                y: this.nexus.camera.position.y,
                z: this.nexus.camera.position.z
            },
            rotation: {
                x: this.nexus.camera.rotation.x,
                y: this.nexus.camera.rotation.y,
                z: this.nexus.camera.rotation.z
            }
        };
    }

    /** Get current mode (explore, observe, build) */
    getCurrentMode() {
        return this.nexus.currentMode;
    }

    /** Check if observation panel is visible */
    isObservationPanelVisible() {
        return document.getElementById('observation-panel').classList.contains('visible');
    }

    /** Check if builder panel is visible */
    isBuilderPanelVisible() {
        return document.getElementById('builder-panel').classList.contains('visible');
    }

    /** Check if possession HUD is visible */
    isPossessionHUDVisible() {
        return document.getElementById('possession-hud') !== null;
    }

    /** Get world objects count */
    getWorldObjectsCount() {
        return this.nexus.worldObjects.length;
    }

    /** Get chat messages */
    getChatMessages() {
        const messages = [];
        document.querySelectorAll('.chat-message').forEach(msg => {
            messages.push({
                sender: msg.querySelector('.chat-sender')?.textContent || '',
                text: msg.textContent.replace(msg.querySelector('.chat-sender')?.textContent || '', '').trim(),
                isAI: msg.classList.contains('ai'),
                isHuman: msg.classList.contains('human')
            });
        });
        return messages;
    }

    // ========== ACTIONS ==========

    /** Select/observe an entity by ID or name */
    observeEntity(idOrName) {
        for (const [id, entity] of this.nexus.entities) {
            if (entity.id === idOrName || entity.name === idOrName) {
                this.nexus.observeEntity(id);
                return true;
            }
        }
        return false;
    }

    /** Set control mode: 'observe', 'guide', or 'takeover' */
    setControlMode(mode) {
        if (!this.nexus.observedEntity) return false;
        this.nexus.setControlMode(mode);
        return true;
    }

    /** Take over the currently observed entity (possession) */
    takeOver() {
        return this.setControlMode('takeover');
    }

    /** Release control and return to observe mode */
    releaseControl() {
        return this.setControlMode('observe');
    }

    /** Simulate key press for movement */
    pressKey(key, duration = 100) {
        return new Promise(resolve => {
            const lowerKey = key.toLowerCase();
            if (lowerKey in this.nexus.keys) {
                this.nexus.keys[lowerKey] = true;
                setTimeout(() => {
                    this.nexus.keys[lowerKey] = false;
                    resolve(true);
                }, duration);
            } else {
                resolve(false);
            }
        });
    }

    /** Move in a direction for a duration */
    async move(direction, duration = 500) {
        const keyMap = {
            forward: 'w',
            backward: 's',
            left: 'a',
            right: 'd'
        };
        const key = keyMap[direction] || direction;

        // Get current position for comparison
        const getEntityPos = () => {
            if (this.nexus.controlMode === ControlMode.TAKEOVER && this.nexus.observedEntity) {
                return { ...this.nexus.observedEntity.position };
            }
            return this.nexus.localEntity ? { ...this.nexus.localEntity.position } : { x: 0, y: 0, z: 0 };
        };

        const posBefore = getEntityPos();

        // Press the key and wait for animation frames to process
        await this.pressKey(key, duration);

        // Wait for position to change or timeout
        const startTime = Date.now();
        const maxWait = 500;
        const threshold = 0.01;

        await new Promise(resolve => {
            const checkMove = () => {
                const posAfter = getEntityPos();
                const dx = Math.abs(posAfter.x - posBefore.x);
                const dz = Math.abs(posAfter.z - posBefore.z);
                const elapsed = Date.now() - startTime;

                if (dx > threshold || dz > threshold || elapsed > maxWait) {
                    resolve();
                } else {
                    requestAnimationFrame(checkMove);
                }
            };
            requestAnimationFrame(checkMove);
        });

        return true;
    }

    /** Teleport camera to position */
    teleportCamera(x, y, z) {
        this.nexus.camera.position.set(x, y, z);
        return true;
    }

    /** Set camera rotation */
    setCameraRotation(x, y) {
        this.nexus.camera.rotation.x = x;
        this.nexus.camera.rotation.y = y;
        return true;
    }

    /** Switch mode: 'explore', 'observe', 'build' */
    setMode(mode) {
        this.nexus.setMode(mode);
        return true;
    }

    /** Send a chat message */
    sendChatMessage(message) {
        document.getElementById('chat-input').value = message;
        this.nexus.sendChat();
        return true;
    }

    /** Send a command to an AI entity */
    commandAI(entityName, command) {
        return this.sendChatMessage(`@${entityName} ${command}`);
    }

    /** Add a new entity */
    addEntity(name, type, task = '') {
        document.getElementById('entity-name-input').value = name;
        document.getElementById('entity-type-select').value = type;
        document.getElementById('entity-task-input').value = task;
        this.nexus.addEntity();
        return true;
    }

    /** Place a world object */
    placeObject(type, x, z) {
        const position = new THREE.Vector3(x, 0, z);
        this.nexus.placeObject(type, position);
        return true;
    }

    /** Get distance between two points */
    getDistance(pos1, pos2) {
        const dx = pos1.x - pos2.x;
        const dy = (pos1.y || 0) - (pos2.y || 0);
        const dz = pos1.z - pos2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /** Wait for a condition to be true */
    async waitFor(conditionFn, timeout = 5000, interval = 100) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            if (conditionFn()) return true;
            await new Promise(r => setTimeout(r, interval));
        }
        return false;
    }

    /** Wait for loading to complete */
    async waitForReady(timeout = 10000) {
        return this.waitFor(() => this.isReady() && !this.isLoading(), timeout);
    }

    // ========== TEST HELPERS ==========

    /** Get a snapshot of current state for assertions */
    getStateSnapshot() {
        return {
            ready: this.isReady(),
            loading: this.isLoading(),
            mode: this.getCurrentMode(),
            controlMode: this.getControlMode(),
            isPossessing: this.isPossessing(),
            camera: this.getCameraState(),
            localPlayer: this.getLocalPlayer(),
            observedEntity: this.getObservedEntity(),
            entityCount: this.nexus.entities.size,
            worldObjectCount: this.getWorldObjectsCount(),
            observationPanelVisible: this.isObservationPanelVisible(),
            builderPanelVisible: this.isBuilderPanelVisible(),
            possessionHUDVisible: this.isPossessionHUDVisible()
        };
    }

    /** Reset to initial state (for test isolation) */
    reset() {
        // Release any possession
        if (this.isPossessing()) {
            this.releaseControl();
        }
        // Clear observed entity
        this.nexus.observedEntity = null;
        document.getElementById('observation-panel').classList.remove('visible');
        // Reset mode
        this.setMode('explore');
        // Teleport to start position
        this.teleportCamera(0, 2, 10);
        return true;
    }

    // ========== REALITY MIRROR API ==========

    /** Enable the Reality Portal (webcam) */
    async enableRealityMirror() {
        return this.nexus.enableRealityMirror();
    }

    /** Disable the Reality Portal */
    disableRealityMirror() {
        return this.nexus.disableRealityMirror();
    }

    /** Toggle AI gaze (perception active/inactive) */
    toggleAIGaze() {
        return this.nexus.toggleAIGaze();
    }

    /** Show the Reality Portal panel */
    showRealityMirror() {
        return this.nexus.showRealityMirror();
    }

    /** Hide the Reality Portal panel */
    hideRealityMirror() {
        return this.nexus.hideRealityMirror();
    }

    /** Minimize the Reality Portal */
    minimizeRealityMirror() {
        return this.nexus.minimizeRealityMirror();
    }

    /** Toggle Reality Portal minimized state */
    toggleRealityMirror() {
        return this.nexus.toggleRealityMirror();
    }

    /** Get current Reality Portal snapshot (for AI agents) */
    getRealitySnapshot() {
        return this.nexus.getRealitySnapshot();
    }

    /** Check if Reality Portal is enabled */
    isRealityMirrorEnabled() {
        return this.nexus.realityMirror?.enabled || false;
    }

    /** Check if AI gaze is active */
    isAIGazeActive() {
        return this.nexus.realityMirror?.aiGazeActive || false;
    }

    // ===========================================
    // CYCLE 2: NEW API METHODS
    // ===========================================

    /** Add an entry to the shared knowledge base */
    addKnowledge(entityId, entityName, type, content) {
        return this.nexus.addKnowledge(entityId, entityName, type, content);
    }

    /** Get all knowledge entries, optionally filtered by type */
    getKnowledge(filterType = null) {
        return this.nexus.getKnowledge(filterType);
    }

    /** Get entity's current emotion (for AI entities) */
    getEntityEmotion(entityId) {
        const entity = this.nexus.entities.get(entityId);
        return entity ? entity.emotion : null;
    }

    /** Get entity's attention target (what they're looking at) */
    getEntityAttention(entityId) {
        const entity = this.nexus.entities.get(entityId);
        return entity ? entity.attentionTarget : null;
    }

    /** Set entity's emotion (for AI entities) */
    setEntityEmotion(entityId, emotion, intensity = 0.5) {
        const entity = this.nexus.entities.get(entityId);
        if (entity && entity.type === EntityType.AI) {
            entity.emotion = emotion;
            entity.emotionIntensity = Math.max(0, Math.min(1, intensity));
            return true;
        }
        return false;
    }

    /** Set entity's attention target */
    setEntityAttention(entityId, targetEntityIdOrPortal) {
        const entity = this.nexus.entities.get(entityId);
        if (entity) {
            entity.attentionTarget = targetEntityIdOrPortal;
            return true;
        }
        return false;
    }

    /** Toggle knowledge panel visibility */
    toggleKnowledgePanel() {
        this.nexus.toggleKnowledgePanel();
        return true;
    }

    /** Get visualization of current relationships (for external display) */
    getRelationshipMap() {
        const relationships = [];
        this.nexus.entities.forEach(entity => {
            if (entity.attentionTarget) {
                relationships.push({
                    from: entity.id,
                    fromName: entity.name,
                    to: entity.attentionTarget,
                    type: 'attention',
                    emotion: entity.emotion
                });
            }
        });

        if (this.nexus.observedEntity) {
            relationships.push({
                from: 'player',
                fromName: 'You',
                to: this.nexus.observedEntity.id,
                toName: this.nexus.observedEntity.name,
                type: this.nexus.controlMode
            });
        }

        return relationships;
    }
}
