import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSUMERS_DIR = path.resolve(HERE, '../apps/control-plane/src/app/features/consumers');
const API_TYPES_PATH = path.resolve(HERE, '../libs/api-client/types.ts');
const MODELS_PATH = path.join(CONSUMERS_DIR, 'models/reconciliation.models.ts');
const PAGE_TS_PATH = path.join(CONSUMERS_DIR, 'pages/consumer-reconciliation.page.ts');
const PAGE_HTML_PATH = path.join(CONSUMERS_DIR, 'pages/consumer-reconciliation.page.html');
const RECON_COMPONENTS_DIR = path.join(CONSUMERS_DIR, 'components/reconciliation');

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
        expect(pageSrc).toContain("'GAP_A_ORPHAN_ROUTE', 'GAP_B_UNFED_SCHEMA', 'GAP_D_UNLINKED_SPIKE'");
        expect(pageSrc).toContain("['GAP_E_MISSING_SDLC_DOC'].includes(gap.type)");
        expect(pageSrc).toContain("gap.type !== 'GAP_F_INDEX_DRIFT'");
        expect(pageSrc).toContain("stage.status === 'missing'");
        expect(pageSrc).toContain("this.filterType.set('GAP_E_MISSING_SDLC_DOC')");
        expect(pageSrc).toContain("stage.status === 'drift'");
        expect(pageSrc).toContain("this.filterType.set('GAP_F_INDEX_DRIFT')");
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
