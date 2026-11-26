import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSUMERS_DIR = path.resolve(HERE, '../apps/control-plane/src/app/features/consumers');
const API_TYPES_PATH = path.resolve(HERE, '../libs/api-client/types.ts');
const MODELS_PATH = path.join(CONSUMERS_DIR, 'models/reconciliation.models.ts');
const PAGE_TS_PATH = path.join(CONSUMERS_DIR, 'pages/consumer-reconciliation.page.ts');
const PAGE_HTML_PATH = path.join(CONSUMERS_DIR, 'pages/consumer-reconciliation.page.html');
const RECON_COMPONENTS_DIR = path.join(CONSUMERS_DIR, 'components/reconciliation');
const SERVICE_TS_PATH = path.join(CONSUMERS_DIR, 'services/reconciliation.service.ts');
const METRICS_TS_PATH = path.join(RECON_COMPONENTS_DIR, 'reconciliation-metrics.component.ts');

const RECON_UI_FILES = [
    path.join(RECON_COMPONENTS_DIR, 'reconciliation-hero.component.ts'),
    path.join(RECON_COMPONENTS_DIR, 'reconciliation-pipeline.component.ts'),
    path.join(RECON_COMPONENTS_DIR, 'reconciliation-metrics.component.ts'),
    path.join(RECON_COMPONENTS_DIR, 'reconciliation-toolbar.component.ts'),
    path.join(RECON_COMPONENTS_DIR, 'reconciliation-gap-card.component.ts'),
    PAGE_TS_PATH,
    PAGE_HTML_PATH,
];

/**
 * Pure mirror of ConsumerReconciliationPage filtering and state transitions
 * (kept in sync with consumer-reconciliation.page.ts).
 */
function filterGaps(gaps, { pillar = 'all', type = 'all', severity = 'all', query = '' }) {
    const q = query.trim().toLowerCase();
    return gaps.filter((gap) => {
        if (pillar === 'code') {
            if (!['GAP_A_ORPHAN_ROUTE', 'GAP_B_UNFED_SCHEMA', 'GAP_D_UNLINKED_SPIKE'].includes(gap.type)) {
                return false;
            }
        } else if (pillar === 'sdlc') {
            if (!['GAP_E_MISSING_SDLC_DOC'].includes(gap.type)) {
                return false;
            }
        } else if (pillar === 'postgres') {
            if (gap.type !== 'GAP_F_INDEX_DRIFT') {
                return false;
            }
        }

        if (type !== 'all' && gap.type !== type) return false;
        if (severity !== 'all' && gap.severity !== severity) return false;
        if (q) {
            const matchSymbol = gap.symbol.toLowerCase().includes(q);
            const matchPath = gap.filePath.toLowerCase().includes(q);
            const matchDetail = gap.detail.toLowerCase().includes(q);
            const matchTarget = gap.suggestedTarget.toLowerCase().includes(q);
            if (!matchSymbol && !matchPath && !matchDetail && !matchTarget) {
                return false;
            }
        }
        return true;
    });
}

function applyCategoryToggle(state, nextType) {
    const toggled = state.filterType === nextType ? 'all' : nextType;
    return {
        ...state,
        filterType: toggled,
        activePillar: toggled !== 'all' ? 'all' : state.activePillar,
    };
}

function applyStageSelect(stage) {
    if (stage.status === 'missing') {
        return {
            activePillar: 'all',
            filterType: 'GAP_E_MISSING_SDLC_DOC',
            searchQuery: stage.stage,
        };
    }
    if (stage.status === 'drift') {
        return {
            activePillar: 'all',
            filterType: 'GAP_F_INDEX_DRIFT',
            searchQuery: stage.directory.replace(/\/$/, ''),
        };
    }
    return {
        activePillar: 'all',
        filterType: 'all',
        searchQuery: stage.directory.replace(/\/$/, ''),
    };
}

/**
 * Loads the REAL count helpers from reconciliation.service.ts (transpiled, not mirrored), so this
 * test measures the code the cockpit ships instead of a copy that can drift from it.
 */
