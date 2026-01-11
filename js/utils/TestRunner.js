    export async function runTests() {
        const results = { passed: 0, failed: 0, tests: [] };

        function test(name, fn) {
            try {
                fn();
                results.passed++;
                results.tests.push({ name, status: 'PASS' });
                console.log(`✓ ${name}`);
            } catch (e) {
                results.failed++;
                results.tests.push({ name, status: 'FAIL', error: e.message });
                console.error(`✗ ${name}: ${e.message}`);
            }
        }

        function expect(val) {
            return {
                toBe: (expected) => { if (val !== expected) throw new Error(`Expected ${expected}, got ${val}`); },
                toBeTruthy: () => { if (!val) throw new Error(`Expected truthy, got ${val}`); },
                toBeDefined: () => { if (val === undefined) throw new Error(`Expected defined, got undefined`); },
                toBeGreaterThan: (n) => { if (val <= n) throw new Error(`Expected > ${n}, got ${val}`); },
                toContain: (s) => { if (!val.includes(s)) throw new Error(`Expected to contain "${s}"`); }
            };
        }

        console.log('=== RUNNING NEXUS TESTS ===\n');

        // Initialization tests
        test('nexus is defined', () => expect(window.nexus).toBeDefined());
        test('nexusAPI is defined', () => expect(window.nexusAPI).toBeDefined());
        test('scene exists', () => expect(window.nexus.scene).toBeDefined());
        test('camera exists', () => expect(window.nexus.camera).toBeDefined());
        test('renderer exists', () => expect(window.nexus.renderer).toBeDefined());

        // Entity tests
        test('entities map exists', () => expect(window.nexus.entities).toBeDefined());
        test('has entities', () => expect(window.nexus.entities.size).toBeGreaterThan(0));
        test('has local player', () => expect(window.nexus.localEntity).toBeDefined());

        // API tests
        test('getEntities returns array', () => {
            const entities = window.nexusAPI.getEntities();
            expect(Array.isArray(entities)).toBe(true);
        });
        test('getState returns object', () => {
            const state = window.nexusAPI.getState();
            expect(state.mode).toBeDefined();
        });

        // Agent registration test
        test('can register agent', () => {
            const agent = window.nexusAPI.registerAgent({ name: 'TestBot', type: 'ai' });
            expect(agent.authToken).toBeDefined();
            window.nexusAPI.unregisterAgent(agent.authToken);
        });

        // Render test
        test('can render without error', () => {
            window.nexus.renderer.render(window.nexus.scene, window.nexus.camera);
            expect(true).toBe(true);
        });

        console.log(`\n=== RESULTS: ${results.passed} passed, ${results.failed} failed ===`);
        return results;
    };
