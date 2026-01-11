
// Entity Types
export const EntityType = {
    HUMAN: 'human',
    AI: 'ai',
    TWIN: 'twin'
};

// Entity States
export const EntityState = {
    IDLE: 'idle',
    WORKING: 'working',
    THINKING: 'thinking',
    CONTROLLED: 'controlled'
};

// Control Modes (for observation)
export const ControlMode = {
    OBSERVE: 'observe',    // Just watching
    GUIDE: 'guide',        // Can send suggestions
    TAKEOVER: 'takeover'   // Full control
};

// ===========================================
// ENTITY CLASS - Core unit for humans & AIs
// ===========================================
export class Entity {
    constructor(id, name, type, position = { x: 0, y: 0, z: 0 }) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.position = { ...position };
        this.targetPosition = { ...position }; // For smooth movement
        this.rotation = { x: 0, y: 0, z: 0 };
        this.targetRotation = { x: 0, y: 0 }; // For smooth rotation
        this.state = EntityState.IDLE;
        this.currentTask = null;
        this.taskQueue = [];
        this.activityLog = [];
        this.avatar = null;
        this.controlledBy = null; // null = autonomous, or entity ID of controller
        this.observers = []; // List of entities observing this one

        // Smooth movement settings
        this.lerpSpeed = 8; // Higher = faster interpolation
        this.isMoving = false;
        this.moveStartTime = 0;
        this.walkCycleOffset = Math.random() * Math.PI * 2; // Random start for walk animation

        // For AI entities
        this.aiConfig = {
            autonomous: true,
            decisionInterval: 2000,
            personality: 'helpful'
        };

        // CYCLE 2: AI Emotion & Attention System
        this.emotion = 'neutral'; // neutral, curious, focused, helping, thinking
        this.attentionTarget = null; // What this entity is looking at (entityId or 'reality-portal')
        this.emotionIntensity = 0.5; // 0-1

        // For Digital Twins
        this.twinConfig = {
            externalSystemUrl: null,
            syncInterval: 1000,
            lastSyncTime: null
        };

        // Timer tracking for cleanup (prevents memory leaks)
        this.behaviorTimeoutId = null;
        this.syncTimeoutId = null;
    }

    // Set target position for smooth movement
    moveTo(x, z) {
        this.targetPosition.x = x;
        this.targetPosition.z = z;
        this.isMoving = true;
        this.moveStartTime = Date.now();
    }

    // Update smooth movement (call every frame)
    updateMovement(deltaTime) {
        if (!this.avatar) return;

        const dt = Math.min(deltaTime, 0.1); // Cap delta to prevent jumps
        const lerpFactor = 1 - Math.exp(-this.lerpSpeed * dt);

        // Smooth position interpolation
        const dx = this.targetPosition.x - this.position.x;
        const dz = this.targetPosition.z - this.position.z;
        const distSq = dx * dx + dz * dz;

        if (distSq > 0.0001) {
            this.position.x += dx * lerpFactor;
            this.position.z += dz * lerpFactor;
            this.isMoving = true;

            // Smoothly rotate to face movement direction
            const targetAngle = Math.atan2(dx, dz);
            const currentAngle = this.avatar.rotation.y;
            let angleDiff = targetAngle - currentAngle;

            // Normalize angle difference to -PI to PI
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            this.avatar.rotation.y += angleDiff * lerpFactor * 0.5;
        } else {
            this.position.x = this.targetPosition.x;
            this.position.z = this.targetPosition.z;
            this.isMoving = false;
        }

        // Update avatar position with walking animation
        this.avatar.position.x = this.position.x;
        this.avatar.position.z = this.position.z;

        // Walking animation (minimal to avoid motion sickness)
        if (this.isMoving && distSq > 0.01) {
            // Very subtle bob - smooth sine wave, not bouncing
            const walkSpeed = 6; // Slower
            const bobHeight = 0.02; // Much smaller
            const time = Date.now() * 0.001;
            this.avatar.position.y = Math.sin(time * walkSpeed + this.walkCycleOffset) * bobHeight;
            // No body sway - it adds to motion sickness
        } else {
            // Idle - almost no movement
            this.avatar.position.y = 0;
        }
    }

    log(message, type = 'action') {
        const entry = {
            time: new Date().toISOString(),
            message,
            type
        };
        this.activityLog.push(entry);
        if (this.activityLog.length > 100) {
            this.activityLog.shift();
        }
        return entry;
    }

    teleportTo(x, y, z) {
        this.position = { x, y, z };
        this.targetPosition = { x, z }; // Also update target for smooth movement
        this.log(`Teleported to (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`);
    }

    setTask(task) {
        this.currentTask = task;
        this.state = EntityState.WORKING;
        this.log(`Started task: ${task}`, 'action');
    }

    completeTask() {
        const completed = this.currentTask;
        this.log(`Completed task: ${completed}`, 'output');
        this.currentTask = null;

        if (this.taskQueue.length > 0) {
            this.setTask(this.taskQueue.shift());
        } else {
            this.state = EntityState.IDLE;
        }
    }

    serialize() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            position: this.position,
            rotation: this.rotation,
            state: this.state,
            currentTask: this.currentTask
        };
    }
}