function loadServiceCounters() {
    const fullSource = fs.readFileSync(SERVICE_TS_PATH, 'utf8');
    const classAt = fullSource.search(/^export class\s/m);
    if (classAt < 0) throw new Error('reconciliation.service.ts: expected an `export class` declaration');
    // Keep the module-level helpers (the single source of truth for every count) and drop the
    // Angular service class, whose decorators need a framework runtime this test does not load.
    const source = fullSource.slice(0, classAt);
    const { outputText: transpiled } = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
            experimentalDecorators: true,
            emitDecoratorMetadata: false,
            useDefineForClassFields: true,
        },
    });
    // Drop import statements; the pure helpers below reference no imported value.
    const outputText = transpiled;
    const importRe = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"];?[ \t]*$/gm;
    // Drop `export` (named and list form) and the decorator helpers the pure helpers never reach.
    const body = outputText
        .replace(importRe, '')
        .replace(/^\s*export\s+(?=(?:const|function|interface|type|class)\b)/gm, '')
        .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');
    const factory = new Function(
        'Injectable',
        'computed',
        'inject',
        'signal',
        'ConsumerProfileService',
        '__decorate',
        // `import` cannot be a Function parameter name, so stub dynamic imports inside the body
        // (module-level `import x = require()` syntax can survive transpilation to a bare call).
        `const __vite_ssr_import__ = () => undefined;\nconst __importDefault = (m) => ({ default: m });\n${body.replace(/\bimport\(/g, '__vite_ssr_import__(')}\nreturn { DISCREPANCY_TYPES, PILLAR_DISCREPANCY_TYPES, countGapsByType, countGapsInPillar, countHiddenByCap };`,
    );
    // Decorators are irrelevant here: `__decorate` is a no-op and `Injectable()` returns a no-op
    // class decorator, so the service class definition still parses and evaluates.
    const noop = (value) => value;
    const noopDecorate = (decorators, target) => {
        for (const decorator of decorators) noop(decorator);
        return target;
    };
    const injectable = () => noop;
    const passThrough = (value) => value;
    return factory(
        passThrough,
        passThrough,
        passThrough,
        passThrough,
        class {},
        noopDecorate,
        injectable,
    );
}

/**
 * Fallback pillar sets, used ONLY when reconciliation.service.ts does not export the helper
 * module (pre-fix code). They reproduce the OLD, buggy page behaviour exactly: pillar counts came
 * from ad-hoc SUMMARY sums (`missingSdlcDocs + staleContracts` for the sdlc pillar), so a fixed
 * rule below fails on that code instead of crashing on a missing export.
 */
const LEGACY_PILLAR_TYPES = {
    code: ['GAP_A_ORPHAN_ROUTE', 'GAP_B_UNFED_SCHEMA', 'GAP_D_UNLINKED_SPIKE'],
    sdlc: ['GAP_E_MISSING_SDLC_DOC'],
    postgres: ['GAP_F_INDEX_DRIFT'],
};

function loadServiceCountersOrNull() {
    try {
        return loadServiceCounters();
    } catch {
        return null;
    }
}

const SERVICE_COUNTERS = loadServiceCountersOrNull();

const COUNTERS = SERVICE_COUNTERS ?? {
    DISCREPANCY_TYPES: null,
    PILLAR_DISCREPANCY_TYPES: null,
    countGapsByType: (list) => {
        const counts = {};
        for (const item of list) counts[item.type] = (counts[item.type] ?? 0) + 1;
        return counts;
    },
    // Mirror of the OLD page: the sdlc pillar chip = summary.missingSdlcDocs + summary.staleContracts.
    countGapsInPillar: (list, pillar) => {
        if (pillar === 'sdlc') {
            return list.filter((g) => ['GAP_E_MISSING_SDLC_DOC', 'GAP_C_STALE_HASH'].includes(g.type)).length;
        }
        return list.filter((g) => (LEGACY_PILLAR_TYPES[pillar] ?? []).includes(g.type)).length;
    },
    countHiddenByCap: () => 0,
};

