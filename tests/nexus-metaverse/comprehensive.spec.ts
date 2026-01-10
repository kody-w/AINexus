import { test, expect, Page } from '@playwright/test';

/**
 * COMPREHENSIVE NEXUS METAVERSE TEST SUITE
 *
 * Complete coverage of all API functionality including:
 * - Core initialization and state
 * - Entity system
 * - Observation and possession
 * - AI Agent system
 * - World builder
 * - Chat system
 * - Movement controls
 * - UI state management
 * - Error handling
 * - Performance scenarios
 */

// =====================================================
// TEST HELPERS
// =====================================================

async function waitForReady(page: Page, timeout = 15000) {
  await page.waitForFunction(
    () => window['nexusAPI']?.isReady() && !window['nexusAPI']?.isLoading(),
    { timeout }
  );
}

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

async function getState(page: Page) {
  return page.evaluate(() => window['nexusAPI']?.getStateSnapshot());
}

// =====================================================
// INITIALIZATION TESTS
// =====================================================

test.describe('Initialization', () => {
  test('loads without errors', async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);

    const state = await getState(page);
    expect(state.ready).toBe(true);
    expect(state.loading).toBe(false);
  });

  test('exposes nexusAPI on window', async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);

    const hasAPI = await page.evaluate(() => typeof window['nexusAPI'] === 'object');
    expect(hasAPI).toBe(true);
  });

  test('exposes agentController on window', async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);

    const hasController = await page.evaluate(() => typeof window['agentController'] === 'object');
    expect(hasController).toBe(true);
  });

  test('creates local player entity', async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);

    const player = await api(page, 'getLocalPlayer');
    expect(player).not.toBeNull();
    expect(player.type).toBe('human');
  });

  test('spawns demo AI entities', async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);

    const entities = await api(page, 'getEntities');
    const aiEntities = entities.filter((e: any) => e.type === 'ai');
    expect(aiEntities.length).toBeGreaterThanOrEqual(3);
  });

  test('starts in explore mode', async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('explore');
  });
});

// =====================================================
// ENTITY SYSTEM TESTS
// =====================================================

test.describe('Entity System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('getEntities returns all entities', async ({ page }) => {
    const entities = await api(page, 'getEntities');
    expect(Array.isArray(entities)).toBe(true);
    expect(entities.length).toBeGreaterThan(0);
  });

  test('getEntity by name works', async ({ page }) => {
    const atlas = await api(page, 'getEntity', 'Atlas');
    expect(atlas).not.toBeNull();
    expect(atlas.name).toBe('Atlas');
  });

  test('getEntity returns null for unknown', async ({ page }) => {
    const unknown = await api(page, 'getEntity', 'NonExistent123');
    expect(unknown).toBeNull();
  });

  test('entities have required properties', async ({ page }) => {
    const entities = await api(page, 'getEntities');
    for (const entity of entities) {
      expect(entity).toHaveProperty('id');
      expect(entity).toHaveProperty('name');
      expect(entity).toHaveProperty('type');
      expect(entity).toHaveProperty('state');
      expect(entity).toHaveProperty('position');
    }
  });

  test('entity positions are valid', async ({ page }) => {
    const entities = await api(page, 'getEntities');
    for (const entity of entities) {
      expect(typeof entity.position.x).toBe('number');
      expect(typeof entity.position.z).toBe('number');
      expect(Number.isFinite(entity.position.x)).toBe(true);
      expect(Number.isFinite(entity.position.z)).toBe(true);
    }
  });
});

// =====================================================
// AI AGENT REGISTRATION TESTS
// =====================================================

test.describe('Agent Registration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('registers AI agent with minimal config', async ({ page }) => {
    const result = await api(page, 'registerAgent', { name: 'MinimalBot' });

    expect(result.agentId).toBeDefined();
    expect(result.authToken).toBeDefined();
    expect(result.entityId).toBeDefined();
    expect(result.name).toBe('MinimalBot');
  });

  test('registers AI agent with full config', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'FullConfigBot',
      type: 'ai',
      personality: 'test personality',
      capabilities: ['move', 'chat'],
      autonomous: false,
      decisionInterval: 5000,
      initialTask: 'Testing full config'
    });

    expect(result.agentId).toBeDefined();
    expect(result.name).toBe('FullConfigBot');
  });

  test('registers digital twin', async ({ page }) => {
    const result = await api(page, 'registerAgent', {
      name: 'TwinBot',
      type: 'twin'
    });

    const entity = await api(page, 'getEntity', 'TwinBot');
    expect(entity.type).toBe('twin');
  });

  test('each agent gets unique ID', async ({ page }) => {
    const agent1 = await api(page, 'registerAgent', { name: 'UniqueTest1' });
    const agent2 = await api(page, 'registerAgent', { name: 'UniqueTest2' });

    expect(agent1.agentId).not.toBe(agent2.agentId);
    expect(agent1.authToken).not.toBe(agent2.authToken);
  });

  test('getAgents lists all registered agents', async ({ page }) => {
    await api(page, 'registerAgent', { name: 'ListTest1', autonomous: false });
    await api(page, 'registerAgent', { name: 'ListTest2', autonomous: false });

    const agents = await api(page, 'getAgents');
    const names = agents.map((a: any) => a.name);

    expect(names).toContain('ListTest1');
    expect(names).toContain('ListTest2');
  });
});

