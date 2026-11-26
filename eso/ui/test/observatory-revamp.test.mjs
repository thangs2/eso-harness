import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    buildEvidenceEffectivenessView,
    classifyLearningBranches,
    collectExplicitUnknowns,
    dedupeGaps,
    extractReceiptSources,
} from '../apps/control-plane/src/app/features/observatory/pages/request-detail/evidence-effectiveness.selectors.ts';
import { toPostTurnGaps } from '../apps/control-plane/src/app/features/observatory/pages/request-detail/request-detail.selectors.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OBS_DIR = path.resolve(HERE, '../apps/control-plane/src/app/features/observatory');
const OBS2_DIR = path.resolve(HERE, '../apps/control-plane/src/app/features/observatory-v2');
const DETAIL_PAGE_SRC = fs.readFileSync(path.join(OBS_DIR, 'pages/request-detail.page.ts'), 'utf8');
const MASTER_PAGE_SRC = fs.readFileSync(path.join(OBS_DIR, 'pages/observatory.page.ts'), 'utf8');
const VERDICT_PANEL_SRC = fs.readFileSync(
    path.join(OBS_DIR, 'pages/request-detail/components/verdict-panel.component.ts'),
    'utf8',
);
const EE_PANEL_SRC = fs.readFileSync(
    path.join(OBS_DIR, 'pages/request-detail/components/evidence-effectiveness-panel.component.ts'),
    'utf8',
);
const GLANCE_CARDS_SRC = fs.readFileSync(
    path.join(OBS_DIR, 'pages/request-detail/components/glance-cards.component.ts'),
    'utf8',
);
const GLOBAL_STYLES_SRC = fs.readFileSync(path.resolve(HERE, '../src/styles.css'), 'utf8');
const ROUTES_SRC = fs.readFileSync(
    path.resolve(HERE, '../apps/control-plane/src/app/routes.ts'),
    'utf8',
);
const SHELL_SRC = fs.readFileSync(
    path.resolve(HERE, '../apps/control-plane/src/app/layout/shell/shell.component.ts'),
    'utf8',
);

function walkTsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkTsFiles(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

function makeBaseDetail(overrides = {}) {
    return {
        request: {
            id: 'req-1',
            traceId: 'trace-1',
            consumerId: 'eso-harness',
            userQuery: 'Add 5-Axis Evidence Effectiveness UI',
            startedAt: '2026-11-26T10:00:00Z',
            endedAt: '2026-11-26T10:00:02Z',
            status: 'ok',
            taskType: 'impl',
            flowId: 'default',
            workerId: 'build-runtime',
            hostId: 'mac-1',
            runtimeKey: 'mac-1:cursor',
            model: 'claude-4',
            adapter: 'cursor',
            promptHash: 'abc123',
            promptLength: 120,
        },
        context: {},
        routing: {},
        checks: [],
        recon: [],
        systemStages: [],
        requestMetrics: {
            callCount: 1,
            toolCount: 0,
            hasFailures: false,
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            tokensEstimated: false,
        },
        pipeline: [],
        events: [],
        telemetry: { llmCalls: [], tools: [], files: [] },
        verdict: {
            level: 'allow',
            basis: 'All required turn proof checks passed',
            actor: { role: 'developer', id: 'build-runtime' },
            gaps: [],
            score: 100,
            ruleRefs: [],
            receiptId: 'rcpt-1',
            computedAt: '2026-11-26T10:00:02Z',
        },
        receipt: null,
        signals: null,
        jev: null,
        effectiveness: {
            stepsTotal: 8,
            stepsWithEvidence: 6,
            rolesAssigned: 1,
            rolesObserved: 1,
            workersTotal: 1,
            workersObserved: 1,
            failures: 0,
            durationMs: 2000,
            writeGateChecked: false,
            receiptSealed: true,
            gaps: 0,
        },
        writeGate: null,
        ...overrides,
    };
}

test('Option A consolidation: single canonical Observatory exists, observatory-v2 removed & redirected', () => {
    assert.equal(fs.existsSync(OBS2_DIR), false, 'features/observatory-v2 must be removed after promotion');
    assert.match(ROUTES_SRC, /path:\s*'observatory-v2',\s*redirectTo:\s*'observatory'/);
    assert.match(ROUTES_SRC, /path:\s*'observatory-v2\/requests\/:requestId',\s*redirectTo:\s*'observatory\/requests\/:requestId'/);

    assert.match(SHELL_SRC, /routerLink="\/observatory"/);
    assert.doesNotMatch(SHELL_SRC, /routerLink="\/observatory-v2"/);
    assert.doesNotMatch(SHELL_SRC, /onObservatoryV2/);
    assert.doesNotMatch(DETAIL_PAGE_SRC, /Compare in Observatory v1/);
    assert.doesNotMatch(MASTER_PAGE_SRC, /Compare in Observatory v1/);

    for (const file of walkTsFiles(OBS_DIR)) {
        const src = fs.readFileSync(file, 'utf8');
        const matches = src.matchAll(/selector:\s*['"]([^'"]+)['"]/g);
        for (const m of matches) {
            assert.doesNotMatch(m[1], /^eso-v2-/, `Temporary eso-v2- selector leaked in ${file}: ${m[1]}`);
        }
    }
});

test('Canonical Observatory Detail integrates 5-Axis Evidence Effectiveness, Receipt v2 sources[], Explicit Unknowns, and Proof-First default tab', () => {
    const requiredFiles = [
        'components/request-grid.component.ts',
        'components/workers-flow.component.ts',
        'components/office-2d5d.component.ts',
        'pages/observatory.page.ts',
        'pages/request-detail.page.ts',
        'pages/request-detail/request-detail.models.ts',
        'pages/request-detail/request-detail.selectors.ts',
        'pages/request-detail/evidence-effectiveness.selectors.ts',
        'pages/request-detail/components/evidence-effectiveness-panel.component.ts',
        'pages/request-detail/components/request-hero.component.ts',
        'pages/request-detail/components/pipeline-stepper.component.ts',
        'pages/request-detail/components/pipeline-flow.component.ts',
        'pages/request-detail/components/glance-cards.component.ts',
        'pages/request-detail/components/waterfall-panel.component.ts',
        'pages/request-detail/components/graph-panel.component.ts',
        'pages/request-detail/components/verdict-panel.component.ts',
        'pages/request-detail/components/rules-panel.component.ts',
        'pages/request-detail/components/telemetry-panel.component.ts',
        'pages/request-detail/components/step-guide.component.ts',
        'pages/request-detail/components/verdict-guide.component.ts',
    ];
    for (const rel of requiredFiles) {
        assert.ok(fs.existsSync(path.join(OBS_DIR, rel)), `Missing expected Observatory file: ${rel}`);
    }

    assert.match(DETAIL_PAGE_SRC, /export class RequestDetailPage/);
    assert.match(DETAIL_PAGE_SRC, /<eso-evidence-effectiveness/);
    assert.match(DETAIL_PAGE_SRC, /activeTab\s*=\s*signal<TabKey>\(\s*'decisions'\s*\)/);
    assert.doesNotMatch(DETAIL_PAGE_SRC, /activeTab\s*=\s*signal<TabKey>\(\s*'waterfall'\s*\)/);
    assert.match(VERDICT_PANEL_SRC, /Receipt v2 Verified Sources/);
    assert.match(VERDICT_PANEL_SRC, /Explicit Unknowns/);
});

test('BR-18 Explicit Unknowns deterministically enumerates missing evidence dimensions', () => {
    const detail = makeBaseDetail();
    const unknowns = collectExplicitUnknowns(detail, null, null, null);
    const ids = unknowns.map((u) => u.id);
    assert.ok(ids.includes('no-pre-turn-judgment'));
    assert.ok(ids.includes('no-receipt-payload'));
    assert.ok(ids.includes('no-write-gate'));
    assert.ok(ids.includes('no-architecture-graph'));
    assert.ok(ids.includes('no-host-signals'));
    assert.ok(ids.includes('missing-action-events'));
    assert.ok(ids.includes('kb-sufficiency-unavailable'));
});

test('Receipt v2 sources[] extraction maps server-verified sources cleanly', () => {
    const receipt = {
        receiptId: 'rcpt-2',
        consumerId: 'eso-harness',
        traceId: 'trace-1',
        prevHash: 'GENESIS',
        hash: 'deadbeef',
        hmac: 'cafebabe',
        specVersion: 2,
        payload: {
            specVersion: 2,
            consumerId: 'eso-harness',
            traceId: 'trace-1',
            verdict: { level: 'allow', basis: 'ok', actor: null, gaps: [], score: 100 },
            eventDigests: [],
            sources: [
                {
                    requirementId: 'REQ-01',
                    where: 'sdlc/02.governance/spec.md',
                    hash: 'sha256:111',
                    verifiedAt: '2026-11-26T10:00:01Z',
                    verified: true,
                },
                {
                    requirementId: null,
                    where: 'README.md',
                    hash: null,
                    verifiedAt: '2026-11-26T10:00:01Z',
                    verified: false,
                },
            ],
        },
        createdAt: '2026-11-26T10:00:02Z',
    };

    const sources = extractReceiptSources(receipt);
    assert.equal(sources.length, 2);
    assert.deepEqual(sources[0], {
        requirementId: 'REQ-01',
        where: 'sdlc/02.governance/spec.md',
        hash: 'sha256:111',
        verifiedAt: '2026-11-26T10:00:01Z',
        verified: true,
    });
    assert.equal(sources[1].verified, false);
    assert.equal(sources[1].requirementId, null);
});

test('5-Axis Evidence Effectiveness computes real metrics without fabricating missing values (BR-12)', () => {
    const sparseDetail = makeBaseDetail({
        verdict: null,
        effectiveness: null,
        events: [],
        telemetry: { llmCalls: [], tools: [], files: [] },
    });
    const sparseView = buildEvidenceEffectivenessView({
        detail: sparseDetail,
        preTurnGate: null,
        actionEvents: [],
        tokenSummary: { input: null, output: null, cacheRead: null, estimated: false },
        fullReceipt: null,
        receiptVerification: 'unavailable',
        kbSufficiency: null,
    });
    assert.equal(sparseView.overallStatus, 'cannot-judge');
    assert.equal(sparseView.axis1.ratioPct, null);
    assert.equal(sparseView.axis1.state, 'not-captured');
    assert.equal(sparseView.axis2.coveragePct, null);
    assert.equal(sparseView.axis4.totalTokens, null);
    assert.equal(sparseView.axis4.durationMs, null);

    const richDetail = makeBaseDetail({
        telemetry: {
            llmCalls: [{ workerId: 'build-runtime', model: 'claude-4' }],
            tools: [{ name: 'read_file' }, { name: 'edit_file' }],
            files: [
                { path: 'eso/ui/app.ts', op: 'edit' },
                { path: 'AGENTS.md', op: 'read' },
            ],
        },
        recon: [{ id: 'codegraph', label: 'CodeGraph', source: 'mcp', required: true, status: 'ok', calls: 2 }],
        pipeline: [{ workerId: 'worker-build', label: 'Build', status: 'PASS', event: 'worker.completed', durationMs: 500, errorCode: '' }],
        events: [
            {
                observationId: 'obs-1',
                traceId: 'trace-1',
                hostId: 'mac-1',
                runtimeKey: 'mac-1:cursor',
                workerId: 'worker-build',
                event: 'action.recorded',
                outcome: 'PASS',
                at: '2026-11-26T10:00:01Z',
                evidence: { tool: 'edit_file', outcome: 'ok', files: ['eso/ui/app.ts'], readBeforeEdit: true },
            },
        ],
        verdict: {
            level: 'allow',
            basis: 'All checks passed',
            actor: { id: 'worker-build', role: 'developer' },
            gaps: [],
            score: 100,
            ruleRefs: [{ kind: 'law', path: 'AGENTS.md', line: 1 }],
            receiptId: 'rcpt-2',
            computedAt: '2026-11-26T10:00:02Z',
        },
        writeGate: {
            decisionId: 'wg-ok',
            allowed: true,
            code: 'ALLOW_SCOPE',
            target: 'eso/ui/app.ts',
            at: '2026-11-26T10:00:01Z',
            actor: null,
        },
    });
    const fullReceipt = {
        receiptId: 'rcpt-2',
        consumerId: 'eso-harness',
        traceId: 'trace-1',
        prevHash: 'GENESIS',
        hash: 'abc',
        hmac: 'def',
        specVersion: 2,
        payload: {
            specVersion: 2,
            consumerId: 'eso-harness',
            traceId: 'trace-1',
            verdict: { level: 'allow', basis: 'ok', actor: null, gaps: [], score: 100 },
            eventDigests: [],
            sources: [
                { requirementId: 'REQ-1', where: 'AGENTS.md', hash: 'sha256:aaa', verifiedAt: '2026-11-26T10:00:01Z', verified: true },
            ],
        },
        createdAt: '2026-11-26T10:00:02Z',
    };
    const richView = buildEvidenceEffectivenessView({
        detail: richDetail,
        preTurnGate: { level: 'sufficient', decision: 'allow', enforcement: 'enforce', gaps: [] },
        actionEvents: [{ id: 'obs-1', tool: 'edit_file', outcome: 'ok', filesCount: 1, readBeforeEdit: 'yes', diffRef: 'd1' }],
        tokenSummary: { input: 1200, output: 300, cacheRead: 500, estimated: false },
        fullReceipt,
        receiptVerification: 'verified',
        kbSufficiency: {
            consumerId: 'eso-harness',
            status: 'clear',
            blockMerge: false,
            findings: [],
            summary: { missingKind: 0, orphanArtifact: 0, ownerMissing: 0, nearDuplicate: 0, contradicts: 0, upstream: 0, dropped: 0 },
        },
    });
    assert.equal(richView.overallStatus, 'effective');
    assert.equal(richView.capturedAxes, 5);
    assert.equal(richView.axis1.ratioPct, 100);
    assert.equal(richView.axis2.diagnosisKind, 'sufficient');
    assert.equal(richView.axis3.verifiedCount, 1);
    assert.equal(richView.axis3.readBeforeEditYes, 1);
    assert.equal(richView.axis4.totalTokens, 2000);
    assert.equal(richView.axis4.writeGateStatus, 'allowed');
    assert.equal(richView.axis5.allClear, true);
});

test('Axis 5 classifies all 4 SDLC Learning Handoff branches (form, obligation, model, retrieval)', () => {
    const detail = makeBaseDetail({
        recon: [{ id: 'docgraph', label: 'DocGraph', source: 'cli', required: true, status: 'not-captured', calls: 0 }],
        writeGate: {
            decisionId: 'wg-1',
            allowed: false,
            code: 'SCOPE_DENIED',
            target: 'eso/ui/app.ts',
            at: '2026-11-26T10:00:01Z',
            actor: null,
        },
    });
    const preTurnGate = {
        level: 'insufficient',
        decision: 'block',
        enforcement: 'enforce',
        gaps: [
            { domain: 'pre', code: 'MISSING_KIND', what: 'Missing spec', consequence: 'Blocked' },
            { domain: 'pre', code: 'ROLE_INSUFFICIENT', what: 'Role bar mismatch', consequence: 'Blocked' },
            { domain: 'pre', code: 'NO_REQUIREMENTS', what: 'No graph reqs', consequence: 'Cannot judge' },
            { domain: 'pre', code: 'EVIDENCE_UNVERIFIED', what: 'Unverified doc', consequence: 'Recall miss' },
        ],
    };
    const postGaps = toPostTurnGaps([]);
    const unknowns = collectExplicitUnknowns(detail, preTurnGate, null, null);
    const cards = classifyLearningBranches('eso-harness', preTurnGate, postGaps, unknowns, detail, null);

    const branches = cards.map((c) => c.branch);
    assert.deepEqual(branches, ['form', 'obligation', 'model', 'retrieval']);
    assert.deepEqual(cards[0].targetRoute, ['/consumers', 'eso-harness', 'settings']);
    assert.equal(cards[0].queryParams.tab, 'knowledge');
    assert.deepEqual(cards[1].targetRoute, ['/consumers', 'eso-harness', 'learning']);
    assert.deepEqual(cards[2].targetRoute, ['/consumers', 'eso-harness', 'architecture']);
    assert.deepEqual(cards[3].targetRoute, ['/consumers', 'eso-harness', 'learning']);
});

test('5-Axis deduplicates mirrored pre-turn (PRE_GAP) and post-turn (JUDGMENT_GAP_UNKNOWN) gaps (19 + 19 => 19, not 38)', () => {
    const preGaps = Array.from({ length: 19 }, (_, idx) => ({
        domain: 'pre',
        code: 'PRE_GAP',
        what: `Missing evidence item #${idx + 1}`,
        consequence: 'Pre-turn gate flagged missing sufficiency.',
    }));
    const postRaw = Array.from({ length: 19 }, (_, idx) => ({
        code: 'JUDGMENT_GAP_UNKNOWN',
        what: `Missing evidence item #${idx + 1}`,
        consequence: 'Verdict downgraded to partial',
    }));
    const postGaps = toPostTurnGaps(postRaw);

    const deduped = dedupeGaps(preGaps, postGaps);
    assert.equal(deduped.length, 19);

    const detail = makeBaseDetail({
        verdict: {
            level: 'partial',
            basis: '19 judgment gaps mirrored',
            actor: { id: 'agent-1', role: 'developer' },
            gaps: postRaw,
            score: 0,
            ruleRefs: [],
            receiptId: 'rcpt-19',
            computedAt: '2026-11-26T10:00:02Z',
        },
    });
    const view = buildEvidenceEffectivenessView({
        detail,
        preTurnGate: { level: 'partial', decision: 'allow', enforcement: 'warn', gaps: preGaps },
        actionEvents: [],
        tokenSummary: { input: null, output: null, cacheRead: null, estimated: false },
        fullReceipt: null,
        receiptVerification: 'verified',
        kbSufficiency: null,
    });
    assert.equal(view.axis2.gapCount, 19);
    assert.notEqual(view.axis2.gapCount, 38);
});

test('Axis 3 does not repeat "verified · verified" and uses consistent English headings', () => {
    assert.doesNotMatch(EE_PANEL_SRC, /verified\s*·\s*\{\{\s*view\(\)\.axis3\.receiptVerification\s*\}\}/);
    assert.match(EE_PANEL_SRC, /sources verified/);
    assert.match(EE_PANEL_SRC, /Receipt:\s*\{\{\s*view\(\)\.axis3\.receiptVerification\s*\}\}/);
    assert.match(EE_PANEL_SRC, /Retrieval Precision \(MET-08\)/);
    assert.match(EE_PANEL_SRC, /Sufficiency Coverage \(P4\)/);
    assert.match(EE_PANEL_SRC, /Evidence Basis &amp; Trust \(P7\)/);
    assert.match(EE_PANEL_SRC, /Execution Impact/);
    assert.match(EE_PANEL_SRC, /Learn → Train Handoff \(P5\)/);
});

test('Layout overflow guards: VerdictPanel Q5/Q6, EvidenceEffectivenessPanel grid, GlanceCards, DetailPage', () => {
    assert.match(VERDICT_PANEL_SRC, /class="sources-table-wrap"/);
    assert.match(VERDICT_PANEL_SRC, /\.sources-table-wrap\s*\{[^}]*overflow-x:\s*auto/);
    assert.match(VERDICT_PANEL_SRC, /\.sources-table\s*\{[^}]*table-layout:\s*fixed/);
    assert.match(VERDICT_PANEL_SRC, /\.next-codes\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.doesNotMatch(VERDICT_PANEL_SRC, /\.next-codes\s*\{[^}]*grid-auto-flow:\s*column/);
    assert.match(VERDICT_PANEL_SRC, /groupedGapCodes/);

    assert.match(EE_PANEL_SRC, /\.ee-grid\s*\{[^}]*minmax\(0,\s*1fr\)/);
    assert.match(EE_PANEL_SRC, /\.axis-card\s*\{[^}]*min-width:\s*0/);
    // The button stays one line; the label inside it is what truncates.
    assert.match(EE_PANEL_SRC, /\.axis-disclosure\s*\{[^}]*overflow:\s*hidden/);
    assert.match(EE_PANEL_SRC, /\.axis-disclosure code\s*\{[^}]*text-overflow:\s*ellipsis/);

    // Axis 1 shows progress, not the corpus: the card must not print a path list, and the list
    // must be reachable on demand without adding a dependency.
    assert.doesNotMatch(EE_PANEL_SRC, /class="chip-row"/, 'Axis 1 must not render a chip list inline');
    assert.doesNotMatch(EE_PANEL_SRC, /class="chip"/, 'no inline path chips on the score card');
    assert.match(EE_PANEL_SRC, /<dialog[^>]*#filesDialog/, 'the file list opens in a native dialog');
    assert.match(EE_PANEL_SRC, /showModal\(\)/, 'dialog opens via showModal for focus trap + Esc');
    assert.match(EE_PANEL_SRC, /@for \(file of view\(\)\.axis1\.fileList; track file\.path\)/, 'dialog lists every file');
    // The sheet behaviour moved to the shared `.eso-sheet` primitive; assert it there, once.
    assert.match(GLOBAL_STYLES_SRC, /\.eso-sheet\s*\{[^}]*width:\s*min\(var\(--eso-sheet-width/, 'shared sheet is width-parameterised');
    assert.match(GLOBAL_STYLES_SRC, /\.eso-sheet\s*\{[^}]*margin-top:\s*auto/, 'shared sheet pins to the lower edge on mobile');
    assert.match(GLOBAL_STYLES_SRC, /\.eso-sheet\[open\]\s*\{\s*animation/, 'open transition is gated on reduced-motion');
    assert.doesNotMatch(EE_PANEL_SRC, /MatBottomSheet|@angular\/material\/bottom-sheet/, 'no new bottom-sheet dependency');

    assert.match(GLANCE_CARDS_SRC, /CORE_PROOF_CODES/);
    assert.match(GLANCE_CARDS_SRC, /v\.gaps\.slice\(0,\s*5\)/);
    assert.match(GLANCE_CARDS_SRC, /trace proofs missing/);

    assert.match(DETAIL_PAGE_SRC, /combineLatest/);
    assert.match(DETAIL_PAGE_SRC, /role="tabpanel"/);
    assert.match(DETAIL_PAGE_SRC, /overflow-x:\s*clip/);
});

test('Axis 1 fileList: every touched file with its used/loaded split, and short labels with extension', () => {
    const detail = makeBaseDetail({
        telegram: undefined,
        events: [
            {
                observationId: 'o-1', traceId: 'trace-1', hostId: 'mac-1', runtimeKey: 'k', workerId: 'build-runtime',
                event: 'action.recorded', outcome: 'PASS',
                evidence: {
                    tool: 'apply_patch',
                    files: ['AGENTS.md', 'packages/fineso-core/src/index.ts'],
                },
                at: '2026-11-26T10:00:01Z',
            },
        ],
        telemetry: {
            llmCalls: [],
            tools: [],
            files: ['AGENTS.md', 'packages/fineso-core/src/index.ts', 'SDLC/04.architecture/01.landscape/05.packages-matrix.md'],
        },
    });
    const view = buildEvidenceEffectivenessView({
        detail,
        preTurnGate: null,
        actionEvents: [],
        tokenSummary: { input: null, output: null, cacheRead: null, estimated: false },
        fullReceipt: null,
        receiptVerification: 'unavailable',
        kbSufficiency: null,
    });

    const list = view.axis1.fileList;
    assert.equal(list.length, 3, 'every loaded file appears exactly once');
    assert.equal(list.filter((f) => f.used).length, 2, 'action.recorded files count as used');
    assert.equal(list[0].used, true, 'used files are listed first so they explain the ratio');
    assert.equal(view.axis1.loadedCount, 3);
    assert.equal(view.axis1.usedCount, 2);

    // Labels keep the extension and never drop it by cutting path segments.
    const matrix = list.find((f) => f.path.endsWith('05.packages-matrix.md'));
    assert.ok(matrix, 'the nested doc is present');
    assert.equal(matrix.label, '05.packages-matrix.md');
    assert.ok(matrix.label.endsWith('.md'), 'extension must survive truncation');
    assert.ok(!matrix.label.includes('…/'), 'label is a basename, not the last two path segments');
});

test('Modals share one sheet primitive: no component re-declares its own mobile sheet or backdrop', () => {
    // `step-guide` and `verdict-guide` used to go full-screen on mobile while `request-detail`'s
    // sheet pinned to the bottom edge — three dialogs, three behaviours. They now all carry
    // `.eso-sheet`, which owns sizing, the backdrop and the mobile bottom-sheet rule.
    const modals = {
        'step-guide.component.ts': fs.readFileSync(path.join(OBS_DIR, 'pages/request-detail/components/step-guide.component.ts'), 'utf8'),
        'verdict-guide.component.ts': fs.readFileSync(path.join(OBS_DIR, 'pages/request-detail/components/verdict-guide.component.ts'), 'utf8'),
        'evidence-effectiveness-panel.component.ts': EE_PANEL_SRC,
    };
    for (const [name, src] of Object.entries(modals)) {
        assert.match(src, /class="[^"]*\beso-sheet\b/, `${name} uses the shared sheet`);
        assert.match(src, /eso-sheet-panel/, `${name} marks its panel wrapper`);
        assert.doesNotMatch(src, /::backdrop/, `${name} must not re-declare the backdrop`);
        assert.doesNotMatch(src, /@keyframes\s+sheet-up/, `${name} must not re-declare the sheet animation`);
        assert.doesNotMatch(src, /max-height:\s*100vh/, `${name} must not hard-code a mobile height unit`);
    }
    // The old duplicated full-screen rule is gone; the primitive owns it now.
    assert.doesNotMatch(GLOBAL_STYLES_SRC, /\.eso-sheet\s*\{[^}]*border-radius:\s*0\b/, 'no full-screen square sheet');
});
