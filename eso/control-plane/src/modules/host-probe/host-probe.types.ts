/**
 * F-30 / US-38 — host capability probe domain types.
 *
 * A capability level is only ever derived from evidence the probe collected in this run.
 * Documents, README claims and adapter self-declarations are not evidence (BR-22 / D-121).
 */

/** Six probe dimensions from FRD F-30 §2 / D-121. */
export const PROBE_DIMENSIONS = [
    'observe',
    'inject',
    'memoryRead',
    'memoryWrite',
    'mcpTools',
    'multiAgentRemoteCi',
] as const;

export type ProbeDimension = (typeof PROBE_DIMENSIONS)[number];

export type DimensionStatus = 'measured' | 'partial' | 'unknown' | 'blocked';

/** `unknown` means "not proven", never a silent alias for a low level. */
export type CapabilityLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'unknown';

export interface ProbeEvidenceInput {
    /** e.g. `session-event`, `context-injected`, `memory-recall`, `cross-session-retrieval`. */
    kind: string;
    summary: string;
    /** Evidence location relative to the consumer root; never a secret. */
    path?: string;
    /** Optional digest of the captured artefact. */
    digest?: string;
}

export interface ProbeEvidence extends ProbeEvidenceInput {
    id: string;
    dimension: ProbeDimension;
}

export interface DimensionObservation {
    dimension: ProbeDimension;
    status: DimensionStatus;
    evidence?: ProbeEvidenceInput[];
    detail?: string;
}

/**
 * Injectable probe executor. The caller supplies whatever actually runs the scripted session
 * (host adapter, plugin, or a fixture in tests); the service never spawns a host process.
 */
export interface ProbeAdapter {
    probe(dimension: ProbeDimension): DimensionObservation | Promise<DimensionObservation>;
}

export interface HostDescriptor {
    hostId: string;
    hostVersion: string;
}

export interface ProbeEvent {
    seq: number;
    at: string;
    type: 'probe.started' | 'probe.dimension' | 'probe.blocked' | 'probe.completed';
    dimension?: ProbeDimension;
    detail?: string;
}

export interface DimensionResult {
    dimension: ProbeDimension;
    status: DimensionStatus;
    evidence: ProbeEvidence[];
    limitation?: string;
}

export interface ProbeLevels {
    overall: CapabilityLevel;
    /** The four rungs of the L0–L4 ladder; a rung is `unknown` unless proven this run. */
    chain: {
        observe: CapabilityLevel;
        inject: CapabilityLevel;
        memoryRead: CapabilityLevel;
        memoryWrite: CapabilityLevel;
    };
}

export interface HostCapabilityCard {
    schemaVersion: 1;
    host: { id: string; version: string };
    probedAt: string;
    status: 'measured' | 'partial' | 'unknown';
    /** Refusal reason from FRD F-30 §5, absent on a clean measured card. */
    reason?: 'PROBE_BLOCKED' | 'INSUFFICIENT_EVIDENCE';
    /** False when policy blocked the probe: the UI must not enable a source. */
    publishLevels: boolean;
    levels: ProbeLevels;
    dimensions: DimensionResult[];
    events: ProbeEvent[];
    evidence: ProbeEvidence[];
    limitations: string[];
}

/** Minimal filesystem port so the service is deterministic and unit-testable. */
export interface ProbeFileSystem {
    mkdirp(path: string): void;
    writeFile(path: string, content: string): void;
    exists(path: string): boolean;
}

export interface HostProbeOptions {
    /** Consumer root; card defaults to `<root>/.harness/host-capability.json`. */
    root?: string;
    /** Explicit card path (absolute or root-relative). */
    outFile?: string;
    io?: ProbeFileSystem;
    now?: () => Date;
}

export interface HostProbeResult {
    card: HostCapabilityCard;
    cardPath: string;
}

/** Raised by a probe adapter when policy forbids the measurement. */
export class ProbeBlockedError extends Error {
    constructor(message = 'Host probe blocked by policy') {
        super(message);
        this.name = 'ProbeBlockedError';
    }
}