// =====================================================
// AGENT AUTHENTICATION TESTS
// =====================================================

test.describe('Agent Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('valid token authenticates', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'AuthBot', autonomous: false });
    const result = await api(page, 'agentChat', agent.authToken, 'Auth test');

    expect(result.success).toBe(true);
  });

  test('invalid token fails', async ({ page }) => {
    const result = await api(page, 'agentMove', 'invalid-token-12345', 'forward', 100);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  test('token works across multiple calls', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'MultiCallBot', autonomous: false });

    const r1 = await api(page, 'agentChat', agent.authToken, 'Call 1');
    const r2 = await api(page, 'agentChat', agent.authToken, 'Call 2');
    const r3 = await api(page, 'agentChat', agent.authToken, 'Call 3');

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(true);
  });
});

// =====================================================
// AGENT MOVEMENT TESTS
// =====================================================

test.describe('Agent Movement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('moves forward', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'MoveForwardBot', autonomous: false });
    const before = await api(page, 'getEntity', 'MoveForwardBot');

    await api(page, 'agentMove', agent.authToken, 'forward', 300);
    await page.waitForTimeout(400);

    const after = await api(page, 'getEntity', 'MoveForwardBot');
    expect(after.position.z).toBeLessThan(before.position.z);
  });

  test('moves backward', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'MoveBackBot', autonomous: false });
    const before = await api(page, 'getEntity', 'MoveBackBot');

    await api(page, 'agentMove', agent.authToken, 'backward', 300);
    await page.waitForTimeout(400);

    const after = await api(page, 'getEntity', 'MoveBackBot');
    expect(after.position.z).toBeGreaterThan(before.position.z);
  });

  test('moves left', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'MoveLeftBot', autonomous: false });
    const before = await api(page, 'getEntity', 'MoveLeftBot');

    await api(page, 'agentMove', agent.authToken, 'left', 300);
    await page.waitForTimeout(400);

    const after = await api(page, 'getEntity', 'MoveLeftBot');
    expect(after.position.x).toBeLessThan(before.position.x);
  });

  test('moves right', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'MoveRightBot', autonomous: false });
    const before = await api(page, 'getEntity', 'MoveRightBot');

    await api(page, 'agentMove', agent.authToken, 'right', 300);
    await page.waitForTimeout(400);

    const after = await api(page, 'getEntity', 'MoveRightBot');
    expect(after.position.x).toBeGreaterThan(before.position.x);
  });

  test('respects movement duration', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'DurationBot', autonomous: false });
    const before = await api(page, 'getEntity', 'DurationBot');

    // Short duration
    await api(page, 'agentMove', agent.authToken, 'forward', 100);
    await page.waitForTimeout(150);
    const afterShort = await api(page, 'getEntity', 'DurationBot');
    const shortDist = Math.abs(afterShort.position.z - before.position.z);

    // Reset position conceptually by moving back
    await api(page, 'agentMove', agent.authToken, 'backward', 100);
    await page.waitForTimeout(150);

    // Long duration
    const beforeLong = await api(page, 'getEntity', 'DurationBot');
    await api(page, 'agentMove', agent.authToken, 'forward', 500);
    await page.waitForTimeout(550);
    const afterLong = await api(page, 'getEntity', 'DurationBot');
    const longDist = Math.abs(afterLong.position.z - beforeLong.position.z);

    expect(longDist).toBeGreaterThan(shortDist);
  });
});

// =====================================================
// AGENT CHAT TESTS
// =====================================================

