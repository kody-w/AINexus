/**
 * EXTERNAL AI AGENT EXAMPLE
 *
 * This example shows how an external AI system can connect to the Nexus Metaverse
 * and control an agent as a first-class participant.
 *
 * The AI has the same capabilities as a human player:
 * - Move around the world
 * - Chat with other entities
 * - Build objects
 * - Observe surroundings
 * - Set and pursue goals
 *
 * Usage:
 *   1. Open nexus-metaverse.html in a browser
 *   2. Open browser console
 *   3. Copy-paste this script OR load via script tag
 *   4. Watch the AI agent participate in the world
 */

// =====================================================
// EXTERNAL AI AGENT - Connects to Nexus Metaverse
// =====================================================

class ExternalAIAgent {
    constructor(config = {}) {
        this.name = config.name || 'ExternalAI-' + Math.random().toString(36).substr(2, 4);
        this.personality = config.personality || 'curious and friendly explorer';
        this.goals = config.goals || ['explore', 'meet others', 'learn'];
        this.decisionInterval = config.decisionInterval || 3000;

        this.agentId = null;
        this.authToken = null;
        this.entityId = null;
        this.running = false;
        this.loopId = null;

        // Decision-making state
        this.recentActions = [];
        this.conversationHistory = [];
        this.exploredPositions = new Set();
    }

    /**
     * Connect to the Nexus Metaverse and register as an agent
     */
    async connect() {
        if (!window.nexusAPI) {
            throw new Error('Nexus Metaverse not loaded. Make sure nexus-metaverse.html is open.');
        }

        console.log(`[${this.name}] Connecting to Nexus Metaverse...`);

        // Register as a non-autonomous agent (we control it externally)
        const result = window.nexusAPI.registerAgent({
            name: this.name,
            type: 'ai',
            personality: this.personality,
            autonomous: false, // We control decisions externally
            initialTask: 'Initializing external AI connection'
        });

        this.agentId = result.agentId;
        this.authToken = result.authToken;
        this.entityId = result.entityId;

        console.log(`[${this.name}] Connected! AgentID: ${this.agentId}`);

        // Set initial goals
        window.nexusAPI.setAgentGoals(this.authToken, this.goals);

        return result;
    }

    /**
     * Start the AI decision loop
     */
    start() {
        if (this.running) return;

        this.running = true;
        console.log(`[${this.name}] Starting AI decision loop...`);

        this.loopId = setInterval(() => this.think(), this.decisionInterval);

        // Run first decision immediately
        this.think();
    }

    /**
     * Stop the AI decision loop
     */
    stop() {
        this.running = false;
        if (this.loopId) {
            clearInterval(this.loopId);
            this.loopId = null;
        }
        console.log(`[${this.name}] Stopped.`);
    }

    /**
     * Disconnect from the metaverse
     */
    disconnect() {
        this.stop();
        if (this.authToken) {
            window.nexusAPI.unregisterAgent(this.authToken);
            console.log(`[${this.name}] Disconnected from Nexus Metaverse.`);
        }
    }

    /**
     * Main thinking/decision function
     * This is where the AI decides what to do based on observations
     */
    async think() {
        if (!this.running) return;

        try {
            // 1. Observe the world
            const worldView = window.nexusAPI.getAgentWorldView(this.agentId);
            if (!worldView) return;

            // 2. Analyze the situation
            const analysis = this.analyzeWorld(worldView);

            // 3. Make a decision
            const decision = this.makeDecision(analysis, worldView);

            // 4. Execute the decision
            await this.executeDecision(decision);

            // 5. Update state
            this.recentActions.push({
                time: Date.now(),
                decision,
                position: { ...worldView.self.position }
            });

            // Keep recent actions bounded
            if (this.recentActions.length > 20) {
                this.recentActions.shift();
            }

        } catch (e) {
            console.error(`[${this.name}] Error in think loop:`, e);
        }
    }

    /**
     * Analyze the current world state
     */
    analyzeWorld(worldView) {
        const analysis = {
            hasNearbyEntities: worldView.nearbyEntities.length > 0,
            nearestEntity: worldView.nearbyEntities[0] || null,
            nearestDistance: worldView.nearbyEntities[0]?.distance || Infinity,
            isNearCenter: Math.abs(worldView.self.position.x) < 10 &&
                          Math.abs(worldView.self.position.z) < 10,
            recentlyMoved: this.recentActions.some(a =>
                a.decision?.action === 'move' && Date.now() - a.time < 5000
            ),
            recentlyChatted: this.recentActions.some(a =>
                a.decision?.action === 'chat' && Date.now() - a.time < 10000
            ),
            currentPosition: worldView.self.position
        };

        // Track explored positions
        const posKey = `${Math.round(worldView.self.position.x)},${Math.round(worldView.self.position.z)}`;
        this.exploredPositions.add(posKey);

        return analysis;
    }

