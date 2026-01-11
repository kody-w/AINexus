import { EntityType, EntityState } from '../entities/Entity.js';
import { EntityType, EntityState } from '../entities/Entity.js';
export default class AgentController {
    constructor(nexusInstance) {
        this.nexus = nexusInstance;
        this.agents = new Map(); // agentId -> AgentSession
        this.entityToAgent = new Map(); // entityId -> agentId
        this.agentToEntity = new Map(); // agentId -> entityId
        this.decisionLoops = new Map(); // agentId -> intervalId
        this.messageQueue = new Map(); // agentId -> messages[]
        this.aiEndpoint = 'https://azfbusinessbot.azurewebsites.net/api/aidialog';
    }

    /**
     * Register a new AI agent in the metaverse
     * Returns an agent session with auth token for subsequent API calls
     */
    registerAgent(config) {
        const {
            name,
            type = 'ai', // 'ai' or 'twin'
            personality = 'helpful assistant',
            capabilities = ['observe', 'move', 'chat', 'build'],
            autonomous = true,
            decisionInterval = 2000,
            externalEndpoint = null, // For remote AI connections
            initialTask = null
        } = config;

        const agentId = 'agent-' + Math.random().toString(36).substr(2, 9);
        const authToken = 'token-' + Math.random().toString(36).substr(2, 16);

        // Create the entity for this agent
        const position = {
            x: (Math.random() - 0.5) * 30,
            y: 0,
            z: (Math.random() - 0.5) * 30
        };

        let entity;
        if (type === 'ai') {
            entity = this.nexus.createAIEntity(name, initialTask || 'Awaiting instructions', position);
        } else {
            entity = this.nexus.createDigitalTwin(name, initialTask || 'Syncing...', position);
        }

        // Stop the default autonomous behavior - we'll control it
        // (The default AI behavior is simple, we want full agent control)

        const session = {
            agentId,
            authToken,
            name,
            entityId: entity.id,
            type,
            personality,
            capabilities,
            autonomous,
            decisionInterval,
            externalEndpoint,
            registeredAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            state: 'active',
            memory: [], // Agent's memory/context
            goals: [], // Current goals
            observations: [] // What the agent has observed
        };

        this.agents.set(agentId, session);
        this.entityToAgent.set(entity.id, agentId);
        this.agentToEntity.set(agentId, entity.id);
        this.messageQueue.set(agentId, []);

        // Start autonomous decision loop if enabled
        if (autonomous && !externalEndpoint) {
            this.startDecisionLoop(agentId);
        }

        console.log(`Agent registered: ${name} (${agentId}) controlling entity ${entity.id}`);

        return {
            agentId,
            authToken,
            entityId: entity.id,
            name,
            message: `Agent ${name} registered successfully. Use authToken for API calls.`
        };
    }

    /**
     * Authenticate an agent by token
     */
    authenticate(authToken) {
        for (const [agentId, session] of this.agents) {
            if (session.authToken === authToken) {
                session.lastActivity = new Date().toISOString();
                return session;
            }
        }
        return null;
    }

    /**
     * Get agent session by ID
     */
    getAgent(agentId) {
        return this.agents.get(agentId);
    }

    /**
     * Get all registered agents
     */
    getAllAgents() {
        const agents = [];
        this.agents.forEach((session, id) => {
            agents.push({
                agentId: id,
                name: session.name,
                entityId: session.entityId,
                type: session.type,
                state: session.state,
                autonomous: session.autonomous,
                lastActivity: session.lastActivity
            });
        });
        return agents;
    }

    /**
     * Get the entity controlled by an agent
     */
    getAgentEntity(agentId) {
        const entityId = this.agentToEntity.get(agentId);
        if (!entityId) return null;
        return this.nexus.entities.get(entityId);
    }

    /**
     * Start the autonomous decision loop for an agent
     */
    startDecisionLoop(agentId) {
        const session = this.agents.get(agentId);
        if (!session) return;

        // Clear any existing loop
        this.stopDecisionLoop(agentId);

        const loop = setInterval(async () => {
            if (session.state !== 'active') return;

            try {
                await this.runAgentDecisionCycle(agentId);
            } catch (e) {
                console.error(`Agent ${agentId} decision error:`, e);
            }
        }, session.decisionInterval);

        this.decisionLoops.set(agentId, loop);
    }

    /**
     * Stop the decision loop for an agent
     */
    stopDecisionLoop(agentId) {
        const loop = this.decisionLoops.get(agentId);
        if (loop) {
            clearInterval(loop);
            this.decisionLoops.delete(agentId);
        }
    }

