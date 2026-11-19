/**
 * Phase 4 M7 — team-level observatory.
 *
 * Groups host observations by trace so a third person can audit one change across hosts/workers.
 * Read-only; no run/execution state.
 */
import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

function groupTraces(observations: any[]) {
    const traces = new Map<string, any>();
    for (const observation of observations) {
        const traceId = String(observation.trace_id ?? observation.traceId ?? observation.observation_id ?? observation.observationId);
        const trace = traces.get(traceId) ?? {
            traceId,
            hosts: new Set<string>(),
            workers: new Set<string>(),
            events: [] as string[],
            outcomes: [] as string[],
            firstAt: null as string | null,
            lastAt: null as string | null,
            observations: 0,
        };
        trace.observations += 1;
        if (observation.host_id || observation.hostId) trace.hosts.add(String(observation.host_id ?? observation.hostId));
        if (observation.worker_id || observation.workerId) trace.workers.add(String(observation.worker_id ?? observation.workerId));
        if (observation.event) trace.events.push(String(observation.event));
        if (observation.outcome) trace.outcomes.push(String(observation.outcome));
        const at = observation.at ?? observation.received_at ?? observation.receivedAt ?? null;
        if (at) {
            if (!trace.firstAt || at < trace.firstAt) trace.firstAt = at;
            if (!trace.lastAt || at > trace.lastAt) trace.lastAt = at;
        }
        traces.set(traceId, trace);
    }
    return [...traces.values()].map((trace) => ({
        ...trace,
        hosts: [...trace.hosts],
        workers: [...trace.workers],
        events: [...new Set(trace.events)],
        outcomes: [...new Set(trace.outcomes)],
    }));
}

export class TeamObservatoryService {
    constructor(private readonly store: PlatformStore) {}

    async summary(consumerId: string, limit = 500) {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        const take = Math.max(1, Math.min(Number(limit) || 500, 2000));
        const observations = await this.store.listObservations(consumer.id, take);
        const traces = groupTraces(observations);
        return {
            consumerId: consumer.id,
            summary: {
                observations: observations.length,
                traces: traces.length,
                hosts: new Set(traces.flatMap((trace) => trace.hosts)).size,
                workers: new Set(traces.flatMap((trace) => trace.workers)).size,
                outcomes: traces.flatMap((trace) => trace.outcomes).reduce((map: Record<string, number>, outcome: string) => {
                    map[outcome] = (map[outcome] ?? 0) + 1;
                    return map;
                }, {}),
            },
            traces: traces.sort((left, right) => String(right.lastAt ?? '').localeCompare(String(left.lastAt ?? ''))),
        };
    }
}