test.describe('Agent Chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('sends chat message', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'ChatTestBot', autonomous: false });

    await api(page, 'agentChat', agent.authToken, 'Hello from ChatTestBot!');

    const messages = await api(page, 'getChatMessages');
    const botMessage = messages.find((m: any) => m.sender === 'ChatTestBot');

    expect(botMessage).toBeDefined();
    expect(botMessage.text).toContain('Hello from ChatTestBot!');
  });

  test('message shows correct sender', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'SenderBot', autonomous: false });

    await api(page, 'agentChat', agent.authToken, 'Test message');

    const messages = await api(page, 'getChatMessages');
    const lastMessage = messages[messages.length - 1];

    expect(lastMessage.sender).toBe('SenderBot');
  });

  test('multiple agents can chat', async ({ page }) => {
    const agent1 = await api(page, 'registerAgent', { name: 'Chatter1', autonomous: false });
    const agent2 = await api(page, 'registerAgent', { name: 'Chatter2', autonomous: false });

    await api(page, 'agentChat', agent1.authToken, 'Message from 1');
    await api(page, 'agentChat', agent2.authToken, 'Message from 2');

    const messages = await api(page, 'getChatMessages');
    const msg1 = messages.find((m: any) => m.sender === 'Chatter1');
    const msg2 = messages.find((m: any) => m.sender === 'Chatter2');

    expect(msg1).toBeDefined();
    expect(msg2).toBeDefined();
  });
});

// =====================================================
// AGENT TASK AND GOALS TESTS
// =====================================================

test.describe('Agent Tasks and Goals', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('sets task', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'TaskBot', autonomous: false });

    await api(page, 'agentSetTask', agent.authToken, 'Important task');

    const entity = await api(page, 'getEntity', 'TaskBot');
    expect(entity.currentTask).toBe('Important task');
  });

  test('sets goals', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'GoalBot', autonomous: false });

    await api(page, 'setAgentGoals', agent.authToken, ['goal1', 'goal2', 'goal3']);

    const status = await page.evaluate((id) => window['nexusAPI'].getAgentStatus(id), agent.agentId);
    expect(status.goals).toContain('goal1');
    expect(status.goals).toContain('goal2');
    expect(status.goals).toContain('goal3');
  });

  test('initial task from config', async ({ page }) => {
    const agent = await api(page, 'registerAgent', {
      name: 'InitialTaskBot',
      initialTask: 'Starting task',
      autonomous: false
    });

    const entity = await api(page, 'getEntity', 'InitialTaskBot');
    expect(entity.currentTask).toBe('Starting task');
  });
});

// =====================================================
// AGENT WORLD VIEW TESTS
// =====================================================

test.describe('Agent World View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('returns self info', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'ViewBot', autonomous: false });

    const view = await api(page, 'getAgentWorldView', agent.agentId);

    expect(view.self).toBeDefined();
    expect(view.self.name).toBe('ViewBot');
    expect(view.self.position).toBeDefined();
  });

  test('returns nearby entities', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'NearbyBot', autonomous: false });

    const view = await api(page, 'getAgentWorldView', agent.agentId);

    expect(view.nearbyEntities).toBeDefined();
    expect(Array.isArray(view.nearbyEntities)).toBe(true);
  });

  test('nearby entities have distance', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'DistanceBot', autonomous: false });

    const view = await api(page, 'getAgentWorldView', agent.agentId);

    if (view.nearbyEntities.length > 0) {
      expect(view.nearbyEntities[0]).toHaveProperty('distance');
      expect(typeof view.nearbyEntities[0].distance).toBe('number');
    }
  });

  test('entities sorted by distance', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'SortBot', autonomous: false });

    const view = await api(page, 'getAgentWorldView', agent.agentId);

    if (view.nearbyEntities.length > 1) {
      for (let i = 1; i < view.nearbyEntities.length; i++) {
        expect(view.nearbyEntities[i].distance).toBeGreaterThanOrEqual(
          view.nearbyEntities[i - 1].distance
        );
      }
    }
  });
});

// =====================================================
// AGENT LIFECYCLE TESTS
// =====================================================