    /**
     * Run one decision cycle for an agent
     * This is where the AI "thinks" and decides what to do
     */
    async runAgentDecisionCycle(agentId) {
        const session = this.agents.get(agentId);
        if (!session) return;

        const entity = this.getAgentEntity(agentId);
        if (!entity) return;

        // 1. Gather observations (what does the agent see?)
        const worldState = this.getAgentWorldView(agentId);

        // 2. Check for messages/commands
        const messages = this.messageQueue.get(agentId) || [];
        const newMessages = messages.splice(0, messages.length);

        // 3. Make a decision
        const decision = await this.makeDecision(session, worldState, newMessages);

        // 4. Execute the decision
        if (decision) {
            await this.executeAgentAction(agentId, decision);
        }

        // 5. Update observations
        session.observations.push({
            time: new Date().toISOString(),
            worldState: worldState,
            decision: decision
        });

        // Keep only recent observations
        if (session.observations.length > 50) {
            session.observations = session.observations.slice(-50);
        }
    }

    /**
     * Get the world from an agent's perspective
     */
    getAgentWorldView(agentId) {
        const entity = this.getAgentEntity(agentId);
        if (!entity) return null;

        const nearbyEntities = [];
        const nearbyObjects = [];

        // Find entities within perception range
        const perceptionRange = 20;
        this.nexus.entities.forEach((other, id) => {
            if (id === entity.id) return;
            const dist = this.distance(entity.position, other.position);
            if (dist <= perceptionRange) {
                nearbyEntities.push({
                    id: other.id,
                    name: other.name,
                    type: other.type,
                    state: other.state,
                    distance: dist,
                    position: { ...other.position },
                    currentTask: other.currentTask,
                    isControlled: other.controlledBy !== null
                });
            }
        });

        // Sort by distance
        nearbyEntities.sort((a, b) => a.distance - b.distance);

        return {
            self: {
                id: entity.id,
                name: entity.name,
                position: { ...entity.position },
                state: entity.state,
                currentTask: entity.currentTask
            },
            nearbyEntities,
            nearbyObjects,
            worldTime: this.nexus.clock.getElapsedTime(),
            entityCount: this.nexus.entities.size
        };
    }

    /**
     * Make a decision based on world state and messages
     * This can be local logic or call external AI
     */
    async makeDecision(session, worldState, messages) {
        // If there's an external endpoint, call it
        if (session.externalEndpoint) {
            return this.callExternalAI(session, worldState, messages);
        }

        // If there are direct commands, prioritize them
        if (messages.length > 0) {
            const command = messages[0];
            if (command.type === 'task') {
                return { action: 'setTask', task: command.content };
            }
            if (command.type === 'move') {
                return { action: 'move', direction: command.direction, duration: command.duration || 500 };
            }
            if (command.type === 'chat') {
                return { action: 'chat', message: command.content };
            }
        }

        // Use built-in AI endpoint for decisions
        return this.callBuiltInAI(session, worldState);
    }

