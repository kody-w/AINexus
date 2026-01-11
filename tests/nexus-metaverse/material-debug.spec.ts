import { test, expect, Page } from '@playwright/test';

/**
 * Material Debug Tests
 *
 * These tests are specifically designed to identify and fix the Three.js
 * "Cannot read properties of undefined (reading 'value')" errors that occur
 * in refreshMaterialUniforms.
 *
 * RUN WITH: npx playwright test material-debug --project=chromium --reporter=list
 */

async function waitForReady(page: Page) {
    await page.waitForFunction(() => window['nexus'] !== undefined, { timeout: 10000 });
    await page.waitForTimeout(500);
}

test.describe('Material Debug - Finding Uniform Errors', () => {

    test('identify all materials in scene', async ({ page }) => {
        await page.goto('/nexus-metaverse.html');
        await waitForReady(page);

        const materials = await page.evaluate(() => {
            const nexus = window['nexus'];
            const mats: any[] = [];

            nexus.scene.traverse((obj: any) => {
                if (obj.material) {
                    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                    materials.forEach((mat: any) => {
                        mats.push({
                            objectName: obj.name || 'unnamed',
                            objectType: obj.type,
                            materialType: mat.type,
                            materialId: mat.id,
                            fog: mat.fog,
                            hasUniforms: !!mat.uniforms,
                            uniformCount: mat.uniforms ? Object.keys(mat.uniforms).length : 0,
                            visible: obj.visible
                        });
                    });
                }
            });

            return mats;
        });

        console.log('\n=== ALL MATERIALS IN SCENE ===');
        console.table(materials);
        console.log(`Total: ${materials.length} materials\n`);

        expect(materials.length).toBeGreaterThan(0);
    });

    test('identify materials with fog enabled', async ({ page }) => {
        await page.goto('/nexus-metaverse.html');
        await waitForReady(page);

        const fogMaterials = await page.evaluate(() => {
            const nexus = window['nexus'];
            const mats: any[] = [];

            nexus.scene.traverse((obj: any) => {
                if (obj.material) {
                    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                    materials.forEach((mat: any) => {
                        if (mat.fog !== false) {
                            mats.push({
                                objectName: obj.name || 'unnamed',
                                objectType: obj.type,
                                materialType: mat.type,
                                fog: mat.fog
                            });
                        }
                    });
                }
            });

            return mats;
        });

        console.log('\n=== MATERIALS WITH FOG ENABLED (potential issues) ===');
        if (fogMaterials.length > 0) {
            console.table(fogMaterials);
        } else {
            console.log('None found - all materials have fog: false');
        }

        // This is informational - we want to see which materials might cause issues
    });

    test('identify ShaderMaterials and their uniforms', async ({ page }) => {
        await page.goto('/nexus-metaverse.html');
        await waitForReady(page);

        const shaderMats = await page.evaluate(() => {
            const nexus = window['nexus'];
            const mats: any[] = [];

            nexus.scene.traverse((obj: any) => {
                if (obj.material && obj.material.type === 'ShaderMaterial') {
                    const mat = obj.material;
                    const uniformInfo: any = {};

                    if (mat.uniforms) {
                        Object.entries(mat.uniforms).forEach(([key, val]: [string, any]) => {
                            uniformInfo[key] = {
                                hasValue: val?.value !== undefined,
                                valueType: val?.value !== undefined ? typeof val.value : 'undefined'
                            };
                        });
                    }

                    mats.push({
                        objectName: obj.name || 'unnamed',
                        fog: mat.fog,
                        uniforms: uniformInfo
                    });
                }
            });

            return mats;
        });

        console.log('\n=== SHADER MATERIALS ===');
        shaderMats.forEach((m, i) => {
            console.log(`\n${i + 1}. ${m.objectName} (fog: ${m.fog})`);
            console.log('   Uniforms:', JSON.stringify(m.uniforms, null, 2));
        });

        // Check for undefined uniforms
        const hasUndefined = shaderMats.some(m =>
            Object.values(m.uniforms).some((u: any) => !u.hasValue)
        );

        if (hasUndefined) {
            console.error('\n!!! FOUND SHADER MATERIALS WITH UNDEFINED UNIFORM VALUES !!!');
        }
    });

    test('test render with each object type hidden', async ({ page }) => {
        const errors: string[] = [];

        page.on('pageerror', err => {
            if (err.message.includes("reading 'value'")) {
                errors.push(err.message);
            }
        });

        await page.goto('/nexus-metaverse.html');
        await waitForReady(page);

        // Get all unique object types
        const objectTypes = await page.evaluate(() => {
            const nexus = window['nexus'];
            const types = new Set<string>();

            nexus.scene.traverse((obj: any) => {
                if (obj.isMesh || obj.isLine || obj.isPoints) {
                    types.add(obj.name || obj.type);
                }
            });

            return Array.from(types);
        });

        console.log('\n=== TESTING EACH OBJECT TYPE ===');
        console.log('Object types found:', objectTypes);

        // Test hiding each type and see if errors stop
        for (const objType of objectTypes.slice(0, 10)) { // Test first 10
            errors.length = 0;

            await page.evaluate((type) => {
                const nexus = window['nexus'];
                nexus.scene.traverse((obj: any) => {
                    if ((obj.name || obj.type) === type) {
                        obj.visible = false;
                    }
                });
            }, objType);

            await page.waitForTimeout(200);

            // Restore
            await page.evaluate((type) => {
                const nexus = window['nexus'];
                nexus.scene.traverse((obj: any) => {
                    if ((obj.name || obj.type) === type) {
                        obj.visible = true;
                    }
                });
            }, objType);

            if (errors.length > 0) {
                console.log(`  ${objType}: ${errors.length} errors when visible`);
            }
        }
    });

    test('count errors per frame and identify pattern', async ({ page }) => {
        let errorCount = 0;
        let frameCount = 0;

        page.on('pageerror', err => {
            if (err.message.includes("reading 'value'")) {
                errorCount++;
            }
        });

        await page.goto('/nexus-metaverse.html');
        await waitForReady(page);

        // Get initial frame count
        const initialFrames = await page.evaluate(() => {
            return window['nexus']?.renderer?.info?.render?.frame || 0;
        });

        await page.waitForTimeout(3000);

        const finalFrames = await page.evaluate(() => {
            return window['nexus']?.renderer?.info?.render?.frame || 0;
        });

        frameCount = finalFrames - initialFrames;

        console.log('\n=== ERROR PATTERN ANALYSIS ===');
        console.log(`Frames rendered: ${frameCount}`);
        console.log(`Total errors: ${errorCount}`);
        console.log(`Errors per frame: ${(errorCount / frameCount).toFixed(2)}`);

        if (errorCount > 0 && frameCount > 0) {
            const errorsPerFrame = errorCount / frameCount;
            if (errorsPerFrame >= 1) {
                console.log('\n!!! At least 1 error per frame - likely a material on a visible object !!!');
            } else if (errorsPerFrame > 0) {
                console.log('\n!!! Intermittent errors - may be triggered by animation or state change !!!');
            }
        }
    });

    test('fix: force fog false on all materials and verify', async ({ page }) => {
        const errors: string[] = [];

        page.on('pageerror', err => {
            if (err.message.includes("reading 'value'")) {
                errors.push(err.message);
            }
        });

        await page.goto('/nexus-metaverse.html');
        await waitForReady(page);

        // Force fog: false on ALL materials
        const fixedCount = await page.evaluate(() => {
            const nexus = window['nexus'];
            let count = 0;

            nexus.scene.traverse((obj: any) => {
                if (obj.material) {
                    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                    materials.forEach((mat: any) => {
                        if (mat.fog !== false) {
                            mat.fog = false;
                            mat.needsUpdate = true;
                            count++;
                        }
                    });
                }
            });

            return count;
        });

        console.log(`\nFixed fog on ${fixedCount} materials`);

        // Clear errors and wait for new frames
        errors.length = 0;
        await page.waitForTimeout(2000);

        console.log(`Errors after fix: ${errors.length}`);

        // The errors might still happen if the issue isn't fog-related
        if (errors.length > 0) {
            console.log('\n!!! Errors persist after fog fix - issue is NOT fog-related !!!');
            console.log('The issue may be in the Three.js version or a specific material property');
        }
    });
});
