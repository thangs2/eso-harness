/**
 * Prompt construction — host-side, from the ESO config snapshot + the user's prompt.
 *
 * The prompt is built for the worker the flow selected: worker definition (host-neutral), flow
 * context and the user's request. No token, no secret and no ESO run concept is included.
 */

import type { SnapshotFlow, SnapshotPlacement, SnapshotWorker } from './config-client';

export interface PromptInput {
    consumerId: string;
    runtimeKey: string;
    flow: SnapshotFlow | null;
    worker: SnapshotWorker;
    placement: SnapshotPlacement;
    model: string;
    adapter: string;
    userPrompt: string;
    hostStep: number;
    maxSteps: number;
    taskType?: string;
}

function list(value: string[] | undefined): string {
    return Array.isArray(value) && value.length ? value.join(', ') : 'none';
}

function barText(bar: unknown[] | undefined): string {
    if (!Array.isArray(bar) || !bar.length) return 'none';
    return bar
        .map((item) => {
            if (!item || typeof item !== 'object') return String(item);
            const record = item as Record<string, unknown>;
            return [record.kind, record.metric, record.op, record.value].filter((part) => part !== undefined && part !== '').join(' ');
        })
        .join('; ');
}

/** The final line contract the adapter output is read for (see evidence.deriveOutcome). */
export const OUTCOME_CONTRACT = 'OUTCOME: PASS|FAIL|BLOCKED';
export const EVIDENCE_REPORT_CONTRACT = 'EVIDENCE_JSON: {"tools":[],"files":[],"recon":[]}';

/** Deterministic prompt text: same snapshot + same user prompt => same bytes. */
export function buildPrompt(input: PromptInput): string {
    const worker = input.worker;
    const flow = input.flow;
    const placement = input.placement;
    const source = flow
        ? `${flow.id}${flow.version !== undefined ? ` v${flow.version}` : ''}${flow.name ? ` — ${flow.name}` : ''}`
        : 'unpublished flow';

    const task = (input.taskType || flow?.taskType || 'build').toLowerCase();
    const taskRules = task === 'audit'
        ? [
            'Task type: audit (read-only).',
            'Do NOT edit files or run mutating commands.',
            'Inspect the repository and report findings with evidence.',
            'If the task is not acceptable, end with OUTCOME: FAIL; a human decides next.',
        ]
        : task === 'verify'
            ? ['Task type: verify. Run checks; do not implement features.']
            : ['Task type: build. Edit only within the worker scope and report evidence.'];
    const roleRule = ['gate'].includes(String(worker.layer))
        ? 'This is a gate worker: evaluate, do not implement.'
        : 'This is a peer worker: work only inside your declared scope.';
    return [
        `You are worker ${worker.id}${worker.name ? ` (${worker.name})` : ''}.`,
        `Role: ${worker.role ?? 'unspecified'} · layer: ${worker.layer ?? 'unspecified'} · status: ${worker.status ?? 'unspecified'}`,
        `Scope: ${worker.scope ?? 'unspecified'}`,
        `Capabilities: ${list(worker.capabilities)}`,
        `Verbs: ${list(worker.verbs)}`,
        `Quality bar: ${barText(worker.bar)}`,
        `Escalation: ${worker.escalation ?? 'unspecified'}`,
        '',
        ...taskRules,
        roleRule,
        '',
        '## Context',
        `Consumer: ${input.consumerId}`,
        `Host runtime: ${input.runtimeKey}`,
        `Flow: ${source} (step ${input.hostStep}/${input.maxSteps})`,
        `Placement: tier=${placement.modelTier ?? 'unspecified'} · fallback=${placement.fallback ?? 'unspecified'}`,
        `Model: ${input.model} · adapter: ${input.adapter}`,
        '',
        '## Worker instructions',
        worker.instructions?.trim() || 'No worker instructions were published in the config snapshot.',
        '',
        '## User request',
        input.userPrompt,
        '',
        '## Reply contract',
        'Work on the user request as this worker. Do not start other workers; the host runtime advances the flow.',
        '',
        '## Evidence report',
        'Before the OUTCOME line, add exactly one line with real operations you performed:',
        EVIDENCE_REPORT_CONTRACT,
        'Fill arrays with actual tool/file/recon names and counts. Do not invent. Empty arrays if unknown.',
        '',
        `End your reply with exactly one line: ${OUTCOME_CONTRACT}`,
    ].join('\n');
}

/** Short prompt fingerprint for logs/evidence (never the prompt body). */
export async function promptFingerprint(prompt: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
}