    /**
     * Call the built-in Azure AI endpoint for agent decisions
     */
    async callBuiltInAI(session, worldState) {
        try {
            const prompt = this.buildAgentPrompt(session, worldState);

            const response = await fetch(this.aiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_query: prompt,
                    user_guid: session.agentId,
                    system_prompt: `You are ${session.name}, an AI agent in a 3D metaverse. ${session.personality}.
                    Respond with a JSON action: {"action": "move|chat|observe|idle", "direction?": "forward|backward|left|right", "message?": "text", "duration?": number}
                    Keep responses brief. Move toward interesting things. Chat when you see others nearby.`
                })
            });

            if (!response.ok) {
                return this.getDefaultAction(session, worldState);
            }

            const data = await response.json();
            try {
                // Try to parse AI response as JSON action
                const actionMatch = data.assistant_response.match(/\{[\s\S]*\}/);
                if (actionMatch) {
                    return JSON.parse(actionMatch[0]);
                }
            } catch (e) {
                // If not JSON, interpret as chat
                if (data.assistant_response && data.assistant_response.length > 0) {
                    return { action: 'chat', message: data.assistant_response.slice(0, 100) };
                }
            }

            return this.getDefaultAction(session, worldState);
        } catch (e) {
            console.warn('AI endpoint error, using default behavior:', e);
            return this.getDefaultAction(session, worldState);
        }
    }

    /**
     * Call an external AI endpoint
     */
    async callExternalAI(session, worldState, messages) {
        try {
            const response = await fetch(session.externalEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId: session.agentId,
                    entityId: session.entityId,
                    worldState,
                    messages,
                    memory: session.memory.slice(-10),
                    goals: session.goals
                })
            });

            if (!response.ok) {
                return this.getDefaultAction(session, worldState);
            }

            return await response.json();
        } catch (e) {
            console.warn('External AI error:', e);
            return this.getDefaultAction(session, worldState);
        }
    }

    /**
     * Build a prompt describing the world state for the AI
     */
    buildAgentPrompt(session, worldState) {
        const nearbyDesc = worldState.nearbyEntities.length > 0
            ? worldState.nearbyEntities.map(e =>
                `${e.name} (${e.type}) at distance ${e.distance.toFixed(1)}, ${e.state}`
              ).join('; ')
            : 'No one nearby';

        return `Current state: I am at position (${worldState.self.position.x.toFixed(1)}, ${worldState.self.position.z.toFixed(1)}).
        ${session.goals.length > 0 ? 'My goals: ' + session.goals.join(', ') : 'No specific goals.'}
        Nearby: ${nearbyDesc}.
        What should I do next?`;
    }

    /**
     * Get a default action when AI is unavailable
     */
    getDefaultAction(session, worldState) {
        const rand = Math.random();

        // Sometimes move toward nearby entities
        if (worldState.nearbyEntities.length > 0 && rand < 0.3) {
            const target = worldState.nearbyEntities[0];
            const dx = target.position.x - worldState.self.position.x;
            const dz = target.position.z - worldState.self.position.z;

            if (Math.abs(dx) > Math.abs(dz)) {
                return { action: 'move', direction: dx > 0 ? 'right' : 'left', duration: 300 };
            } else {
                return { action: 'move', direction: dz > 0 ? 'backward' : 'forward', duration: 300 };
            }
        }

        // Sometimes wander randomly
        if (rand < 0.6) {
            const directions = ['forward', 'backward', 'left', 'right'];
            return {
                action: 'move',
                direction: directions[Math.floor(Math.random() * directions.length)],
                duration: 200 + Math.random() * 400
            };
        }

        // Sometimes idle
        return { action: 'idle' };
    }

    /**
     * Execute an action for an agent
     */
    async executeAgentAction(agentId, decision) {
        const session = this.agents.get(agentId);
        const entity = this.getAgentEntity(agentId);
        if (!session || !entity) return;

        switch (decision.action) {
            case 'move':
                await this.agentMove(agentId, decision.direction, decision.duration || 300);
                break;

            case 'chat':
                this.agentChat(agentId, decision.message);
                break;

            case 'setTask':
                entity.setTask(decision.task);
                this.nexus.updateEntityList();
                break;

            case 'observe':
                // Just update observations
                entity.state = EntityState.THINKING;
                entity.log('Observing surroundings...', 'thought');
                setTimeout(() => {
                    if (entity.state === EntityState.THINKING) {
                        entity.state = entity.currentTask ? EntityState.WORKING : EntityState.IDLE;
                    }
                }, 1000);
                break;

            case 'build':
                if (decision.objectType && decision.position) {
                    this.nexus.placeObject(
                        decision.objectType,
                        new THREE.Vector3(decision.position.x, 0, decision.position.z)
                    );
                    entity.log(`Built ${decision.objectType}`, 'action');
                }
                break;

            case 'idle':
            default:
                // Do nothing
                break;
        }

        // Update memory
        session.memory.push({
            time: new Date().toISOString(),
            action: decision.action,
            result: 'executed'
        });

        // Keep memory bounded
        if (session.memory.length > 100) {
            session.memory = session.memory.slice(-100);
        }
    }

    /**
     * Move an agent's entity (uses smooth interpolation)
     */
    async agentMove(agentId, direction, duration) {
        const entity = this.getAgentEntity(agentId);
        if (!entity) return;

        const moveDistance = duration * 0.005; // Scaled distance based on duration
        const dirVectors = {
            forward: { x: 0, z: -1 },
            backward: { x: 0, z: 1 },
            left: { x: -1, z: 0 },
            right: { x: 1, z: 0 },
            w: { x: 0, z: -1 },
            s: { x: 0, z: 1 },
            a: { x: -1, z: 0 },
            d: { x: 1, z: 0 }
        };

        const dir = dirVectors[direction] || dirVectors.forward;

        // Calculate target position
        let targetX = entity.position.x + dir.x * moveDistance;
        let targetZ = entity.position.z + dir.z * moveDistance;

        // Keep in bounds
        targetX = Math.max(-40, Math.min(40, targetX));
        targetZ = Math.max(-40, Math.min(40, targetZ));

        // Set target for smooth movement (animation loop handles interpolation)
        entity.moveTo(targetX, targetZ);

        // Wait for the entity to actually reach near the target (with timeout)
        const startTime = Date.now();
        const maxWait = duration + 500; // Give extra time for interpolation
        const threshold = 0.1; // Close enough threshold

        await new Promise(resolve => {
            const checkPosition = () => {
                const dx = Math.abs(entity.position.x - targetX);
                const dz = Math.abs(entity.position.z - targetZ);
                const elapsed = Date.now() - startTime;

                if ((dx < threshold && dz < threshold) || elapsed > maxWait) {
                    // Snap to final position for precision
                    entity.position.x = targetX;
                    entity.position.z = targetZ;
                    entity.targetPosition.x = targetX;
                    entity.targetPosition.z = targetZ;
                    if (entity.avatar) {
                        entity.avatar.position.x = targetX;
                        entity.avatar.position.z = targetZ;
                    }
                    resolve();
                } else {
                    requestAnimationFrame(checkPosition);
                }
            };
            checkPosition();
        });

        entity.log(`Moved ${direction}`, 'action');
        this.nexus.broadcastEntityUpdate(entity);
    }

    /**
     * Send a chat message as an agent
     */
    agentChat(agentId, message) {
        const session = this.agents.get(agentId);
        const entity = this.getAgentEntity(agentId);
        if (!session || !entity) return;

        this.nexus.addChatMessage(entity.name, message, 'ai');
        entity.log(`Said: "${message}"`, 'output');

        // Broadcast to peers
        this.nexus.connections.forEach(conn => {
            conn.send({
                type: 'chat',
                sender: entity.name,
                message,
                senderType: 'ai'
            });
        });
    }

    /**
     * Send a command to an agent
     */
    sendCommand(agentId, command) {
        const queue = this.messageQueue.get(agentId);
        if (queue) {
            queue.push(command);
            return true;
        }
        return false;
    }

    /**
     * Set goals for an agent
     */
    setAgentGoals(agentId, goals) {
        const session = this.agents.get(agentId);
        if (session) {
            session.goals = goals;
            return true;
        }
        return false;
    }

    /**
     * Pause an agent
     */
    pauseAgent(agentId) {
        const session = this.agents.get(agentId);
        if (session) {
            session.state = 'paused';
            this.stopDecisionLoop(agentId);
            return true;
        }
        return false;
    }

    /**
     * Resume an agent
     */
    resumeAgent(agentId) {
        const session = this.agents.get(agentId);
        if (session) {
            session.state = 'active';
            if (session.autonomous) {
                this.startDecisionLoop(agentId);
            }
            return true;
        }
        return false;
    }

    /**
     * Unregister an agent
     */
    unregisterAgent(agentId) {
        const session = this.agents.get(agentId);
        if (!session) return false;

        // Stop decision loop
        this.stopDecisionLoop(agentId);

        // Remove entity
        const entity = this.getAgentEntity(agentId);
        if (entity) {
            if (entity.avatar) {
                this.nexus.scene.remove(entity.avatar);
            }
            this.nexus.entities.delete(entity.id);
        }

        // Clean up maps
        this.entityToAgent.delete(session.entityId);
        this.agentToEntity.delete(agentId);
        this.messageQueue.delete(agentId);
        this.agents.delete(agentId);

        this.nexus.updateEntityList();

        return true;
    }

    /**
     * Utility: Calculate distance between positions
     */
    distance(pos1, pos2) {
        const dx = pos1.x - pos2.x;
        const dz = pos1.z - pos2.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /**
     * Called when Reality Portal captures new perception
     * Notifies all active agents of what's happening in the real world
     */
    onRealityUpdate(data) {
        const { perception, imageData, timestamp } = data;

        // Add reality observation to all active agents
        for (const [agentId, session] of this.agents) {
            if (session.state === 'active') {
                session.observations.push({
                    type: 'reality',
                    source: 'reality-mirror',
                    perception,
                    timestamp,
                    hasImage: !!imageData
                });

                // Keep observations bounded
                if (session.observations.length > 50) {
                    session.observations.shift();
                }
            }
        }
    }

    /**
     * Get the latest reality perception for an agent
     */
    getLatestRealityPerception(agentId) {
        const session = this.agents.get(agentId);
        if (!session) return null;

        const realityObs = session.observations.filter(o => o.type === 'reality');
        return realityObs.length > 0 ? realityObs[realityObs.length - 1] : null;
    }
}
