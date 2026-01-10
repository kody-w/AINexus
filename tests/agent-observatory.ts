/**
 * AGENT OBSERVATORY
 *
 * Launches multiple visible browser windows where AI agents control entities
 * in the Nexus Metaverse. Human observers can watch all agents in real-time
 * and take control of any agent's window when needed.
 *
 * Each window shows:
 * - The AI agent's real-time view of the metaverse
 * - Agent's decision-making process
 * - Current task/goal
 * - Reality Mirror showing the human's physical environment
 *
 * Usage:
 *   npx ts-node agent-observatory.ts --agents=4
 */

import { chromium, Browser, Page, BrowserContext } from '@playwright/test';

interface AgentWindow {
  id: string;
  name: string;
  personality: string;
  context: BrowserContext;
  page: Page;
  authToken?: string;
  agentId?: string;
}

const AGENT_PERSONALITIES = [
  { name: 'Explorer-1', personality: 'Curious explorer who loves discovering new areas' },
  { name: 'Builder-1', personality: 'Creative builder who enjoys constructing things' },
  { name: 'Social-1', personality: 'Friendly socializer who loves meeting other entities' },
  { name: 'Guardian-1', personality: 'Watchful guardian who monitors the environment' },
  { name: 'Analyst-1', personality: 'Analytical thinker who observes patterns' },
  { name: 'Helper-1', personality: 'Helpful assistant who assists other entities' },
  { name: 'Artist-1', personality: 'Creative artist who appreciates aesthetics' },
  { name: 'Strategist-1', personality: 'Strategic planner who thinks ahead' },
];

class AgentObservatory {
  private browser: Browser | null = null;
  private agents: AgentWindow[] = [];
  private serverProcess: any = null;
  private baseUrl = 'http://localhost:8000';

  async start(numAgents: number = 4) {
    console.log('\n=== AGENT OBSERVATORY ===\n');
    console.log(`Launching ${numAgents} AI agent windows...`);
    console.log('Each window represents an AI agent\'s view of the metaverse.');
    console.log('You can observe all agents and take control when needed.\n');

    // Launch browser in headed mode
    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    // Calculate window positions for tiled layout
    const screenWidth = 1920;
    const screenHeight = 1080;
    const cols = Math.ceil(Math.sqrt(numAgents));
    const rows = Math.ceil(numAgents / cols);
    const windowWidth = Math.floor(screenWidth / cols);
    const windowHeight = Math.floor(screenHeight / rows);

    // Create agent windows
    for (let i = 0; i < numAgents; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * windowWidth;
      const y = row * windowHeight;

      const config = AGENT_PERSONALITIES[i % AGENT_PERSONALITIES.length];
      const name = config.name.replace('-1', `-${Math.floor(i / AGENT_PERSONALITIES.length) + 1}`);

      const agent = await this.createAgentWindow({
        id: `agent-${i}`,
        name,
        personality: config.personality,
        x, y,
        width: windowWidth - 10,
        height: windowHeight - 40
      });

      this.agents.push(agent);
      console.log(`  [${i + 1}/${numAgents}] ${name} window created`);
    }

    console.log('\n--- All agent windows launched ---\n');
    console.log('Press Ctrl+C to stop the observatory.\n');

    // Start agent behaviors
    await this.runAgents();
  }

