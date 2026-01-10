import { test, expect, Page } from '@playwright/test';

/**
 * NEXUS METAVERSE TEST SUITE
 *
 * Tests the AI-Human collaborative metaverse using the exposed NexusAPI.
 * The API allows programmatic control just like a human would interact.
 */

// Helper to wait for the metaverse to be ready
async function waitForReady(page: Page, timeout = 15000) {
  await page.waitForFunction(
    () => window['nexusAPI']?.isReady() && !window['nexusAPI']?.isLoading(),
    { timeout }
  );
}

// Helper to call API methods
async function api(page: Page, method: string, ...args: any[]) {
  return page.evaluate(
    ({ method, args }) => {
      const api = window['nexusAPI'];
      if (!api) throw new Error('NexusAPI not available');
      const fn = api[method];
      if (typeof fn !== 'function') throw new Error(`Method ${method} not found`);
      return fn.apply(api, args);
    },
    { method, args }
  );
}

// Helper to get state snapshot
async function getState(page: Page) {
  return page.evaluate(() => window['nexusAPI']?.getStateSnapshot());
}

// ===========================================
// TEST SUITES
// ===========================================

test.describe('Nexus Metaverse - Initialization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
  });

  test('should load and initialize the metaverse', async ({ page }) => {
    // Wait for loading to complete
    await waitForReady(page);

    // Verify ready state
    const state = await getState(page);
    expect(state.ready).toBe(true);
    expect(state.loading).toBe(false);
  });

  test('should have the API exposed on window', async ({ page }) => {
    await waitForReady(page);

    const hasAPI = await page.evaluate(() => !!window['nexusAPI']);
    expect(hasAPI).toBe(true);

    const hasNexus = await page.evaluate(() => !!window['nexus']);
    expect(hasNexus).toBe(true);
  });

  test('should start in explore mode', async ({ page }) => {
    await waitForReady(page);

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('explore');
  });

  test('should have a local player entity', async ({ page }) => {
    await waitForReady(page);

    const localPlayer = await api(page, 'getLocalPlayer');
    expect(localPlayer).not.toBeNull();
    expect(localPlayer.name).toBe('You');
    expect(localPlayer.type).toBe('human');
  });

  test('should have default camera position', async ({ page }) => {
    await waitForReady(page);

    const camera = await api(page, 'getCameraState');
    expect(camera.position.y).toBeCloseTo(2, 0); // Eye height
    expect(camera.position.z).toBeCloseTo(10, 0); // Starting distance
  });
});

test.describe('Nexus Metaverse - Entity System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('should have demo AI entities spawned', async ({ page }) => {
    const entities = await api(page, 'getEntities');

    // Should have local player + 3 AIs + 1 digital twin = 5 entities
    expect(entities.length).toBeGreaterThanOrEqual(5);

    // Find the AI entities
    const atlas = entities.find((e: any) => e.name === 'Atlas');
    const nova = entities.find((e: any) => e.name === 'Nova');
    const echo = entities.find((e: any) => e.name === 'Echo');

    expect(atlas).toBeDefined();
    expect(atlas.type).toBe('ai');

    expect(nova).toBeDefined();
    expect(nova.type).toBe('ai');

    expect(echo).toBeDefined();
    expect(echo.type).toBe('ai');
  });

  test('should have a digital twin entity', async ({ page }) => {
    const entities = await api(page, 'getEntities');

    const twin = entities.find((e: any) => e.name === 'Factory-Bot-1');
    expect(twin).toBeDefined();
    expect(twin.type).toBe('twin');
  });

  test('should be able to get entity by name', async ({ page }) => {
    const atlas = await api(page, 'getEntity', 'Atlas');

    expect(atlas).not.toBeNull();
    expect(atlas.name).toBe('Atlas');
    expect(atlas.type).toBe('ai');
  });

  test('should be able to add a new AI entity', async ({ page }) => {
    const initialEntities = await api(page, 'getEntities');
    const initialCount = initialEntities.length;

    await api(page, 'addEntity', 'TestBot', 'ai', 'Running tests');

    const newEntities = await api(page, 'getEntities');
    expect(newEntities.length).toBe(initialCount + 1);

    const testBot = await api(page, 'getEntity', 'TestBot');
    expect(testBot).not.toBeNull();
    expect(testBot.name).toBe('TestBot');
    expect(testBot.type).toBe('ai');
    expect(testBot.currentTask).toBe('Running tests');
  });

  test('should be able to add a digital twin entity', async ({ page }) => {
    await api(page, 'addEntity', 'RobotArm-1', 'twin', 'Assembly line monitoring');

    const robotArm = await api(page, 'getEntity', 'RobotArm-1');
    expect(robotArm).not.toBeNull();
    expect(robotArm.type).toBe('twin');
  });
});