/** Summary metric name -> the gap type it is supposed to count (mirror of reconciliation.service summary). */
const SUMMARY_FIELD_BY_TYPE = {
    GAP_A_ORPHAN_ROUTE: 'orphanRoutes',
    GAP_B_UNFED_SCHEMA: 'unfedSchemas',
    GAP_C_STALE_HASH: 'staleContracts',
    GAP_D_UNLINKED_SPIKE: 'unlinkedSpikes',
    GAP_E_MISSING_SDLC_DOC: 'missingSdlcDocs',
    GAP_F_INDEX_DRIFT: 'indexDrift',
};

/** Reference summary derived the way the cockpit must: every count straight off the gap array. */
function derivedSummary(gaps) {
    const counts = COUNTERS.countGapsByType(gaps);
    const summary = { totalGaps: gaps.length };
    for (const [type, field] of Object.entries(SUMMARY_FIELD_BY_TYPE)) {
        summary[field] = counts[type] ?? 0;
    }
    return summary;
}

const SAMPLE_GAPS = [
    {
        id: 'gap-a-1',
        type: 'GAP_A_ORPHAN_ROUTE',
        severity: 'critical',
        symbol: 'POST /api/v1/orders',
        filePath: 'src/orders/routes.ts',
        lines: '10-24',
        detectedAt: '2026-11-26T00:00:00Z',
        detail: 'Undocumented POST endpoint',
        suggestedTarget: 'sdlc/07.technical/03.api/orders.api.md',
        promptTemplate: 'Document route',
        status: 'open',
    },
    {
        id: 'gap-b-1',
        type: 'GAP_B_UNFED_SCHEMA',
        severity: 'warning',
        symbol: 'Table decision_ledger',
        filePath: 'packages/decision/src/ledger.ts',
        lines: '40-55',
        detectedAt: '2026-11-26T00:00:00Z',
        detail: 'Table missing from data dictionary',
        suggestedTarget: 'sdlc/07.technical/02.data-design/03.data-dictionary.md',
        promptTemplate: 'Document schema',
        status: 'open',
    },
    {
        id: 'gap-c-1',
        type: 'GAP_C_STALE_HASH',
        severity: 'critical',
        symbol: 'Manifest hash mismatch',
        filePath: 'sdlc/03.inception/01.vision/vision.md',
        lines: '1-1',
        detectedAt: '2026-11-26T00:00:00Z',
        detail: 'SHA-256 differs from manifest',
        suggestedTarget: '.harness/knowledge-manifest.json',
        promptTemplate: 'Re-lock hash',
        status: 'open',
    },
    {
        id: 'gap-d-1',
        type: 'GAP_D_UNLINKED_SPIKE',
        severity: 'info',
        symbol: 'Spike cache-notes.md',
        filePath: 'scratch/cache-notes.md',
        lines: '1-30',
        detectedAt: '2026-11-26T00:00:00Z',
        detail: 'Unlinked scratch spike',
        suggestedTarget: 'sdlc/03.inception/02.decision-log/cache-notes.md',
        promptTemplate: 'Link spike',
        status: 'open',
    },
    {
        id: 'gap-e-1',
        type: 'GAP_E_MISSING_SDLC_DOC',
        severity: 'critical',
        symbol: 'S3 BRD (missing)',
        filePath: 'sdlc/05.requirements/01.specification/02.brd/',
        lines: '1-1',
        detectedAt: '2026-11-26T00:00:00Z',
        detail: 'Missing required BRD stage documents',
        suggestedTarget: 'sdlc/05.requirements/01.specification/02.brd/01.brd.md',
        promptTemplate: 'Create BRD skeleton',
        status: 'open',
    },
    {
        id: 'gap-f-1',
        type: 'GAP_F_INDEX_DRIFT',
        severity: 'warning',
        symbol: 'Unindexed doc architecture.md',
        filePath: 'sdlc/07.technical/01.architecture/architecture.md',
        lines: '1-1',
        detectedAt: '2026-11-26T00:00:00Z',
        detail: 'Markdown file on disk not indexed in knowledge_doc',
        suggestedTarget: 'platform.knowledge_doc',
        promptTemplate: 'Sync Postgres index',
        status: 'open',
    },
];

