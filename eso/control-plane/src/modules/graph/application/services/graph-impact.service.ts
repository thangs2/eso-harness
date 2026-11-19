/**
 * Phase 3 M1 — graph impact query.
 *
 * Read-only. Requires the consumer's graph tables; a missing graph is `unknown`, never `absent`.
 */
import { fail } from '../../../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../../../platform/registry/store.js';
import type { BunScopedDb } from '../../../../common/db/isolation.js';

export type ImpactDirection = 'downstream' | 'upstream';

export interface ImpactQuery {
    target: string;
    kind?: string;
    direction?: ImpactDirection;
    depth?: number;
    fanout?: number;
    project?: string;
    buildId?: string;
}

const MAX_DEPTH = 5;
const DEFAULT_DEPTH = 2;
const MAX_FANOUT = 50;

function numberInRange(value: unknown, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(Math.floor(parsed), max);
}

export class GraphImpactService {
    constructor(
        private readonly store: PlatformStore,
        private readonly scoped: BunScopedDb | null,
    ) {}

    async impact(consumerId: string, query: ImpactQuery) {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        if (!this.scoped) fail('INVALID_STATE', 'Graph database is not configured');
        const target = String(query.target || '').trim();
        if (!target) fail('INVALID_STATE', 'target is required');
        const depth = numberInRange(query.depth, DEFAULT_DEPTH, MAX_DEPTH);
        const fanout = numberInRange(query.fanout, MAX_FANOUT, MAX_FANOUT);
        const direction: ImpactDirection = query.direction === 'upstream' ? 'upstream' : 'downstream';
        const project = String(query.project || consumer.id).trim();
        if (project !== consumer.id) fail('INVALID_STATE', 'project must match the consumer scope');
        const kind = String(query.kind || 'module').trim();

        try {
            return await this.scoped.withConsumer(consumer.id, async (session) => {
                let coverage = 0;
                try {
                    const completeness = await session.query(
                        `SELECT value FROM completeness WHERE project = $1 AND question = 'Q1' ORDER BY measured_at DESC LIMIT 1`,
                        [project],
                    ) as any[];
                    coverage = completeness.length ? Number(completeness[0].value) : 0;
                } catch {
                    return this.unknown(consumer.id, project, target, direction, depth, 'GRAPH_NOT_BUILT');
                }
                if (coverage < 0.8) {
                    return this.unknown(consumer.id, project, target, direction, depth, 'LOW_COVERAGE', coverage);
                }

                const targets = await session.query(
                    `SELECT node_id, kind, node_key, path FROM graph_node WHERE project = $1 AND ($2 = '' OR kind = $2) AND (node_key = $3 OR path = $3) LIMIT $4`,
                    [project, kind, target, fanout],
                ) as any[];
                if (targets.length === 0) {
                    return { status: 'not-found', consumerId: consumer.id, project, target, direction, depth, coverage, nodes: [], edges: [] };
                }
                const ids = targets.map((node) => node.node_id);
                const edges = await session.query(
                    `WITH RECURSIVE walk AS (
                        SELECT e.edge_id, e.from_node_id, e.to_node_id, e.kind, e.conflict, 1 AS depth, ARRAY[e.from_node_id, e.to_node_id] AS path
                        FROM graph_edge e
                        WHERE e.project = $1 AND (($3 = 'downstream' AND e.to_node_id = ANY($2)) OR ($3 = 'upstream' AND e.from_node_id = ANY($2)))
                        UNION ALL
                        SELECT e.edge_id, e.from_node_id, e.to_node_id, e.kind, e.conflict, w.depth + 1, w.path || e.from_node_id
                        FROM graph_edge e JOIN walk w ON (($3 = 'downstream' AND e.to_node_id = w.from_node_id) OR ($3 = 'upstream' AND e.from_node_id = w.to_node_id))
                        WHERE e.project = $1 AND w.depth < $4 AND NOT e.from_node_id = ANY(w.path)
                    ) SELECT * FROM walk LIMIT $5`,
                    [project, ids, direction, depth, fanout],
                ) as any[];
                const nodeIds = [...new Set(edges.flatMap((edge) => [edge.from_node_id, edge.to_node_id]))];
                const nodes = nodeIds.length ? await session.query(
                    `SELECT node_id, kind, node_key, path FROM graph_node WHERE project = $1 AND node_id = ANY($2)`,
                    [project, nodeIds],
                ) as any[] : [];
                const authorityRank: Record<string, number> = { declared: 3, derived: 2, inferred: 1 };
                let claims: any[] = [];
                try {
                    claims = await session.query(
                        `SELECT edge_id, source_kind, claim, at FROM source_claim WHERE project = $1 AND edge_id = ANY($2) ORDER BY seq`,
                        [project, edges.map((edge) => edge.edge_id)],
                    ) as any[];
                } catch {
                    claims = [];
                }
                const enrichedEdges = edges.map((edge) => {
                    const edgeClaims = claims.filter((claim) => claim.edge_id === edge.edge_id).map((claim) => ({
                        source_kind: claim.source_kind === 'docs' ? 'declared' : claim.source_kind === 'roslyn' ? 'derived' : 'inferred',
                        claim: claim.claim,
                        at: claim.at,
                    }));
                    const authority = [...edgeClaims].sort((left, right) => (authorityRank[right.source_kind] ?? 0) - (authorityRank[left.source_kind] ?? 0))[0]?.source_kind ?? null;
                    return { ...edge, provenance: { authority, claims: edgeClaims }, conflict: Boolean(edge.conflict) };
                });
                const capped = edges.length >= fanout;
                return {
                    status: coverage < 0.9 ? 'unknown' : 'ready',
                    consumerId: consumer.id,
                    project,
                    target,
                    direction,
                    depth,
                    coverage,
                    ...(coverage < 0.9 ? { reason: 'LOW_COVERAGE' } : {}),
                    nodes,
                    edges: enrichedEdges,
                    capped,
                    totalFound: edges.length,
                };
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/relation .* does not exist|undefined_table/i.test(message)) {
                return this.unknown(consumer.id, project, target, direction, depth, 'GRAPH_NOT_BUILT');
            }
            throw error;
        }
    }

    private unknown(consumerId: string, project: string, target: string, direction: ImpactDirection, depth: number, reason: string, coverage = 0) {
        return {
            status: 'unknown',
            consumerId,
            project,
            target,
            direction,
            depth,
            coverage,
            reason,
            nodes: [],
            edges: [],
            capped: false,
            totalFound: 0,
        };
    }
}