test.describe('Nexus Metaverse - Observation System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    // Reset to clean state
    await api(page, 'reset');
  });

  test('should be able to observe an entity', async ({ page }) => {
    const success = await api(page, 'observeEntity', 'Atlas');
    expect(success).toBe(true);

    const observed = await api(page, 'getObservedEntity');
    expect(observed).not.toBeNull();
    expect(observed.name).toBe('Atlas');
  });

  test('should show observation panel when observing', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');

    const isVisible = await api(page, 'isObservationPanelVisible');
    expect(isVisible).toBe(true);
  });

  test('should switch to observe mode when observing', async ({ page }) => {
    await api(page, 'observeEntity', 'Nova');

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('observe');
  });

  test('should be able to switch observed entity', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    let observed = await api(page, 'getObservedEntity');
    expect(observed.name).toBe('Atlas');

    await api(page, 'observeEntity', 'Nova');
    observed = await api(page, 'getObservedEntity');
    expect(observed.name).toBe('Nova');
  });

  test('should start in observe control mode', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');

    const controlMode = await api(page, 'getControlMode');
    expect(controlMode).toBe('observe');
  });
});

test.describe('Nexus Metaverse - Possession System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('should be able to take over an entity', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    const success = await api(page, 'takeOver');
    expect(success).toBe(true);

    const isPossessing = await api(page, 'isPossessing');
    expect(isPossessing).toBe(true);
  });

  test('should teleport camera to entity position on takeover', async ({ page }) => {
    // Get Atlas's position before takeover
    const atlasBefore = await api(page, 'getEntity', 'Atlas');
    const cameraBeforeTakeover = await api(page, 'getCameraState');

    // Verify we're not at Atlas's position yet
    expect(cameraBeforeTakeover.position.x).not.toBeCloseTo(atlasBefore.position.x, 0);

    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    // Camera should now be at Atlas's position (at eye height)
    const cameraAfter = await api(page, 'getCameraState');
    expect(cameraAfter.position.x).toBeCloseTo(atlasBefore.position.x, 0);
    expect(cameraAfter.position.z).toBeCloseTo(atlasBefore.position.z, 0);
    expect(cameraAfter.position.y).toBeCloseTo(2, 0); // Eye height
  });

  test('should show possession HUD when possessing', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    const hudVisible = await api(page, 'isPossessionHUDVisible');
    expect(hudVisible).toBe(true);
  });

  test('should mark entity as controlled during possession', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    const atlas = await api(page, 'getEntity', 'Atlas');
    expect(atlas.isControlled).toBe(true);
    expect(atlas.state).toBe('controlled');
  });

  test('should be able to release control', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    expect(await api(page, 'isPossessing')).toBe(true);

    await api(page, 'releaseControl');

    expect(await api(page, 'isPossessing')).toBe(false);

    const controlMode = await api(page, 'getControlMode');
    expect(controlMode).toBe('observe');
  });

  test('should hide possession HUD after release', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    expect(await api(page, 'isPossessionHUDVisible')).toBe(true);

    await api(page, 'releaseControl');

    expect(await api(page, 'isPossessionHUDVisible')).toBe(false);
  });

  test('should return entity to autonomous mode after release', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    const atlasDuringPossession = await api(page, 'getEntity', 'Atlas');
    expect(atlasDuringPossession.isControlled).toBe(true);

    await api(page, 'releaseControl');

    const atlasAfterRelease = await api(page, 'getEntity', 'Atlas');
    expect(atlasAfterRelease.isControlled).toBe(false);
  });
});