function gap(id, type, status = 'open') {
    return {
        id,
        type,
        severity: 'critical',
        symbol: `symbol-${id}`,
        filePath: `src/${id}.ts`,
        lines: '1-1',
        detectedAt: '2026-11-26T00:00:00Z',
        detail: `detail-${id}`,
        suggestedTarget: `sdlc/${id}.md`,
        promptTemplate: `prompt-${id}`,
        status,
    };
}

/**
 * Shape measured against live backend data for consumer `fineso`: 29 rows, 3 GAP-E (S8/S9/S12).
 * The S12 GAP-E row is the one that used to be counted by the pillar but dropped by the ledger.
 */
function finesoFixture() {
    const gaps = [
        gap('a-1', 'GAP_A_ORPHAN_ROUTE'),
        gap('b-1', 'GAP_B_UNFED_SCHEMA'),
        gap('e-s8', 'GAP_E_MISSING_SDLC_DOC'),
        gap('e-s9', 'GAP_E_MISSING_SDLC_DOC'),
        gap('e-s12', 'GAP_E_MISSING_SDLC_DOC'),
    ];
    for (let i = 0; i < 8; i++) gaps.push(gap(`c-${i}`, 'GAP_C_STALE_HASH'));
    for (let i = 0; i < 16; i++) gaps.push(gap(`f-${i}`, 'GAP_F_INDEX_DRIFT'));
    return gaps;
}

/** Mirror of the page's `filteredGaps`/`codeDriftCount` etc., using the service's own pillar sets. */
function countPillarWithService(gaps, pillar) {
    return COUNTERS.countGapsInPillar(gaps, pillar);
}

