import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { toPostTurnGaps, toPreTurnGate } from '../apps/control-plane/src/app/features/observatory/pages/request-detail/request-detail.selectors.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERDICT_PANEL = fs.readFileSync(
    path.resolve(HERE, '../apps/control-plane/src/app/features/observatory/pages/request-detail/components/verdict-panel.component.ts'),
    'utf8',
);
const STEP_GUIDE = fs.readFileSync(
    path.resolve(HERE, '../apps/control-plane/src/app/features/observatory/pages/request-detail/components/step-guide.component.ts'),
    'utf8',
);
const API_CLIENT = fs.readFileSync(path.resolve(HERE, '../libs/api-client/client.ts'), 'utf8');
const SETTINGS_KNOWLEDGE = fs.readFileSync(
    path.resolve(HERE, '../apps/control-plane/src/app/features/consumers/pages/settings-knowledge.base.ts'),
    'utf8',
);
const KNOWLEDGE_OVERVIEW_TS = fs.readFileSync(
    path.resolve(HERE, '../apps/control-plane/src/app/features/consumers/components/knowledge-overview.component.ts'),
    'utf8',
);

test('B3: verdict panel labels Q3 as Turn Proof, not Sufficiency', () => {
    assert.match(VERDICT_PANEL, /<h3><span class="q-no">Q3<\/span>\s*Turn Proof<\/h3>/);
    assert.doesNotMatch(VERDICT_PANEL, /<h3><span class="q-no">Q3<\/span>\s*Sufficiency<\/h3>/);
});

test('B3: step-guide explicitly distinguishes turn proof score from knowledge sufficiency', () => {
    assert.match(STEP_GUIDE, /Turn proof score is distinct from knowledge sufficiency/i);
});

test('G3: Knowledge sufficiency API is wired without adding a new tab', () => {
    assert.match(API_CLIENT, /getConsumerKnowledgeSufficiency/);
    assert.match(API_CLIENT, /\/knowledge\/sufficiency/);
    assert.match(SETTINGS_KNOWLEDGE, /getKnowledgeSufficiency\(/);
    // Keep the existing 6 knowledge sections without adding a 7th tab
    const tabMatches = KNOWLEDGE_OVERVIEW_TS.match(/\{\s*id:\s*'/g) || [];
    assert.equal(tabMatches.length, 6, 'Knowledge overview must not add a new tab');
});

test('Pre-turn gate selector returns null when no observation carries evidence.judgment', () => {
    const events = [
        {
            observationId: 'obs-1',
            traceId: 't-1',
            hostId: 'h-1',
            runtimeKey: 'h-1:cursor',
            workerId: 'worker-build',
            event: 'action.recorded',
            outcome: 'ok',
            at: '2026-11-26T00:00:00Z',
            evidence: { tool: 'edit_file' },
        },
    ];
    assert.equal(toPreTurnGate(events), null);
});

test('Pre-turn gate selector extracts level, decision, enforcement, and unified pre-domain gaps', () => {
    const events = [
        {
            observationId: 'obs-2',
            traceId: 't-1',
            hostId: 'h-1',
            runtimeKey: 'h-1:cursor',
            workerId: null,
            event: 'judgment.evaluated',
            outcome: 'ok',
            at: '2026-11-26T00:00:01Z',
            evidence: {
                judgment: {
                    decision: 'block',
                    enforcement: 'enforce',
                    verdict: { level: 'insufficient' },
                    gaps: {
                        gap_items: [
                            {
                                code: 'MISSING_EVIDENCE',
                                reason: 'No test evidence attached',
                                path: 'src/app.ts',
                                consequence: 'Write is blocked before execution',
                            },
                        ],
                    },
                },
            },
        },
    ];

    const gate = toPreTurnGate(events);
    assert.ok(gate, 'Expected PreTurnGateView');
    assert.equal(gate.level, 'insufficient');
    assert.equal(gate.decision, 'block');
    assert.equal(gate.enforcement, 'enforce');
    assert.deepEqual(gate.gaps, [
        {
            domain: 'pre',
            code: 'MISSING_EVIDENCE',
            what: 'No test evidence attached',
            where: 'src/app.ts',
            consequence: 'Write is blocked before execution',
        },
    ]);
});

test('toPostTurnGaps maps post-turn verdict gaps into unified read-model shape', () => {
    const mapped = toPostTurnGaps([
        { code: 'NO_RECEIPT', what: 'Receipt missing', consequence: 'Integrity cannot be verified' },
    ]);
    assert.deepEqual(mapped, [
        {
            domain: 'post',
            code: 'NO_RECEIPT',
            what: 'Receipt missing',
            consequence: 'Integrity cannot be verified',
        },
    ]);
});