test.describe('Nexus Metaverse - Movement System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('should move camera forward when pressing W', async ({ page }) => {
    const initialCamera = await api(page, 'getCameraState');
    const initialZ = initialCamera.position.z;

    // Move forward
    await api(page, 'move', 'forward', 500);

    // Wait for movement to complete
    await page.waitForTimeout(600);

    const afterCamera = await api(page, 'getCameraState');
    // Z should decrease when moving forward (toward center)
    expect(afterCamera.position.z).toBeLessThan(initialZ);
  });

  test('should move camera backward when pressing S', async ({ page }) => {
    const initialCamera = await api(page, 'getCameraState');
    const initialZ = initialCamera.position.z;

    await api(page, 'move', 'backward', 500);
    await page.waitForTimeout(600);

    const afterCamera = await api(page, 'getCameraState');
    expect(afterCamera.position.z).toBeGreaterThan(initialZ);
  });

  test('should update local player position when moving', async ({ page }) => {
    const initialPlayer = await api(page, 'getLocalPlayer');
    const initialZ = initialPlayer.position.z;

    await api(page, 'move', 'forward', 500);
    await page.waitForTimeout(600);

    const afterPlayer = await api(page, 'getLocalPlayer');
    expect(afterPlayer.position.z).not.toBeCloseTo(initialZ, 0);
  });

  test('should move possessed entity when in takeover mode', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    const atlasBefore = await api(page, 'getEntity', 'Atlas');

    await api(page, 'takeOver');

    // Move forward while possessing
    await api(page, 'move', 'forward', 500);
    await page.waitForTimeout(600);

    const atlasAfter = await api(page, 'getEntity', 'Atlas');

    // Atlas's position should have changed
    const distance = await api(page, 'getDistance', atlasBefore.position, atlasAfter.position);
    expect(distance).toBeGreaterThan(0.1);
  });

  test('should be able to teleport camera', async ({ page }) => {
    await api(page, 'teleportCamera', 15, 5, 20);

    const camera = await api(page, 'getCameraState');
    expect(camera.position.x).toBeCloseTo(15, 0);
    expect(camera.position.y).toBeCloseTo(5, 0);
    expect(camera.position.z).toBeCloseTo(20, 0);
  });
});

test.describe('Nexus Metaverse - Mode Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('should be able to switch to build mode', async ({ page }) => {
    await api(page, 'setMode', 'build');

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('build');

    const builderVisible = await api(page, 'isBuilderPanelVisible');
    expect(builderVisible).toBe(true);
  });

  test('should be able to switch to observe mode', async ({ page }) => {
    await api(page, 'setMode', 'observe');

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('observe');
  });

  test('should be able to switch back to explore mode', async ({ page }) => {
    await api(page, 'setMode', 'build');
    await api(page, 'setMode', 'explore');

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('explore');

    const builderVisible = await api(page, 'isBuilderPanelVisible');
    expect(builderVisible).toBe(false);
  });
});

test.describe('Nexus Metaverse - World Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('should be able to place a cube', async ({ page }) => {
    const initialCount = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'cube', 5, 5);

    const newCount = await api(page, 'getWorldObjectsCount');
    expect(newCount).toBe(initialCount + 1);
  });

  test('should be able to place a sphere', async ({ page }) => {
    const initialCount = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'sphere', -5, 5);

    const newCount = await api(page, 'getWorldObjectsCount');
    expect(newCount).toBe(initialCount + 1);
  });

  test('should be able to place multiple objects', async ({ page }) => {
    const initialCount = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'cube', 0, 10);
    await api(page, 'placeObject', 'sphere', 5, 10);
    await api(page, 'placeObject', 'tree', 10, 10);

    const newCount = await api(page, 'getWorldObjectsCount');
    expect(newCount).toBe(initialCount + 3);
  });

  test('should be able to place a portal', async ({ page }) => {
    const initialCount = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'portal', 0, 15);

    const newCount = await api(page, 'getWorldObjectsCount');
    expect(newCount).toBe(initialCount + 1);
  });
});

