import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { PlatformError } from '../../platform/registry/errors.js';
import {
    PROBE_DIMENSIONS,
    ProbeBlockedError,
    type CapabilityLevel,
    type DimensionObservation,
    type DimensionResult,
    type DimensionStatus,
    type HostCapabilityCard,
    type HostDescriptor,
    type HostProbeOptions,
    type HostProbeResult,
    type ProbeAdapter,
    type ProbeDimension,
    type ProbeEvent,
    type ProbeEvidence,
    type ProbeFileSystem,
} from './host-probe.types.js';

/**
 * F-30 / US-38 / AC-38 — host capability probe.
 *
 * ESO is a sidecar: this service does **not** start, chat with or execute a host. The caller
 * injects a `ProbeAdapter` that ran the scripted session on the host; this service only records
 * what that run actually produced and derives a level from evidence.
 *
 * Invariants:
 * - a level is derived only from evidence collected in this run;
 * - missing memory ⇒ `unknown` / L2 at most, never a claim of L4;
 * - a policy block ⇒ `PROBE_BLOCKED`, `overall: unknown`, `publishLevels: false` (fail closed).
 */

const DIMENSION_ORDER: readonly ProbeDimension[] = PROBE_DIMENSIONS;

/** The L0–L4 rung each chain dimension can prove. */
const RUNG: Partial<Record<ProbeDimension, CapabilityLevel>> = {
    observe: 'L1',
    inject: 'L2',
    memoryRead: 'L3',
    memoryWrite: 'L4',
};

const CROSS_SESSION_KIND = 'cross-session-retrieval';

