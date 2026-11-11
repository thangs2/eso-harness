import 'reflect-metadata';
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AuthModule } from '../src/common/guards/auth.module.js';
import { AuthConfig } from '../src/common/guards/auth-config.service.js';
import { DatabaseModule } from '../src/common/infrastructure/database.module.js';
import { DatabaseService } from '../src/common/infrastructure/database.service.js';
import { ProvisioningApiModule } from '../src/provisioning/api/provisioning-api.module.js';
import { ProvisioningApiService } from '../src/provisioning/api/provisioning-api.service.js';
import { MemoryPlatformStore } from '../src/platform/registry/store.js';

const AUTH_TOKEN = 'test-token-provisioning-api';

function tempRoot(): string {
    return mkdtempSync(join(tmpdir(), 'eso-api-test-'));
}

@Module({
    imports: [AuthModule, DatabaseModule, ProvisioningApiModule],
})
class ProvisioningTestAppModule {}

describe('P1-ESO-634-L5.8-api — Provisioning HTTP Endpoints', () => {
    let app: NestFastifyApplication;
    let store: MemoryPlatformStore;
    let baseUrl: string;
    let tempDirs: string[] = [];

    beforeEach(async () => {
        store = new MemoryPlatformStore();
        await store.ensurePlatformSchema();

        const adapter = new FastifyAdapter();
        app = await NestFactory.create<NestFastifyApplication>(
            ProvisioningTestAppModule,
            adapter,
            { logger: false }
        );

        app.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
                transformOptions: { enableImplicitConversion: false },
            })
        );

        const authConfig = app.get(AuthConfig);
        authConfig.token = AUTH_TOKEN;
        authConfig.project = 'test-project';

        const dbService = app.get(DatabaseService);
        dbService.setDatabase(store);

        const provService = app.get(ProvisioningApiService);
        provService.setStore(store);

        await app.listen(0, '127.0.0.1');
        baseUrl = await app.getUrl();
    });

    afterEach(async () => {
        if (app) {
            await app.close();
        }
        for (const dir of tempDirs) {
            try {
                rmSync(dir, { recursive: true, force: true });
            } catch {}
        }
        tempDirs = [];
    });

    test('INV-40-5: AuthGuard rejects unauthorized requests', async () => {
        // No auth header => 401
        const resNoAuth = await fetch(`${baseUrl}/api/v1/consumers/c-auth-test/provision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.equal(resNoAuth.status, 401);
        const errNoAuth = (await resNoAuth.json()) as any;
        assert.equal(errNoAuth.code, 'UNAUTHORIZED');

        // Invalid token => 401
        const resBadAuth = await fetch(`${baseUrl}/api/v1/consumers/c-auth-test/setup`, {
            method: 'GET',
            headers: {
                authorization: 'Bearer wrong-token',
            },
        });
        assert.equal(resBadAuth.status, 401);
        const errBadAuth = (await resBadAuth.json()) as any;
        assert.equal(errBadAuth.code, 'UNAUTHORIZED');
    });

    test('INV-40-4: DTO rejects non-whitelisted fields (e.g. tier/recipe/host)', async () => {
        const root = tempRoot();
        tempDirs.push(root);

        const consumerId = 'c-api-validation';
        const now = new Date().toISOString();
        await store.insertConsumer({
            id: consumerId,
            name: 'Validation Consumer',
            root,
            sdlcRoot: null,
            schemaName: `c_${consumerId}`,
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        const resForbidden = await fetch(`${baseUrl}/api/v1/consumers/${consumerId}/provision`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
            body: JSON.stringify({
                tier: 'gold', // Forbidden legacy concept
            }),
        });
        assert.equal(resForbidden.status, 400);
    });

    test('AC-40-1 & INV-40-1 & INV-40-2: Successful provisioning and setup read-back', async () => {
        const root = tempRoot();
        tempDirs.push(root);

        const consumerId = 'c-api-success';
        const now = new Date().toISOString();
        await store.insertConsumer({
            id: consumerId,
            name: 'API Success Consumer',
            root,
            sdlcRoot: null,
            schemaName: `c_${consumerId}`,
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        // 1. POST /api/v1/consumers/:id/provision
        const provRes = await fetch(`${baseUrl}/api/v1/consumers/${consumerId}/provision`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
            body: JSON.stringify({
                profile: { locale: 'vi' },
            }),
        });

        assert.equal(provRes.status, 200);
        const provBody = (await provRes.json()) as any;

        assert.equal(provBody.consumer, consumerId);
        assert.equal(provBody.status, 'provisioned');
        assert.equal(provBody.schema, `c_${consumerId}`);
        assert.equal(provBody.material.agents, true);
        assert.equal(provBody.material.harness, '.harness/config.json');
        assert.equal(provBody.material.manifest, '.harness/manifest.json');
        assert.equal(provBody.setup.ready, true);
        assert.ok(provBody.setup.updated_at);

        // 2. GET /api/v1/consumers/:id/setup
        const setupRes = await fetch(`${baseUrl}/api/v1/consumers/${consumerId}/setup`, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
        });

        assert.equal(setupRes.status, 200);
        const setupBody = (await setupRes.json()) as any;

        assert.equal(setupBody.consumerId, consumerId);
        assert.equal(setupBody.schema.exists, true);
        assert.equal(setupBody.schema.name, `c_${consumerId}`);
        assert.equal(setupBody.material.agents, true);
        assert.equal(setupBody.material.config, true);
        assert.equal(setupBody.material.manifest, true);
        assert.equal(setupBody.setup.ready, true);
        assert.ok(setupBody.setup.updatedAt);
    });

    test('INV-40-2: Idempotency of provisioning endpoint', async () => {
        const root = tempRoot();
        tempDirs.push(root);

        const consumerId = 'c-api-idempotent';
        const now = new Date().toISOString();
        await store.insertConsumer({
            id: consumerId,
            name: 'API Idempotent Consumer',
            root,
            sdlcRoot: null,
            schemaName: `c_${consumerId}`,
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        // First call
        const res1 = await fetch(`${baseUrl}/api/v1/consumers/${consumerId}/provision`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
            body: JSON.stringify({
                profile: { locale: 'en' },
            }),
        });
        assert.equal(res1.status, 200);
        const body1 = (await res1.json()) as any;

        // Second call with same parameters
        const res2 = await fetch(`${baseUrl}/api/v1/consumers/${consumerId}/provision`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
            body: JSON.stringify({
                profile: { locale: 'en' },
            }),
        });
        assert.equal(res2.status, 200);
        const body2 = (await res2.json()) as any;

        assert.equal(body1.schema, body2.schema);
        assert.equal(body1.status, body2.status);
        assert.equal(body1.setup.ready, body2.setup.ready);

        // GET confirms setup is intact
        const getRes = await fetch(`${baseUrl}/api/v1/consumers/${consumerId}/setup`, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
        });
        assert.equal(getRes.status, 200);
        const getBody = (await getRes.json()) as any;
        assert.equal(getBody.setup.ready, true);
    });

    test('AC-40-3 & INV-40-3: Failure error mappings', async () => {
        // 1. CONSUMER_NOT_FOUND => 404 (on provision)
        const res404 = await fetch(`${baseUrl}/api/v1/consumers/c-not-found/provision`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
            body: JSON.stringify({}),
        });
        assert.equal(res404.status, 404);
        const body404 = (await res404.json()) as any;
        assert.equal(body404.code, 'CONSUMER_NOT_FOUND');

        // 2. CONSUMER_NOT_FOUND => 404 (on getSetup)
        const get404 = await fetch(`${baseUrl}/api/v1/consumers/c-not-found/setup`, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
        });
        assert.equal(get404.status, 404);
        const getBody404 = (await get404.json()) as any;
        assert.equal(getBody404.code, 'CONSUMER_NOT_FOUND');

        // 3. ROOT_NOT_FOUND => 422
        const missingDirConsumer = 'c-missing-dir';
        const now = new Date().toISOString();
        await store.insertConsumer({
            id: missingDirConsumer,
            name: 'Missing Dir Consumer',
            root: '/nonexistent/path/for/eso/test',
            sdlcRoot: null,
            schemaName: `c_${missingDirConsumer}`,
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        const res422 = await fetch(`${baseUrl}/api/v1/consumers/${missingDirConsumer}/provision`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                authorization: `Bearer ${AUTH_TOKEN}`,
            },
            body: JSON.stringify({}),
        });
        assert.equal(res422.status, 422);
        const body422 = (await res422.json()) as any;
        assert.equal(body422.code, 'ROOT_NOT_FOUND');

        // 4. SCHEMA_MISMATCH => 409
        const rootMismatch = tempRoot();
        tempDirs.push(rootMismatch);
        const mismatchId = 'c-schema-mismatch';
        await store.insertConsumer({
            id: mismatchId,
            name: 'Schema Mismatch Consumer',
            root: rootMismatch,
            sdlcRoot: null,
            schemaName: `c_${mismatchId}`,
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        const provService = app.get(ProvisioningApiService);
        const schemaProto = Object.getPrototypeOf((provService as any).getServices().schemaService);
        const origProvMethod = schemaProto.provision;
        schemaProto.provision = async () => {
            const { fail } = await import('../src/platform/registry/errors.js');
            fail('SCHEMA_MISMATCH', 'Target schema mismatch');
        };

        try {
            const res409 = await fetch(`${baseUrl}/api/v1/consumers/${mismatchId}/provision`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    authorization: `Bearer ${AUTH_TOKEN}`,
                },
                body: JSON.stringify({}),
            });
            assert.equal(res409.status, 409);
            const body409 = (await res409.json()) as any;
            assert.equal(body409.code, 'SCHEMA_MISMATCH');
        } finally {
            schemaProto.provision = origProvMethod;
        }

        // 5. MATERIAL_FAILED => 500
        const rootMatFail = tempRoot();
        tempDirs.push(rootMatFail);
        const matFailId = 'c-mat-fail';
        await store.insertConsumer({
            id: matFailId,
            name: 'Material Fail Consumer',
            root: rootMatFail,
            sdlcRoot: null,
            schemaName: `c_${matFailId}`,
            status: 'ready',
            version: 1,
            storageMode: 'schema',
            materializedHash: null,
            createdAt: now,
            updatedAt: now,
        });

        const matProto = Object.getPrototypeOf((provService as any).getServices().materialService);
        const origMatMethod = matProto.provision;
        matProto.provision = async () => {
            const { fail } = await import('../src/platform/registry/errors.js');
            fail('MATERIAL_FAILED', 'Disk write simulated failure');
        };

        try {
            const res500 = await fetch(`${baseUrl}/api/v1/consumers/${matFailId}/provision`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    authorization: `Bearer ${AUTH_TOKEN}`,
                },
                body: JSON.stringify({}),
            });
            assert.equal(res500.status, 500);
            const body500 = (await res500.json()) as any;
            assert.equal(body500.code, 'MATERIAL_FAILED');
        } finally {
            matProto.provision = origMatMethod;
        }
    });
});