test.describe('Nexus Metaverse - Chat System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('should be able to send a chat message', async ({ page }) => {
    const initialMessages = await api(page, 'getChatMessages');
    const initialCount = initialMessages.length;

    await api(page, 'sendChatMessage', 'Hello, world!');

    const newMessages = await api(page, 'getChatMessages');
    expect(newMessages.length).toBe(initialCount + 1);

    const lastMessage = newMessages[newMessages.length - 1];
    expect(lastMessage.text).toContain('Hello, world!');
  });

  test('should be able to command an AI entity', async ({ page }) => {
    await api(page, 'commandAI', 'Atlas', 'analyze the environment');

    // Wait a moment for the command to be processed
    await page.waitForTimeout(100);

    // Check that Atlas received a new task
    const atlas = await api(page, 'getEntity', 'Atlas');
    expect(atlas.currentTask).toBe('analyze the environment');
  });

  test('should add system message when possessing', async ({ page }) => {
    const initialMessages = await api(page, 'getChatMessages');
    const initialCount = initialMessages.length;

    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    const newMessages = await api(page, 'getChatMessages');
    expect(newMessages.length).toBeGreaterThan(initialCount);

    // Check for possession message
    const possessionMessage = newMessages.find((m: any) =>
      m.text.toLowerCase().includes('possessing')
    );
    expect(possessionMessage).toBeDefined();
  });
});

test.describe('Nexus Metaverse - State Snapshot', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('should provide complete state snapshot', async ({ page }) => {
    const state = await getState(page);

    // Verify all expected properties exist
    expect(state).toHaveProperty('ready');
    expect(state).toHaveProperty('loading');
    expect(state).toHaveProperty('mode');
    expect(state).toHaveProperty('controlMode');
    expect(state).toHaveProperty('isPossessing');
    expect(state).toHaveProperty('camera');
    expect(state).toHaveProperty('localPlayer');
    expect(state).toHaveProperty('entityCount');
    expect(state).toHaveProperty('worldObjectCount');
    expect(state).toHaveProperty('observationPanelVisible');
    expect(state).toHaveProperty('builderPanelVisible');
    expect(state).toHaveProperty('possessionHUDVisible');
  });

  test('should update snapshot after actions', async ({ page }) => {
    const stateBefore = await getState(page);
    expect(stateBefore.observationPanelVisible).toBe(false);

    await api(page, 'observeEntity', 'Atlas');

    const stateAfter = await getState(page);
    expect(stateAfter.observationPanelVisible).toBe(true);
    expect(stateAfter.observedEntity).not.toBeNull();
    expect(stateAfter.observedEntity.name).toBe('Atlas');
  });
});

test.describe('Nexus Metaverse - Reset Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('should reset to initial state', async ({ page }) => {
    // Make some changes
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');
    await api(page, 'setMode', 'build');

    // Verify changes
    let state = await getState(page);
    expect(state.isPossessing).toBe(true);

    // Reset
    await api(page, 'reset');

    // Verify reset
    state = await getState(page);
    expect(state.isPossessing).toBe(false);
    expect(state.mode).toBe('explore');
    expect(state.observationPanelVisible).toBe(false);
    expect(state.camera.position.z).toBeCloseTo(10, 0);
  });
});

