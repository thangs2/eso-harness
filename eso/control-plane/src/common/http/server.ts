import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { pathToFileURL } from 'node:url';

import { AuthService, loadAuthConfig, type AuthConfig } from '../auth/auth.js';
import { corsHeaders } from '../errors/cors.js';
import { toErrorResponse } from '../errors/envelope.js';
import {
    BunSqlPlatformStore,
    PlatformError,
    RegistryService,
    type PlatformStore,
} from '../../platform/registry/index.js';
import { EventReader } from '../../platform/events/read/event-reader.js';
import { RegistrationService } from '../../modules/consumers/registration/registration.service.js';
import { RegistryQueryService } from '../../modules/consumers/query/registry-query.service.js';
import { UpdateConsumerService } from '../../modules/consumers/update/update.service.js';
import { LifecycleService } from '../../modules/consumers/lifecycle/lifecycle.service.js';
import { PurgeService } from '../../modules/consumers/purge/purge.service.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import { BunScopedDb, IsolationService } from '../db/isolation.js';
import { FsBrowseService } from '../fs/fs-browse.service.js';
import { SchemaProvisioningService } from '../../provisioning/schema/schema-provisioning.service.js';
import { MaterialProvisioningService } from '../../provisioning/material/material-provisioning.service.js';
import { ProvisioningStateService } from '../../provisioning/state/provisioning-state.service.js';

/**
 * L6.2 — the HTTP surface for Sprint 1.
 *
 * One route table, one error envelope, one auth gate. Consumer-scoped data routes go through the
 * isolation middleware; every registry route goes through the same services the unit tests use.
 */
export interface PlatformServerOptions {
    store: PlatformStore;
    auth: AuthService;
    scoped?: BunScopedDb;
}

