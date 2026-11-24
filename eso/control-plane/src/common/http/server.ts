import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { pathToFileURL } from 'node:url';

import { AuthService, loadAuthConfig, parseAuthorization, type AuthConfig } from '../auth/auth.js';
import { HostTokenService } from '../auth/host-token.service.js';
import { corsHeaders } from '../errors/cors.js';
import { toErrorResponse } from '../errors/envelope.js';
import {
    BunSqlPlatformStore,
    PlatformError,
    RegistryService,
    stackVersionsHash,
    type PlatformStore,
} from '../../platform/registry/index.js';
import { EventReader } from '../../platform/events/read/event-reader.js';
import { RegistrationService } from '../../modules/consumers/registration/registration.service.js';
import { RegistryQueryService } from '../../modules/consumers/query/registry-query.service.js';
import { UpdateConsumerService } from '../../modules/consumers/update/update.service.js';
import { LifecycleService } from '../../modules/consumers/lifecycle/lifecycle.service.js';
import { PurgeService } from '../../modules/consumers/purge/purge.service.js';
import { LegacyHarnessService } from '../../modules/consumers/legacy/legacy-harness.service.js';
import { HarnessMigrationService } from '../../modules/consumers/migration/harness-migration.service.js';
import { BoundaryPolicyService } from '../../modules/boundaries/boundary-policy.service.js';
import { JudgmentService } from '../../modules/judgment/judgment.service.js';
import { JevService } from '../../modules/judgment/jev.service.js';
import { GraphImpactService } from '../../modules/graph/application/services/graph-impact.service.js';
import { KnowledgeMappingService } from '../../modules/knowledge/knowledge-mapping.service.js';
import { KnowledgeMappingCheckService } from '../../modules/knowledge/knowledge-mapping-check.service.js';
import { LearningService } from '../../modules/learning/learning.service.js';
import { EvidenceScoreService } from '../../modules/evidence-score/evidence-score.service.js';
import { EvidenceLedgerService } from '../../modules/evidence-ledger/evidence-ledger.service.js';
import { InMemoryMemoryFactStore, MemoryService } from '../../modules/memory/memory.service.js';
import { InMemoryTransferStore, TransferService } from '../../modules/transfer/transfer.service.js';
import { EvidenceIngestService } from '../../modules/ingest/ingest.service.js';
import { StoreEvidenceLedger } from '../../modules/ingest/store-evidence-ledger.js';
import { HarnessPackagingService } from '../../modules/harness-packaging/harness-packaging.service.js';
import { SelfUpgradeService } from '../../modules/self-upgrade/self-upgrade.service.js';
import { ArchQueryService } from '../../modules/arch-query/arch-query.service.js';
import { HostSyncService } from '../../modules/host-sync/host-sync.service.js';
import { HostProbeService } from '../../modules/host-probe/host-probe.service.js';
import { ConsumerConfigService } from '../../modules/consumer-config/consumer-config.service.js';
import { ParityService } from '../../modules/parity/parity.service.js';
import { TeamObservatoryService } from '../../modules/observatory/team-observatory.service.js';
import { ProfileService } from '../../modules/profiles/profile.service.js';
import { BunScopedDb, IsolationService } from '../db/isolation.js';
import { FsBrowseService } from '../fs/fs-browse.service.js';
import { McpDiscoveryService } from '../mcp/mcp-discovery.service.js';
import { HostDiscoveryService } from '../hosts/host-discovery.service.js';
import { SchemaProvisioningService } from '../../provisioning/schema/schema-provisioning.service.js';
import { MaterialProvisioningService } from '../../provisioning/material/material-provisioning.service.js';
import { ProvisioningStateService } from '../../provisioning/state/provisioning-state.service.js';
import { WorkerFileService } from '../../modules/workers/worker-file.service.js';
import { KnowledgeIndexService } from '../../modules/knowledge/knowledge-index.service.js';
import { KnowledgeCheckService } from '../../modules/knowledge/knowledge-check.service.js';
import { KnowledgeRetrievalService } from '../../modules/knowledge/knowledge-retrieval.service.js';
import { LocalEmbeddingService } from '../../modules/knowledge/local-embedding.service.js';
import { KnowledgeEvalService } from '../../modules/knowledge/knowledge-eval.service.js';
import { InventoryService } from '../../modules/inventory/inventory.service.js';
import { SufficiencyService } from '../../modules/sufficiency/sufficiency.service.js';
import { WorkerPolicyService } from '../../modules/workers/worker-policy.service.js';
import { WorkerImportService } from '../../modules/workers/worker-import.service.js';
import { ScopeService } from '../../modules/scope/scope.service.js';
import { RuleFileService } from '../../modules/rules/rule-file.service.js';
import { FlowFileService } from '../../modules/flows/flow-file.service.js';
import { FlowProposalService } from '../../modules/flows/flow-proposal.service.js';
import { HostRuntimeService } from '../../modules/host-runtime/host-runtime.service.js';
import { ConfigSnapshotService, RUNTIME_KEY_PATTERN, etagMatches } from '../../modules/config-snapshot/config-snapshot.service.js';
import { ObservationService } from '../../modules/observations/observation.service.js';
import { RequestService } from '../../modules/requests/request.service.js';
import { PluginService } from '../../modules/plugins/plugin.service.js';
import { TelemetryService } from '../../modules/telemetry/telemetry.service.js';

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
    // Reconcile consumer schemas at start. The knowledge DDL is bootstrap-only (CREATE IF NOT EXISTS
    // plus ADD COLUMN IF NOT EXISTS) and runs on schema creation; an existing consumer would never
    // pick up new tables/columns on a control-plane upgrade otherwise. Best-effort: a broken consumer
    // schema must not stop the control plane from serving the others.
    const observationRetentionDays = Number(process.env.ESO_OBSERVATION_RETENTION_DAYS || 0);
    const observationCutoff = observationRetentionDays > 0
        ? new Date(Date.now() - observationRetentionDays * 86_400_000).toISOString()
        : null;
    const pruneReadyConsumers = async (): Promise<void> => {
        if (!observationCutoff) return;
        for (const consumer of await store.listConsumers({ status: 'ready' })) {
            try {
                await store.pruneObservations(consumer.id, new Date(Date.now() - observationRetentionDays * 86_400_000).toISOString());
            } catch (error) {
                console.error(`OBSERVATION_RETENTION_FAILED:${consumer.id}:${(error as Error)?.message || error}`);
            }
        }
    };
    for (const consumer of await store.listConsumers({ status: 'ready' })) {
        try {
            await store.ensureKnowledgeSchema(consumer.id);
            if (observationCutoff) await store.pruneObservations(consumer.id, observationCutoff);
        } catch (error) {
            console.error(`KNOWLEDGE_SCHEMA_REFRESH_FAILED:${consumer.id}:${(error as Error)?.message || error}`);
        }
    }
    if (observationCutoff) {
        const timer = setInterval(() => { void pruneReadyConsumers(); }, 60 * 60 * 1000);
        timer.unref?.();
    }
    const registration = new RegistrationService(registry, store);
    const query = new RegistryQueryService(store);
    const updates = new UpdateConsumerService(store);
    const lifecycle = new LifecycleService(store);
    const purge = new PurgeService(store);
    const legacyHarness = new LegacyHarnessService(store);
    const harnessMigration = new HarnessMigrationService(store);
    const boundaries = new BoundaryPolicyService(store);
    const judgment = new JudgmentService(store);
    const jev = new JevService(store);
    const graphImpact = new GraphImpactService(store, options.scoped ?? null);
    const knowledgeMapping = new KnowledgeMappingService(store);
    const knowledgeMappingCheck = new KnowledgeMappingCheckService(store);
    const learning = new LearningService(store);
    const evidenceScore = new EvidenceScoreService(store);
    const parity = new ParityService(store);
    const teamObservatory = new TeamObservatoryService(store);
    const profiles = new ProfileService(store);
    const events = new EventReader(store);
    const scoped = options.scoped ?? null;
    const isolation = new IsolationService(store, scoped ?? undefined);
    const fsBrowse = new FsBrowseService();
    const mcpDiscovery = new McpDiscoveryService();
    const hostDiscovery = new HostDiscoveryService();
    const schemaProvisioning = new SchemaProvisioningService(store);
    const materialProvisioning = new MaterialProvisioningService(store);
    const stateProvisioning = new ProvisioningStateService(store);
    const workerFiles = new WorkerFileService(store);
    const knowledgeIndex = new KnowledgeIndexService(store);
    const knowledgeCheck = new KnowledgeCheckService(store);
    const knowledgeEmbedding = new LocalEmbeddingService(store);
    const knowledgeRetrieval = new KnowledgeRetrievalService(store, knowledgeEmbedding);
    const knowledgeEval = new KnowledgeEvalService(knowledgeRetrieval);
    const inventory = new InventoryService(store);
    const sufficiency = new SufficiencyService(store, inventory);
    const workerPolicy = new WorkerPolicyService(store);
    const workerImport = new WorkerImportService(workerFiles);
    const scope = new ScopeService(store);
    const ruleFiles = new RuleFileService(store);
    const flowFiles = new FlowFileService(store, workerFiles);
    const flowProposal = new FlowProposalService(store, workerFiles, flowFiles);
    /**
     * BUG-39: a flow write that returns `{ok:false}` is a failure, not a 200. Map the service reason
     * to a coded error so the UI cannot silently treat publish/setDefault as successful.
     */
    const assertFlowOk = (result: any, action: string): void => {
        if (result?.ok !== false) return;
        if (result?.validation) {
            const errors = Array.isArray(result.validation.errors) ? result.validation.errors : [];
            throw new PlatformError('FLOW_INVALID', errors.length ? errors.join(', ') : `Flow ${action} validation failed`);
        }
        const reason = String(result?.reason || 'FLOW_INVALID');
        if (reason === 'NO_DRAFT') throw new PlatformError('FLOW_NO_DRAFT', `No draft to ${action}`);
        if (reason === 'VERSION_NOT_FOUND') throw new PlatformError('NOT_FOUND', 'Flow version not found');
        if (reason === 'INVALID_DEFAULT') throw new PlatformError('FLOW_INVALID', 'flowId/version must identify a published version');
        throw new PlatformError('FLOW_INVALID', `${action} failed: ${reason}`);
    };
    const hostRuntime = new HostRuntimeService(store);
    const hostTokens = new HostTokenService(store);
    const configSnapshot = new ConfigSnapshotService(store, flowFiles, workerFiles, hostRuntime);
    const observations = new ObservationService(store);
    const requests = new RequestService(store, configSnapshot);
    const plugins = new PluginService(store);
    const telemetry = new TelemetryService(store);

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

    /**
     * BUG-38: `POST /consumers` must be all-or-nothing at the API. If provisioning fails after the
     * registry row was created, compensate (drop the schema + remove the row/events) so a retry is
     * not blocked by a 409 for a consumer that never became ready.
     */
    const provisionNewConsumer = async (id: string, body: any) => {
        try {
            return await provisionConsumer(id, body);
        } catch (error) {
            try { await store.dropSchema(id); } catch { /* best effort */ }
            try { await store.removeConsumer(id); } catch { /* best effort */ }
            if (error instanceof PlatformError) throw error;
            throw new PlatformError('PROVISION_FAILED', String((error as Error)?.message || error));
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

    // Operator/machine auth first, then scoped host bearer token (snapshot + observation ingest).
    const hostOrOperator = async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            (request as any).actor = auth.authenticate(request.headers.authorization);
            return;
        } catch (error) {
            const parsed = parseAuthorization(request.headers.authorization);
            if (!parsed || parsed.scheme !== 'bearer') {
                const response = toErrorResponse(error);
                reply.code(response.status).send(response.body);
                return;
            }
            try {
                (request as any).actor = await hostTokens.authenticate(parsed.value);
            } catch (hostError) {
                const response = toErrorResponse(hostError);
                reply.code(response.status).send(response.body);
            }
        }
    };

    app.get('/health', async () => ({ status: 'ok' }));

    app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request) => {
        return auth.me(request.headers.authorization);
    });

    app.get('/api/v1/fs/resolve-directory', { preHandler: requireAuth }, async (request, reply) => {
        try {
            return await fsBrowse.resolveDirectory(String((request.query as any)?.name || ''));
        } catch (error) {
            const status = typeof (error as any)?.getStatus === 'function' ? (error as any).getStatus() : 500;
            const body = typeof (error as any)?.getResponse === 'function'
                ? (error as any).getResponse()
                : { code: 'INTERNAL_ERROR', message: 'Filesystem resolve failed' };
            reply.code(status).send(body);
        }
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
        // BUG-45: bounded list; the store clamps to default 100 / max 500.
        const limit = q.limit === undefined || q.limit === '' ? undefined : Number(q.limit);
        const offset = q.offset === undefined || q.offset === '' ? undefined : Number(q.offset);
        return query.list({
            includeDeleted: q.include_deleted === 'true' || q.include_deleted === true,
            status: typeof q.status === 'string' && q.status ? q.status : null,
            limit,
            offset,
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
            await provisionNewConsumer(record.id, body);
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

    app.get('/api/v1/consumers/:id/mcp', { preHandler: requireAuth }, async (request) => {
        const id = (request.params as any).id;
        const consumer = await store.getConsumer(id);
        if (!consumer) {
            throw new Error(`Consumer not found: ${id}`);
        }
        return mcpDiscovery.discover(consumer.id, consumer.root);
    });

    app.get('/api/v1/consumers/:id/hosts', { preHandler: requireAuth }, async (request) => {
        const id = (request.params as any).id;
        const consumer = await store.getConsumer(id);
        if (!consumer) {
            throw new Error(`Consumer not found: ${id}`);
        }
        return hostDiscovery.discover(consumer.id, consumer.root);
    });

    // Host registry is GLOBAL: a machine (host) owns one or more runtimes (hostId:runtimeId).
    // ESO stores the registration; it never starts a host process or routes work.
    app.get('/api/v1/hosts', { preHandler: requireAuth }, async () => {
        return hostRuntime.listHosts();
    });

    app.put('/api/v1/hosts/:hostId', { preHandler: requireAuth }, async (request) => {
        return hostRuntime.putHost((request.params as any).hostId, request.body || {});
    });

    app.put('/api/v1/hosts/:hostId/runtimes/:runtimeId', { preHandler: requireAuth }, async (request) => {
        return hostRuntime.putHostRuntime((request.params as any).hostId, (request.params as any).runtimeId, request.body || {});
    });

    app.post('/api/v1/hosts/:hostId/runtimes/:runtimeId/heartbeat', { preHandler: requireAuth }, async (request) => {
        return hostRuntime.heartbeat((request.params as any).hostId, (request.params as any).runtimeId, request.body || {});
    });

    // Flattened runtime list (compat for pickers/placement); nested view is GET /hosts.
    app.get('/api/v1/host-runtimes', { preHandler: requireAuth }, async () => {
        return hostRuntime.listHostRuntimes();
    });

    // Scoped host tokens (operator auth only): issue returns the plaintext token exactly once.
    app.post('/api/v1/hosts/:hostId/runtimes/:runtimeId/tokens', { preHandler: requireAuth }, async (request, reply) => {
        const body = request.body as any;
        const consumerId = String(body?.consumerId || '').trim();
        if (!consumerId) throw new PlatformError('INVALID_CONSUMER_ID', 'consumerId is required');
        const issued = await hostTokens.issue((request.params as any).hostId, (request.params as any).runtimeId, consumerId);
        reply.code(201);
        return issued;
    });

    app.delete('/api/v1/hosts/:hostId/runtimes/:runtimeId/tokens/:tokenId', { preHandler: requireAuth }, async (request, reply) => {
        await hostTokens.revoke((request.params as any).hostId, (request.params as any).runtimeId, (request.params as any).tokenId);
        return reply.code(204).send();
    });

    const stackVersionView = async (consumerId: string) => {
        const consumer = await store.getConsumer(consumerId);
        const versions = await store.listStackVersions(consumerId);
        return {
            consumerId,
            // BUG-27: `version` + `versionsHash` are the optimistic tokens a client may send back
            // as `baseVersion` on the next replace-all.
            version: consumer?.version ?? null,
            versionsHash: stackVersionsHash(versions),
            versions,
        };
    };

    app.get('/api/v1/consumers/:id/stack-versions', { preHandler: requireAuth }, async (request) => {
        const id = (request.params as any).id;
        const consumer = await store.getConsumer(id);
        if (!consumer) {
            throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        }
        return stackVersionView(consumer.id);
    });

    app.put('/api/v1/consumers/:id/stack-versions', { preHandler: requireAuth }, async (request) => {
        const id = (request.params as any).id;
        const consumer = await store.getConsumer(id);
        if (!consumer) {
            throw new PlatformError('CONSUMER_NOT_FOUND', `Consumer not found: ${id}`);
        }
        const body = request.body as any;
        const baseVersion = body?.baseVersion;
        if (baseVersion === undefined || baseVersion === null || baseVersion === '') {
            throw new PlatformError('STALE_VERSION', 'baseVersion is required for a replace-all stack-version write');
        }
        const currentVersions = await store.listStackVersions(consumer.id);
        const currentHash = stackVersionsHash(currentVersions);
        const baseString = String(baseVersion);
        const matchesConsumerVersion = /^\d+$/.test(baseString) && Number(baseString) === consumer.version;
        const matchesVersionsHash = baseString === currentHash;
        if (!matchesConsumerVersion && !matchesVersionsHash) {
            throw new PlatformError(
                'STALE_VERSION',
                `baseVersion is stale: send consumer version ${consumer.version} or hash ${currentHash}`
            );
        }
        const versions = Array.isArray(body?.versions) ? body.versions : [];
        const now = new Date().toISOString();
        const normalized = versions.map((item: any) => ({
            consumerId: consumer.id,
            version: Number(item?.version),
            status: item?.status === 'draft' || item?.status === 'retired' ? item.status : 'published',
            layers: Array.isArray(item?.layers) ? item.layers : [],
            publishedAt: item?.publishedAt ?? (item?.status === 'published' ? now : null),
            createdAt: item?.createdAt ?? now,
        }));
        const applied = await store.replaceStackVersions(consumer.id, normalized, {
            consumerVersion: consumer.version,
            versionsHash: currentHash,
        });
        if (!applied) {
            throw new PlatformError('STALE_VERSION', 'stack versions changed while this write was in flight');
        }
        return stackVersionView(consumer.id);
    });

    app.put('/api/v1/consumers/:id', { preHandler: requireAuth }, async (request) => {
        const actor = (request as any).actor;
        const body = request.body as any;
        const id = (request.params as any).id;
        const result = await updates.update(id, {
            id: body?.id,
            name: body?.name,
            profile: body?.profile,
            zones: body?.zones,
            expected_version: body?.expected_version,
            actor,
        });
        // The update writes config.json, but the manifest embeds that file's hash. Re-run the
        // material pass so config + manifest + materializedHash stay one consistent bundle.
        await materialProvisioning.provision(id, { profile: body?.profile, zones: body?.zones });
        return result.consumer;
    });

    for (const action of ['retire', 'reactivate', 'delete', 'restore'] as const) {
        app.post(`/api/v1/consumers/:id/${action}`, { preHandler: requireAuth }, async (request) => {
            return lifecycle.transition((request.params as any).id, action, (request as any).actor);
        });
    }

    app.post('/api/v1/boundaries/rollout', { preHandler: requireAuth }, async (request) => {
        return boundaries.rollout((request as any).actor);
    });

    app.post('/api/v1/consumers/:id/jev/decide', { preHandler: requireAuth }, async (request) => {
        return jev.decide((request.params as any).id, request.body ?? {}, (request as any).actor);
    });

    app.get('/api/v1/consumers/:id/observatory/team', { preHandler: requireAuth }, async (request) => {
        return teamObservatory.summary((request.params as any).id, (request.query as any)?.limit);
    });

    app.post('/api/v1/consumers/:id/parity', { preHandler: requireAuth }, async (request) => {
        return parity.compare((request.params as any).id, request.body ?? {});
    });

    // BUG-46: both evidence write paths persist through the same store-backed adapter; no request
    // path keeps evidence in a process-local Map.
    const evidenceLedger = new EvidenceLedgerService(store);


    const memoryService = new MemoryService(new InMemoryMemoryFactStore());
    const transferService = new TransferService(new InMemoryTransferStore());
    const ingestService = new EvidenceIngestService(new StoreEvidenceLedger(store));
    const packagingService = new HarnessPackagingService(process.cwd());
    const selfUpgradeService = new SelfUpgradeService(process.cwd());
    const archQueryService = new ArchQueryService(process.cwd());
    const hostSyncService = new HostSyncService();
    const hostProbeService = new HostProbeService();
    const capabilityCards = new Map<string, any>();
    const consumerConfig = new ConsumerConfigService(store);

    app.get('/api/v1/consumers/:id/config/preview', { preHandler: requireAuth }, async (request) => {
        return consumerConfig.preview((request.params as any).id);
    });

    app.put('/api/v1/consumers/:id/config', { preHandler: requireAuth }, async (request) => {
        return consumerConfig.save((request.params as any).id, (request.body ?? {}) as any);
    });

    app.post('/api/v1/consumers/:id/hosts/:hostId/capability', { preHandler: requireAuth }, async (request, reply) => {
        const consumerId = String((request.params as any).id);
        const hostId = String((request.params as any).hostId);
        const body = (request.body ?? {}) as any;
        const card = hostProbeService.assess({ ...body, host: { ...(body.host || {}), id: hostId } });
        capabilityCards.set(`${consumerId}::${hostId}`, card);
        const consumer = await store.getConsumer(consumerId).catch(() => null);
        if (consumer?.root) {
            try {
                const { mkdirSync, writeFileSync } = await import('node:fs');
                const { join } = await import('node:path');
                mkdirSync(join(consumer.root, '.harness'), { recursive: true });
                writeFileSync(join(consumer.root, '.harness', 'host-capability.json'), JSON.stringify(card, null, 2));
            } catch {
                // best effort: the card is still served from memory
            }
        }
        return reply.code(200).send(card);
    });

    app.get('/api/v1/consumers/:id/hosts/:hostId/capability', { preHandler: requireAuth }, async (request, reply) => {
        const key = `${String((request.params as any).id)}::${String((request.params as any).hostId)}`;
        const card = capabilityCards.get(key);
        if (!card) return reply.code(404).send({ code: 'NOT_FOUND', message: 'capability card not found' });
        return card;
    });

    app.post('/api/v1/consumers/:id/memory/facts', { preHandler: requireAuth }, async (request, reply) => {
        return reply.code(201).send(await memoryService.propose((request.params as any).id, (request.body ?? {}) as any, (request as any).actor));
    });
    app.get('/api/v1/consumers/:id/memory/facts', { preHandler: requireAuth }, async (request) => {
        return memoryService.list((request.params as any).id, (request.query as any) || {});
    });
    app.get('/api/v1/consumers/:id/memory/read', { preHandler: requireAuth }, async (request) => {
        return memoryService.read((request.params as any).id, (request.query as any) || {});
    });
    app.get('/api/v1/consumers/:id/memory/facts/:factId', { preHandler: requireAuth }, async (request) => {
        return memoryService.get((request.params as any).id, (request.params as any).factId);
    });
    app.post('/api/v1/consumers/:id/memory/facts/:factId/approve', { preHandler: requireAuth }, async (request) => {
        return memoryService.approve((request.params as any).id, (request.params as any).factId, (request as any).actor);
    });
    app.post('/api/v1/consumers/:id/memory/facts/:factId/reject', { preHandler: requireAuth }, async (request) => {
        return memoryService.reject((request.params as any).id, (request.params as any).factId, (request as any).actor, (request.body as any)?.reason);
    });

    app.post('/api/v1/consumers/:id/transfers', { preHandler: requireAuth }, async (request, reply) => {
        return reply.code(201).send(await transferService.propose((request.params as any).id, (request.body ?? {}) as any, (request as any).actor));
    });
    app.get('/api/v1/consumers/:id/transfers', { preHandler: requireAuth }, async (request) => {
        return transferService.list((request.params as any).id, (request.query as any) || {});
    });
    app.get('/api/v1/consumers/:id/transfers/entries', { preHandler: requireAuth }, async (request) => {
        return transferService.entries((request.params as any).id, (request.query as any) || {});
    });
    app.post('/api/v1/consumers/:id/transfers/:proposalId/approve', { preHandler: requireAuth }, async (request) => {
        return transferService.approve((request.params as any).id, (request.params as any).proposalId, (request as any).actor);
    });

    app.post('/api/v1/consumers/:id/ingest/events', { preHandler: requireAuth }, async (request, reply) => {
        return reply.code(202).send(await ingestService.ingest((request.params as any).id, request.body ?? {}));
    });
    app.get('/api/v1/consumers/:id/ingest/events', { preHandler: requireAuth }, async (request) => {
        return ingestService.records((request.params as any).id);
    });

    app.get('/api/v1/packaging/report', { preHandler: requireAuth }, async () => {
        return packagingService.inspect();
    });

    app.get('/api/v1/self-upgrade/proposals', { preHandler: requireAuth }, async () => {
        return selfUpgradeService.list();
    });
    app.post('/api/v1/self-upgrade/proposals', { preHandler: requireAuth }, async (request, reply) => {
        return reply.code(201).send(selfUpgradeService.propose((request.body ?? {}) as any, (request as any).actor));
    });
    app.post('/api/v1/self-upgrade/proposals/:proposalId/approve', { preHandler: requireAuth }, async (request) => {
        return selfUpgradeService.approve((request.params as any).proposalId, (request as any).actor);
    });
    app.post('/api/v1/self-upgrade/proposals/:proposalId/apply', { preHandler: requireAuth }, async (request) => {
        return selfUpgradeService.apply((request.params as any).proposalId, (request as any).actor, (request.body as any) || undefined);
    });

    /**
     * BUG-47 — consumer-scoped architecture questions. The scan root is the consumer's repo, so
     * `answer.root` and every citation refer to that tree instead of the control-plane cwd.
     * Unknown consumer ⇒ 404 `CONSUMER_NOT_FOUND`; a consumer without a root ⇒ 422 `ROOT_NOT_FOUND`.
     */
    app.post('/api/v1/consumers/:id/arch/ask', { preHandler: requireAuth }, async (request) => {
        const consumerId = String((request.params as any).id);
        const consumer = await store.getConsumer(consumerId);
        if (!consumer) throw new PlatformError('CONSUMER_NOT_FOUND', consumerId);
        if (!consumer.root) throw new PlatformError('ROOT_NOT_FOUND', consumerId);
        const answer = archQueryService.ask((request.body ?? {}) as any, consumer.root);
        return archQueryService.assertContract(answer);
    });

    /**
     * Backward compatibility only (repo scope): scans this control-plane checkout
     * (`process.cwd()`), never a consumer repo. New callers must use
     * `POST /api/v1/consumers/:id/arch/ask`; this route remains for pre-BUG-47 clients.
     */
    app.post('/api/v1/arch/ask', { preHandler: requireAuth }, async (request) => {
        const answer = archQueryService.ask((request.body ?? {}) as any);
        return archQueryService.assertContract(answer);
    });

    app.post('/api/v1/consumers/:id/hosts/sync', { preHandler: requireAuth }, async (request) => {
        return hostSyncService.sync((request.body ?? {}) as any);
    });

    app.post('/api/v1/consumers/:id/evidence', { preHandler: requireAuth }, async (request, reply) => {
        return reply.code(201).send(await evidenceLedger.append((request.params as any).id, request.body ?? {}));
    });

    app.get('/api/v1/consumers/:id/evidence/:evidenceId', { preHandler: requireAuth }, async (request) => {
        return evidenceLedger.get((request.params as any).id, (request.params as any).evidenceId);
    });

    app.put('/api/v1/consumers/:id/evidence/:evidenceId', { preHandler: requireAuth }, async (_request, reply) => {
        return reply.code(405).send({ code: 'METHOD_NOT_ALLOWED', message: 'evidence ledger is append-only' });
    });

    app.delete('/api/v1/consumers/:id/evidence/:evidenceId', { preHandler: requireAuth }, async (_request, reply) => {
        return reply.code(405).send({ code: 'METHOD_NOT_ALLOWED', message: 'evidence ledger is append-only' });
    });

    app.post('/api/v1/consumers/:id/evidence-score', { preHandler: requireAuth }, async (request) => {
        return evidenceScore.score((request.params as any).id, request.body ?? {});
    });

    app.get('/api/v1/consumers/:id/learning/proposals', { preHandler: requireAuth }, async (request) => {
        return learning.list((request.params as any).id);
    });
    app.post('/api/v1/consumers/:id/learning/proposals', { preHandler: requireAuth }, async (request) => {
        return learning.propose((request.params as any).id, request.body, (request as any).actor);
    });
    app.post('/api/v1/consumers/:id/learning/proposals/:proposalId/approve', { preHandler: requireAuth }, async (request) => {
        return learning.approve((request.params as any).id, (request.params as any).proposalId, (request as any).actor);
    });
    app.post('/api/v1/consumers/:id/learning/proposals/:proposalId/reject', { preHandler: requireAuth }, async (request) => {
        return learning.reject((request.params as any).id, (request.params as any).proposalId, (request as any).actor, (request.body as any)?.reason);
    });
    app.post('/api/v1/consumers/:id/learning/proposals/:proposalId/apply', { preHandler: requireAuth }, async (request) => {
        return learning.apply((request.params as any).id, (request.params as any).proposalId, (request as any).actor, (request.body as any)?.window);
    });
    app.post('/api/v1/consumers/:id/learning/proposals/:proposalId/measure', { preHandler: requireAuth }, async (request) => {
        return learning.measure((request.params as any).id, (request.params as any).proposalId, (request.body as any)?.metrics, (request as any).actor, (request.body as any)?.now);
    });

    app.post('/api/v1/consumers/:id/learning/proposals/:proposalId/revert', { preHandler: requireAuth }, async (request) => {
        return learning.revert((request.params as any).id, (request.params as any).proposalId, (request as any).actor, (request.body as any)?.reason);
    });

    app.get('/api/v1/consumers/:id/knowledge/mapping', { preHandler: requireAuth }, async (request) => {
        return knowledgeMapping.mapping((request.params as any).id);
    });
    app.get('/api/v1/consumers/:id/knowledge/mapping/check', { preHandler: requireAuth }, async (request) => {
        return knowledgeMappingCheck.check((request.params as any).id);
    });

    app.get('/api/v1/consumers/:id/graph/impact', { preHandler: requireAuth }, async (request) => {
        const query = request.query as any;
        return graphImpact.impact((request.params as any).id, {
            target: query.target,
            kind: query.kind,
            direction: query.direction,
            depth: query.depth,
            fanout: query.fanout,
            project: query.project,
            buildId: query.buildId,
        });
    });

    app.post('/api/v1/consumers/:id/sufficiency', { preHandler: requireAuth }, async (request) => {
        return judgment.evaluate((request.params as any).id, (request.body as any) ?? {}, (request as any).actor);
    });

    // P6 — per-actor file-write scope. Same domain guard the worker write path enforces.
    app.post('/api/v1/consumers/:id/scope/check', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return scope.check((request.params as any).id, {
            allowedFiles: body.allowedFiles,
            target: body.target,
            emptyScope: body.emptyScope === true,
        });
    });

    app.get('/api/v1/consumers/:id/boundaries', { preHandler: requireAuth }, async (request) => {
        return boundaries.get((request.params as any).id);
    });

    app.put('/api/v1/consumers/:id/boundaries', { preHandler: requireAuth }, async (request) => {
        const body = request.body as any;
        return boundaries.save((request.params as any).id, body?.policies, (request as any).actor, body?.enforcement);
    });

    app.post('/api/v1/consumers/:id/boundaries/grants', { preHandler: requireAuth }, async (request) => {
        return boundaries.createGrant((request.params as any).id, request.body, (request as any).actor);
    });

    app.delete('/api/v1/consumers/:id/boundaries/grants/:grantId', { preHandler: requireAuth }, async (request) => {
        return boundaries.revokeGrant((request.params as any).id, (request.params as any).grantId, (request as any).actor);
    });

    app.get('/api/v1/consumers/:id/harness-migration/preview', { preHandler: requireAuth }, async (request) => {
        return harnessMigration.preview((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/harness-migration/conflicts/:entryId/resolve', { preHandler: requireAuth }, async (request) => {
        const body = request.body as any;
        return harnessMigration.resolveConflict((request.params as any).id, (request.params as any).entryId, body?.strategy, (request as any).actor);
    });

    app.post('/api/v1/consumers/:id/harness-migration/apply', { preHandler: requireAuth }, async (request) => {
        return harnessMigration.apply((request.params as any).id, (request as any).actor);
    });

    app.get('/api/v1/consumers/:id/legacy-harness', { preHandler: requireAuth }, async (request) => {
        return legacyHarness.inspect((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/legacy-harness/archive', { preHandler: requireAuth }, async (request) => {
        return legacyHarness.archive((request.params as any).id, (request as any).actor);
    });

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

    app.get('/api/v1/consumers/:id/knowledge', { preHandler: requireAuth }, async (request) => {
        return store.knowledgeSummary((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/knowledge/index', { preHandler: requireAuth }, async (request) => {
        return knowledgeIndex.index((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/knowledge/evaluate', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return knowledgeEval.evaluate((request.params as any).id, Array.isArray(body.cases) ? body.cases : [], body.k, body.weights);
    });

    app.get('/api/v1/consumers/:id/knowledge/embeddings', { preHandler: requireAuth }, async (request) => {
        return knowledgeEmbedding.status((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/knowledge/embed', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return knowledgeEmbedding.embedPending((request.params as any).id, Number(body.batchSize) || 8);
    });

    app.post('/api/v1/consumers/:id/knowledge/retrieve', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return knowledgeRetrieval.retrieve((request.params as any).id, String(body.query || ''), {
            type: body.type,
            status: body.status,
            limit: body.limit,
            graphDepth: body.graphDepth,
            weights: body.weights,
            tier: body.tier,
            budgetTokens: body.budgetTokens,
            context: body.context,
        });
    });

    app.get('/api/v1/consumers/:id/knowledge/search', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return knowledgeRetrieval.retrieve((request.params as any).id, String(q?.q || ''), {
            type: q?.type,
            status: q?.status,
            limit: Number(q?.limit) || 20,
            tier: q?.tier,
            budgetTokens: q?.budgetTokens,
            context: q?.context ? (() => { try { return JSON.parse(String(q.context)); } catch { return undefined; } })() : undefined,
        });
    });

    app.get('/api/v1/consumers/:id/knowledge/flows', { preHandler: requireAuth }, async (request) => {
        return store.knowledgeFlows((request.params as any).id);
    });

    app.get('/api/v1/consumers/:id/knowledge/edge-claims', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return store.knowledgeEdgeClaims((request.params as any).id, q?.edgeId);
    });

    app.get('/api/v1/consumers/:id/knowledge/external-refs', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return store.knowledgeExternalRefs((request.params as any).id, q?.docId);
    });

    app.get('/api/v1/consumers/:id/knowledge/coverage', { preHandler: requireAuth }, async (request) => {
        return store.knowledgeCoverage((request.params as any).id);
    });

    // F-14/US-22 + F-15/US-23 — inventory artifact and content sufficiency (read-only).
    // `kinds` overrides `.harness/knowledge-template.json` for ad-hoc checks.
    const templateKinds = (value: unknown): string[] | undefined => {
        if (typeof value !== 'string' || !value.trim()) return undefined;
        const kinds = value.split(',').map((kind) => kind.trim()).filter(Boolean);
        return kinds.length > 0 ? kinds : undefined;
    };

    app.get('/api/v1/consumers/:id/knowledge/inventory', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        const kinds = templateKinds(q?.kinds);
        return inventory.inventory((request.params as any).id, kinds ? { template: kinds } : undefined);
    });

    app.get('/api/v1/consumers/:id/knowledge/sufficiency', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        const kinds = templateKinds(q?.kinds);
        return sufficiency.check((request.params as any).id, kinds ? { template: kinds } : undefined);
    });

    app.post('/api/v1/consumers/:id/knowledge/check', { preHandler: requireAuth }, async (request) => {
        return knowledgeCheck.check((request.params as any).id);
    });

    app.get('/api/v1/consumers/:id/knowledge/docs', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return store.knowledgeDocs((request.params as any).id, typeof q?.q === 'string' ? q.q : '', Number(q?.limit) || 50);
    });

    app.get('/api/v1/consumers/:id/knowledge/docs/:docId', { preHandler: requireAuth }, async (request) => {
        return store.knowledgeDoc((request.params as any).id, (request.params as any).docId);
    });

    app.get('/api/v1/consumers/:id/knowledge/findings', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return store.knowledgeFindings((request.params as any).id, Number(q?.limit) || 50);
    });

    app.post('/api/v1/consumers/:id/workers/import/audit', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        await store.recordWorkerImport((request.params as any).id, {
            sourceFile: String(body.sourceFile || ''),
            sourceHash: String(body.sourceHash || ''),
            sourceType: String(body.sourceType || 'unknown'),
            workerId: String(body.workerId || ''),
            action: String(body.action || 'import'),
            detail: body.detail || {},
        });
        return { ok: true };
    });

    app.get('/api/v1/consumers/:id/workers/imports', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return store.listWorkerImports((request.params as any).id, Number(q?.limit) || 50);
    });

    app.get('/api/v1/consumers/:id/material/summary', { preHandler: requireAuth }, async (request) => {
        return ruleFiles.materialCounts((request.params as any).id);
    });

    app.delete('/api/v1/consumers/:id/rules/:ruleId', { preHandler: requireAuth }, async (request) => {
        return ruleFiles.remove((request.params as any).id, (request.params as any).ruleId);
    });

    app.get('/api/v1/plugins', { preHandler: requireAuth }, async () => {
        return plugins.list();
    });

    app.post('/api/v1/plugins', { preHandler: requireAuth }, async (request) => {
        return plugins.install(request.body || {});
    });

    app.delete('/api/v1/plugins/:pluginId', { preHandler: requireAuth }, async (request) => {
        return plugins.remove((request.params as any).pluginId);
    });

    app.get('/api/v1/consumers/:id/plugins', { preHandler: requireAuth }, async (request) => {
        return plugins.consumer((request.params as any).id);
    });

    app.put('/api/v1/consumers/:id/plugins/:pluginId', { preHandler: requireAuth }, async (request) => {
        return plugins.configure((request.params as any).id, (request.params as any).pluginId, request.body || {});
    });

    app.post('/api/v1/consumers/:id/plugins/:pluginId/test', { preHandler: requireAuth }, async (request) => {
        return plugins.test((request.params as any).id, (request.params as any).pluginId);
    });

    app.post('/api/v1/consumers/:id/plugins/:pluginId/sync', { preHandler: requireAuth }, async (request) => {
        return plugins.sync((request.params as any).id, (request.params as any).pluginId);
    });

    app.get('/api/v1/consumers/:id/plugins/:pluginId/projects', { preHandler: requireAuth }, async (request) => {
        return plugins.discoverProjects((request.params as any).id, (request.params as any).pluginId);
    });

    app.get('/api/v1/consumers/:id/provider-records', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return store.listProviderRecords((request.params as any).id, q?.provider);
    });

    // Read-only config snapshot for a host runtime (operator or scoped host token).
    app.get('/api/v1/consumers/:id/config-snapshot', { preHandler: hostOrOperator }, async (request, reply) => {
        const id = (request.params as any).id;
        const rawRuntimeKey = (request.query as any)?.runtimeKey;
        const runtimeKey = rawRuntimeKey === undefined ? undefined : String(rawRuntimeKey);
        if (runtimeKey !== undefined && !RUNTIME_KEY_PATTERN.test(runtimeKey)) {
            throw new PlatformError('HOST_RUNTIME_INVALID', 'runtimeKey must be hostId:runtimeId');
        }
        const actor = (request as any).actor;
        if (actor?.kind === 'host') {
            if (actor.consumerId !== id) throw new PlatformError('AUTH_INVALID', 'Host token consumer scope mismatch');
            if (!runtimeKey || runtimeKey !== `${actor.hostId}:${actor.runtimeId}`) {
                throw new PlatformError('AUTH_INVALID', 'Host token runtime scope mismatch');
            }
        }
        const snapshot = await configSnapshot.get(id);
        const etag = `"${snapshot.version}"`;
        if (etagMatches(String(request.headers['if-none-match'] || ''), snapshot.version)) {
            return reply.code(304).header('etag', etag).send();
        }
        reply.header('etag', etag).header('cache-control', 'no-cache');
        return snapshot;
    });

    // Observation/evidence append log (operator, or scoped host token for POST).
    app.post('/api/v1/consumers/:id/observations', { preHandler: hostOrOperator }, async (request) => {
        return observations.ingest((request.params as any).id, request.body || {}, (request as any).actor || {});
    });

    app.get('/api/v1/consumers/:id/observations', { preHandler: requireAuth }, async (request) => {
        const limit = Number((request.query as any)?.limit) || 100;
        return observations.list((request.params as any).id, limit);
    });

    // Read-only request projection: one trace = one request. No execution state.
    app.get('/api/v1/consumers/:id/requests', { preHandler: requireAuth }, async (request) => {
        const limit = Number((request.query as any)?.limit) || 200;
        return requests.list((request.params as any).id, limit);
    });

    app.get('/api/v1/consumers/:id/requests/:requestId', { preHandler: requireAuth }, async (request) => {
        return requests.get((request.params as any).id, (request.params as any).requestId);
    });

    app.get('/api/v1/consumers/:id/prompts', { preHandler: requireAuth }, async (request) => {
        const limit = Number((request.query as any)?.limit) || 500;
        return requests.listPrompts((request.params as any).id, limit);
    });

    // Read-only SSE stream over the observation log. ESO only reads observations.
    app.get('/api/v1/consumers/:id/observations/stream', { preHandler: requireAuth }, async (request, reply) => {
        const id = String((request.params as any).id || '');
        reply.hijack();
        reply.raw.writeHead(200, {
            ...corsHeaders(request.headers.origin),
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        let closed = false;
        let timer: ReturnType<typeof setInterval> | null = null;
        const write = (event: string, data: unknown) => {
            if (closed) return;
            reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const send = async () => {
            try {
                const result = await observations.list(id, 200);
                write('snapshot', { items: result.items || [] });
            } catch (error) {
                write('error', { message: error instanceof Error ? error.message : String(error) });
            }
        };
        const cleanup = () => {
            closed = true;
            if (timer) clearInterval(timer);
            try { reply.raw.end(); } catch { /* already closed */ }
        };
        request.raw.on('close', cleanup);
        request.raw.on('error', cleanup);
        write('hello', { consumerId: id, at: new Date().toISOString() });
        await send();
        timer = setInterval(() => { void send(); }, 1500);
    });

    app.get('/api/v1/consumers/:id/flows', { preHandler: requireAuth }, async (request) => {
        return flowFiles.list((request.params as any).id);
    });

    app.get('/api/v1/consumers/:id/slp/flow-proposal', { preHandler: requireAuth }, async (request) => {
        return flowProposal.preview((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/slp/flow-proposal/apply', { preHandler: requireAuth }, async (request) => {
        return flowProposal.apply((request.params as any).id);
    });

    app.get('/api/v1/consumers/:id/flows/default', { preHandler: requireAuth }, async (request) => {
        return flowFiles.defaultFlow((request.params as any).id);
    });

    app.put('/api/v1/consumers/:id/flows/default', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        const result = await flowFiles.setDefault((request.params as any).id, String(body.flowId || ''), Number(body.version) || 0);
        assertFlowOk(result, 'set default');
        return result;
    });

    app.get('/api/v1/consumers/:id/flows/:flowId', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return flowFiles.get((request.params as any).id, (request.params as any).flowId, Number(q?.version) || undefined);
    });

    app.put('/api/v1/consumers/:id/flows/:flowId', { preHandler: requireAuth }, async (request) => {
        return flowFiles.saveDraft((request.params as any).id, (request.params as any).flowId, request.body || {});
    });

    app.post('/api/v1/consumers/:id/flows/:flowId/validate', { preHandler: requireAuth }, async (request) => {
        return flowFiles.validate((request.params as any).id, request.body || {});
    });

    app.delete('/api/v1/consumers/:id/flows/:flowId/draft', { preHandler: requireAuth }, async (request) => {
        return flowFiles.deleteDraft((request.params as any).id, (request.params as any).flowId);
    });

    app.post('/api/v1/consumers/:id/flows/:flowId/publish', { preHandler: requireAuth }, async (request) => {
        const result = await flowFiles.publish((request.params as any).id, (request.params as any).flowId);
        assertFlowOk(result, 'publish');
        return result;
    });

    app.get('/api/v1/consumers/:id/flows/:flowId/versions', { preHandler: requireAuth }, async (request) => {
        return flowFiles.listVersions((request.params as any).id, (request.params as any).flowId);
    });

    app.get('/api/v1/consumers/:id/workers/sync/status', { preHandler: requireAuth }, async (request) => {
        return workerFiles.sourceStatus((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/workers/sync', { preHandler: requireAuth }, async (request) => {
        await workerFiles.refreshIndex((request.params as any).id);
        return workerFiles.sourceStatus((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/workers/sync/promote/:workerId', { preHandler: requireAuth }, async (request) => {
        return workerFiles.promoteProjection((request.params as any).id, (request.params as any).workerId);
    });

    app.get('/api/v1/consumers/:id/rules', { preHandler: requireAuth }, async (request) => {
        return ruleFiles.list((request.params as any).id);
    });

    app.post('/api/v1/consumers/:id/rules/import/preview', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return ruleFiles.preview((request.params as any).id, Array.isArray(body.files) ? body.files : []);
    });

    app.post('/api/v1/consumers/:id/rules/import/apply', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return ruleFiles.apply((request.params as any).id, Array.isArray(body.candidates) ? body.candidates : []);
    });

    app.post('/api/v1/consumers/:id/workers/import/preview', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return workerImport.preview((request.params as any).id, Array.isArray(body.files) ? body.files : []);
    });

    app.post('/api/v1/consumers/:id/workers/:workerId/check', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return workerPolicy.checkAndRecord((request.params as any).id, (request.params as any).workerId, {
            verb: body.verb,
            path: body.path,
            evidence: Array.isArray(body.evidence) ? body.evidence : [],
        });
    });

    app.post('/api/v1/consumers/:id/workers/:workerId/write', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return workerPolicy.write((request.params as any).id, (request.params as any).workerId, {
            path: body.path,
            content: body.content,
            evidence: Array.isArray(body.evidence) ? body.evidence : [],
        });
    });

    app.post('/api/v1/consumers/:id/workers/:workerId/handoff', { preHandler: requireAuth }, async (request) => {
        const body = (request.body || {}) as any;
        return workerPolicy.handoff((request.params as any).id, (request.params as any).workerId, String(body.toWorkerId || ''), Array.isArray(body.evidence) ? body.evidence : [], body.work || {}, String(body.outcome || ''));
    });

    app.post('/api/v1/consumers/:id/workers/:workerId/handoffs/:handoffId/accept', { preHandler: requireAuth }, async (request) => {
        return workerPolicy.acceptHandoff((request.params as any).id, (request.params as any).workerId, (request.params as any).handoffId);
    });

    app.get('/api/v1/consumers/:id/workers/:workerId/handoffs', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return workerPolicy.listHandoffs((request.params as any).id, (request.params as any).workerId, Number(q?.limit) || 50);
    });

    app.get('/api/v1/consumers/:id/workers/:workerId/events', { preHandler: requireAuth }, async (request) => {
        const q = request.query as any;
        return workerPolicy.listEvents((request.params as any).id, (request.params as any).workerId, Number(q?.limit) || 50);
    });

    app.get('/api/v1/consumers/:id/workers', { preHandler: requireAuth }, async (request) => {
        return workerFiles.read((request.params as any).id);
    });

    // Worker host placement policy — stored by ESO, enforced by the host runtime.
    app.get('/api/v1/consumers/:id/worker-placement', { preHandler: requireAuth }, async (request) => {
        return hostRuntime.listWorkerPlacements((request.params as any).id);
    });

    app.put('/api/v1/consumers/:id/workers/:workerId/placement', { preHandler: requireAuth }, async (request) => {
        return hostRuntime.putWorkerPlacement((request.params as any).id, (request.params as any).workerId, request.body || {});
    });

    app.put('/api/v1/consumers/:id/workers', { preHandler: requireAuth }, async (request) => {
        const body = request.body as any;
        if (Array.isArray(body?.edges) && body.edges.length > 0) {
            throw new PlatformError('EDGES_MOVED_TO_FLOW', 'Use PUT /consumers/:id/flows/:flowId and publish');
        }
        return workerFiles.write((request.params as any).id, {
            workers: Array.isArray(body?.workers) ? body.workers : [],
            edges: Array.isArray(body?.edges) ? body.edges : [],
            bindings: Array.isArray(body?.bindings) ? body.bindings : [],
        });
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

    // Vision test V2 telemetry: append-only UI surface views. The beacon is unauthenticated on
    // purpose (it must never delay or block a render); it carries no prompt/PII, only the surface,
    // an optional consumer id and an in-memory page session. Reading the aggregate requires auth.
    app.post('/api/v1/telemetry/ui', async (request, reply) => {
        const body = (request.body ?? {}) as any;
        const event = await telemetry.record({
            surface: body?.surface,
            consumerId: body?.consumerId,
            session: body?.session,
        });
        return reply.code(202).send(event);
    });

    app.get('/api/v1/telemetry/summary', { preHandler: requireAuth }, async (request) => {
        const q = (request.query ?? {}) as any;
        return telemetry.summary({
            from: q?.from,
            to: q?.to,
            consumerId: q?.consumer ?? q?.consumerId,
        });
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
