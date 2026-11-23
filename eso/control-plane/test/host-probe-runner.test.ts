/**
 * CR-012 end-to-end: host-side runner builds a card from evidence files, control-plane validates it.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryPlatformStore } from '../src/platform/registry/store.js';
import { AuthService } from '../src/common/auth/auth.js';
import { createPlatformServer } from '../src/common/http/server.js';
import { buildCard, upload } from '../../../tools/host-probe-runner/probe-runner.mjs';

const roots: string[] = [];
const servers: any[] = [];
afterEach(async () => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    for (const app of servers.splice(0)) await app.close();
});

function root(files: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), 'eso-probe-runner-'));
    roots.push(dir);
    mkdirSync(join(dir, '.harness', 'probe'), { recursive: true });
    for (const [name, value] of Object.entries(files)) {
        writeFileSync(join(dir, '.harness', 'probe', `${name}.json`), JSON.stringify(value));
    }
    return dir;
}

const measured = (kind = 'session-event') => ({ status: 'measured', evidence: [{ kind, summary: 'captured' }] });

async function server() {
    const app = await createPlatformServer({
        store: new MemoryPlatformStore(),
        auth: new AuthService({ user: 'operator', password: 'secret', token: 'token' }),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    servers.push(app);
    return `http://127.0.0.1:${(app.server.address() as any).port}`;
}

describe('CR-012 host probe runner', () => {
    test('evidence observe+inject ⇒ L2 và upload 200', async () => {
        const dir = root({ observe: measured(), inject: measured('context-injected') });
        const card = buildCard({ hostId: 'cursor', hostVersion: '0.45.0', root: dir });
        assert.equal(card.levels.overall, 'L2');
        assert.equal(card.publishLevels, true);

        const base = await server();
        const result = await upload({ baseUrl: base, consumerId: 'demo', hostId: 'cursor', card, user: 'operator', password: 'secret' });
        assert.equal(result.status, 200);
        assert.equal((result.body as any).levels.overall, 'L2');
    });

    test('memoryWrite không có cross-session ⇒ không lên L4, có limitation', () => {
        const dir = root({
            observe: measured(),
            inject: measured('context-injected'),
            memoryRead: measured('memory-recall'),
            memoryWrite: measured('memory-write'),
        });
        const card = buildCard({ hostId: 'cursor', hostVersion: '0.45.0', root: dir });
        assert.equal(card.levels.overall, 'L3');
        assert.equal(card.levels.chain.memoryWrite, 'L3');
        assert.ok(card.limitations.some((line: string) => line.includes('cross-session')));
    });

    test('blocked ⇒ publishLevels=false, overall unknown, KHÔNG claim level', async () => {
        const dir = root({ observe: measured(), blocked: { reason: 'policy forbids probe' } });
        const card = buildCard({ hostId: 'cursor', hostVersion: '0.45.0', root: dir });
        assert.equal(card.publishLevels, false);
        assert.equal(card.levels.overall, 'unknown');
        assert.equal(card.reason, 'PROBE_BLOCKED');

        const base = await server();
        const result = await upload({ baseUrl: base, consumerId: 'demo', hostId: 'cursor', card, user: 'operator', password: 'secret' });
        assert.equal(result.status, 200);
    });

    test('evidence thiếu ⇒ dimension hạ unknown, không bịa level', () => {
        const dir = root({ observe: { status: 'measured', evidence: [] } });
        const card = buildCard({ hostId: 'cursor', hostVersion: '0.45.0', root: dir });
        assert.equal(card.levels.overall, 'unknown');
        assert.equal(card.dimensions.find((d: any) => d.dimension === 'observe').status, 'unknown');
    });
});
