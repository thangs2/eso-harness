/**
 * AC legacy batch 5b — close US-38 (host capability probe) and US-41 (host sync).
 *
 * SCN/AC ids are pinned so RTM-LEGACY can link them directly. Temp dirs only, no network.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    HostProbeService,
    ProbeBlockedError,
    type DimensionObservation,
    type ProbeAdapter,
    type ProbeDimension,
} from '../src/modules/host-probe/index.js';
import { HostSyncService } from '../src/modules/host-sync/index.js';

const NOW = new Date('2026-11-23T00:00:00.000Z');
const fixedNow = () => new Date(NOW);

const roots: string[] = [];
function tempRoot(tag: string): string {
    const root = mkdtempSync(join(tmpdir(), `eso-batch5b-${tag}-`));
    roots.push(root);
    return root;
}
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function observation(
    dimension: ProbeDimension,
    status: DimensionObservation['status'],
    evidence: DimensionObservation['evidence'] = [],
): DimensionObservation {
    return { dimension, status, evidence };
}

/** Adapter whose behaviour is fully injected: tests own the "probe run" result. */
function adapterFor(
    entries: Partial<Record<ProbeDimension, DimensionObservation>>,
    onUnknown: (dimension: ProbeDimension) => DimensionObservation = (dimension) =>
        observation(dimension, 'unknown'),
): ProbeAdapter {
    return {
        probe: (dimension) => entries[dimension] ?? onUnknown(dimension),
    };
}

function measured(dimension: ProbeDimension, kind: string): DimensionObservation {
    return observation(dimension, 'measured', [{ kind, summary: `${dimension} captured` }]);
}

