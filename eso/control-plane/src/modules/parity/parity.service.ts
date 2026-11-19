/**
 * Phase 4 M6 — host parity metric.
 *
 * Policy and outcome are the gate. Evidence parity is diagnostic only (host capability can differ).
 */
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

function normalizeRun(run: any, label: string) {
    if (!run || typeof run !== 'object') fail('INVALID_STATE', `${label} run is required`);
    const outcome = String(run.outcome || '').toUpperCase();
    if (!['PASS', 'FAIL', 'BLOCKED'].includes(outcome)) fail('INVALID_STATE', `${label}.outcome must be PASS|FAIL|BLOCKED`);
    return {
        hostId: String(run.hostId || ''),
        runtimeKey: String(run.runtimeKey || ''),
        flowId: String(run.flowId || ''),
        workerId: String(run.workerId || ''),
        outcome,
        policy: run.policy ?? {},
        evidence: run.evidence ?? {},
    };
}

export class ParityService {
    constructor(private readonly store: PlatformStore) {}

    async compare(consumerId: string, input: any) {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const left = normalizeRun(input?.left, 'left');
        const right = normalizeRun(input?.right, 'right');
        const policyParity = canonical(left.policy) === canonical(right.policy);
        const outcomeParity = left.outcome === right.outcome;
        const evidenceParity = canonical(left.evidence) === canonical(right.evidence);
        return {
            consumerId: consumer.id,
            gate: policyParity && outcomeParity,
            policyParity,
            outcomeParity,
            evidenceParity,
            left,
            right,
            diffs: {
                policy: policyParity ? [] : ['policy differs'],
                outcome: outcomeParity ? [] : [`${left.outcome} != ${right.outcome}`],
                evidence: evidenceParity ? [] : ['evidence differs (diagnostic only)'],
            },
            note: 'policy + outcome are the gate; evidence parity is diagnostic',
        };
    }
}