export async function createPlatformServer(options: PlatformServerOptions): Promise<FastifyInstance> {
    const { store, auth } = options;
    const registry = new RegistryService(store);
    await registry.initialize();
    const registration = new RegistrationService(registry, store);
    const query = new RegistryQueryService(store);
    const updates = new UpdateConsumerService(store);
    const lifecycle = new LifecycleService(store);
    const purge = new PurgeService(store);
    const profiles = new ProfileService(store);
    const events = new EventReader(store);
    const scoped = options.scoped ?? null;
    const isolation = new IsolationService(store, scoped ?? undefined);
    const fsBrowse = new FsBrowseService();
    const schemaProvisioning = new SchemaProvisioningService(store);
    const materialProvisioning = new MaterialProvisioningService(store);
    const stateProvisioning = new ProvisioningStateService(store);

    const provisionConsumer = async (id: string, body: any) => {
        try {
            const schema = await schemaProvisioning.provision(id);
            await materialProvisioning.provision(id, {
                profile: body?.profile,
                zones: body?.zones,
            });
            const setup = await stateProvisioning.persistSetup(id, { expectReady: true, status: 'ready' });
            return {
                consumer: id,
                status: 'provisioned',
                schema: schema.schemaName,
                material: {
                    agents: true,
                    harness: '.harness/config.json',
                    manifest: '.harness/manifest.json',
                },
                setup: {
                    ready: setup.setup.ready,
                    updated_at: setup.setup.updatedAt,
                },
            };
        } catch (error) {
            await store.setStatus(id, 'error', new Date().toISOString());
            throw error;
        }
    };

    const app = Fastify({ logger: false, bodyLimit: 2_000_000 });

    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
        // Reject encoded path traversal before find-my-way can normalise it away.
        const rawUrl = String(request.raw?.url || '');
        if (rawUrl.startsWith('/api/v1/c/') && /(%2e|%2f|\.\.)/i.test(rawUrl)) {
            reply.code(400).send({ code: 'INVALID_CONSUMER_ID', message: 'Invalid consumer id' });
            return;
        }
        for (const [key, value] of Object.entries(corsHeaders(request.headers.origin))) {
            reply.header(key, value);
        }
        if (request.method === 'OPTIONS') {
            reply.code(204).send();
        }
    });

    const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            (request as any).actor = auth.authenticate(request.headers.authorization);
        } catch (error) {
            const response = toErrorResponse(error);
            reply.code(response.status).send(response.body);
        }
    };

    app.get('/health', async () => ({ status: 'ok' }));

    app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request) => {
        return auth.me(request.headers.authorization);
    });

    app.get('/api/v1/fs/list', { preHandler: requireAuth }, async (request, reply) => {
        try {
            return await fsBrowse.list((request.query as { path?: string } | undefined)?.path);
        } catch (error) {
            const status = typeof (error as any)?.getStatus === 'function' ? (error as any).getStatus() : 500;
            const body = typeof (error as any)?.getResponse === 'function'
                ? (error as any).getResponse()
                : { code: 'INTERNAL_ERROR', message: 'Filesystem browse failed' };
            reply.code(status).send(body);
        }
    });

    app.get('/api/v1/consumers', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return query.list({
            includeDeleted: q.include_deleted === 'true' || q.include_deleted === true,
            status: typeof q.status === 'string' && q.status ? q.status : null,
        });
    });

    app.post('/api/v1/consumers/plan', { preHandler: requireAuth }, async (request) => {
        const body = request.body as any;
        if (!body?.id || !body?.root) {
            throw new PlatformError('INVALID_CONSUMER_ID', 'id and root are required for a plan');
        }
        return {
            root: body.root,
            consumer: body.id,
            profile: body.profile ?? {},
            files: [
                {
                    relative: '.harness/config.json',
                    action: 'create-if-missing',
                    preview: { id: body.id, name: body.name, root: body.root, profile: body.profile },
                },
            ],
            warnings: [],
            generatedAt: new Date().toISOString(),
        };
    });

    app.post('/api/v1/consumers', { preHandler: requireAuth }, async (request, reply) => {
        const actor = (request as any).actor;
        const body = request.body as any;
        const record = await registration.register({
            id: body?.id,
            name: body?.name,
            root: body?.root,
            sdlcRoot: body?.sdlcRoot ?? null,
            profile: body?.profile,
            zones: body?.zones,
            actor,
        });
        if (body?.profile?.canonical) {
            await provisionConsumer(record.id, body);
            reply.code(201);
            return query.get(record.id);
        }
        reply.code(201);
        return record;
    });

    app.get('/api/v1/consumers/:id', { preHandler: requireAuth }, async (request) => {
        return query.get((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/provision', { preHandler: requireAuth }, async (request) => {
        const body = request.body as any;
        return provisionConsumer((request.params as any).id, body);
    });

    app.get('/api/v1/consumers/:id/setup', { preHandler: requireAuth }, async (request) => {
        return stateProvisioning.readSetup((request.params as any).id);
    });

    app.put('/api/v1/consumers/:id', { preHandler: requireAuth }, async (request) => {
        const actor = (request as any).actor;
        const body = request.body as any;
        const result = await updates.update((request.params as any).id, {
            id: body?.id,
            name: body?.name,
            profile: body?.profile,
            zones: body?.zones,
            expected_version: body?.expected_version,
            actor,
        });
        return result.consumer;
    });

    for (const action of ['retire', 'reactivate', 'delete', 'restore'] as const) {
        app.post(`/api/v1/consumers/:id/${action}`, { preHandler: requireAuth }, async (request) => {
            return lifecycle.transition((request.params as any).id, action, (request as any).actor);
        });
    }

    app.post('/api/v1/consumers/:id/purge', { preHandler: requireAuth }, async (request) => {
        const body = request.body as any;
        return purge.purge((request.params as any).id, body?.confirm_id, (request as any).actor);
    });

    app.get('/api/v1/consumers/:id/profile', { preHandler: requireAuth }, async (request) => {
        return profiles.get((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/profile/check', { preHandler: requireAuth }, async (request) => {
        return profiles.check((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/profile/materialize', { preHandler: requireAuth }, async (request) => {
        return profiles.materialize((request.params as any).id);
    });

    app.get('/api/v1/consumers/:id/events', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return events.list((request.params as any).id, Number(q.limit) || 100);
    });

    app.route({
        method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        url: '/api/v1/c/:consumer/*',
        preHandler: requireAuth,
        handler: async (request) => {
            const consumer = (request.params as any).consumer;
            return isolation.run(consumer, async (session) => ({
                consumer,
                searchPath: session.searchPath,
                ok: true,
            }));
        },
    });

    app.setNotFoundHandler(async (request, reply) => {
        const response = toErrorResponse({ code: 'CONSUMER_NOT_FOUND', status: 404, message: 'Consumer not found' });
        reply.code(404).send({ code: 'CONSUMER_NOT_FOUND', message: 'Consumer not found' });
    });

    app.setErrorHandler(async (error, request, reply) => {
        const response = toErrorResponse(error);
        reply
            .code(response.status)
            .header('content-type', 'application/json; charset=utf-8')
            .send(response.body);
    });

    return app;
}

export async function startPlatformServer(options: {
    store: PlatformStore;
    auth: AuthService;
    port?: number;
    host?: string;
    scoped?: BunScopedDb;
}): Promise<FastifyInstance> {
    const app = await createPlatformServer(options);
    const port = options.port ?? Number(process.env.ESO_PORT || 8787);
    const host = options.host ?? '127.0.0.1';
    await app.listen({ port, host });
    console.log(`LISTEN:${(app.server.address() as any)?.port ?? port}`);
    return app;
}

const isMain =
    typeof (import.meta as any).main === 'boolean'
        ? (import.meta as any).main
        : Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);

if (isMain) {
    const BunRuntime = (globalThis as any).Bun;
    if (!BunRuntime?.SQL) {
        console.error('Bun runtime with Bun.SQL is required to start the control plane');
        process.exit(2);
    }
    const authConfig: AuthConfig = loadAuthConfig({ env: process.env });
    const sql = new BunRuntime.SQL(process.env.ESO_DB_URL || process.env.ESO_TEST_DB_URL);
    const store = new BunSqlPlatformStore(sql);
    await store.ensurePlatformSchema();
    const app = await startPlatformServer({
        store,
        auth: new AuthService(authConfig),
        scoped: new BunScopedDb(sql),
    });
    const shutdown = async () => {
        await app.close();
        await sql.close();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