describe('AC legacy batch 5b — host capability probe (US-38)', () => {
    test('SCN-38-1 · AC-38-1 — probe 6 chiều ⇒ card có version/levels/events/evidence', async () => {
        const root = tempRoot('probe-happy');
        const adapter = adapterFor({
            observe: measured('observe', 'session-event'),
            inject: measured('inject', 'context-injected'),
            memoryRead: measured('memoryRead', 'memory-recall'),
            memoryWrite: observation('memoryWrite', 'measured', [
                { kind: 'memory-write-readback', summary: 'write then read in same session' },
                { kind: 'cross-session-retrieval', summary: 'new session recalled the memory' },
            ]),
            mcpTools: measured('mcpTools', 'tool-visible'),
            multiAgentRemoteCi: measured('multiAgentRemoteCi', 'subagent-run'),
        });

        const { card, cardPath } = await new HostProbeService({ root, now: fixedNow }).probe(
            { hostId: 'cursor', hostVersion: '0.48.0' },
            adapter,
        );

        assert.equal(cardPath, join(root, '.harness', 'host-capability.json'));
        assert.equal(existsSync(cardPath), true);
        assert.deepEqual(JSON.parse(readFileSync(cardPath, 'utf8')), card);

        assert.equal(card.host.version, '0.48.0');
        assert.equal(card.probedAt, NOW.toISOString());
        assert.equal(card.publishLevels, true);
        assert.equal(card.status, 'measured');
        assert.equal(card.levels.overall, 'L4');
        assert.deepEqual(card.levels.chain, {
            observe: 'L1',
            inject: 'L2',
            memoryRead: 'L3',
            memoryWrite: 'L4',
        });

        assert.equal(card.dimensions.length, 6);
        assert.deepEqual(
            card.dimensions.map((item) => item.dimension),
            ['observe', 'inject', 'memoryRead', 'memoryWrite', 'mcpTools', 'multiAgentRemoteCi'],
        );
        for (const dimension of card.dimensions) {
            assert.ok(dimension.evidence.length >= 1, `${dimension.dimension} must carry evidence`);
        }
        assert.ok(card.evidence.length >= 6);
        assert.equal(card.events[0].type, 'probe.started');
        assert.equal(card.events.at(-1)?.type, 'probe.completed');
        assert.equal(card.events.length, 8); // started + 6 dimensions + completed
        assert.equal(card.reason, undefined);
    });

    test('SCN-38-2 · AC-38-2 — thiếu memory ⇒ unknown/L2, không claim L4', async () => {
        const root = tempRoot('probe-no-memory');
        const noMemory = adapterFor({
            observe: measured('observe', 'session-event'),
            inject: measured('inject', 'context-injected'),
            memoryRead: observation('memoryRead', 'unknown'),
            memoryWrite: observation('memoryWrite', 'unknown'),
            mcpTools: measured('mcpTools', 'tool-visible'),
            multiAgentRemoteCi: measured('multiAgentRemoteCi', 'subagent-run'),
        });

        const { card } = await new HostProbeService({ root, now: fixedNow }).probe(
            { hostId: 'antigravity', hostVersion: '1.0.0' },
            noMemory,
        );

        assert.equal(card.levels.overall, 'L2');
        assert.notEqual(card.levels.overall, 'L4');
        assert.equal(card.levels.chain.memoryRead, 'unknown');
        assert.equal(card.levels.chain.memoryWrite, 'unknown');
        assert.equal(card.status, 'partial');
        assert.ok(card.limitations.some((line) => line.startsWith('memoryRead:')));
        assert.ok(card.limitations.some((line) => line.startsWith('memoryWrite:')));

        // A declaration without cross-session evidence still cannot claim L4.
        const claimOnly = adapterFor({
            observe: measured('observe', 'session-event'),
            inject: measured('inject', 'context-injected'),
            memoryRead: measured('memoryRead', 'memory-recall'),
            memoryWrite: observation('memoryWrite', 'measured', [
                { kind: 'memory-write-readback', summary: 'same-session readback only' },
            ]),
            mcpTools: measured('mcpTools', 'tool-visible'),
            multiAgentRemoteCi: measured('multiAgentRemoteCi', 'subagent-run'),
        });
        const claimed = await new HostProbeService({ root, now: fixedNow }).probe(
            { hostId: 'antigravity', hostVersion: '1.0.0' },
            claimOnly,
        );
        assert.equal(claimed.card.levels.overall, 'L3');
        assert.equal(claimed.card.levels.chain.memoryWrite, 'unknown');
        assert.notEqual(claimed.card.levels.overall, 'L4');
        assert.ok(claimed.card.limitations.some((line) => line.includes('cross-session')));
    });

    test('SCN-38-3 · AC-38-3 — policy chặn ⇒ PROBE_BLOCKED/unknown, không publish level', async () => {
        const root = tempRoot('probe-blocked');
        const blockedOnMemory = adapterFor(
            {
                observe: measured('observe', 'session-event'),
                inject: measured('inject', 'context-injected'),
                mcpTools: measured('mcpTools', 'tool-visible'),
            },
            (dimension) => {
                if (dimension === 'memoryRead') throw new ProbeBlockedError('policy denies memory read');
                return observation(dimension, 'unknown');
            },
        );

        const { card, cardPath } = await new HostProbeService({ root, now: fixedNow }).probe(
            { hostId: 'claude', hostVersion: '2.0.0' },
            blockedOnMemory,
        );

        assert.equal(existsSync(cardPath), true);
        assert.equal(card.status, 'unknown');
        assert.equal(card.reason, 'PROBE_BLOCKED');
        assert.equal(card.publishLevels, false);
        assert.equal(card.levels.overall, 'unknown');
        assert.deepEqual(card.levels.chain, {
            observe: 'unknown',
            inject: 'unknown',
            memoryRead: 'unknown',
            memoryWrite: 'unknown',
        });
        assert.equal(card.dimensions.find((item) => item.dimension === 'memoryRead')?.status, 'blocked');
        assert.ok(card.limitations.some((line) => line.includes('blocked by policy')));
        assert.ok(card.events.some((event) => event.type === 'probe.blocked'));
        // No published level means every rung stays unknown even though observe was measured.
        assert.equal(
            Object.values(card.levels.chain).some((level) => level !== 'unknown'),
            false,
        );
    });
});

function canonicalFixture(version = 7): { root: string } {
    const root = tempRoot('sync');
    mkdirSync(join(root, 'agents', 'rules'), { recursive: true });
    mkdirSync(join(root, '.harness'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), '# Canonical law\n\nProjected to every host.\n');
    writeFileSync(join(root, 'agents', 'rules', 'core.law.mdc'), '---\ndescription: law\n---\n\nRule body.\n');
    writeFileSync(join(root, 'agents', 'rules', 'core.style.mdc'), '---\ndescription: style\n---\n\nStyle body.\n');
    mkdirSync(join(root, 'agents', 'skills', 'demo'), { recursive: true });
    writeFileSync(join(root, 'agents', 'skills', 'demo', 'SKILL.md'), '# Demo skill\n\nSkill body.\n');
    writeFileSync(join(root, '.harness', 'config.json'), JSON.stringify({ consumerId: 'acme' }));
    writeFileSync(join(root, '.harness', 'manifest.json'), JSON.stringify({ consumerId: 'acme', version, keep: 'x' }));
    return { root };
}

