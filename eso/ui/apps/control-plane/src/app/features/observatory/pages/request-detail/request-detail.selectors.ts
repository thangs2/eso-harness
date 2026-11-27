import type { ActionEventView, ObservationDto, PipelineStepView, PreTurnGateView, RequestDetailDto, StageDetailView, UnifiedGapItem, VerdictGap } from './request-detail.models.js';
import { TAB_LABELS, missingValue } from './request-detail.models.js';

/** Pure payload → view mappings. Components never re-derive these from rendered text. */

export function toTraceEvents(events: RequestDetailDto['events']): ObservationDto[] {
    return events.map((event) => ({
        observationId: event.observationId,
        traceId: event.traceId,
        hostId: event.hostId,
        runtimeKey: event.runtimeKey,
        workerId: event.workerId,
        event: event.event,
        outcome: event.outcome,
        evidence: event.evidence,
        at: event.at,
        receivedAt: event.at,
    }));
}

/**
 * The same 8 system stages as flow cards. A step whose remaining subcards are all absent is
 * flagged `empty` and renders one line until the reader expands it.
 */
/**
 * Payloads that predate `evidenced` still reach the page, so absence falls back to the old
 * inspection of the sub-card values. That is a compatibility path only: when the stage declares
 * the flag, the flag wins and the string scan never runs (one definition, not two).
 */
function stageIsEmpty(stage: RequestDetailDto['systemStages'][number], subcards: StageDetailView[]): boolean {
    if (typeof stage.evidenced === 'boolean') return !stage.evidenced;
    return subcards.length === 0 || subcards.every((detail) => missingValue(detail.value));
}

export function toFlowSteps(stages: RequestDetailDto['systemStages']): PipelineStepView[] {
    return stages.map((stage) => {
        const lawValue = stage.details.find((detail) => detail.label === 'Law')?.value ?? 'not captured';
        const subcards = stage.id === 'intake-law' && stage.details.length >= 3
            ? stage.details
            : (stage.id === 'intake-law' ? stage.details.filter((detail) => detail.label === 'Law') : stage.details);
        const tab = stage.tab as keyof typeof TAB_LABELS;
        return {
            id: stage.id,
            stepNumber: stage.stepNumber,
            label: stage.title,
            status: stage.status,
            sub: stage.sub ? stage.sub : (stage.id === 'intake-law' ? (missingValue(lawValue) ? 'law not captured' : lawValue) : 'not captured'),
            subcards,
            empty: stageIsEmpty(stage, subcards),
            evidenced: typeof stage.evidenced === 'boolean' ? stage.evidenced : null,
            tab,
            tabLabel: TAB_LABELS[tab] ?? 'Evidence',
        };
    });
}

/** Q4 — only the events the host actually reported as actions, with no inferred fields. */
export function toActionEvents(events: RequestDetailDto['events']): ActionEventView[] {
    return events
        .filter((event) => event.event === 'action.recorded')
        .map((event) => {
            const evidence = (event.evidence ?? {}) as Record<string, unknown>;
            const files = Array.isArray(evidence['files']) ? evidence['files'].map(String) : [];
            const readBeforeEdit = evidence['readBeforeEdit'];
            const diffRef = evidence['diffRef'];
            const tool = typeof evidence['tool'] === 'string' ? evidence['tool'].trim() : '';
            const outcome = typeof evidence['outcome'] === 'string' ? evidence['outcome'].trim() : '';
            return {
                id: event.observationId,
                tool: tool || 'tool not recorded',
                outcome: outcome || 'outcome not recorded',
                filesCount: files.length,
                readBeforeEdit: readBeforeEdit === true ? 'yes' : readBeforeEdit === false ? 'no' : 'not captured',
                diffRef: typeof diffRef === 'string' && diffRef.trim() ? diffRef.trim() : 'not captured',
            };
        });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizePreTurnGap(item: unknown, index: number): UnifiedGapItem | null {
    if (typeof item === 'string') {
        const text = item.trim();
        return text
            ? { domain: 'pre', code: `PRE_GAP_${index + 1}`, what: text, consequence: 'Pre-turn gate flagged an unmet requirement.' }
            : null;
    }
    if (!isObjectRecord(item)) return null;
    const code = nonEmptyString(item['code']) || nonEmptyString(item['id']) || nonEmptyString(item['kind']) || `PRE_GAP_${index + 1}`;
    const what = nonEmptyString(item['what'])
        || nonEmptyString(item['reason'])
        || nonEmptyString(item['message'])
        || nonEmptyString(item['requirement'])
        || nonEmptyString(item['question'])
        || code;
    const where = nonEmptyString(item['where']) || nonEmptyString(item['path']) || nonEmptyString(item['field']) || undefined;
    const consequence = nonEmptyString(item['consequence'])
        || nonEmptyString(item['impact'])
        || nonEmptyString(item['action'])
        || 'Pre-turn gate flagged an unmet requirement.';
    return {
        domain: 'pre',
        code,
        what,
        ...(where ? { where } : {}),
        consequence,
    };
}

/** Post-turn verdict gaps mapped into the unified read-model shape. */
export function toPostTurnGaps(gaps: ReadonlyArray<VerdictGap>): UnifiedGapItem[] {
    return (gaps ?? []).map((gap) => ({
        domain: 'post',
        code: gap.code,
        what: gap.what,
        consequence: gap.consequence,
    }));
}

/** Pre-turn gate summary extracted from the latest trace observation carrying `evidence.judgment`. */
export function toPreTurnGate(events: RequestDetailDto['events']): PreTurnGateView | null {
    for (let i = (events?.length ?? 0) - 1; i >= 0; i -= 1) {
        const evidence = isObjectRecord(events[i]?.evidence) ? events[i].evidence : null;
        const judgment = evidence && isObjectRecord(evidence['judgment']) ? evidence['judgment'] : null;
        if (!judgment) continue;

        const nestedVerdict = isObjectRecord(judgment['verdict']) ? judgment['verdict'] : null;
        const level = nonEmptyString(judgment['level']) || nonEmptyString(nestedVerdict?.['level']) || 'unknown';
        const decision = nonEmptyString(judgment['decision']) || (judgment['wouldBlock'] === true ? 'block' : 'unknown');
        const enforcement = nonEmptyString(judgment['enforcement']) || 'not recorded';

        let rawGaps: unknown[] = [];
        if (Array.isArray(judgment['gaps'])) {
            rawGaps = judgment['gaps'];
        } else if (isObjectRecord(judgment['gaps']) && Array.isArray(judgment['gaps']['gap_items'])) {
            rawGaps = judgment['gaps']['gap_items'];
        } else if (Array.isArray(nestedVerdict?.['gaps'])) {
            rawGaps = nestedVerdict['gaps'];
        }

        const gaps = rawGaps
            .map((item, index) => normalizePreTurnGap(item, index))
            .filter((item): item is UnifiedGapItem => item !== null);

        return { level, decision, enforcement, gaps };
    }
    return null;
}