  private async createAgentWindow(config: {
    id: string;
    name: string;
    personality: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<AgentWindow> {
    const context = await this.browser!.newContext({
      viewport: { width: config.width, height: config.height }
    });

    const page = await context.newPage();

    // Set window position (Playwright handles this via viewport)
    await page.goto(`${this.baseUrl}/nexus-metaverse.html`);

    // Wait for metaverse to be ready
    await page.waitForFunction(
      () => window['nexusAPI']?.isReady() && !window['nexusAPI']?.isLoading(),
      { timeout: 30000 }
    );

    // Register this as an AI agent
    const registration = await page.evaluate(
      ({ name, personality }) => {
        return window['nexusAPI'].registerAgent({
          name,
          personality,
          autonomous: false, // We control it from here
          type: 'ai'
        });
      },
      { name: config.name, personality: config.personality }
    );

    // Add title overlay to identify the window
    await page.evaluate(
      ({ name, personality }) => {
        const overlay = document.createElement('div');
        overlay.id = 'agent-title-overlay';
        overlay.innerHTML = `
          <div style="
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.8);
            color: #00d4ff;
            padding: 10px 20px;
            border-radius: 8px;
            font-family: monospace;
            z-index: 9999;
            border: 1px solid #00d4ff;
            text-align: center;
          ">
            <div style="font-size: 1.2em; font-weight: bold;">${name}</div>
            <div style="font-size: 0.8em; opacity: 0.7;">${personality}</div>
          </div>
        `;
        document.body.appendChild(overlay);
      },
      { name: config.name, personality: config.personality }
    );

    return {
      id: config.id,
      name: config.name,
      personality: config.personality,
      context,
      page,
      authToken: registration.authToken,
      agentId: registration.agentId
    };
  }

  private async runAgents() {
    // Each agent runs its own behavior loop
    const loops = this.agents.map(agent => this.runAgentLoop(agent));

    // Keep running until interrupted
    await Promise.all(loops);
  }

  private async runAgentLoop(agent: AgentWindow) {
    const page = agent.page;
    let running = true;

    // Handle page close
    page.on('close', () => {
      running = false;
      console.log(`[${agent.name}] Window closed`);
    });

    while (running) {
      try {
        // Get agent's world view
        const worldView = await page.evaluate(
          (agentId) => window['nexusAPI'].getAgentWorldView(agentId),
          agent.agentId
        );

        if (!worldView) {
          await this.sleep(1000);
          continue;
        }

        // Make a decision based on personality and world state
        const decision = this.makeDecision(agent.personality, worldView);

        // Execute the decision
        await this.executeDecision(page, agent.authToken!, decision);

        // Log activity
        await this.updateAgentStatus(page, agent.name, decision);

        // Random delay between decisions
        await this.sleep(1500 + Math.random() * 2000);

      } catch (error) {
        // Window might be closed
        if (!running) break;
        await this.sleep(1000);
      }
    }
  }

  private makeDecision(personality: string, worldView: any): any {
    const self = worldView.self;
    const nearby = worldView.nearbyEntities || [];

    // Personality-based decision making
    if (personality.includes('explorer')) {
      // Explorers move around a lot
      const directions = ['forward', 'backward', 'left', 'right'];
      return {
        action: 'move',
        direction: directions[Math.floor(Math.random() * directions.length)],
        duration: 300 + Math.random() * 400
      };
    }

    if (personality.includes('social') && nearby.length > 0) {
      // Socializers chat with nearby entities
      const target = nearby[0];
      if (target.distance < 10) {
        const greetings = [
          `Hello ${target.name}!`,
          `Hey there, ${target.name}! How are you?`,
          `Nice to see you, ${target.name}!`
        ];
        return {
          action: 'chat',
          message: greetings[Math.floor(Math.random() * greetings.length)]
        };
      } else {
        // Move toward them
        return this.moveToward(self, target);
      }
    }

    if (personality.includes('builder')) {
      // Builders sometimes place objects
      if (Math.random() < 0.2) {
        const objects = ['cube', 'sphere', 'cylinder'];
        return {
          action: 'build',
          objectType: objects[Math.floor(Math.random() * objects.length)],
          x: self.position.x + (Math.random() - 0.5) * 5,
          z: self.position.z + (Math.random() - 0.5) * 5
        };
      }
    }

    if (personality.includes('guardian') || personality.includes('watchful')) {
      // Guardians observe more and move less
      if (Math.random() < 0.7) {
        return { action: 'observe' };
      }
    }

    // Default: random movement
    const directions = ['forward', 'backward', 'left', 'right'];
    return {
      action: 'move',
      direction: directions[Math.floor(Math.random() * directions.length)],
      duration: 200 + Math.random() * 300
    };
  }

  private moveToward(self: any, target: any): any {
    const dx = target.position.x - self.position.x;
    const dz = target.position.z - self.position.z;

    let direction;
    if (Math.abs(dx) > Math.abs(dz)) {
      direction = dx > 0 ? 'right' : 'left';
    } else {
      direction = dz > 0 ? 'backward' : 'forward';
    }

    return { action: 'move', direction, duration: 400 };
  }

  private async executeDecision(page: Page, authToken: string, decision: any) {
    switch (decision.action) {
      case 'move':
        await page.evaluate(
          ({ token, dir, dur }) => window['nexusAPI'].agentMove(token, dir, dur),
          { token: authToken, dir: decision.direction, dur: decision.duration }
        );
        break;

      case 'chat':
        await page.evaluate(
          ({ token, msg }) => window['nexusAPI'].agentChat(token, msg),
          { token: authToken, msg: decision.message }
        );
        break;

      case 'build':
        await page.evaluate(
          ({ token, type, x, z }) => window['nexusAPI'].agentBuild(token, type, x, z),
          { token: authToken, type: decision.objectType, x: decision.x, z: decision.z }
        );
        break;

      case 'observe':
        // Just watching, no action needed
        break;
    }
  }

  private async updateAgentStatus(page: Page, name: string, decision: any) {
    const statusText = decision.action === 'move' ? `Moving ${decision.direction}` :
                       decision.action === 'chat' ? 'Chatting...' :
                       decision.action === 'build' ? `Building ${decision.objectType}` :
                       'Observing...';

    await page.evaluate(
      (status) => {
        const overlay = document.getElementById('agent-title-overlay');
        if (overlay) {
          const statusEl = overlay.querySelector('.status') || document.createElement('div');
          statusEl.className = 'status';
          statusEl.style.cssText = 'font-size: 0.9em; color: #00ff88; margin-top: 5px;';
          statusEl.textContent = status;
          if (!overlay.querySelector('.status')) {
            overlay.querySelector('div')?.appendChild(statusEl);
          }
        }
      },
      statusText
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    console.log('\nStopping Agent Observatory...');

    for (const agent of this.agents) {
      try {
        await agent.context.close();
      } catch {}
    }

    if (this.browser) {
      await this.browser.close();
    }

    console.log('Observatory stopped.\n');
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  let numAgents = 4;

  // Parse arguments
  for (const arg of args) {
    if (arg.startsWith('--agents=')) {
      numAgents = parseInt(arg.split('=')[1], 10);
    }
  }

  const observatory = new AgentObservatory();

  // Handle shutdown
  process.on('SIGINT', async () => {
    await observatory.stop();
    process.exit(0);
  });

  try {
    await observatory.start(numAgents);
  } catch (error) {
    console.error('Error:', error);
    await observatory.stop();
    process.exit(1);
  }
}

main();
