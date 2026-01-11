/* js/main.js */
import NexusMetaverse from './core/NexusMetaverse.js';
import AgentController from './core/AgentController.js';
import NexusAPI from './api/NexusAPI.js';
import AutomationDriver from './utils/AutomationDriver.js';
import { runTests } from './utils/TestRunner.js';

// Global variables (to match legacy behavior)
let nexus = null;
let nexusAPI = null;
let agentController = null;

async function init() {
    // Check if Three.js loaded
    if (typeof THREE === 'undefined') {
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.innerHTML = `
                <div style="color: #ff6b6b; text-align: center;">
                    <div style="font-size: 2em; margin-bottom: 20px;">Error</div>
                    <div>Three.js failed to load. Check your internet connection or try disabling tracking prevention.</div>
                </div>
            `;
        }
        return;
    }

    console.log('Initializing Nexus Metaverse...');

    // Initialize Core
    try {
        nexus = new NexusMetaverse();
        nexus.init();

        // Initialize Agents
        agentController = new AgentController(nexus);

        // Initialize API
        nexusAPI = new NexusAPI(nexus, agentController);

        // Initialize Automation
        const automationDriver = new AutomationDriver(nexus);

        // Expose to window for debugging and external scripts
        window.nexus = nexus;
        window.agentController = agentController;
        window.nexusAPI = nexusAPI;
        window.automationDriver = automationDriver;

        // Legacy/Bookmarklet support
        window.injectAutomation = function () {
            if (window.automationDriver) {
                window.automationDriver.injectPanel();
                console.log('[Automation] Panel injected.');
            } else {
                console.error('[Automation] Nexus not initialized');
            }
        };

        window.runTests = runTests;

        window.injectTests = function () {
            window.runTests().then(results => {
                alert(`Tests: ${results.passed} passed, ${results.failed} failed`);
            });
        };

        console.log('Nexus Metaverse initialized.');
        console.log('API available at window.nexusAPI');
        console.log('Agent Controller available at window.agentController');

    } catch (e) {
        console.error('Failed to initialize Nexus Metaverse:', e);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) {
            loadingEl.innerHTML = `
                <div style="color: #ff6b6b; text-align: center;">
                    <div style="font-size: 1.5em; margin-bottom: 20px;">Initialization Error</div>
                    <div>${e.message}</div>
                    <div style="font-size: 0.8em; margin-top: 10px; opacity: 0.7;">Check console for details</div>
                </div>
            `;
        }
    }
}

// Start
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