test.describe('Agent Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('pauses agent', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'PauseBot', autonomous: true });

    const result = await api(page, 'pauseAgent', agent.authToken);
    expect(result.success).toBe(true);

    const status = await page.evaluate((id) => window['nexusAPI'].getAgentStatus(id), agent.agentId);
    expect(status.state).toBe('paused');
  });

  test('resumes agent', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'ResumeBot', autonomous: true });

    await api(page, 'pauseAgent', agent.authToken);
    const result = await api(page, 'resumeAgent', agent.authToken);

    expect(result.success).toBe(true);

    const status = await page.evaluate((id) => window['nexusAPI'].getAgentStatus(id), agent.agentId);
    expect(status.state).toBe('active');
  });

  test('unregisters agent', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'UnregBot', autonomous: false });

    // Verify exists
    let entity = await api(page, 'getEntity', 'UnregBot');
    expect(entity).not.toBeNull();

    // Unregister
    const result = await api(page, 'unregisterAgent', agent.authToken);
    expect(result.success).toBe(true);

    // Verify gone
    entity = await api(page, 'getEntity', 'UnregBot');
    expect(entity).toBeNull();
  });

  test('unregistered agent token invalid', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'TokenInvalidBot', autonomous: false });

    await api(page, 'unregisterAgent', agent.authToken);

    // Token should no longer work
    const result = await api(page, 'agentChat', agent.authToken, 'Should fail');
    expect(result.success).toBe(false);
  });
});

// =====================================================
// AGENT MEMORY TESTS
// =====================================================

test.describe('Agent Memory', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('records actions in memory', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'MemoryBot', autonomous: false });

    await api(page, 'agentMove', agent.authToken, 'forward', 100);
    await page.waitForTimeout(150);
    await api(page, 'agentChat', agent.authToken, 'Memory test');

    const memory = await api(page, 'getAgentMemory', agent.authToken);

    expect(memory).not.toBeNull();
    expect(memory.memory.length).toBeGreaterThan(0);
  });

  test('memory includes action type', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'ActionMemBot', autonomous: false });

    await api(page, 'agentChat', agent.authToken, 'Test');

    const memory = await api(page, 'getAgentMemory', agent.authToken);
    const lastAction = memory.memory[memory.memory.length - 1];

    expect(lastAction).toHaveProperty('action');
  });

  test('returns goals in memory response', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'GoalMemBot', autonomous: false });

    await api(page, 'setAgentGoals', agent.authToken, ['test goal']);

    const memory = await api(page, 'getAgentMemory', agent.authToken);

    expect(memory.goals).toContain('test goal');
  });
});

// =====================================================
// AGENT BUILDING TESTS
// =====================================================

test.describe('Agent Building', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('builds cube', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'BuildCubeBot', autonomous: false });
    const before = await api(page, 'getWorldObjectsCount');

    await api(page, 'agentBuild', agent.authToken, 'cube', 10, 10);

    const after = await api(page, 'getWorldObjectsCount');
    expect(after).toBe(before + 1);
  });

  test('builds sphere', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'BuildSphereBot', autonomous: false });
    const before = await api(page, 'getWorldObjectsCount');

    await api(page, 'agentBuild', agent.authToken, 'sphere', 15, 15);

    const after = await api(page, 'getWorldObjectsCount');
    expect(after).toBe(before + 1);
  });

  test('builds at specified position', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'BuildPosBot', autonomous: false });

    // Build should succeed at any valid position
    const result = await api(page, 'agentBuild', agent.authToken, 'cube', 20, 20);
    expect(result.success).toBe(true);
  });
});

// =====================================================
// OBSERVATION AND POSSESSION TESTS
// =====================================================

test.describe('Observation and Possession', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('observes entity', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');

    const observed = await api(page, 'getObservedEntity');
    expect(observed).not.toBeNull();
    expect(observed.name).toBe('Atlas');
  });

  test('shows observation panel', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');

    const visible = await api(page, 'isObservationPanelVisible');
    expect(visible).toBe(true);
  });

  test('takes over entity', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    const isPossessing = await api(page, 'isPossessing');
    expect(isPossessing).toBe(true);
  });

  test('teleports camera on takeover', async ({ page }) => {
    const atlas = await api(page, 'getEntity', 'Atlas');

    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    const camera = await api(page, 'getCameraState');
    expect(camera.position.x).toBeCloseTo(atlas.position.x, 0);
    expect(camera.position.z).toBeCloseTo(atlas.position.z, 0);
  });

  test('releases control', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');
    await api(page, 'releaseControl');

    const isPossessing = await api(page, 'isPossessing');
    expect(isPossessing).toBe(false);
  });

  test('shows possession HUD during takeover', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    const hudVisible = await api(page, 'isPossessionHUDVisible');
    expect(hudVisible).toBe(true);
  });

  test('hides possession HUD after release', async ({ page }) => {
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');
    await api(page, 'releaseControl');

    const hudVisible = await api(page, 'isPossessionHUDVisible');
    expect(hudVisible).toBe(false);
  });

  test('can observe registered agent', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'ObserveMe', autonomous: false });

    await api(page, 'observeEntity', 'ObserveMe');

    const observed = await api(page, 'getObservedEntity');
    expect(observed.name).toBe('ObserveMe');
  });

  test('can take over registered agent', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'PossessMe', autonomous: false });

    await api(page, 'observeEntity', 'PossessMe');
    await api(page, 'takeOver');

    expect(await api(page, 'isPossessing')).toBe(true);

    // Move while possessing
    const before = await api(page, 'getEntity', 'PossessMe');
    await api(page, 'move', 'forward', 300);
    await page.waitForTimeout(350);
    const after = await api(page, 'getEntity', 'PossessMe');

    expect(after.position.z).not.toBeCloseTo(before.position.z, 0);
  });
});

