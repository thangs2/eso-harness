import { describe, expect, it } from 'bun:test';
import { entryWorkerId, flowWorkerIds, nextEdge, nextWorkerId } from '../src/flow-engine';
import type { SnapshotFlow } from '../src/config-client';

function flow(overrides: Partial<SnapshotFlow> = {}): SnapshotFlow {
    return {
        id: 'f',
        nodes: [{ workerId: 'a' }, { workerId: 'b' }, { workerId: 'c' }],
        edges: [
            { id: 'e-a-b', from: 'a', to: 'b', on: 'PASS', condition: { kind: 'outcome', equals: 'PASS' }, priority: 0 },
            { id: 'e-b-c', from: 'b', to: 'c', on: 'PASS', priority: 0 },
            { id: 'e-b-a', from: 'b', to: 'a', on: 'FAIL', priority: 0 },
        ],
        ...overrides,
    };
}

describe('flow-engine', () => {
    it('finds the entry worker (node no edge points at)', () => {
        expect(entryWorkerId(flow())).toBe('a');
        expect(entryWorkerId(null)).toBe(null);
        expect(entryWorkerId({ id: 'empty', nodes: [], edges: [] })).toBe(null);
    });

    it('matches edges on the worker outcome', () => {
        expect(nextEdge(flow(), 'b', 'PASS')?.to).toBe('c');
        expect(nextEdge(flow(), 'b', 'FAIL')?.to).toBe('a');
        expect(nextEdge(flow(), 'b', 'BLOCKED')).toBe(null);
        expect(nextEdge(flow(), 'zzz', 'PASS')).toBe(null);
        expect(nextWorkerId(flow(), 'a', 'PASS')).toBe('b');
    });

    it('honours condition.equals when `on` is absent', () => {
        const custom = flow({ edges: [{ id: 'e', from: 'a', to: 'c', condition: { kind: 'outcome', equals: 'PASS' } }] });
        expect(nextEdge(custom, 'a', 'PASS')?.to).toBe('c');
    });

    it('sorts by priority then declaration order', () => {
        const custom = flow({
            edges: [
                { id: 'late', from: 'a', to: 'b', on: 'PASS', priority: 5 },
                { id: 'early', from: 'a', to: 'c', on: 'PASS', priority: 1 },
                { id: 'tie', from: 'a', to: 'b', on: 'PASS', priority: 1 },
            ],
        });
        expect(nextEdge(custom, 'a', 'PASS')?.id).toBe('early');
    });

    it('returns declared worker ids in node order', () => {
        expect(flowWorkerIds(flow())).toEqual(['a', 'b', 'c']);
        expect(flowWorkerIds(null)).toEqual([]);
    });
});