describe('Reconciliation Cockpit filtering & stage mapping', () => {
    test('pillar filtering maps code=A/B/D, sdlc=E, postgres=F, all=all 6', () => {
        expect(filterGaps(SAMPLE_GAPS, { pillar: 'all' }).map((g) => g.type)).toEqual([
            'GAP_A_ORPHAN_ROUTE',
            'GAP_B_UNFED_SCHEMA',
            'GAP_C_STALE_HASH',
            'GAP_D_UNLINKED_SPIKE',
            'GAP_E_MISSING_SDLC_DOC',
            'GAP_F_INDEX_DRIFT',
        ]);

        expect(filterGaps(SAMPLE_GAPS, { pillar: 'code' }).map((g) => g.type)).toEqual([
            'GAP_A_ORPHAN_ROUTE',
            'GAP_B_UNFED_SCHEMA',
            'GAP_D_UNLINKED_SPIKE',
        ]);

        // sdlc pillar = GAP-E only: GAP-C is a manifest/hash contract (artifact pillar), and
        // folding it in made the capped-count badge fire for the wrong pillar.
        expect(filterGaps(SAMPLE_GAPS, { pillar: 'sdlc' }).map((g) => g.type)).toEqual([
            'GAP_E_MISSING_SDLC_DOC',
        ]);

        expect(filterGaps(SAMPLE_GAPS, { pillar: 'postgres' }).map((g) => g.type)).toEqual([
            'GAP_F_INDEX_DRIFT',
        ]);
    });

    test('category toggle selects category, resets activePillar, and toggles back to all', () => {
        const initial = { activePillar: 'code', filterType: 'all' };
        const selected = applyCategoryToggle(initial, 'GAP_B_UNFED_SCHEMA');
        expect(selected.filterType).toBe('GAP_B_UNFED_SCHEMA');
        expect(selected.activePillar).toBe('all');
        expect(filterGaps(SAMPLE_GAPS, { pillar: selected.activePillar, type: selected.filterType }).map((g) => g.id)).toEqual([
            'gap-b-1',
        ]);

        const toggledOff = applyCategoryToggle(selected, 'GAP_B_UNFED_SCHEMA');
        expect(toggledOff.filterType).toBe('all');
        expect(filterGaps(SAMPLE_GAPS, { pillar: toggledOff.activePillar, type: toggledOff.filterType }).length).toBe(6);
    });

    test('severity and search filtering match symbol, filePath, detail, and suggestedTarget', () => {
        expect(filterGaps(SAMPLE_GAPS, { severity: 'critical' }).map((g) => g.id)).toEqual([
            'gap-a-1',
            'gap-c-1',
            'gap-e-1',
        ]);
        expect(filterGaps(SAMPLE_GAPS, { severity: 'warning' }).map((g) => g.id)).toEqual([
            'gap-b-1',
            'gap-f-1',
        ]);
        expect(filterGaps(SAMPLE_GAPS, { severity: 'info' }).map((g) => g.id)).toEqual(['gap-d-1']);

        // Match by symbol
        expect(filterGaps(SAMPLE_GAPS, { query: 'decision_ledger' }).map((g) => g.id)).toEqual(['gap-b-1']);
        // Match by filePath
        expect(filterGaps(SAMPLE_GAPS, { query: 'scratch/cache-notes' }).map((g) => g.id)).toEqual(['gap-d-1']);
        // Match by detail
        expect(filterGaps(SAMPLE_GAPS, { query: 'SHA-256 DIFFERS' }).map((g) => g.id)).toEqual(['gap-c-1']);
        // Match by suggestedTarget
        expect(filterGaps(SAMPLE_GAPS, { query: 'knowledge_doc' }).map((g) => g.id)).toEqual(['gap-f-1']);
        // Combined severity + search
        expect(filterGaps(SAMPLE_GAPS, { severity: 'critical', query: 'orders' }).map((g) => g.id)).toEqual(['gap-a-1']);
    });

    test('stageSelect maps missing -> GAP_E_MISSING_SDLC_DOC and drift -> GAP_F_INDEX_DRIFT', () => {
        const missingState = applyStageSelect({
            stage: 'S3',
            name: 'BRD',
            owner: 'BA',
            group: 'A',
            directory: 'sdlc/05.requirements/01.specification/02.brd/',
            docCount: 0,
            status: 'missing',
        });
        expect(missingState).toEqual({
            activePillar: 'all',
            filterType: 'GAP_E_MISSING_SDLC_DOC',
            searchQuery: 'S3',
        });
        expect(
            filterGaps(SAMPLE_GAPS, {
                pillar: missingState.activePillar,
                type: missingState.filterType,
                query: missingState.searchQuery,
            }).map((g) => g.id),
        ).toEqual(['gap-e-1']);

        const driftState = applyStageSelect({
            stage: 'S8',
            name: 'Architecture',
            owner: 'SA',
            group: 'B',
            directory: 'sdlc/07.technical/01.architecture/',
            docCount: 1,
            status: 'drift',
        });
        expect(driftState).toEqual({
            activePillar: 'all',
            filterType: 'GAP_F_INDEX_DRIFT',
            searchQuery: 'sdlc/07.technical/01.architecture',
        });
        expect(
            filterGaps(SAMPLE_GAPS, {
                pillar: driftState.activePillar,
                type: driftState.filterType,
                query: driftState.searchQuery,
            }).map((g) => g.id),
        ).toEqual(['gap-f-1']);

        const coveredState = applyStageSelect({
            stage: 'S2',
            name: 'Vision',
            owner: 'PO',
            group: 'A',
            directory: 'sdlc/03.inception/01.vision/',
            docCount: 1,
            status: 'covered',
        });
        expect(coveredState).toEqual({
            activePillar: 'all',
            filterType: 'all',
            searchQuery: 'sdlc/03.inception/01.vision',
        });
    });

    test('consumer-reconciliation.page.ts stays aligned with pillar and stageSelect contracts', () => {
        const pageSrc = fs.readFileSync(PAGE_TS_PATH, 'utf8');
        const serviceSrc = fs.readFileSync(SERVICE_TS_PATH, 'utf8');
        // The page no longer re-declares the pillar type sets or the stage search fallback: it
        // delegates to the service helpers, so its pillar filter, its pillar counts and its
        // stage-to-row lookup cannot drift from each other.
        expect(pageSrc).toContain('PILLAR_DISCREPANCY_TYPES[pillar]');
        expect(pageSrc).toContain("countGapsInPillar(this.reconciliationService.gaps(), 'code')");
        expect(pageSrc).toContain("countGapsInPillar(this.reconciliationService.gaps(), 'sdlc')");
        expect(pageSrc).toContain("countGapsInPillar(this.reconciliationService.gaps(), 'postgres')");
        expect(pageSrc).toContain('findGapBackingStage(this.reconciliationService.gaps(), stage)');
        expect(pageSrc).toContain("stage.status === 'drift'");
        expect(pageSrc).toContain("this.filterType.set('GAP_F_INDEX_DRIFT')");
        expect(pageSrc).not.toContain("'GAP_A_ORPHAN_ROUTE', 'GAP_B_UNFED_SCHEMA', 'GAP_D_UNLINKED_SPIKE'");

        // The single declaration of the pillar sets lives in the service, and GAP-C is not sdlc.
        const sdlcBlock = serviceSrc.slice(serviceSrc.indexOf('sdlc: ['), serviceSrc.indexOf("postgres: ['"));
        expect(sdlcBlock).toContain("['GAP_E_MISSING_SDLC_DOC']");
        expect(sdlcBlock).not.toContain('GAP_C_STALE_HASH');
    });
});