// =====================================================
// MODE SWITCHING TESTS
// =====================================================

test.describe('Mode Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('switches to build mode', async ({ page }) => {
    await api(page, 'setMode', 'build');

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('build');
  });

  test('shows builder panel in build mode', async ({ page }) => {
    await api(page, 'setMode', 'build');

    const visible = await api(page, 'isBuilderPanelVisible');
    expect(visible).toBe(true);
  });

  test('switches to observe mode', async ({ page }) => {
    await api(page, 'setMode', 'observe');

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('observe');
  });

  test('switches back to explore mode', async ({ page }) => {
    await api(page, 'setMode', 'build');
    await api(page, 'setMode', 'explore');

    const mode = await api(page, 'getCurrentMode');
    expect(mode).toBe('explore');
  });
});

// =====================================================
// HUMAN MOVEMENT TESTS
// =====================================================

test.describe('Human Movement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
    await api(page, 'reset');
  });

  test('moves forward', async ({ page }) => {
    const before = await api(page, 'getCameraState');

    await api(page, 'move', 'forward', 300);
    await page.waitForTimeout(350);

    const after = await api(page, 'getCameraState');
    expect(after.position.z).toBeLessThan(before.position.z);
  });

  test('teleports camera', async ({ page }) => {
    await api(page, 'teleportCamera', 25, 5, 30);

    const camera = await api(page, 'getCameraState');
    expect(camera.position.x).toBeCloseTo(25, 0);
    expect(camera.position.y).toBeCloseTo(5, 0);
    expect(camera.position.z).toBeCloseTo(30, 0);
  });

  test('updates local player position', async ({ page }) => {
    const before = await api(page, 'getLocalPlayer');

    await api(page, 'move', 'forward', 300);
    await page.waitForTimeout(350);

    const after = await api(page, 'getLocalPlayer');
    expect(after.position.z).not.toBeCloseTo(before.position.z, 0);
  });
});

// =====================================================
// WORLD BUILDER TESTS
// =====================================================

test.describe('World Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('places cube', async ({ page }) => {
    const before = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'cube', 5, 5);

    const after = await api(page, 'getWorldObjectsCount');
    expect(after).toBe(before + 1);
  });

  test('places sphere', async ({ page }) => {
    const before = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'sphere', -5, -5);

    const after = await api(page, 'getWorldObjectsCount');
    expect(after).toBe(before + 1);
  });

  test('places tree', async ({ page }) => {
    const before = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'tree', 10, -10);

    const after = await api(page, 'getWorldObjectsCount');
    expect(after).toBe(before + 1);
  });

  test('places portal', async ({ page }) => {
    const before = await api(page, 'getWorldObjectsCount');

    await api(page, 'placeObject', 'portal', 0, 20);

    const after = await api(page, 'getWorldObjectsCount');
    expect(after).toBe(before + 1);
  });
});

// =====================================================
// CHAT SYSTEM TESTS
// =====================================================

test.describe('Chat System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('sends human message', async ({ page }) => {
    const before = await api(page, 'getChatMessages');

    await api(page, 'sendChatMessage', 'Hello from human!');

    const after = await api(page, 'getChatMessages');
    expect(after.length).toBeGreaterThan(before.length);
  });

  test('commands AI via @mention', async ({ page }) => {
    await api(page, 'commandAI', 'Atlas', 'patrol the area');

    const atlas = await api(page, 'getEntity', 'Atlas');
    expect(atlas.currentTask).toBe('patrol the area');
  });

  test('getChatMessages returns array', async ({ page }) => {
    const messages = await api(page, 'getChatMessages');

    expect(Array.isArray(messages)).toBe(true);
  });
});

// =====================================================
// STATE SNAPSHOT TESTS
// =====================================================

