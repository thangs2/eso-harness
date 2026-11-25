/**
 * One status/verdict tone vocabulary for the whole console.
 *
 * The list (`request-grid`) and the request-detail hero used to each carry their own mapping, so the
 * same request could be green in the list and uncoloured in the header. The hero's copy also compared
 * `status === 'completed'` case-sensitively, which never matched the host's uppercased outcome. This is
 * the single implementation; components render `tone` as a CSS class and stay presentational.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

/** Finished, progressing, or not understood — the order matters (`completed` contains `complete`). */
export function statusTone(value: string): Tone {
    const status = String(value || '').toLowerCase();
    if (status.includes('fail') || status.includes('block') || status.includes('error') || status.includes('deny')) return 'bad';
    if (status.includes('completed') || status.includes('pass') || status === 'ok' || status === 'success') return 'ok';
    if (status.includes('submitted') || status.includes('progress') || status.includes('pending') || status.includes('run')) return 'warn';
    return 'muted';
}

/** Q1 verdict level: allow = pass, partial = warn, deny = bad, unknown/missing = muted. */
export function verdictTone(value: string): Tone {
    const verdict = String(value || '').toLowerCase();
    if (verdict === 'allow') return 'ok';
    if (verdict === 'partial') return 'warn';
    if (verdict === 'deny') return 'bad';
    return 'muted';
}