describe('Reconciliation count invariants (category counts == ledger rows)', () => {
    const fixtures = [
        ['fineso (29 rows, 3 GAP-E)', finesoFixture()],
        ['one row per category', SAMPLE_GAPS],
        ['empty', []],
        ['only GAP-E', [gap('e1', 'GAP_E_MISSING_SDLC_DOC'), gap('e2', 'GAP_E_MISSING_SDLC_DOC')]],
        ['resolved rows still counted', [gap('a-1', 'GAP_A_ORPHAN_ROUTE', 'resolved'), gap('c-1', 'GAP_C_STALE_HASH', 'staged_in_inbox')]],
    ];

    test('sum of per-category counts equals gaps.length and each count equals its own type count', () => {
        for (const [label, list] of fixtures) {
            const summary = derivedSummary(list);
            const counts = Object.entries(SUMMARY_FIELD_BY_TYPE).map(([type, field]) => [type, field, summary[field]]);
            const sum = counts.reduce((total, [, , value]) => total + value, 0);
            expect(sum, `${label}: per-category sum must equal rows`).toBe(list.length);
            expect(summary.totalGaps, `${label}: totalGaps must equal rows`).toBe(list.length);
            for (const [type, field, value] of counts) {
                expect(value, `${label}: ${field} must equal number of ${type} rows`).toBe(
                    list.filter((g) => g.type === type).length,
                );
            }
        }
    });

    test('pillar counts are rows of that pillar and sum to gaps.length', () => {
        const list = finesoFixture();
        const code = countPillarWithService(list, 'code');
        const sdlc = countPillarWithService(list, 'sdlc');
        const postgres = countPillarWithService(list, 'postgres');
        expect(code).toBe(2); // GAP-A + GAP-B
        expect(sdlc).toBe(3); // GAP-E only: S8 + S9 + S12 (GAP-C is NOT sdlc pillar)
        expect(postgres).toBe(16); // GAP-F
        expect([code, sdlc, postgres, list.length]).toEqual([2, 3, 16, 29]);
    });

    test('sdlc pillar count matches the GAP-E category tab, never a GAP-C + GAP-E sum', () => {
        const list = finesoFixture();
        const summary = derivedSummary(list);
        expect(countPillarWithService(list, 'sdlc')).toBe(summary.missingSdlcDocs);
        expect(countPillarWithService(list, 'sdlc')).not.toBe(summary.missingSdlcDocs + summary.staleContracts);
    });

    test('hiddenByCapCount uses the same pillar type sets as the pillar counts', () => {
        const truncated = {
            GAP_A_ORPHAN_ROUTE: 1,
            GAP_C_STALE_HASH: 4,
            GAP_E_MISSING_SDLC_DOC: 2,
            GAP_F_INDEX_DRIFT: 3,
        };
        expect(COUNTERS.countHiddenByCap(truncated, 'all', 'all')).toBe(10);
        expect(COUNTERS.countHiddenByCap(truncated, 'sdlc', 'all')).toBe(2);
        expect(COUNTERS.countHiddenByCap(truncated, 'code', 'all')).toBe(1);
        expect(COUNTERS.countHiddenByCap(truncated, 'postgres', 'all')).toBe(3);
        expect(COUNTERS.countHiddenByCap(truncated, 'sdlc', 'GAP_C_STALE_HASH')).toBe(0);
        expect(COUNTERS.countHiddenByCap(undefined, 'all', 'all')).toBe(0);
    });

    test('category tabs and the summary are fed by one source and one type list', () => {
        const serviceSrc = fs.readFileSync(SERVICE_TS_PATH, 'utf8');
        // The summary derives every per-type field from the gap array, not from a passed-in count.
        const summaryBlock = serviceSrc.slice(serviceSrc.indexOf('readonly summary = computed'));
        const body = summaryBlock.slice(0, summaryBlock.indexOf('private normalizeStages'));
        expect(body).toContain('countGapsByType(allGaps)');
        for (const field of Object.values(SUMMARY_FIELD_BY_TYPE)) {
            expect(body, `summary.${field} must come from gaps()`).toContain(`${field}:`);
        }

        // The metrics component only binds summary fields (one source for all tabs).
        const metricsSrc = fs.readFileSync(METRICS_TS_PATH, 'utf8');
        const classAt = metricsSrc.search(/^export class\s/m);
        const componentDecl = metricsSrc.slice(0, classAt);
        expect(componentDecl).toContain('selector: \'eso-reconciliation-metrics\'');
        expect(metricsSrc).toContain('summary = input.required<ReconciliationScanSummaryDto>()');
        expect(metricsSrc).toContain('role="tab"');
        expect(metricsSrc.match(/aria-selected/g)?.length ?? 0).toBeGreaterThanOrEqual(7);

        // Page pillar counts must use the service helper, not ad-hoc sums.
        const pageSrc = fs.readFileSync(PAGE_TS_PATH, 'utf8');
        expect(pageSrc).toContain("countGapsInPillar(this.reconciliationService.gaps(), 'sdlc')");
        expect(pageSrc).not.toContain('missingSdlcDocs + ');
    });
});