test.describe('Nexus Metaverse - AI Agent System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('should register a new AI agent', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'TestAgent',
      type: 'ai',
      personality: 'test bot',
      autonomous: false
    });

    expect(result.agentId).toBeDefined();
    expect(result.authToken).toBeDefined();
    expect(result.entityId).toBeDefined();
    expect(result.name).toBe('TestAgent');
  });

  test('should create entity for registered agent', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'EntityTestBot',
      type: 'ai'
    });

    const entity = await api(page, 'getEntity', 'EntityTestBot');
    expect(entity).not.toBeNull();
    expect(entity.type).toBe('ai');
  });

  test('should list registered agents', async ({ page }) => {
    await api(page, 'registerAgent', { name: 'Agent1', autonomous: false });
    await api(page, 'registerAgent', { name: 'Agent2', autonomous: false });

    const agents = await api(page, 'getAgents');
    const agent1 = agents.find((a: any) => a.name === 'Agent1');
    const agent2 = agents.find((a: any) => a.name === 'Agent2');

    expect(agent1).toBeDefined();
    expect(agent2).toBeDefined();
  });

  test('should get agent status', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'StatusBot',
      type: 'ai',
      autonomous: false,
      initialTask: 'Testing status'
    });

    // Need to get agent status by agentId, not authToken
    const status = await page.evaluate((agentId) => {
      return window['nexusAPI'].getAgentStatus(agentId);
    }, result.agentId);

    expect(status).not.toBeNull();
    expect(status.name).toBe('StatusBot');
    expect(status.currentTask).toBe('Testing status');
  });

  test('should move agent with authToken', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'MoveBot',
      autonomous: false
    });

    const entityBefore = await api(page, 'getEntity', 'MoveBot');
    const posBefore = entityBefore.position;

    await api(page, 'agentMove', result.authToken, 'forward', 300);
    await page.waitForTimeout(400);

    const entityAfter = await api(page, 'getEntity', 'MoveBot');
    const posAfter = entityAfter.position;

    // Position should have changed
    expect(posAfter.z).not.toBeCloseTo(posBefore.z, 0);
  });

  test('should send chat as agent', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'ChatBot',
      autonomous: false
    });

    const messagesBefore = await api(page, 'getChatMessages');
    const countBefore = messagesBefore.length;

    await api(page, 'agentChat', result.authToken, 'Hello from ChatBot!');

    const messagesAfter = await api(page, 'getChatMessages');
    expect(messagesAfter.length).toBeGreaterThan(countBefore);

    const lastMessage = messagesAfter[messagesAfter.length - 1];
    expect(lastMessage.sender).toBe('ChatBot');
    expect(lastMessage.text).toContain('Hello from ChatBot!');
  });

  test('should set agent task', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'TaskBot',
      autonomous: false
    });

    await api(page, 'agentSetTask', result.authToken, 'New important task');

    const entity = await api(page, 'getEntity', 'TaskBot');
    expect(entity.currentTask).toBe('New important task');
  });

  test('should set agent goals', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'GoalBot',
      autonomous: false
    });

    await api(page, 'setAgentGoals', result.authToken, ['explore', 'build', 'chat']);

    const status = await page.evaluate((agentId) => {
      return window['nexusAPI'].getAgentStatus(agentId);
    }, result.agentId);

    expect(status.goals).toContain('explore');
    expect(status.goals).toContain('build');
    expect(status.goals).toContain('chat');
  });

  test('should build object as agent', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'BuilderBot',
      autonomous: false
    });

    const countBefore = await api(page, 'getWorldObjectsCount');

    await api(page, 'agentBuild', result.authToken, 'cube', 10, 10);

    const countAfter = await api(page, 'getWorldObjectsCount');
    expect(countAfter).toBe(countBefore + 1);
  });

  test('should pause and resume agent', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'PauseBot',
      autonomous: true,
      decisionInterval: 100 // Fast for testing
    });

    // Pause the agent
    const pauseResult = await api(page, 'pauseAgent', result.authToken);
    expect(pauseResult.success).toBe(true);

    const statusPaused = await page.evaluate((agentId) => {
      return window['nexusAPI'].getAgentStatus(agentId);
    }, result.agentId);
    expect(statusPaused.state).toBe('paused');

    // Resume the agent
    const resumeResult = await api(page, 'resumeAgent', result.authToken);
    expect(resumeResult.success).toBe(true);

    const statusResumed = await page.evaluate((agentId) => {
      return window['nexusAPI'].getAgentStatus(agentId);
    }, result.agentId);
    expect(statusResumed.state).toBe('active');
  });

  test('should unregister agent', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'UnregisterBot',
      autonomous: false
    });

    // Verify entity exists
    let entity = await api(page, 'getEntity', 'UnregisterBot');
    expect(entity).not.toBeNull();

    // Unregister
    const unregResult = await api(page, 'unregisterAgent', result.authToken);
    expect(unregResult.success).toBe(true);

    // Entity should be gone
    entity = await api(page, 'getEntity', 'UnregisterBot');
    expect(entity).toBeNull();
  });

  test('should reject invalid auth token', async ({ page }) => {
    const result = await api(page, 'agentMove', 'invalid-token', 'forward', 100);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid auth token');
  });

  test('should get agent world view', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'ViewBot',
      autonomous: false
    });

    const worldView = await api(page, 'getAgentWorldView', result.agentId);

    expect(worldView).not.toBeNull();
    expect(worldView.self).toBeDefined();
    expect(worldView.self.name).toBe('ViewBot');
    expect(worldView.nearbyEntities).toBeDefined();
    expect(Array.isArray(worldView.nearbyEntities)).toBe(true);
  });

  test('should register digital twin agent', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'RobotArm-001',
      type: 'twin',
      autonomous: false,
      initialTask: 'Syncing with factory'
    });

    const entity = await api(page, 'getEntity', 'RobotArm-001');
    expect(entity).not.toBeNull();
    expect(entity.type).toBe('twin');
  });

  test('should trigger manual decision cycle', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'ManualBot',
      autonomous: false
    });

    const triggerResult = await api(page, 'triggerAgentDecision', result.authToken);
    expect(triggerResult.success).toBe(true);
  });

  test('should get agent memory', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'MemoryBot',
      autonomous: false
    });

    // Perform some actions to build memory
    await api(page, 'agentMove', result.authToken, 'forward', 100);
    await page.waitForTimeout(150);
    await api(page, 'agentChat', result.authToken, 'Testing memory');

    const memory = await api(page, 'getAgentMemory', result.authToken);
    expect(memory).not.toBeNull();
    expect(memory.memory.length).toBeGreaterThan(0);
  });
});

