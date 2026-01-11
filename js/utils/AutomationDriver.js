export default class AutomationDriver {
    constructor(nexusInstance) {
        this.nexus = nexusInstance;
        this.recording = false;
        this.recordedActions = [];
        this.playing = false;
        this.playbackIndex = 0;
        this.panelVisible = false;
    }

    // Camera/View Control
    lookAt(x, y, z) {
        if (!this.nexus) return;
        const target = new THREE.Vector3(x, y, z);
        const dir = target.clone().sub(this.nexus.camera.position).normalize();
        this.nexus.yaw = Math.atan2(dir.x, dir.z);
        this.nexus.pitch = Math.asin(dir.y);
    }

    moveTo(x, y, z, duration = 1000) {
        return new Promise(resolve => {
            const start = this.nexus.camera.position.clone();
            const end = new THREE.Vector3(x, y, z);
            const startTime = Date.now();

            const animate = () => {
                const elapsed = Date.now() - startTime;
                const t = Math.min(1, elapsed / duration);
                const eased = t * t * (3 - 2 * t); // smoothstep

                this.nexus.camera.position.lerpVectors(start, end, eased);

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };
            animate();
        });
    }

    rotateTo(yaw, pitch, duration = 500) {
        return new Promise(resolve => {
            const startYaw = this.nexus.yaw;
            const startPitch = this.nexus.pitch;
            const startTime = Date.now();

            const animate = () => {
                const elapsed = Date.now() - startTime;
                const t = Math.min(1, elapsed / duration);
                const eased = t * t * (3 - 2 * t);

                this.nexus.yaw = startYaw + (yaw - startYaw) * eased;
                this.nexus.pitch = startPitch + (pitch - startPitch) * eased;

                if (t < 1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };
            animate();
        });
    }

    // Entity Interaction
    clickEntity(entityId) {
        const entity = this.nexus.entities.get(entityId);
        if (entity) {
            const screenPos = this.projectToScreen(entity.position);
            this.nexus.onEntityClicked(entity, screenPos.x, screenPos.y);
            return true;
        }
        return false;
    }

    selectAction(actionName) {
        if (this.nexus.actionMenuActive) {
            this.nexus.gazedAction = actionName;
            const entity = this.nexus.actionMenuTarget;
            this.nexus.handleActionMenuClick(actionName, entity);
            return true;
        }
        return false;
    }

    // Move toward entity
    async approachEntity(entityId, distance = 5) {
        const entity = this.nexus.entities.get(entityId);
        if (!entity) return false;

        const dir = new THREE.Vector3()
            .subVectors(this.nexus.camera.position, entity.position)
            .normalize();

        const targetPos = entity.position.clone().add(dir.multiplyScalar(distance));
        targetPos.y = this.nexus.camera.position.y;

        await this.moveTo(targetPos.x, targetPos.y, targetPos.z);
        this.lookAt(entity.position.x, entity.position.y + 1.8, entity.position.z);
        return true;
    }

    projectToScreen(pos3D) {
        const pos = pos3D.clone().project(this.nexus.camera);
        return {
            x: (pos.x * 0.5 + 0.5) * window.innerWidth,
            y: (-pos.y * 0.5 + 0.5) * window.innerHeight
        };
    }

    // Recording
    startRecording() {
        this.recording = true;
        this.recordedActions = [];
        this.recordStartTime = Date.now();
        console.log('[Automation] Recording started');
    }

    recordAction(type, data) {
        if (!this.recording) return;
        this.recordedActions.push({
            time: Date.now() - this.recordStartTime,
            type,
            data
        });
    }

    stopRecording() {
        this.recording = false;
        console.log('[Automation] Recording stopped:', this.recordedActions.length, 'actions');
        return this.recordedActions;
    }

    // Playback
    async playRecording(actions) {
        if (!actions || actions.length === 0) return;
        this.playing = true;
        let lastTime = 0;

        for (const action of actions) {
            if (!this.playing) break;

            const delay = action.time - lastTime;
            if (delay > 0) await this.wait(delay);
            lastTime = action.time;

            await this.executeAction(action);
        }
        this.playing = false;
    }

    stopPlayback() {
        this.playing = false;
    }

    async executeAction(action) {
        switch (action.type) {
            case 'moveTo':
                await this.moveTo(action.data.x, action.data.y, action.data.z, action.data.duration);
                break;
            case 'rotateTo':
                await this.rotateTo(action.data.yaw, action.data.pitch, action.data.duration);
                break;
            case 'clickEntity':
                this.clickEntity(action.data.entityId);
                break;
            case 'selectAction':
                this.selectAction(action.data.action);
                break;
            case 'wait':
                await this.wait(action.data.ms);
                break;
        }
    }

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Get state for scripting
    getState() {
        return {
            camera: {
                position: this.nexus.camera.position.clone(),
                yaw: this.nexus.yaw,
                pitch: this.nexus.pitch
            },
            entities: Array.from(this.nexus.entities.values()).map(e => ({
                id: e.id,
                name: e.name,
                position: e.position.clone(),
                state: e.state,
                emotion: e.emotion
            })),
            observedEntity: this.nexus.observedEntity?.id,
            controlMode: this.nexus.controlMode
        };
    }

    // List entities
    listEntities() {
        return Array.from(this.nexus.entities.values()).map(e => ({
            id: e.id,
            name: e.name,
            type: e.type,
            position: { x: e.position.x.toFixed(1), y: e.position.y.toFixed(1), z: e.position.z.toFixed(1) }
        }));
    }

    // Inject control panel
    injectPanel() {
        if (document.getElementById('automation-panel')) {
            this.togglePanel();
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'automation-panel';
        panel.innerHTML = `
            <style>
                #automation-panel {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    width: 280px;
                    background: rgba(10, 20, 40, 0.95);
                    border: 2px solid rgba(100, 200, 255, 0.5);
                    border-radius: 8px;
                    padding: 12px;
                    z-index: 10000;
                    font-family: 'Segoe UI', sans-serif;
                    font-size: 12px;
                    color: #e0f0ff;
                    backdrop-filter: blur(10px);
                }
                #automation-panel h3 {
                    margin: 0 0 10px 0;
                    font-size: 14px;
                    color: #00d4ff;
                    border-bottom: 1px solid rgba(100, 200, 255, 0.3);
                    padding-bottom: 6px;
                }
                #automation-panel .btn {
                    background: rgba(0, 150, 255, 0.3);
                    border: 1px solid rgba(100, 200, 255, 0.5);
                    color: #fff;
                    padding: 6px 10px;
                    border-radius: 4px;
                    cursor: pointer;
                    margin: 2px;
                    font-size: 11px;
                }
                #automation-panel .btn:hover {
                    background: rgba(0, 150, 255, 0.5);
                }
                #automation-panel .btn.active {
                    background: rgba(0, 200, 100, 0.5);
                }
                #automation-panel .section {
                    margin-bottom: 10px;
                }
                #automation-panel .entity-list {
                    max-height: 120px;
                    overflow-y: auto;
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 4px;
                    padding: 4px;
                }
                #automation-panel .entity-item {
                    padding: 4px 6px;
                    cursor: pointer;
                    border-radius: 3px;
                }
                #automation-panel .entity-item:hover {
                    background: rgba(0, 150, 255, 0.3);
                }
                #automation-panel .status {
                    font-size: 10px;
                    color: #88aacc;
                    margin-top: 5px;
                }
                #automation-panel input {
                    background: rgba(0, 0, 0, 0.3);
                    border: 1px solid rgba(100, 200, 255, 0.3);
                    color: #fff;
                    padding: 4px 6px;
                    border-radius: 3px;
                    width: 100%;
                    margin-top: 4px;
                }
            </style>
            <h3>Automation Driver</h3>
            <div class="section">
                <button class="btn" onclick="automationDriver.togglePanel()">Hide</button>
                <button class="btn" id="rec-btn" onclick="automationDriver.toggleRecording()">Record</button>
                <button class="btn" id="play-btn" onclick="automationDriver.playLastRecording()">Play</button>
            </div>
            <div class="section">
                <strong>Entities:</strong>
                <div class="entity-list" id="entity-list"></div>
            </div>
            <div class="section">
                <strong>Quick Script:</strong>
                <input type="text" id="script-input" placeholder="e.g., approachEntity('entity-id')">
                <button class="btn" onclick="automationDriver.runScript()">Run</button>
            </div>
            <div class="status" id="auto-status">Ready</div>
        `;
        document.body.appendChild(panel);
        this.panelVisible = true;
        this.refreshEntityList();
    }

    togglePanel() {
        const panel = document.getElementById('automation-panel');
        if (panel) {
            this.panelVisible = !this.panelVisible;
            panel.style.display = this.panelVisible ? 'block' : 'none';
        }
    }

    refreshEntityList() {
        const list = document.getElementById('entity-list');
        if (!list) return;

        const entities = this.listEntities();
        list.innerHTML = entities.map(e =>
            `<div class="entity-item" onclick="automationDriver.approachEntity('${e.id}')">${e.name} (${e.type})</div>`
        ).join('');
    }

    toggleRecording() {
        const btn = document.getElementById('rec-btn');
        if (this.recording) {
            this.stopRecording();
            if (btn) btn.classList.remove('active');
            this.setStatus('Recording saved');
        } else {
            this.startRecording();
            if (btn) btn.classList.add('active');
            this.setStatus('Recording...');
        }
    }

    playLastRecording() {
        if (this.recordedActions.length > 0) {
            this.setStatus('Playing...');
            this.playRecording(this.recordedActions).then(() => {
                this.setStatus('Playback complete');
            });
        } else {
            this.setStatus('No recording to play');
        }
    }

    runScript() {
        const input = document.getElementById('script-input');
        if (!input) return;

        try {
            const result = eval(`this.${input.value}`);
            if (result instanceof Promise) {
                result.then(r => this.setStatus(`Result: ${JSON.stringify(r)}`));
            } else {
                this.setStatus(`Result: ${JSON.stringify(result)}`);
            }
        } catch (e) {
            this.setStatus(`Error: ${e.message}`);
        }
    }

    setStatus(msg) {
        const status = document.getElementById('auto-status');
        if (status) status.textContent = msg;
    }
}
