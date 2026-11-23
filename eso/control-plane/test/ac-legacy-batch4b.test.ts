/**
 * AC legacy batch 4b — US-36 (evidence ingest) + US-37 (adapter packaging).
 *
 * SCN/AC ids are pinned in the test names so RTM-LEGACY can link them directly.
 * Service level only: the HTTP routes are not added by this slice.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PlatformError } from '../src/platform/registry/errors.js';
import {
    EvidenceIngestService,
    INGEST_LIMITS,
    INGEST_SCHEMA,
    InMemoryEvidenceLedger,
} from '../src/modules/ingest/ingest.service.js';
import {
    HARNESS_CORE_VERSION,
    HARNESS_PACKAGE_COMPONENTS,
    HARNESS_PROTOCOL_VERSION,
    HarnessPackagingService,
} from '../src/modules/harness-packaging/harness-packaging.service.js';

const EVENT_ID_1 = '3f8a1c62-1b2d-4c9e-8f4a-2d6b7c8e9f01';
const EVENT_ID_2 = '9a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d';

function validEvent(eventId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schema: INGEST_SCHEMA,
        event_id: eventId,
        occurred_at: new Date(Date.now() - 60_000).toISOString(),
        kind: 'prompt',
        host: 'cursor',
        payload: { text: 'hello' },
        provenance: { source: 'hook' },
        redaction: { applied: true },
        ...overrides,
    };
}

function batch(events: unknown[], schema: string = INGEST_SCHEMA) {
    return { schema, events };
}

async function rejectsCode(promise: Promise<unknown>, code: string, status?: number): Promise<void> {
    await assert.rejects(promise, (error: any) => {
        assert.ok(error instanceof PlatformError, `expected PlatformError, got ${String(error)}`);
        assert.equal(error.code, code);
        if (status !== undefined) assert.equal(error.status, status);
        return true;
    });
}

function makePackage(files: Record<string, string | null>): string {
    const root = mkdtempSync(join(tmpdir(), 'eso-batch4b-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const full = join(root, relativePath);
        if (content === null) {
            mkdirSync(full, { recursive: true });
            continue;
        }
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
    }
    return root;
}

function validPackageFiles(): Record<string, string | null> {
    return {
        'protocol/event.ts': "export const SCHEMA = 'eso.event.v1';\n",
        'core/client.ts': "import { readFile } from 'node:fs/promises';\n\nexport async function readText(path: string) {\n    return readFile(path, 'utf8');\n}\n",
        'adapters/cursor/index.ts': "export const host = 'cursor';\n",
        'manifests/cursor.json': JSON.stringify({
            host: 'cursor',
            version: '1.0.0',
            protocolVersion: HARNESS_PROTOCOL_VERSION,
            coreVersion: HARNESS_CORE_VERSION,
            capabilities: ['observe', 'inject'],
            entrypoint: 'adapters/cursor/index.ts',
        }),
    };
}

describe('AC legacy batch 4b — US-36 ingest + US-37 packaging', () => {
    test('SCN-36-1 · AC-36-1 — batch hợp lệ ⇒ 202 accepted=2, mỗi event có event_id + received_at, ledger append-only', async () => {
        const ingest = new EvidenceIngestService();

        const result = await ingest.ingest('acme', batch([validEvent(EVENT_ID_1), validEvent(EVENT_ID_2)]));

        assert.equal(result.accepted, 2);
        assert.equal(result.duplicate, 0);
        assert.deepEqual(result.rejected, []);
        assert.equal(result.events.length, 2);
        assert.deepEqual(result.events.map((event) => event.event_id), [EVENT_ID_1, EVENT_ID_2]);
        for (const event of result.events) {
            assert.equal(event.duplicate, false);
            assert.equal(Number.isNaN(Date.parse(event.received_at)), false);
            assert.equal(new Date(event.received_at).toISOString(), event.received_at);
        }

        const records = await ingest.records('acme');
        assert.equal(records.length, 2);
        assert.equal(records[0].eventId, EVENT_ID_1);
        assert.equal(records[0].receivedAt, result.events[0].received_at);
        assert.equal(Object.isFrozen(records[0]), true, 'ledger record is immutable');
        // Append-only surface: no delete/update member can be reached from the service.
        assert.equal((ingest as any).delete, undefined);
        assert.equal((ingest as any).ledger?.delete, undefined);
    });

    test('SCN-36-2 · AC-36-2 — gửi lại E1 ⇒ 202 duplicate=1, không tạo record mới, giữ received_at gốc', async () => {
        const ingest = new EvidenceIngestService();
        const first = await ingest.ingest('acme', batch([validEvent(EVENT_ID_1)]));
        const receivedAt = first.events[0].received_at;

        const again = await ingest.ingest('acme', batch([validEvent(EVENT_ID_1)]));

        assert.equal(again.accepted, 0);
        assert.equal(again.duplicate, 1);
        assert.equal(again.events[0].duplicate, true);
        assert.equal(again.events[0].event_id, EVENT_ID_1);
        assert.equal(again.events[0].received_at, receivedAt);
        assert.equal((await ingest.records('acme')).length, 1);
    });

    test('SCN-36-3 · AC-36-3 — schema lạ ⇒ 400 UNKNOWN_SCHEMA; quá size ⇒ 413 PAYLOAD_TOO_LARGE; không ghi record', async () => {
        const ingest = new EvidenceIngestService();

        await rejectsCode(ingest.ingest('acme', batch([validEvent(EVENT_ID_1)], 'eso.event.v2')), 'UNKNOWN_SCHEMA', 400);
        await rejectsCode(
            ingest.ingest('acme', batch([validEvent(EVENT_ID_1, { schema: 'eso.event.unknown' })])),
            'UNKNOWN_SCHEMA',
            400,
        );

        const oversized = Array.from({ length: INGEST_LIMITS.maxEvents + 1 }, () => validEvent(EVENT_ID_1));
        await rejectsCode(ingest.ingest('acme', batch(oversized)), 'PAYLOAD_TOO_LARGE', 413);

        assert.equal((await ingest.records('acme')).length, 0, 'a rejected batch writes nothing');
        assert.equal((await new EvidenceIngestService(new InMemoryEvidenceLedger()).records('acme')).length, 0);
    });

    test('SCN-37-1 · AC-37-1 — đủ protocol · core · adapters · manifests; core không import SDK host', async () => {
        const root = makePackage(validPackageFiles());
        try {
            const packaging = new HarnessPackagingService(root);
            const report = await packaging.inspect();

            assert.deepEqual(Object.keys(report.components).sort(), [...HARNESS_PACKAGE_COMPONENTS].sort());
            assert.deepEqual(Object.values(report.components), [true, true, true, true]);
            assert.deepEqual(report.coreImports, []);
            assert.equal(report.conformant, true);
            assert.equal(report.publishable, true);
            assert.equal(report.adapters.length, 1);
            assert.equal(report.adapters[0].host, 'cursor');

            // Negative half of AC-37-1: a host-SDK import in core is a violation, not a warning.
            writeFileSync(
                join(root, 'core', 'host.ts'),
                "import { CursorClient } from '@cursor/sdk';\n\nexport const client = new CursorClient();\n",
            );
            const polluted = await packaging.inspect();
            assert.equal(polluted.conformant, false);
            assert.equal(polluted.publishable, false);
            assert.equal(polluted.coreImports.length, 1);
            assert.equal(polluted.coreImports[0].module, '@cursor/sdk');
            assert.equal(polluted.coreImports[0].file, join('core', 'host.ts'));
            assert.equal(polluted.violations[0].code, 'CORE_IMPORTS_HOST_SDK');
            await rejectsCode(packaging.assertConformant(), 'CORE_IMPORTS_HOST_SDK', 422);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('SCN-37-2 · AC-37-2 — adapter mới có manifest + entrypoint ⇒ conformant, manifest khai host/version/capability', async () => {
        const files = validPackageFiles();
        files['adapters/dsh/index.ts'] = "export const host = 'dsh';\n";
        files['manifests/dsh.json'] = JSON.stringify({
            host: 'dsh',
            version: '0.2.0',
            protocolVersion: HARNESS_PROTOCOL_VERSION,
            coreVersion: HARNESS_CORE_VERSION,
            capabilities: ['observe', 'inject', 'memory-read'],
            entrypoint: 'adapters/dsh/index.ts',
        });
        const root = makePackage(files);
        try {
            const packaging = new HarnessPackagingService(root);
            const report = await packaging.assertConformant();

            assert.equal(report.conformant, true);
            const dsh = report.adapters.find((adapter) => adapter.host === 'dsh');
            assert.ok(dsh, 'dsh adapter is reported');
            assert.equal(dsh.conformant, true);
            assert.equal(dsh.version, '0.2.0');
            assert.deepEqual(dsh.capabilities, ['observe', 'inject', 'memory-read']);
            assert.equal(dsh.entrypoint, join('adapters', 'dsh', 'index.ts'));
            assert.deepEqual(report.violations, []);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('SCN-37-3 · AC-37-3 — thiếu manifest/entrypoint ⇒ MISSING_MANIFEST, package không publish', async () => {
        const noManifests = validPackageFiles();
        delete noManifests['manifests/cursor.json'];
        const rootWithout = makePackage({ ...noManifests, 'manifests/.keep': null });
        try {
            const packaging = new HarnessPackagingService(rootWithout);
            const report = await packaging.inspect();
            assert.equal(report.components.manifests, true);
            assert.equal(report.publishable, false);
            assert.equal(report.conformant, false);
            assert.ok(report.violations.some((violation) => violation.code === 'MISSING_MANIFEST'));
        } finally {
            rmSync(rootWithout, { recursive: true, force: true });
        }

        // Missing manifests directory entirely: fail closed, never publish.
        const noDir = validPackageFiles();
        delete noDir['manifests/cursor.json'];
        delete noDir['manifests/.keep'];
        const rootNoDir = makePackage(noDir);
        try {
            const packaging = new HarnessPackagingService(rootNoDir);
            const report = await packaging.inspect();
            assert.equal(report.components.manifests, false);
            assert.equal(report.publishable, false);
            await rejectsCode(packaging.assertConformant(), 'MISSING_MANIFEST', 422);
        } finally {
            rmSync(rootNoDir, { recursive: true, force: true });
        }

        // Manifest exists but its entrypoint file does not.
        const brokenEntry = validPackageFiles();
        brokenEntry['manifests/cursor.json'] = JSON.stringify({
            host: 'cursor',
            version: '1.0.0',
            capabilities: ['observe'],
            entrypoint: 'adapters/cursor/missing.ts',
        });
        const rootBroken = makePackage(brokenEntry);
        try {
            const packaging = new HarnessPackagingService(rootBroken);
            assert.equal((await packaging.inspect()).publishable, false);
            await rejectsCode(packaging.assertConformant(), 'MISSING_MANIFEST', 422);
        } finally {
            rmSync(rootBroken, { recursive: true, force: true });
        }
    });
});
