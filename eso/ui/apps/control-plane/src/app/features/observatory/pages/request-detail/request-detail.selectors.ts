import type { ActionEventView, ObservationDto, PipelineStepView, RequestDetailDto } from './request-detail.models.js';
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
export function toFlowSteps(stages: RequestDetailDto['systemStages']): PipelineStepView[] {
    return stages.map((stage) => {
        const lawValue = stage.details.find((detail) => detail.label === 'Law')?.value ?? 'not captured';
        const subcards = stage.id === 'intake-law'
            ? stage.details.filter((detail) => detail.label === 'Law')
            : stage.details;
        const tab = stage.tab as keyof typeof TAB_LABELS;
        return {
            id: stage.id,
            stepNumber: stage.stepNumber,
            label: stage.title,
            status: stage.status,
            sub: stage.id === 'intake-law' ? (missingValue(lawValue) ? 'law not captured' : lawValue) : stage.sub,
            subcards,
            empty: subcards.length === 0 || subcards.every((detail) => missingValue(detail.value)),
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
