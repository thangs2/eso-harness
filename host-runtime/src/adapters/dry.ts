/**
 * Dry adapter — no spawn, no model, deterministic.
 *
 * Used by `--dry-run` and by the integration smoke. It still produces a real observation; that is
 * what makes the dry path verifiable end-to-end without calling a model.
 */

import type { AdapterRequest, AdapterResult, HostAdapter } from './types';

export class DryAdapter implements HostAdapter {
    readonly name = 'dry';

    async run(request: AdapterRequest): Promise<AdapterResult> {
        const promptBytes = new TextEncoder().encode(request.prompt).length;
        // Deterministic on purpose: no timestamps, no randomness, no prompt body echoed.
        const stdout = [
            `[dry] adapter=dry worker=${request.workerId} model=${request.model}`,
            `[dry] prompt-bytes=${promptBytes} executed=false`,
            'OUTCOME: PASS',
            '',
        ].join('\n');

        return {
            adapter: this.name,
            command: null,
            ok: true,
            exitCode: 0,
            stdout,
            stderr: '',
            durationMs: 0,
            timedOut: false,
            blocked: false,
            dry: true,
        };
    }
}