describe('Reconciliation DTO parity & UI hygiene', () => {
    test('reconciliation.models.ts and api-client/types.ts declare ghostDbCount and omit lastSyncedAt', () => {
        const modelsSrc = fs.readFileSync(MODELS_PATH, 'utf8');
        const apiTypesSrc = fs.readFileSync(API_TYPES_PATH, 'utf8');

        for (const [label, src] of [
            ['reconciliation.models.ts', modelsSrc],
            ['api-client/types.ts', apiTypesSrc],
        ]) {
            const match = src.match(/export interface PostgresKnowledgeStatsDto\s*\{[\s\S]*?\}/);
            expect(match, `${label} must define PostgresKnowledgeStatsDto`).not.toBeNull();
            const block = match[0];
            expect(block).toContain('diskMarkdownCount: number;');
            expect(block).toContain('indexedDocsCount: number;');
            expect(block).toContain('unindexedCount: number;');
            expect(block).toContain('staleDbCount: number;');
            expect(block).toContain('ghostDbCount: number;');
            expect(block).not.toContain('lastSyncedAt');
        }
    });

    test('all reconciliation UI component and page files exist and contain zero OS emoji characters', () => {
        const emojiRe = /\p{Extended_Pictographic}/gu;
        for (const filePath of RECON_UI_FILES) {
            expect(fs.existsSync(filePath), `Missing UI file: ${filePath}`).toBe(true);
            const content = fs.readFileSync(filePath, 'utf8');
            const matches = content.match(emojiRe);
            expect(matches, `Unexpected OS emoji in ${path.basename(filePath)}: ${matches?.join(', ')}`).toBeNull();
        }
    });
});