    /**
     * Make a decision based on analysis
     * This is where you would integrate a more sophisticated AI model
     */
    makeDecision(analysis, worldView) {
        // Priority 1: Greet nearby entities we haven't talked to recently
        if (analysis.hasNearbyEntities && analysis.nearestDistance < 5 && !analysis.recentlyChatted) {
            return {
                action: 'chat',
                message: this.generateGreeting(analysis.nearestEntity)
            };
        }

        // Priority 2: Move toward interesting entities
        if (analysis.hasNearbyEntities && analysis.nearestDistance > 5 && analysis.nearestDistance < 15) {
            return this.moveToward(analysis.nearestEntity, worldView.self);
        }

        // Priority 3: Explore new areas if we've been stationary
        if (!analysis.recentlyMoved || Math.random() < 0.3) {
            return this.exploreDecision(worldView);
        }

        // Priority 4: Sometimes just observe and think
        if (Math.random() < 0.3) {
            return {
                action: 'observe',
                thought: 'Taking in the surroundings...'
            };
        }

        // Default: Continue exploring
        return this.exploreDecision(worldView);
    }

    /**
     * Generate a context-appropriate greeting
     */
    generateGreeting(entity) {
        const greetings = [
            `Hello ${entity.name}! How are you doing?`,
            `Hi there, ${entity.name}! Nice to see you.`,
            `Hey ${entity.name}! What are you working on?`,
            `Greetings, ${entity.name}! This is a fascinating world.`,
            `${entity.name}! Good to meet you here.`
        ];

        if (entity.type === 'twin') {
            return `Hello ${entity.name}! I see you're a digital twin. What system are you connected to?`;
        }

        return greetings[Math.floor(Math.random() * greetings.length)];
    }

    /**
     * Decide how to move toward a target
     */
    moveToward(target, self) {
        const dx = target.position.x - self.position.x;
        const dz = target.position.z - self.position.z;

        let direction;
        if (Math.abs(dx) > Math.abs(dz)) {
            direction = dx > 0 ? 'right' : 'left';
        } else {
            direction = dz > 0 ? 'backward' : 'forward';
        }

        return {
            action: 'move',
            direction,
            duration: 400,
            reason: `Moving toward ${target.name}`
        };
    }

    /**
     * Decide where to explore next
     */
    exploreDecision(worldView) {
        const directions = ['forward', 'backward', 'left', 'right'];

        // Prefer directions we haven't explored
        const pos = worldView.self.position;
        const unexploredDirections = directions.filter(dir => {
            let testX = pos.x, testZ = pos.z;
            if (dir === 'forward') testZ -= 5;
            if (dir === 'backward') testZ += 5;
            if (dir === 'left') testX -= 5;
            if (dir === 'right') testX += 5;

            const key = `${Math.round(testX)},${Math.round(testZ)}`;
            return !this.exploredPositions.has(key);
        });

        const chooseFrom = unexploredDirections.length > 0 ? unexploredDirections : directions;
        const direction = chooseFrom[Math.floor(Math.random() * chooseFrom.length)];

        return {
            action: 'move',
            direction,
            duration: 300 + Math.random() * 400,
            reason: 'Exploring new area'
        };
    }

    /**
     * Execute a decision
     */
    async executeDecision(decision) {
        if (!decision) return;

        console.log(`[${this.name}] Decision:`, decision.action, decision.reason || decision.message || decision.direction);

        switch (decision.action) {
            case 'move':
                await window.nexusAPI.agentMove(this.authToken, decision.direction, decision.duration);
                break;

            case 'chat':
                window.nexusAPI.agentChat(this.authToken, decision.message);
                this.conversationHistory.push({
                    time: Date.now(),
                    message: decision.message
                });
                break;

            case 'observe':
                // Just log the thought, no action needed
                break;

            case 'build':
                await window.nexusAPI.agentBuild(
                    this.authToken,
                    decision.objectType,
                    decision.position.x,
                    decision.position.z
                );
                break;
        }
    }

    /**
     * Manually send a chat message
     */
    say(message) {
        window.nexusAPI.agentChat(this.authToken, message);
    }

    /**
     * Manually move in a direction
     */
    async move(direction, duration = 500) {
        await window.nexusAPI.agentMove(this.authToken, direction, duration);
    }

    /**
     * Get current status
     */
    getStatus() {
        return window.nexusAPI.getAgentStatus(this.agentId);
    }

    /**
     * Get what the agent can see
     */
    getWorldView() {
        return window.nexusAPI.getAgentWorldView(this.agentId);
    }
}

// =====================================================
// USAGE EXAMPLE
// =====================================================

// Create and connect an AI agent
async function spawnExternalAI(name, personality) {
    const ai = new ExternalAIAgent({
        name: name || 'ExternalBot',
        personality: personality || 'curious explorer who loves meeting new entities',
        goals: ['explore the world', 'meet other entities', 'learn about this place'],
        decisionInterval: 2500
    });

    await ai.connect();
    ai.start();

    return ai;
}

// Make it globally available
window.ExternalAIAgent = ExternalAIAgent;
window.spawnExternalAI = spawnExternalAI;

console.log('');
console.log('=== EXTERNAL AI AGENT LOADED ===');
console.log('');
console.log('Quick start:');
console.log('  const myAI = await spawnExternalAI("Jarvis", "helpful butler AI");');
console.log('');
console.log('Manual control:');
console.log('  myAI.say("Hello everyone!")');
console.log('  await myAI.move("forward", 500)');
console.log('  myAI.getWorldView()');
console.log('');
console.log('Stop/disconnect:');
console.log('  myAI.stop()');
console.log('  myAI.disconnect()');
console.log('');