test.describe('Nexus Metaverse - Agent Integration Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('full AI agent lifecycle', async ({ page }) => {
    // 1. Register an agent
    const agent = await api(page, 'registerAgent', {
      name: 'LifecycleBot',
      type: 'ai',
      personality: 'helpful and curious',
      autonomous: false,
      initialTask: 'Initial setup'
    });

    expect(agent.authToken).toBeDefined();

    // 2. Set goals
    await api(page, 'setAgentGoals', agent.authToken, ['explore the world', 'meet other entities']);

    // 3. Move around
    await api(page, 'agentMove', agent.authToken, 'forward', 200);
    await page.waitForTimeout(250);
    await api(page, 'agentMove', agent.authToken, 'right', 200);
    await page.waitForTimeout(250);

    // 4. Chat
    await api(page, 'agentChat', agent.authToken, 'Hello everyone! I am exploring.');

    // 5. Build something
    const entity = await api(page, 'getEntity', 'LifecycleBot');
    await api(page, 'agentBuild', agent.authToken, 'cube', entity.position.x + 2, entity.position.z);

    // 6. Update task
    await api(page, 'agentSetTask', agent.authToken, 'Building complete');

    // 7. Verify final state
    const finalEntity = await api(page, 'getEntity', 'LifecycleBot');
    expect(finalEntity.currentTask).toBe('Building complete');

    // 8. Unregister
    await api(page, 'unregisterAgent', agent.authToken);
    const goneEntity = await api(page, 'getEntity', 'LifecycleBot');
    expect(goneEntity).toBeNull();
  });

  test('human observing AI agent', async ({ page }) => {
    // Register an AI agent
    const agent = await api(page, 'registerAgent', {
      name: 'ObservableBot',
      autonomous: false
    });

    // Human observes the AI
    await api(page, 'observeEntity', 'ObservableBot');

    const observed = await api(page, 'getObservedEntity');
    expect(observed.name).toBe('ObservableBot');

    // AI performs action while being observed
    await api(page, 'agentChat', agent.authToken, 'I am being observed!');
    await api(page, 'agentMove', agent.authToken, 'forward', 300);
    await page.waitForTimeout(350);

    // Human takes over the AI
    await api(page, 'takeOver');
    expect(await api(page, 'isPossessing')).toBe(true);

    // Move as the AI
    const posBefore = (await api(page, 'getEntity', 'ObservableBot')).position;
    await api(page, 'move', 'forward', 300);
    await page.waitForTimeout(350);
    const posAfter = (await api(page, 'getEntity', 'ObservableBot')).position;

    expect(posAfter.z).not.toBeCloseTo(posBefore.z, 0);

    // Release control
    await api(page, 'releaseControl');
    expect(await api(page, 'isPossessing')).toBe(false);
  });

  test('multiple AI agents interacting', async ({ page }) => {
    // Register two agents
    const agent1 = await api(page, 'registerAgent', {
      name: 'Agent-Alpha',
      autonomous: false
    });

    const agent2 = await api(page, 'registerAgent', {
      name: 'Agent-Beta',
      autonomous: false
    });

    // Move them toward each other
    const entity1 = await api(page, 'getEntity', 'Agent-Alpha');
    const entity2 = await api(page, 'getEntity', 'Agent-Beta');

    // Agent 1 chats
    await api(page, 'agentChat', agent1.authToken, 'Hello Agent-Beta!');

    // Agent 2 responds
    await api(page, 'agentChat', agent2.authToken, 'Hello Agent-Alpha!');

    // Check chat history
    const messages = await api(page, 'getChatMessages');
    const alphaMsg = messages.find((m: any) => m.sender === 'Agent-Alpha');
    const betaMsg = messages.find((m: any) => m.sender === 'Agent-Beta');

    expect(alphaMsg).toBeDefined();
    expect(betaMsg).toBeDefined();
  });
});