const defaultIo: ProbeFileSystem = {
    mkdirp(path: string): void {
        mkdirSync(path, { recursive: true });
    },
    writeFile(path: string, content: string): void {
        writeFileSync(path, content, 'utf8');
    },
    exists(path: string): boolean {
        return existsSync(path);
    },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEvidence(
    hostId: string,
    dimension: ProbeDimension,
    input: unknown,
): ProbeEvidence[] {
    if (!Array.isArray(input)) return [];
    const evidence: ProbeEvidence[] = [];
    for (const raw of input) {
        if (!isRecord(raw)) continue;
        const kind = typeof raw.kind === 'string' ? raw.kind.trim() : '';
        const summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
        if (!kind || !summary) continue;
        const item: ProbeEvidence = {
            id: `${hostId}:${dimension}:${kind}:${evidence.length + 1}`,
            dimension,
            kind,
            summary,
        };
        if (typeof raw.path === 'string' && raw.path.trim()) item.path = raw.path.trim();
        if (typeof raw.digest === 'string' && raw.digest.trim()) item.digest = raw.digest.trim();
        evidence.push(item);
    }
    return evidence;
}

function normalizeObservation(
    hostId: string,
    value: DimensionObservation,
    expected: ProbeDimension,
): { dimension: ProbeDimension; status: DimensionStatus; evidence: ProbeEvidence[]; detail?: string } {
    const status: DimensionStatus =
        value?.status === 'measured' || value?.status === 'partial' || value?.status === 'blocked'
            ? value.status
            : 'unknown';
    const result: { dimension: ProbeDimension; status: DimensionStatus; evidence: ProbeEvidence[]; detail?: string } = {
        dimension: expected,
        status,
        evidence: status === 'measured' || status === 'partial'
            ? normalizeEvidence(hostId, expected, value?.evidence)
            : [],
    };
    if (typeof value?.detail === 'string' && value.detail.trim()) result.detail = value.detail.trim();
    return result;
}

export class HostProbeService {
    private readonly io: ProbeFileSystem;
    private readonly now: () => Date;

    constructor(private readonly options: HostProbeOptions = {}) {
        this.io = options.io ?? defaultIo;
        this.now = options.now ?? (() => new Date());
    }

    /**
     * Run the 6 dimensions sequentially (deterministic order), derive levels, write the card.
     * A blocked probe still writes a card so the limitation is auditable.
     */
    async probe(host: HostDescriptor, adapter: ProbeAdapter): Promise<HostProbeResult> {
        const hostId = typeof host?.hostId === 'string' ? host.hostId.trim() : '';
        const hostVersion = typeof host?.hostVersion === 'string' ? host.hostVersion.trim() : '';
        if (!hostId || !hostVersion) {
            throw new PlatformError('HOST_UNSUPPORTED', 'host id and version are required');
        }

        const at = this.now().toISOString();
        const events: ProbeEvent[] = [];
        const pushEvent = (type: ProbeEvent['type'], dimension?: ProbeDimension, detail?: string): void => {
            events.push({ seq: events.length + 1, at, type, ...(dimension ? { dimension } : {}), ...(detail ? { detail } : {}) });
        };

        pushEvent('probe.started', undefined, `${hostId}@${hostVersion}`);

        const dimensions: DimensionResult[] = [];
        let blockedDetail: string | undefined;

        for (const dimension of DIMENSION_ORDER) {
            let observation: ReturnType<typeof normalizeObservation>;
            try {
                const raw = await adapter.probe(dimension);
                observation = normalizeObservation(hostId, raw, dimension);
            } catch (error) {
                if (error instanceof ProbeBlockedError) {
                    observation = { dimension, status: 'blocked', evidence: [] };
                    blockedDetail = error.message;
                } else {
                    observation = {
                        dimension,
                        status: 'unknown',
                        evidence: [],
                        detail: error instanceof Error ? error.message : 'probe failed',
                    };
                }
            }

            if (observation.status === 'blocked') {
                blockedDetail = blockedDetail ?? observation.detail ?? `${dimension} probe blocked by policy`;
            }

            const result: DimensionResult = {
                dimension: observation.dimension,
                status: observation.status,
                evidence: observation.evidence,
            };
            if (observation.detail) result.limitation = observation.detail;
            dimensions.push(result);
            pushEvent('probe.dimension', dimension, observation.status);
        }

        const blocked = Boolean(blockedDetail);
        const limitations: string[] = [];
        for (const result of dimensions) {
            if (result.status === 'unknown' && !result.limitation) result.limitation = 'not measured';
            if (result.status === 'partial' && !result.limitation) result.limitation = 'partial evidence';
            if (result.limitation) limitations.push(`${result.dimension}: ${result.limitation}`);
        }

        if (blocked) {
            pushEvent('probe.blocked', undefined, blockedDetail);
        }

        const evidence = dimensions.flatMap((item) => item.evidence);
        const levels = blocked
            ? {
                overall: 'unknown' as const,
                chain: {
                    observe: 'unknown' as const,
                    inject: 'unknown' as const,
                    memoryRead: 'unknown' as const,
                    memoryWrite: 'unknown' as const,
                },
            }
            : this.levels(dimensions, limitations);

        if (blocked) limitations.unshift('probe blocked by policy; no capability level published');

        const everyDimensionMeasured = dimensions.every((item) => item.status === 'measured');
        const status: HostCapabilityCard['status'] = blocked || levels.overall === 'unknown'
            ? 'unknown'
            : everyDimensionMeasured
                ? 'measured'
                : 'partial';

        const card: HostCapabilityCard = {
            schemaVersion: 1,
            host: { id: hostId, version: hostVersion },
            probedAt: at,
            status,
            publishLevels: !blocked && levels.overall !== 'unknown',
            levels,
            dimensions,
            events,
            evidence,
            limitations,
        };
        if (blocked) card.reason = 'PROBE_BLOCKED';
        else if (levels.overall === 'unknown') card.reason = 'INSUFFICIENT_EVIDENCE';

        pushEvent('probe.completed', undefined, `level=${card.levels.overall} status=${card.status}`);

        const cardPath = this.cardPath();
        this.io.mkdirp(dirname(cardPath));
        this.io.writeFile(cardPath, `${JSON.stringify(card, null, 2)}\n`);

        return { card, cardPath };
    }

    /**
     * Backwards-compatible alias used by callers that name the operation after the artifact.
     */
    async run(host: HostDescriptor, adapter: ProbeAdapter): Promise<HostProbeResult> {
        return this.probe(host, adapter);
    }

    private cardPath(): string {
        if (this.options.outFile) {
            return isAbsolute(this.options.outFile)
                ? this.options.outFile
                : join(this.options.root ?? process.cwd(), this.options.outFile);
        }
        return join(this.options.root ?? process.cwd(), '.harness', 'host-capability.json');
    }

    /**
     * Contiguous ladder: a rung is proven only by `measured` status **with** evidence.
     * L4 additionally requires cross-session retrieval evidence, not merely a write/readback.
     */
    private levels(dimensions: DimensionResult[], limitations: string[]): HostCapabilityCard['levels'] {
        const byDimension = new Map(dimensions.map((item) => [item.dimension, item]));
        const proven = (dimension: ProbeDimension): boolean => {
            const result = byDimension.get(dimension);
            return result?.status === 'measured' && result.evidence.length > 0;
        };

        const observe = proven('observe') ? RUNG.observe! : 'unknown';
        const inject = proven('inject') ? RUNG.inject! : 'unknown';
        const memoryRead = proven('memoryRead') ? RUNG.memoryRead! : 'unknown';

        const memoryWriteResult = byDimension.get('memoryWrite');
        const hasWriteEvidence = proven('memoryWrite');
        const hasCrossSession = Boolean(
            memoryWriteResult?.evidence.some((item) => item.kind === CROSS_SESSION_KIND),
        );
        if (hasWriteEvidence && !hasCrossSession) {
            limitations.push('memoryWrite: no cross-session retrieval evidence; L4 not proven');
        }
        const memoryWrite = hasWriteEvidence && hasCrossSession ? RUNG.memoryWrite! : 'unknown';

        let overall: CapabilityLevel;
        if (observe !== 'L1') overall = 'unknown';
        else if (inject !== 'L2') overall = 'L1';
        else if (memoryRead !== 'L3') overall = 'L2';
        else if (memoryWrite !== 'L4') overall = 'L3';
        else overall = 'L4';

        const anyMeasured = dimensions.some((item) => item.status === 'measured' || item.status === 'partial');
        if (overall === 'unknown') {
            // No observe evidence means the ladder cannot start: report `unknown`, not `L0`.
            if (anyMeasured) limitations.push('observe evidence missing; no capability level published');
            else limitations.push('no dimension was measured');
        } else if (overall !== 'L4' && proven('observe')) {
            limitations.push(`level capped at ${overall} by missing evidence`);
        }

        return { overall, chain: { observe, inject, memoryRead, memoryWrite } };
    }
}
