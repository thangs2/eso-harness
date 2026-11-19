/**
 * Host-side judgment gate client.
 *
 * ESO computes the verdict; the host consumes it BEFORE the adapter runs. The host never computes
 * sufficiency itself and never turns cannot-judge into allow.
 */
import type { FetchLike } from './config-client';

export interface JudgmentGateOptions {
    requirements: unknown[];
    answers?: unknown[] | Record<string, unknown>;
    enforcement?: 'shadow' | 'enforce';
    mode?: string;
    flowId?: string;
    workerId?: string;
    intent?: string;
}

export interface JudgmentGateResult {
    level: string;
    decision: 'allow' | 'block';
    wouldBlock: boolean;
    mode: string;
    enforcement: 'shadow' | 'enforce';
    totalGaps: number;
}

export class JudgmentClientError extends Error {
    readonly code = 'JUDGMENT_UNAVAILABLE';

    constructor(message: string) {
        super(message);
        this.name = 'JudgmentClientError';
    }
}

export async function evaluateJudgment(input: {
    baseUrl: string;
    consumer: string;
    token?: string;
    fetchImpl?: FetchLike;
    options: JudgmentGateOptions;
}): Promise<JudgmentGateResult> {
    const fetcher = input.fetchImpl ?? fetch;
    const response = await fetcher(`${input.baseUrl}/api/v1/consumers/${encodeURIComponent(input.consumer)}/sufficiency`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
        },
        body: JSON.stringify({
            requirements: input.options.requirements,
            answers: input.options.answers ?? [],
            enforcement: input.options.enforcement ?? 'shadow',
            ...(input.options.mode ? { mode: input.options.mode } : {}),
            ...(input.options.flowId ? { flowId: input.options.flowId } : {}),
            ...(input.options.workerId ? { workerId: input.options.workerId } : {}),
            ...(input.options.intent ? { intent: input.options.intent } : {}),
        }),
    });
    if (!response.ok) throw new JudgmentClientError(`judgment HTTP ${response.status}`);
    const body = await response.json() as any;
    if (!body?.verdict || typeof body.verdict.level !== 'string') throw new JudgmentClientError('judgment response missing verdict');
    return {
        level: body.verdict.level,
        decision: body.decision === 'block' ? 'block' : 'allow',
        wouldBlock: Boolean(body.wouldBlock),
        mode: String(body.verdict.mode ?? 'block'),
        enforcement: body.enforcement === 'enforce' ? 'enforce' : 'shadow',
        totalGaps: Number(body.gaps?.total_gaps ?? 0),
    };
}