describe('AC legacy batch 5b — host sync (US-41)', () => {
    test('SCN-41-1 · AC-41-1 — chọn Cursor + Claude ⇒ projection 2 host, version không đổi', async () => {
        const { root } = canonicalFixture(7);
        const result = await new HostSyncService({ now: fixedNow }).sync({
            root,
            hosts: ['cursor', 'claude'],
        });

        assert.deepEqual(result.hosts, ['claude', 'cursor']);
        assert.equal(result.projections.length, 2);
        assert.equal(result.consumerVersion, 7);
        assert.deepEqual(result.manifest.version, 7);
        assert.equal(result.manifest.keep, 'x');

        const cursorLaw = join(root, '.cursor', 'eso-harness', 'AGENTS.md');
        const claudeLaw = join(root, '.claude', 'eso-harness', 'AGENTS.md');
        assert.equal(existsSync(cursorLaw), true);
        assert.equal(existsSync(claudeLaw), true);
        assert.match(readFileSync(cursorLaw, 'utf8'), /^<!-- generated by eso host sync;/);
        assert.match(readFileSync(cursorLaw, 'utf8'), /Canonical law/);
        assert.equal(existsSync(join(root, '.cursor', 'eso-harness', 'agents', 'rules', 'core.law.mdc')), true);
        assert.equal(existsSync(join(root, '.claude', 'eso-harness', 'agents', 'rules', 'core.law.md')), true);
        assert.equal(existsSync(join(root, '.cursor', 'eso-harness', 'agents', 'skills', 'demo', 'SKILL.md')), true);

        const manifest = JSON.parse(readFileSync(join(root, '.harness', 'manifest.json'), 'utf8'));
        assert.equal(manifest.version, 7);
        assert.deepEqual(manifest.hostSync.hosts, ['claude', 'cursor']);
        assert.equal(manifest.hostSync.status, 'synced');
        assert.equal(manifest.hostSync.syncedAt, NOW.toISOString());
        assert.equal(result.manifestPath, join(root, '.harness', 'manifest.json'));
    });

    test('SCN-41-2 · AC-41-2 — thêm host ⇒ merge, file người dùng còn, version không đổi', async () => {
        const { root } = canonicalFixture(9);
        const service = new HostSyncService({ now: fixedNow });
        await service.sync({ root, hosts: ['cursor'] });

        const userFile = join(root, '.cursor', 'rules', 'user-rules.mdc');
        mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
        writeFileSync(userFile, '# user managed rule\n\nKeep me.\n');

        const result = await service.sync({ root, hosts: ['cursor', 'antigravity', 'claude'] });

        assert.deepEqual(result.hosts, ['antigravity', 'claude', 'cursor']);
        assert.equal(readFileSync(userFile, 'utf8'), '# user managed rule\n\nKeep me.\n');
        assert.equal(existsSync(join(root, '.agents', 'eso-harness', 'AGENTS.md')), true);
        assert.equal(existsSync(join(root, '.claude', 'eso-harness', 'AGENTS.md')), true);
        assert.deepEqual(
            result.projections.find((item) => item.host === 'cursor')?.preserved,
            ['rules/user-rules.mdc'],
        );

        const manifest = JSON.parse(readFileSync(join(root, '.harness', 'manifest.json'), 'utf8'));
        assert.equal(manifest.version, 9);
        assert.deepEqual(manifest.hostSync.hosts, ['antigravity', 'claude', 'cursor']);
        assert.equal(result.consumerVersion, 9);

        // A non-ESO file at an exact projection path is a conflict, never overwritten.
        const occupied = join(root, '.claude', 'eso-harness', 'AGENTS.md');
        writeFileSync(occupied, '# user owns this path\n');
        await assert.rejects(
            service.sync({ root, hosts: ['claude'] }),
            (error: any) => error.code === 'PROJECTION_CONFLICT',
        );
        assert.equal(readFileSync(occupied, 'utf8'), '# user owns this path\n');
    });

    test('SCN-41-3 · AC-41-3 — canonical thiếu/host lạ ⇒ fail closed, không ghi', async () => {
        const missing = tempRoot('sync-missing');
        mkdirSync(join(missing, 'agents', 'rules'), { recursive: true });
        mkdirSync(join(missing, '.harness'), { recursive: true });
        writeFileSync(join(missing, '.harness', 'config.json'), '{}');
        await assert.rejects(
            new HostSyncService({ now: fixedNow }).sync({ root: missing, hosts: ['cursor'] }),
            (error: any) => error.code === 'CANONICAL_MISSING',
        );
        assert.equal(existsSync(join(missing, '.cursor')), false);

        const { root } = canonicalFixture(3);
        const manifestBefore = readFileSync(join(root, '.harness', 'manifest.json'), 'utf8');
        await assert.rejects(
            new HostSyncService({ now: fixedNow }).sync({ root, hosts: ['solaris'] }),
            (error: any) => error.code === 'HOST_UNSUPPORTED',
        );
        assert.equal(existsSync(join(root, '.solaris')), false);
        assert.equal(existsSync(join(root, '.cursor')), false);
        assert.equal(existsSync(join(root, '.agents')), false);
        assert.equal(readFileSync(join(root, '.harness', 'manifest.json'), 'utf8'), manifestBefore);
    });
});
