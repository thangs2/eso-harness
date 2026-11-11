import '@angular/compiler';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ControlPlaneApiClient } from '../libs/api-client/client.js';
import { OnboardingService } from '../apps/control-plane/src/app/features/onboarding/data/onboarding.service.js';
import { OnboardingPage } from '../apps/control-plane/src/app/features/onboarding/pages/onboarding.page.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('L5.3 / US-39 / AC-39 — Onboarding UI: Select Consumer & Provisioning Preview', () => {

    test('AC-39-1: Happy path — select ready consumer derives preview without host/tier fields', async () => {
        const mockApiClient = {
            listConsumers: async () => ({
                items: [
                    {
                        id: 'consumer-alpha',
                        name: 'Alpha Consumer',
                        root: '/repos/consumer-alpha',
                        status: 'ready',
                        sdlcRoot: 'sdlc',
                        version: 1,
                        updatedAt: new Date().toISOString(),
                    },
                    {
                        id: 'consumer-draft',
                        name: 'Draft Consumer',
                        root: '/repos/consumer-draft',
                        status: 'draft',
                        sdlcRoot: 'sdlc',
                        version: 1,
                        updatedAt: new Date().toISOString(),
                    },
                ],
            }),
            provisionConsumer: async () => {
                throw new Error('Not invoked during preview');
            },
            getConsumerSetup: async () => {
                throw new Error('Not invoked during preview');
            },
        };

        const service = new OnboardingService(mockApiClient);

        // 1. Only ready consumers are loaded
        const readyConsumers = await service.loadReadyConsumers();
        assert.equal(readyConsumers.length, 1);
        assert.equal(readyConsumers[0].id, 'consumer-alpha');

        // 2. Derive provisioning preview
        const preview = service.derivePreview(readyConsumers[0]);
        assert.equal(preview.consumerId, 'consumer-alpha');
        assert.equal(preview.name, 'Alpha Consumer');
        assert.equal(preview.root, '/repos/consumer-alpha');
        assert.equal(preview.schemaName, 'c_consumer-alpha');
        assert.deepEqual(preview.materialBundle, [
            'AGENTS.md',
            'agents/',
            '.harness/config.json',
            '.harness/manifest.json',
        ]);

        // 3. Invariant check: MUST NOT contain host, source, tier, recipe
        assert.equal(preview.host, undefined);
        assert.equal(preview.source, undefined);
        assert.equal(preview.tier, undefined);
        assert.equal(preview.recipe, undefined);
    });

    test('AC-39-2: Edge path — empty ready consumer list displays blocked / CTA state', async () => {
        const mockApiClient = {
            listConsumers: async () => ({
                items: [
                    {
                        id: 'unready-1',
                        name: 'Unready 1',
                        root: '/repos/unready-1',
                        status: 'registered',
                        sdlcRoot: 'sdlc',
                        version: 1,
                        updatedAt: new Date().toISOString(),
                    },
                ],
            }),
        };

        const service = new OnboardingService(mockApiClient);

        const readyConsumers = await service.loadReadyConsumers();
        assert.equal(readyConsumers.length, 0, 'No ready consumers should be returned');

        // Page state simulation
        const page = new OnboardingPage(service);

        await page.loadConsumers();
        assert.equal(page.loading(), false);
        assert.equal(page.consumers().length, 0);
        assert.equal(page.preview(), null);

        // Attempting submit with empty selection must do nothing
        await page.submitProvision();
        assert.equal(page.submitting(), false);
        assert.equal(page.success(), null);
    });

    test('AC-39-3: Failure path — BE provision error shows code & detail, never declares done', async () => {
        const mockApiClient = {
            listConsumers: async () => ({
                items: [
                    {
                        id: 'c-fail-test',
                        name: 'Fail Test Consumer',
                        root: '/repos/c-fail-test',
                        status: 'ready',
                        sdlcRoot: 'sdlc',
                        version: 1,
                        updatedAt: new Date().toISOString(),
                    },
                ],
            }),
            provisionConsumer: async () => {
                const err = new Error('Database schema mismatch detected');
                err.code = 'SCHEMA_MISMATCH';
                err.status = 409;
                err.detail = 'Schema c_wrong does not match consumer id c-fail-test';
                throw err;
            },
            getConsumerSetup: async () => {
                throw new Error('Should not be called if provision fails');
            },
        };

        const service = new OnboardingService(mockApiClient);

        const page = new OnboardingPage(service);

        await page.loadConsumers();
        assert.equal(page.selectedConsumerId(), 'c-fail-test');
        assert.ok(page.preview());

        // Submit triggers error
        await page.submitProvision();

        // Must show error
        const err = page.error();
        assert.ok(err, 'Error must be set');
        assert.equal(err.code, 'SCHEMA_MISMATCH');
        assert.equal(err.status, 409);
        assert.equal(err.message, 'Schema c_wrong does not match consumer id c-fail-test');

        // MUST NOT show success / fake done
        assert.equal(page.success(), null, 'Success must NOT be set on failure');
        assert.equal(page.submitting(), false, 'Submitting state must be reset for retry');
    });

    test('Happy path execution — provision succeeds and reads back setup state', async () => {
        let provisionCalled = false;
        let setupCalled = false;

        const mockApiClient = {
            listConsumers: async () => ({
                items: [
                    {
                        id: 'c-success-test',
                        name: 'Success Consumer',
                        root: '/repos/c-success-test',
                        status: 'ready',
                        sdlcRoot: 'sdlc',
                        version: 1,
                        updatedAt: new Date().toISOString(),
                    },
                ],
            }),
            provisionConsumer: async (id) => {
                provisionCalled = true;
                assert.equal(id, 'c-success-test');
                return {
                    consumer: id,
                    status: 'provisioned',
                    schema: `c_${id}`,
                    material: {
                        agents: true,
                        harness: '.harness/config.json',
                        manifest: '.harness/manifest.json',
                    },
                    setup: {
                        ready: true,
                        updated_at: new Date().toISOString(),
                    },
                };
            },
            getConsumerSetup: async (id) => {
                setupCalled = true;
                assert.equal(id, 'c-success-test');
                return {
                    consumerId: id,
                    status: 'ready',
                    schema: {
                        name: `c_${id}`,
                        exists: true,
                    },
                    material: {
                        agents: true,
                        config: true,
                        manifest: true,
                        hash: 'sha256:abc123mock',
                        materialized: true,
                    },
                    setup: {
                        ready: true,
                        updatedAt: new Date().toISOString(),
                    },
                };
            },
        };

        const service = new OnboardingService(mockApiClient);

        const page = new OnboardingPage(service);

        await page.loadConsumers();
        await page.submitProvision();

        assert.equal(provisionCalled, true);
        assert.equal(setupCalled, true);
        assert.equal(page.error(), null);
        assert.ok(page.success());
        assert.equal(page.success().consumerId, 'c-success-test');
        assert.equal(page.success().status, 'provisioned');
        assert.equal(page.success().ready, true);
        assert.equal(page.success().schema, 'c_c-success-test');
    });

    test('ControlPlaneApiClient implements provisionConsumer and getConsumerSetup endpoints', async () => {
        const recordedRequests = [];

        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, init) => {
            recordedRequests.push({ url: String(url), method: init?.method || 'GET' });

            if (String(url).endsWith('/provision')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        consumer: 'test-c',
                        status: 'provisioned',
                        schema: 'c_test-c',
                        material: { agents: true, harness: '.harness/config.json', manifest: '.harness/manifest.json' },
                        setup: { ready: true, updated_at: '2026-11-10T00:00:00Z' },
                    }),
                };
            }

            if (String(url).endsWith('/setup')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        consumerId: 'test-c',
                        status: 'ready',
                        schema: { name: 'c_test-c', exists: true },
                        material: { agents: true, config: true, manifest: true, hash: 'h1', materialized: true },
                        setup: { ready: true, updatedAt: '2026-11-10T00:00:00Z' },
                    }),
                };
            }

            return { ok: false, status: 404 };
        };

        try {
            const client = new ControlPlaneApiClient({ baseUrl: 'http://test-server' });

            const provRes = await client.provisionConsumer('test-c');
            assert.equal(provRes.consumer, 'test-c');
            assert.equal(provRes.schema, 'c_test-c');

            const setupRes = await client.getConsumerSetup('test-c');
            assert.equal(setupRes.consumerId, 'test-c');
            assert.equal(setupRes.setup.ready, true);

            assert.equal(recordedRequests.length, 2);
            assert.equal(recordedRequests[0].url, 'http://test-server/api/v1/consumers/test-c/provision');
            assert.equal(recordedRequests[0].method, 'POST');
            assert.equal(recordedRequests[1].url, 'http://test-server/api/v1/consumers/test-c/setup');
            assert.equal(recordedRequests[1].method, 'GET');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('Structural and hygiene compliance: No packages/harness-* imports, no tier/recipe/host fields', () => {
        const featureFiles = [
            '../apps/control-plane/src/app/features/onboarding/models/onboarding.model.ts',
            '../apps/control-plane/src/app/features/onboarding/data/onboarding.service.ts',
            '../apps/control-plane/src/app/features/onboarding/pages/onboarding.page.ts',
            '../apps/control-plane/src/app/features/onboarding/onboarding.routes.ts',
        ];

        for (const file of featureFiles) {
            const fullPath = resolve(__dirname, file);
            assert.ok(existsSync(fullPath), `File must exist: ${file}`);
            const content = readFileSync(fullPath, 'utf8');

            assert.equal(content.includes('packages/harness-'), false, `Forbidden import packages/harness-* found in ${file}`);
            assert.equal(/\b(tier|recipe)\b/i.test(content), false, `Forbidden legacy term tier/recipe found in ${file}`);
        }
    });
});