test.describe('Nexus Metaverse - Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('full possession workflow', async ({ page }) => {
    // 1. Start in explore mode
    let state = await getState(page);
    expect(state.mode).toBe('explore');
    expect(state.isPossessing).toBe(false);

    // 2. Select an entity to observe
    await api(page, 'observeEntity', 'Nova');
    state = await getState(page);
    expect(state.observedEntity?.name).toBe('Nova');
    expect(state.observationPanelVisible).toBe(true);

    // 3. Take over the entity
    await api(page, 'takeOver');
    state = await getState(page);
    expect(state.isPossessing).toBe(true);
    expect(state.possessionHUDVisible).toBe(true);

    // 4. Move while possessing
    const novaBefore = await api(page, 'getEntity', 'Nova');
    await api(page, 'move', 'forward', 500);
    await page.waitForTimeout(600);
    const novaAfter = await api(page, 'getEntity', 'Nova');

    const distance = await api(page, 'getDistance', novaBefore.position, novaAfter.position);
    expect(distance).toBeGreaterThan(0.1);

    // 5. Release control
    await api(page, 'releaseControl');
    state = await getState(page);
    expect(state.isPossessing).toBe(false);
    expect(state.possessionHUDVisible).toBe(false);

    // 6. Nova should be autonomous again
    const novaFinal = await api(page, 'getEntity', 'Nova');
    expect(novaFinal.isControlled).toBe(false);
  });

  test('multi-entity observation workflow', async ({ page }) => {
    // Observe Atlas
    await api(page, 'observeEntity', 'Atlas');
    let observed = await api(page, 'getObservedEntity');
    expect(observed.name).toBe('Atlas');

    // Switch to Nova
    await api(page, 'observeEntity', 'Nova');
    observed = await api(page, 'getObservedEntity');
    expect(observed.name).toBe('Nova');

    // Switch to digital twin
    await api(page, 'observeEntity', 'Factory-Bot-1');
    observed = await api(page, 'getObservedEntity');
    expect(observed.name).toBe('Factory-Bot-1');
    expect(observed.type).toBe('twin');
  });

  test('build mode workflow', async ({ page }) => {
    // Switch to build mode
    await api(page, 'setMode', 'build');
    expect(await api(page, 'isBuilderPanelVisible')).toBe(true);

    // Place some objects
    const initialCount = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'cube', 0, 20);
    await api(page, 'placeObject', 'sphere', 3, 20);
    await api(page, 'placeObject', 'portal', 6, 20);

    const finalCount = await api(page, 'getWorldObjectsCount');
    expect(finalCount).toBe(initialCount + 3);

    // Switch back to explore
    await api(page, 'setMode', 'explore');
    expect(await api(page, 'isBuilderPanelVisible')).toBe(false);
  });

  test('AI command workflow', async ({ page }) => {
    // Command Atlas to do something
    await api(page, 'commandAI', 'Atlas', 'patrol the perimeter');

    // Verify Atlas got the task
    const atlas = await api(page, 'getEntity', 'Atlas');
    expect(atlas.currentTask).toBe('patrol the perimeter');
    expect(atlas.state).toBe('working');

    // Observe Atlas
    await api(page, 'observeEntity', 'Atlas');
    const observed = await api(page, 'getObservedEntity');
    expect(observed.currentTask).toBe('patrol the perimeter');
  });
});