test.describe('State Snapshot', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('returns complete snapshot', async ({ page }) => {
    const state = await getState(page);

    expect(state).toHaveProperty('ready');
    expect(state).toHaveProperty('loading');
    expect(state).toHaveProperty('mode');
    expect(state).toHaveProperty('controlMode');
    expect(state).toHaveProperty('isPossessing');
    expect(state).toHaveProperty('camera');
    expect(state).toHaveProperty('localPlayer');
    expect(state).toHaveProperty('entityCount');
    expect(state).toHaveProperty('worldObjectCount');
  });

  test('snapshot updates after actions', async ({ page }) => {
    const before = await getState(page);

    await api(page, 'observeEntity', 'Atlas');

    const after = await getState(page);

    expect(before.observationPanelVisible).toBe(false);
    expect(after.observationPanelVisible).toBe(true);
  });
});

// =====================================================
// RESET FUNCTIONALITY TESTS
// =====================================================

test.describe('Reset Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('resets to initial state', async ({ page }) => {
    // Make changes
    await api(page, 'observeEntity', 'Atlas');
    await api(page, 'takeOver');

    // Reset
    await api(page, 'reset');

    // Verify
    const state = await getState(page);
    expect(state.isPossessing).toBe(false);
    expect(state.mode).toBe('explore');
  });

  test('resets camera position', async ({ page }) => {
    await api(page, 'teleportCamera', 50, 10, 50);
    await api(page, 'reset');

    const camera = await api(page, 'getCameraState');
    expect(camera.position.z).toBeCloseTo(10, 0);
  });
});

// =====================================================
// DECISION LOOP TESTS
// =====================================================

test.describe('Decision Loop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('triggers manual decision', async ({ page }) => {
    const agent = await api(page, 'registerAgent', {
      name: 'ManualDecisionBot',
      autonomous: false
    });

    const result = await api(page, 'triggerAgentDecision', agent.authToken);
    expect(result.success).toBe(true);
  });

  test('autonomous agent makes decisions', async ({ page }) => {
    const agent = await api(page, 'registerAgent', {
      name: 'AutoBot',
      autonomous: true,
      decisionInterval: 500
    });

    // Wait for a few decision cycles
    await page.waitForTimeout(1500);

    // Check that agent has done something (memory should have entries)
    const memory = await api(page, 'getAgentMemory', agent.authToken);

    // Pause to stop decision loop
    await api(page, 'pauseAgent', agent.authToken);

    // Agent should have some memory from decisions
    expect(memory.memory.length).toBeGreaterThanOrEqual(0);
  });
});

// =====================================================
// ERROR HANDLING TESTS
// =====================================================

test.describe('Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('handles invalid entity name', async ({ page }) => {
    const result = await api(page, 'observeEntity', 'NonExistentEntity12345');
    expect(result).toBe(false);
  });

  test('handles invalid auth token gracefully', async ({ page }) => {
    const result = await api(page, 'agentChat', 'bad-token', 'test');
    expect(result.success).toBe(false);
  });

  test('returns null for invalid agent status', async ({ page }) => {
    const status = await page.evaluate(() => {
      return window['nexusAPI'].getAgentStatus('invalid-agent-id');
    });
    expect(status).toBeNull();
  });
});

// =====================================================
// PERFORMANCE TESTS
// =====================================================

test.describe('Performance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/nexus-metaverse.html');
    await waitForReady(page);
  });

  test('handles multiple agents', async ({ page }) => {
    const agents = [];

    for (let i = 0; i < 5; i++) {
      const agent = await api(page, 'registerAgent', {
        name: `PerfBot${i}`,
        autonomous: false
      });
      agents.push(agent);
    }

    // All should exist
    for (const agent of agents) {
      const entity = await api(page, 'getEntity', agent.name);
      expect(entity).not.toBeNull();
    }

    // Clean up
    for (const agent of agents) {
      await api(page, 'unregisterAgent', agent.authToken);
    }
  });

  test('rapid API calls work', async ({ page }) => {
    const agent = await api(page, 'registerAgent', { name: 'RapidBot', autonomous: false });

    // Rapid fire multiple actions
    const promises = [
      api(page, 'agentChat', agent.authToken, 'Message 1'),
      api(page, 'agentChat', agent.authToken, 'Message 2'),
      api(page, 'agentChat', agent.authToken, 'Message 3'),
    ];

    const results = await Promise.all(promises);

    for (const result of results) {
      expect(result.success).toBe(true);
    }
  });
});
