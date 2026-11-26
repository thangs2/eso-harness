import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import {
    assertConsumerId,
    type ConsumerArtifact,
    type PlatformStore,
} from '../../platform/registry/store.js';
import { listIndexableMarkdownFiles, type KnowledgeIndexService } from './knowledge-index.service.js';

export type DiscrepancyType =
    | 'GAP_A_ORPHAN_ROUTE'
    | 'GAP_B_UNFED_SCHEMA'
    | 'GAP_C_STALE_HASH'
    | 'GAP_D_UNLINKED_SPIKE'
    | 'GAP_E_MISSING_SDLC_DOC'
    | 'GAP_F_INDEX_DRIFT';

export type DiscrepancySeverity = 'critical' | 'warning' | 'info';

export type ReconciliationGapStatus = 'open' | 'staged_in_inbox' | 'resolved';

export type ReconciliationScanScope = 'full' | 'git-diff';

export interface ReconciliationGapDto {
    id: string;
    type: DiscrepancyType;
    severity: DiscrepancySeverity;
    symbol: string;
    filePath: string;
    lines: string;
    detectedAt: string;
    detail: string;
    suggestedTarget: string;
    promptTemplate: string;
    status: ReconciliationGapStatus;
    codeSnippet?: string;
}

export interface SdlcStageCoverageDto {
    stage: string;
    group: 'A' | 'B' | 'C' | 'D';
    label: string;
    leadRole: string;
    expectedFolder: string;
    docCount: number;
    indexedCount: number;
    status: 'covered' | 'missing' | 'drift';
    gapId?: string;
}

export interface ReconciliationPostgresStatsDto {
    diskMarkdownCount: number;
    indexedDocsCount: number;
    unindexedCount: number;
    staleDbCount: number;
    ghostDbCount: number;
}

/**
 * Count of gap items that were DROPPED because a per-type emission cap was hit
 * (they are not part of `gaps`). Keys are present only when the drop count is
 * non-zero, so `{}` means "nothing was truncated". Serialisable as plain JSON.
 */
export type ReconciliationTruncatedByType = Partial<Record<DiscrepancyType, number>>;

export interface ReconciliationScanResultDto {
    consumerId: string;
    scannedAt: string;
    scope: ReconciliationScanScope;
    ignoredCount: number;
    postgresStats: ReconciliationPostgresStatsDto;
    pipelineStages: SdlcStageCoverageDto[];
    gaps: ReconciliationGapDto[];
    /** Items silently dropped by emission caps (MAX_GAPS_PER_CATEGORY / MAX_INDEX_DRIFT_GAPS). */
    truncated: ReconciliationTruncatedByType;
}

export interface IgnoreGapInput {
    gapId: string;
    filePath?: string;
    symbol?: string;
    reason?: string;
}

export interface IgnoreGapResultDto {
    ignored: true;
    gapId: string;
    ignoredCount: number;
}

export interface RelockHashInput {
    gapId: string;
    filePath: string;
}

export interface RelockHashResultDto {
    relocked: true;
    gapId: string;
    filePath: string;
    sha256: string;
}

interface ReconcileIgnoreEntry {
    gapId: string;
    filePath?: string;
    symbol?: string;
    reason?: string;
    ignoredAt: string;
}

interface SdlcDocInfo {
    relPath: string;
    relFromSdlc: string;
    lowerRelFromSdlc: string;
    baseNameLower: string;
    dirRel: string;
    frontmatterType: string;
}

interface SdlcStageDefinition {
    stage: string;
    group: 'A' | 'B' | 'C' | 'D';
    label: string;
    leadRole: string;
    canonicalSubfolder: string;
    isDocStage: boolean;
    coreSpec: boolean;
    defaultFileName: string;
    matches: (doc: SdlcDocInfo) => boolean;
    /**
     * Sign-off stages (S16 verify, S17 release gate) are `covered` only by an `approved`
     * artifact whose metadata or provenance points at the stage. Filenames never count.
     */
    requiresSignOff?: boolean;
}

function isIndexDoc(baseNameLower: string): boolean {
    return baseNameLower === 'readme.md' || baseNameLower === '00.index.md';
}

const SDLC_PIPELINE_STAGES: readonly SdlcStageDefinition[] = [
    // Group A: Inception & Requirements (S1..S7)
    {
        stage: 'S1',
        group: 'A',
        label: 'Problem',
        leadRole: 'PO',
        canonicalSubfolder: '03.inception/00.problem/',
        isDocStage: true,
        coreSpec: false,
        defaultFileName: '01.problem-statement.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('03.inception/00.problem/') ||
            (d.lowerRelFromSdlc.startsWith('01.inception/') &&
                /problem|charter|vision/.test(d.baseNameLower)) ||
            ['problem', 'problem-statement', 'inception'].includes(d.frontmatterType),
    },
    {
        stage: 'S2',
        group: 'A',
        label: 'Vision',
        leadRole: 'PO',
        canonicalSubfolder: '03.inception/01.vision/',
        isDocStage: true,
        coreSpec: false,
        defaultFileName: '01.vision.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('03.inception/01.vision/') ||
            (d.lowerRelFromSdlc.startsWith('01.inception/') &&
                /vision|charter|pre-coding/.test(d.baseNameLower)) ||
            ['vision', 'charter'].includes(d.frontmatterType),
    },
    {
        stage: 'S3',
        group: 'A',
        label: 'BRD',
        leadRole: 'BA',
        canonicalSubfolder: '05.requirements/01.specification/02.brd/',
        isDocStage: true,
        coreSpec: true,
        defaultFileName: '01.brd.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('05.requirements/01.specification/02.brd/') ||
            d.lowerRelFromSdlc.startsWith('02.requirements/01.brd/') ||
            /(?:^|\/)\d*\.?brd\//.test(d.lowerRelFromSdlc) ||
            d.frontmatterType === 'brd',
    },
    {
        stage: 'S4',
        group: 'A',
        label: 'PRD',
        leadRole: 'PO',
        canonicalSubfolder: '05.requirements/01.specification/01.prd/',
        isDocStage: true,
        coreSpec: true,
        defaultFileName: '01.prd.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('05.requirements/01.specification/01.prd/') ||
            d.lowerRelFromSdlc.startsWith('02.requirements/02.prd/') ||
            /(?:^|\/)\d*\.?prd\//.test(d.lowerRelFromSdlc) ||
            d.frontmatterType === 'prd',
    },
    {
        stage: 'S5',
        group: 'A',
        label: 'FRD',
        leadRole: 'BA',
        canonicalSubfolder: '05.requirements/01.specification/03.frd/',
        isDocStage: true,
        coreSpec: true,
        defaultFileName: '01.frd.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('05.requirements/01.specification/03.frd/') ||
            d.lowerRelFromSdlc.startsWith('02.requirements/03.frd/') ||
            /(?:^|\/)\d*\.?frd\//.test(d.lowerRelFromSdlc) ||
            d.frontmatterType === 'frd',
    },
    {
        stage: 'S6',
        group: 'A',
        label: 'SRS',
        leadRole: 'BA',
        canonicalSubfolder: '05.requirements/01.specification/04.srs/',
        isDocStage: true,
        coreSpec: true,
        defaultFileName: '01.srs.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('05.requirements/01.specification/04.srs/') ||
            d.lowerRelFromSdlc.startsWith('02.requirements/04.srs/') ||
            /(?:^|\/)\d*\.?srs\//.test(d.lowerRelFromSdlc) ||
            d.frontmatterType === 'srs',
    },
    {
        stage: 'S7',
        group: 'A',
        label: 'AC',
        leadRole: 'BA',
        canonicalSubfolder: '06.analysis/02.ac/',
        isDocStage: true,
        coreSpec: true,
        defaultFileName: '01.acceptance-criteria.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('06.analysis/02.ac/') ||
            (d.lowerRelFromSdlc.startsWith('03.analysis/') &&
                /user-stories|acceptance-criteria|(?:^|[._-])us(?:[._-]|$)|(?:^|[._-])ac(?:[._-]|$)/.test(d.baseNameLower)) ||
            ['ac', 'acceptance-criteria', 'user-stories', 'us'].includes(d.frontmatterType),
    },
    // Group B: Technical Design (S8..S10)
    {
        stage: 'S8',
        group: 'B',
        label: 'API',
        leadRole: 'TECH',
        canonicalSubfolder: '07.technical/03.api/',
        isDocStage: true,
        coreSpec: true,
        defaultFileName: '01.api-contract.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('07.technical/03.api/') ||
            /(?:^|\/)\d*\.?api\//.test(d.lowerRelFromSdlc) ||
            d.baseNameLower.endsWith('.api.md') ||
            ['api', 'api-contract', 'openapi'].includes(d.frontmatterType),
    },
    {
        stage: 'S9',
        group: 'B',
        label: 'Data',
        leadRole: 'TECH',
        canonicalSubfolder: '07.technical/02.data-design/',
        isDocStage: true,
        coreSpec: true,
        defaultFileName: '03.data-dictionary.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('07.technical/02.data-design/') ||
            /(?:^|\/)\d*\.?data-design\//.test(d.lowerRelFromSdlc) ||
            /data-dictionary|data-model/.test(d.baseNameLower) ||
            ['data-design', 'data-dictionary', 'schema'].includes(d.frontmatterType),
    },
    {
        stage: 'S10',
        group: 'B',
        label: 'Arch',
        leadRole: 'TECH',
        canonicalSubfolder: '07.technical/01.architecture/',
        isDocStage: true,
        coreSpec: false,
        defaultFileName: '01.architecture.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('07.technical/01.architecture/') ||
            d.lowerRelFromSdlc.startsWith('04.architecture/') ||
            /(?:^|\/)\d*\.?architecture\//.test(d.lowerRelFromSdlc) ||
            ['architecture', 'arch', 'adr'].includes(d.frontmatterType),
    },
    // Group C: Planning & Scenarios (S11..S13)
    {
        stage: 'S11',
        group: 'C',
        label: 'WBS',
        leadRole: 'PM',
        canonicalSubfolder: '09.wbs/',
        isDocStage: true,
        coreSpec: false,
        defaultFileName: '01.wbs.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('09.wbs/') ||
            d.lowerRelFromSdlc.startsWith('08.wbs/') ||
            /(?:^|\/)\d*\.?wbs\//.test(d.lowerRelFromSdlc) ||
            d.frontmatterType === 'wbs',
    },
    {
        stage: 'S12',
        group: 'C',
        label: 'Phases',
        leadRole: 'TECH',
        canonicalSubfolder: '12.phases/',
        isDocStage: true,
        coreSpec: false,
        defaultFileName: '01.phase-plan.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('12.phases/') ||
            /(?:^|\/)\d*\.?phases\//.test(d.lowerRelFromSdlc) ||
            // Consumers keep phase plans under WBS (e.g. sdlc/08.wbs/02.phase-1-review.md).
            // The base name must actually name a phase (`phase`, `phase-1`, `phase_plan`), so plain
            // WBS docs like 01.wbs.md stay S11-only instead of being swallowed by S12.
            (/(?:^|\/)\d*\.?wbs\//.test(d.lowerRelFromSdlc) &&
                /(?:^|[._-])phases?(?:[._-]|$)/.test(d.baseNameLower)) ||
            ['phase', 'phase-plan', 'phase-review'].includes(d.frontmatterType),
    },
    {
        stage: 'S13',
        group: 'C',
        label: 'SCN',
        leadRole: 'QC',
        canonicalSubfolder: '06.analysis/03.scn/',
        isDocStage: true,
        coreSpec: true,
        defaultFileName: '01.scenarios.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('06.analysis/03.scn/') ||
            /(?:^|\/)\d*\.?scn\//.test(d.lowerRelFromSdlc) ||
            /scenario/.test(d.baseNameLower) ||
            ['scn', 'scenario', 'scenarios'].includes(d.frontmatterType),
    },
    // Group D: Implementation, Test & Release Gate (S14..S17)
    //
    // S16 (Verify) and S17 (Gate) are SIGN-OFF stages. Coverage requires promote/sign-off evidence —
    // an approved artifact targeting the stage — because BR-05 forbids deriving a human signature
    // from a filename (an agent or a file must never sign Done). So for S14..S17 `matches` is
    // ignored by evaluatePipelineStages: no path, base-name or frontmatter guess can set
    // `covered`, and S14/S15 stay non-sign-off but likewise never infer coverage from nothing.
    // None of the four emits GAP-E (isDocStage stays false); they may still report `drift`.
    {
        stage: 'S14',
        group: 'D',
        label: 'Code',
        leadRole: 'DEV',
        canonicalSubfolder: 'src/',
        isDocStage: false,
        coreSpec: false,
        defaultFileName: '',
        matches: () => false,
    },
    {
        stage: 'S15',
        group: 'D',
        label: 'Test',
        leadRole: 'QC',
        canonicalSubfolder: '10.test/',
        isDocStage: false,
        coreSpec: false,
        defaultFileName: '01.test-plan.md',
        matches: (d) =>
            d.lowerRelFromSdlc.startsWith('10.test/') ||
            /(?:^|\/)\d*\.?test\//.test(d.lowerRelFromSdlc) ||
            ['test', 'test-plan'].includes(d.frontmatterType),
    },
    {
        stage: 'S16',
        group: 'D',
        label: 'Verify',
        leadRole: 'QC',
        canonicalSubfolder: '12.phases/',
        isDocStage: false,
        coreSpec: false,
        defaultFileName: '01.verify-report.md',
        // Evidence-only: `covered` needs an approved artifact for S16 (see evaluatePipelineStages).
        matches: () => false,
        requiresSignOff: true,
    },
    {
        stage: 'S17',
        group: 'D',
        label: 'Gate',
        leadRole: 'PO',
        canonicalSubfolder: '12.phases/',
        isDocStage: false,
        coreSpec: false,
        defaultFileName: '01.release-gate.md',
        // Evidence-only: `covered` needs an approved artifact for S17 (see evaluatePipelineStages).
        // A doc called `02.pre-coding-gate.md` belongs to S2, not to the S17 release sign-off.
        matches: () => false,
        requiresSignOff: true,
    },
];

/** S14 (Code) is not a sign-off stage and must never be inferred from a filename. */
const NON_SIGNOFF_D_STAGES = new Set(['S14']);

function isSignOffEvidenceArtifact(artifact: ConsumerArtifact | null | undefined): boolean {
    return Boolean(artifact && artifact.ktState === 'approved');
}

function collectArtifactPathHints(artifact: ConsumerArtifact): string[] {
    const hints: string[] = [];
    for (const source of [artifact.derivedFrom, artifact.metadata?.suggestedTarget, artifact.metadata?.target_path]) {
        if (Array.isArray(source)) {
            for (const value of source) {
                if (typeof value === 'string') hints.push(value);
            }
        } else if (typeof source === 'string') {
            hints.push(source);
        }
    }
    return hints;
}

function artifactTargetsStage(artifact: ConsumerArtifact, stage: string, canonicalSubfolder: string): boolean {
    const meta = artifact.metadata ?? {};
    const declaredStage = [meta.stage, meta.stageId]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toUpperCase());
    if (declaredStage.includes(stage.toUpperCase())) return true;

    // Path hints only count when they are genuinely repo-relative: a hint like
    // `http://host/sdlc/12.phases/x` or `vendor/sdlc/12.phases/x` must NOT sign the stage off.
    // `canonicalSubfolder` is relative to the SDLC root (e.g. `12.phases/`), so a hint qualifies
    // when it contains `<sdlc>/<canonicalSubfolder>/...` at the root — i.e. the segment must not be
    // preceded by an unrelated folder such as `vendor/`.
    const folder = canonicalSubfolder.toLowerCase().replace(/^\/+|\/+$/g, '');
    const tail = `/${folder}/`;
    return collectArtifactPathHints(artifact).some((hint) => {
        const normalized = hint.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase().trim();
        if (!normalized) return false;
        if (/^[a-z][a-z0-9+.-]*:/.test(normalized)) return false; // scheme (http:, file:, ...)
        if (normalized.startsWith('/') || normalized.startsWith('~')) return false; // absolute / home
        if (normalized.split('/').includes('..')) return false; // traversal
        const atRoot = `/${normalized}`;
        const idx = atRoot.indexOf(tail);
        if (idx === -1) return false;
        // Everything before the stage folder must be exactly one SDLC-root segment (e.g. `sdlc`
        // or `SDLC`), never an unrelated prefix such as `vendor`.
        const prefix = atRoot.slice(0, idx);
        return prefix !== '' && !prefix.slice(1).includes('/');
    });
}

function findSignOffArtifact(
    artifacts: readonly ConsumerArtifact[],
    stage: string,
    canonicalSubfolder: string,
): ConsumerArtifact | undefined {
    return artifacts.find(
        (artifact) => isSignOffEvidenceArtifact(artifact) && artifactTargetsStage(artifact, stage, canonicalSubfolder),
    );
}

const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    '.angular',
    '.harness',
    'coverage',
]);

const CODE_SKIP_DIRS = new Set([
    ...SKIP_DIRS,
    'test',
    'tests',
    '__tests__',
]);

const NOISE_ROUTES = new Set(['/health', '/healthz', '/metrics']);
const STATIC_ASSET_EXT_RE = /\.(?:js|mjs|cjs|css|map|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|html)$/i;
const NOISE_SCHEMAS = new Set(['_prisma_migrations', 'schema_migrations']);

const MAX_CODE_FILES = 300;
const MAX_SCHEMA_FILES = 300;
const MAX_GAPS_PER_CATEGORY = 15;
const MAX_INDEX_DRIFT_GAPS = 20;
const MAX_SNIPPET_LINES = 12;

const DECORATOR_ROUTE_RE = /@(Get|Post|Put|Delete|Patch)\s*\(\s*(['"`])([^'"`]+)\2/;
const CALL_ROUTE_RE = /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\2/;
const ON_ROUTE_RE = /\.\s*on\s*\(\s*(['"`])(GET|POST|PUT|DELETE|PATCH)\1\s*,\s*(['"`])([^'"`]+)\3/i;
const BUN_PATHNAME_EQ_RE = /\b(?:url\.)?pathname\s*===?\s*(['"`])(\/api\/[^'"`]+)\1/;
const BUN_PATHNAME_SW_RE = /\b(?:url\.)?pathname\.startsWith\s*\(\s*(['"`])(\/api\/[^'"`]+)\1/;

const PRISMA_MODEL_RE = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"'\[]?([A-Za-z_][A-Za-z0-9_.]*)[`"'\]]?/i;
const ENTITY_DECORATOR_RE = /@Entity\s*\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/;

function toPosixPath(p: string): string {
    return p.split(sep).join('/');
}

function toSlug(input: string): string {
    const slug = input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'item';
}

function sha256Hex(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
}

function makeGapId(type: DiscrepancyType, filePath: string, symbol: string): string {
    const digest = sha256Hex(`${filePath}:${symbol}`).slice(0, 10);
    return `gap-${type}-${digest}`;
}

function safeReadText(filePath: string): string | null {
    try {
        return readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

function parseFrontmatterType(text: string): string {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return '';
    for (const line of match[1].split(/\r?\n/)) {
        const split = line.indexOf(':');
        if (split <= 0) continue;
        const key = line.slice(0, split).trim().toLowerCase();
        if (key === 'type' || key === 'kind') {
            return line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '').toLowerCase();
        }
    }
    return '';
}

function atomicWrite(filePath: string, body: string): void {
    mkdirSync(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, body, 'utf8');
    renameSync(temp, filePath);
}

function extractCodeSnippet(lines: string[], startLine1Based: number, endLine1Based?: number): string {
    if (!lines.length) return '';
    const clampedStart = Math.max(1, Math.min(startLine1Based, lines.length));
    const clampedEnd = Math.max(clampedStart, Math.min(endLine1Based ?? clampedStart, lines.length));
    const startIdx = clampedStart <= 3 ? 0 : clampedStart - 3;
    const endIdx = Math.min(lines.length, Math.max(clampedEnd + 3, startIdx + MAX_SNIPPET_LINES), startIdx + MAX_SNIPPET_LINES);
    return lines.slice(startIdx, endIdx).join('\n').trimEnd();
}

function walkFiles(
    dir: string,
    predicate: (absPath: string, name: string) => boolean,
    maxFiles: number,
    out: string[] = [],
    skipDirs: Set<string> = SKIP_DIRS,
): string[] {
    if (out.length >= maxFiles || !existsSync(dir)) {
        return out;
    }
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (out.length >= maxFiles) break;
        if (entry.isDirectory()) {
            if (skipDirs.has(entry.name)) continue;
            walkFiles(join(dir, entry.name), predicate, maxFiles, out, skipDirs);
        } else if (entry.isFile()) {
            const fullPath = join(dir, entry.name);
            if (predicate(fullPath, entry.name)) {
                out.push(fullPath);
            }
        }
    }
    return out;
}

function findDirCaseInsensitive(parentDir: string, targetLower: string): string | null {
    if (!existsSync(parentDir)) return null;
    try {
        const entries = readdirSync(parentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.toLowerCase() === targetLower) {
                return entry.name;
            }
        }
    } catch {
        return null;
    }
    return null;
}

function resolveInsideRoot(root: string, relOrAbs: string): string | null {
    const rootAbs = resolve(root);
    const targetAbs = isAbsolute(relOrAbs) ? resolve(relOrAbs) : resolve(rootAbs, relOrAbs);
    const rel = relative(rootAbs, targetAbs);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
        return null;
    }
    return targetAbs;
}

function resolveSafeRelativePath(root: string, rawPath: string): { absPath: string; normPath: string } | null {
    const trimmed = rawPath.trim();
    if (!trimmed || isAbsolute(trimmed)) return null;
    const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.split('/').some((seg) => seg === '..')) {
        return null;
    }
    const absPath = resolveInsideRoot(root, normalized);
    if (!absPath) return null;
    const normPath = toPosixPath(relative(resolve(root), absPath));
    return { absPath, normPath };
}

function buildGapStatusMap(artifacts: ConsumerArtifact[]): Map<string, ReconciliationGapStatus> {
    const map = new Map<string, ReconciliationGapStatus>();
    for (const art of artifacts) {
        const gapId = typeof art.metadata?.gapId === 'string' ? art.metadata.gapId.trim() : '';
        if (!gapId) continue;

        const current = map.get(gapId);
        if (art.ktState === 'approved') {
            map.set(gapId, 'resolved');
        } else if (art.ktState === 'proposed' && current !== 'resolved') {
            map.set(gapId, 'staged_in_inbox');
        }
    }
    return map;
}

function isSchemaFile(name: string): boolean {
    const lower = name.toLowerCase();
    return (
        lower.endsWith('.prisma') ||
        lower.endsWith('.sql') ||
        lower.endsWith('.entity.ts') ||
        (lower.includes('ddl') && lower.endsWith('.ts'))
    );
}

function isNonTestCodeFile(name: string): boolean {
    const lower = name.toLowerCase();
    if (
        lower.endsWith('.d.ts') ||
        lower.endsWith('.test.ts') ||
        lower.endsWith('.test.js') ||
        lower.endsWith('.test.mjs') ||
        lower.endsWith('.spec.ts') ||
        lower.endsWith('.spec.js') ||
        lower.endsWith('.spec.mjs')
    ) {
        return false;
    }
    return lower.endsWith('.ts') || lower.endsWith('.js') || lower.endsWith('.mjs');
}

function isNoiseRoute(routeStr: string): boolean {
    const lower = routeStr.trim().toLowerCase();
    if (!lower) return true;
    if (NOISE_ROUTES.has(lower)) return true;
    if (STATIC_ASSET_EXT_RE.test(lower)) return true;
    for (const noise of NOISE_ROUTES) {
        if (lower.endsWith(noise)) return true;
    }
    return false;
}

function isNoiseSchema(tableName: string): boolean {
    return NOISE_SCHEMAS.has(tableName.trim().toLowerCase());
}

function getGitChangedFiles(root: string): Set<string> | null {
    let statusOutput: string;
    try {
        statusOutput = execFileSync('git', ['status', '--porcelain', '-uall'], {
            cwd: root,
            timeout: 4000,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return null;
    }

    const changed = new Set<string>();
    for (const rawLine of statusOutput.split(/\r?\n/)) {
        if (!rawLine || rawLine.length < 4) continue;
        let pathPart = rawLine.slice(3).trim();
        if (pathPart.includes(' -> ')) {
            pathPart = pathPart.split(' -> ').pop()!.trim();
        }
        if (pathPart.startsWith('"') && pathPart.endsWith('"')) {
            pathPart = pathPart.slice(1, -1);
        }
        if (pathPart) {
            changed.add(pathPart.replace(/\\/g, '/'));
        }
    }

    try {
        const diffOutput = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
            cwd: root,
            timeout: 4000,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        for (const line of diffOutput.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) {
                changed.add(trimmed.replace(/\\/g, '/'));
            }
        }
    } catch {
        // Fresh repo without HEAD commit: rely on git status --porcelain entries
    }

    return changed;
}

function loadIgnoreEntries(root: string): ReconcileIgnoreEntry[] {
    const ignorePath = join(root, '.harness', 'reconcile-ignore.json');
    if (!existsSync(ignorePath)) return [];
    const raw = safeReadText(ignorePath);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.entries) ? parsed.entries : [];
        return list.filter((e: any) => e && typeof e === 'object');
    } catch {
        return [];
    }
}

function matchesIgnoreList(gap: ReconciliationGapDto, entries: ReconcileIgnoreEntry[]): boolean {
    for (const entry of entries) {
        if (entry.gapId && entry.gapId === gap.id) return true;
        if (entry.filePath && entry.symbol && entry.filePath === gap.filePath && entry.symbol === gap.symbol) {
            return true;
        }
        if (entry.filePath && !entry.symbol && !entry.gapId && entry.filePath === gap.filePath) {
            return true;
        }
    }
    return false;
}

/**
 * Per-scan bookkeeping for emission caps. When a cap is hit, every remaining candidate of that
 * type is counted as DROPPED (not only the one item where the `>= cap` check fired), so
 * `truncated[type]` is the true number of gaps missing from the result.
 */
class ScanEmissionTracker {
    private readonly dropped: Partial<Record<DiscrepancyType, number>> = {};
    private readonly saturated = new Set<DiscrepancyType>();

    isSaturated(type: DiscrepancyType): boolean {
        return this.saturated.has(type);
    }

    /** Filters a candidate list through `cap`, marking the type saturated and counting the overflow. */
    budget<T>(type: DiscrepancyType, candidates: T[], cap: number): T[] {
        if (this.saturated.has(type)) {
            this.count(type, candidates.length);
            return [];
        }
        // A zero cap only means "no budget left", not that this type is (or is not) overflowing.
        if (cap <= 0) {
            this.count(type, candidates.length);
            return [];
        }
        if (candidates.length <= cap) return candidates;
        this.saturated.add(type);
        this.count(type, candidates.length - cap);
        return candidates.slice(0, cap);
    }

    count(type: DiscrepancyType, n: number): void {
        if (n > 0) this.dropped[type] = (this.dropped[type] ?? 0) + n;
    }

    snapshot(): ReconciliationTruncatedByType {
        return { ...this.dropped };
    }
}

export class ReconciliationScannerService {
    private readonly lastScanCache = new Map<string, ReconciliationScanResultDto>();

    constructor(
        private readonly store: PlatformStore,
        private readonly knowledgeIndex?: KnowledgeIndexService,
    ) {}

    async scan(
        consumerId: string,
        options?: { scope?: ReconciliationScanScope },
    ): Promise<ReconciliationScanResultDto> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }

        const requestedScope: ReconciliationScanScope = options?.scope === 'git-diff' ? 'git-diff' : 'full';
        const scannedAt = new Date().toISOString();
        const artifacts = await this.store.listArtifacts(id);
        const statusByGapId = buildGapStatusMap(artifacts);

        const rawGaps: ReconciliationGapDto[] = [];
        const emissions = new ScanEmissionTracker();
        const root = consumer.root;
        let effectiveScope: ReconciliationScanScope = requestedScope;
        let ignoreEntries: ReconcileIgnoreEntry[] = [];
        let postgresStats: ReconciliationPostgresStatsDto = {
            diskMarkdownCount: 0,
            indexedDocsCount: 0,
            unindexedCount: 0,
            staleDbCount: 0,
            ghostDbCount: 0,
        };
        let pipelineStages: SdlcStageCoverageDto[] = [];

        if (root && existsSync(root)) {
            ignoreEntries = loadIgnoreEntries(root);

            let changedFiles: Set<string> | null = null;
            if (requestedScope === 'git-diff') {
                changedFiles = getGitChangedFiles(root);
                if (changedFiles === null) {
                    effectiveScope = 'full';
                }
            }

            const { sdlcDir, sdlcRootName } = this.resolveSdlcDir(root, consumer.sdlcRoot);
            const sdlcFiles = existsSync(sdlcDir)
                ? walkFiles(sdlcDir, (_p, name) => name.toLowerCase().endsWith('.md'), 1000)
                : [];

            const sdlcDocs: SdlcDocInfo[] = [];
            const docCorpusParts: string[] = [];
            for (const absFile of sdlcFiles) {
                const text = safeReadText(absFile);
                if (text) docCorpusParts.push(text.toLowerCase());
                const relPath = toPosixPath(relative(root, absFile));
                const relFromSdlc = toPosixPath(relative(sdlcDir, absFile));
                const dirFromRoot = toPosixPath(relative(root, dirname(absFile)));
                sdlcDocs.push({
                    relPath,
                    relFromSdlc,
                    lowerRelFromSdlc: relFromSdlc.toLowerCase(),
                    baseNameLower: basename(absFile).toLowerCase(),
                    dirRel: dirFromRoot ? `${dirFromRoot}/` : `${sdlcRootName}/`,
                    frontmatterType: text ? parseFrontmatterType(text) : '',
                });
            }

            // Also include documents/ in doc corpus for route/schema reference checks
            const documentsDirName = findDirCaseInsensitive(root, 'documents');
            if (documentsDirName) {
                const docsFiles = walkFiles(
                    join(root, documentsDirName),
                    (_p, name) => name.toLowerCase().endsWith('.md'),
                    500,
                );
                for (const absFile of docsFiles) {
                    const text = safeReadText(absFile);
                    if (text) docCorpusParts.push(text.toLowerCase());
                }
            }

            const docCorpusLower = docCorpusParts.join('\n');

            const manifestPath = join(root, '.harness', 'knowledge-manifest.json');
            let manifestRaw = '';
            let manifestJson: any = null;
            if (existsSync(manifestPath)) {
                const raw = safeReadText(manifestPath);
                if (raw) {
                    manifestRaw = raw.toLowerCase();
                    try {
                        manifestJson = JSON.parse(raw);
                    } catch {
                        manifestJson = null;
                    }
                }
            }

            // GAP-A: Orphan Routes
            this.scanOrphanRoutes(
                root,
                sdlcRootName,
                docCorpusLower,
                scannedAt,
                statusByGapId,
                changedFiles,
                rawGaps,
                emissions,
            );

            // GAP-B: Unfed Schemas
            this.scanUnfedSchemas(
                root,
                sdlcRootName,
                docCorpusLower,
                scannedAt,
                statusByGapId,
                changedFiles,
                rawGaps,
                emissions,
            );

            // GAP-C: Stale Hashes in .harness/knowledge-manifest.json
            if (manifestJson && typeof manifestJson === 'object') {
                this.scanStaleHashes(root, manifestJson, scannedAt, statusByGapId, changedFiles, rawGaps);
            }

            // GAP-D: Unlinked Spikes in artifacts/ and scratch/
            const promotedArtifactsRaw = Array.isArray(manifestJson?.artifacts)
                ? JSON.stringify(manifestJson.artifacts).toLowerCase()
                : '';
            this.scanUnlinkedSpikes(root, sdlcRootName, docCorpusLower, promotedArtifactsRaw, scannedAt, statusByGapId, changedFiles, rawGaps);

            // GAP-F: Disk *.md <-> PostgreSQL Index Drift (100% shared walker with KnowledgeIndexService)
            const pgResult = await this.scanPostgresIndexDrift(
                id,
                root,
                scannedAt,
                statusByGapId,
                changedFiles,
                rawGaps,
                emissions,
            );
            postgresStats = pgResult.stats;

            // GAP-E: Consumer-Agnostic 17-Stage SDLC Pipeline Coverage (S1..S17)
            pipelineStages = this.evaluatePipelineStages(
                root,
                sdlcRootName,
                sdlcDocs,
                effectiveScope,
                scannedAt,
                statusByGapId,
                pgResult.indexedPaths,
                pgResult.driftGapByPath,
                rawGaps,
                artifacts,
            );
        }

        let ignoredCount = 0;
        const gaps: ReconciliationGapDto[] = [];
        for (const gap of rawGaps) {
            if (matchesIgnoreList(gap, ignoreEntries)) {
                ignoredCount++;
            } else {
                gaps.push(gap);
            }
        }

        const result: ReconciliationScanResultDto = {
            consumerId: id,
            scannedAt,
            scope: effectiveScope,
            ignoredCount,
            postgresStats,
            pipelineStages,
            gaps,
            truncated: emissions.snapshot(),
        };
        this.lastScanCache.set(id, result);
        return result;
    }

    async getLastScan(consumerId: string): Promise<ReconciliationScanResultDto> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }

        const cached = this.lastScanCache.get(id);
        if (!cached) {
            return this.scan(id);
        }

        const artifacts = await this.store.listArtifacts(id);
        const statusByGapId = buildGapStatusMap(artifacts);
        // `...cached` carries `truncated` through untouched: caps are a property of the last scan.
        const refreshed: ReconciliationScanResultDto = {
            ...cached,
            gaps: cached.gaps.map((gap) => ({
                ...gap,
                status: statusByGapId.get(gap.id) ?? gap.status,
            })),
        };
        this.lastScanCache.set(id, refreshed);
        return refreshed;
    }

    async syncIndex(consumerId: string): Promise<ReconciliationScanResultDto> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }
        if (this.knowledgeIndex) {
            await this.knowledgeIndex.index(id);
        }
        return this.scan(id, { scope: 'full' });
    }

    async ignoreGap(consumerId: string, input: IgnoreGapInput): Promise<IgnoreGapResultDto> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }
        if (!consumer.root || !existsSync(consumer.root)) {
            fail('ROOT_NOT_FOUND');
        }
        const gapId = typeof input?.gapId === 'string' ? input.gapId.trim() : '';
        if (!gapId) {
            fail('INVALID_EVENT', 'gapId is required');
        }

        const entries = loadIgnoreEntries(consumer.root);
        const nextEntry: ReconcileIgnoreEntry = {
            gapId,
            filePath: typeof input.filePath === 'string' && input.filePath.trim() ? input.filePath.trim() : undefined,
            symbol: typeof input.symbol === 'string' && input.symbol.trim() ? input.symbol.trim() : undefined,
            reason: typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : undefined,
            ignoredAt: new Date().toISOString(),
        };

        const existingIdx = entries.findIndex((e) => e.gapId === gapId);
        if (existingIdx >= 0) {
            entries[existingIdx] = nextEntry;
        } else {
            entries.push(nextEntry);
        }

        const ignorePath = join(consumer.root, '.harness', 'reconcile-ignore.json');
        atomicWrite(ignorePath, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);

        const cached = this.lastScanCache.get(id);
        if (cached) {
            const beforeLen = cached.gaps.length;
            const remaining = cached.gaps.filter((g) => g.id !== gapId);
            const removed = beforeLen - remaining.length;
            this.lastScanCache.set(id, {
                ...cached,
                gaps: remaining,
                ignoredCount: removed > 0 ? cached.ignoredCount + removed : Math.max(cached.ignoredCount, entries.length),
            });
        }

        return {
            ignored: true,
            gapId,
            ignoredCount: entries.length,
        };
    }

    async relockHash(consumerId: string, input: RelockHashInput): Promise<RelockHashResultDto> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') {
            fail('CONSUMER_NOT_FOUND');
        }
        if (!consumer.root || !existsSync(consumer.root)) {
            fail('ROOT_NOT_FOUND');
        }

        const gapId = typeof input?.gapId === 'string' ? input.gapId.trim() : '';
        const rawFilePath = typeof input?.filePath === 'string' ? input.filePath.trim() : '';
        if (!gapId || !rawFilePath) {
            fail('INVALID_EVENT', 'gapId and filePath are required');
        }

        const safeTarget = resolveSafeRelativePath(consumer.root, rawFilePath);
        if (!safeTarget) {
            fail('INVALID_EVENT', 'filePath must be a safe relative path inside consumer root');
        }

        if (!existsSync(safeTarget.absPath) || !statSync(safeTarget.absPath).isFile()) {
            fail('NOT_FOUND', `File not found: ${safeTarget.normPath}`);
        }

        const manifestPath = join(consumer.root, '.harness', 'knowledge-manifest.json');
        if (!existsSync(manifestPath)) {
            fail('MISSING_MANIFEST', '.harness/knowledge-manifest.json not found');
        }

        let manifest: Record<string, any>;
        try {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        } catch {
            fail('MISSING_MANIFEST', 'Failed to parse .harness/knowledge-manifest.json');
        }

        const currentSha256 = sha256Hex(readFileSync(safeTarget.absPath));
        const candidateLists = [
            manifest.documents,
            manifest.artifacts,
            manifest.files,
            manifest.entries,
        ].filter(Array.isArray) as Array<Array<Record<string, any>>>;

        let updatedCount = 0;
        for (const list of candidateLists) {
            for (const entry of list) {
                if (!entry || typeof entry !== 'object') continue;
                const entryPath = entry.path || entry.target_path || entry.file;
                if (typeof entryPath !== 'string') continue;
                const resolvedEntry = resolveSafeRelativePath(consumer.root, entryPath);
                if (!resolvedEntry || resolvedEntry.normPath !== safeTarget.normPath) continue;

                entry.sha256 = currentSha256;
                if ('hash' in entry) {
                    entry.hash = currentSha256;
                }
                if ('content_hash' in entry) {
                    entry.content_hash = currentSha256;
                }
                updatedCount++;
            }
        }

        if (updatedCount === 0) {
            fail('NOT_FOUND', `Manifest entry not found for ${safeTarget.normPath}`);
        }

        manifest.generated_at = new Date().toISOString();
        atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

        try {
            if (this.knowledgeIndex) {
                await this.knowledgeIndex.index(id);
            }
        } catch {
            // best-effort sync
        }

        const cached = this.lastScanCache.get(id);
        if (cached) {
            this.lastScanCache.set(id, {
                ...cached,
                gaps: cached.gaps.map((gap) => (gap.id === gapId ? { ...gap, status: 'resolved' } : gap)),
            });
        }

        return {
            relocked: true,
            gapId,
            filePath: safeTarget.normPath,
            sha256: currentSha256,
        };
    }

    private resolveSdlcDir(
        root: string,
        sdlcRoot: string | null | undefined,
    ): { sdlcDir: string; sdlcRootName: string } {
        if (sdlcRoot && sdlcRoot.trim()) {
            const trimmed = sdlcRoot.trim();
            const abs = isAbsolute(trimmed) ? trimmed : join(root, trimmed);
            const rel = toPosixPath(relative(root, abs)).replace(/\/+$/, '');
            if (!rel.startsWith('..') && !isAbsolute(rel) && rel) {
                const segments = rel.split('/').filter(Boolean);
                let curDir = root;
                const resolvedSegments: string[] = [];
                for (const seg of segments) {
                    const actual = findDirCaseInsensitive(curDir, seg.toLowerCase()) ?? seg;
                    resolvedSegments.push(actual);
                    curDir = join(curDir, actual);
                }
                const trueRel = resolvedSegments.join('/');
                return { sdlcDir: join(root, trueRel), sdlcRootName: trueRel };
            }
            return { sdlcDir: abs, sdlcRootName: 'sdlc' };
        }
        const detectedName = findDirCaseInsensitive(root, 'sdlc') ?? 'sdlc';
        return { sdlcDir: join(root, detectedName), sdlcRootName: detectedName };
    }

    private async scanPostgresIndexDrift(
        consumerId: string,
        root: string,
        scannedAt: string,
        statusByGapId: Map<string, ReconciliationGapStatus>,
        changedFiles: Set<string> | null,
        out: ReconciliationGapDto[],
        emissions: ScanEmissionTracker,
    ): Promise<{
        stats: ReconciliationPostgresStatsDto;
        indexedPaths: Set<string>;
        driftGapByPath: Map<string, string>;
    }> {
        // Reuse exact shared walker from KnowledgeIndexService so file sets and disk casing match 100%
        const indexablePaths = listIndexableMarkdownFiles(root);
        const diskDocs = new Map<string, { absPath: string; hash: string; lines: string[] }>();

        for (const relPath of indexablePaths) {
            const absPath = join(root, relPath);
            const text = safeReadText(absPath);
            if (text === null) continue;
            diskDocs.set(relPath, {
                absPath,
                hash: sha256Hex(text),
                lines: text.split(/\r?\n/),
            });
        }

        // Compare against the COMPLETE DB side. `knowledgeDocs` is paginated (hard cap 2000),
        // so using it here made every real row past the cap look unindexed — on baplatform
        // (4241 rows) that produced 2242 phantom GAP-F findings and a bogus truncated count.
        let dbRows: Array<{ path: string; contentHash: string }> = [];
        try {
            dbRows = await this.store.knowledgeDocPaths(consumerId);
            if (!Array.isArray(dbRows)) dbRows = [];
        } catch {
            dbRows = [];
        }

        const dbByPath = new Map<string, { path: string; contentHash: string }>();
        for (const doc of dbRows) {
            if (!doc || typeof doc.path !== 'string') continue;
            const normPath = doc.path.replace(/\\/g, '/').replace(/^\.\//, '');
            dbByPath.set(normPath, {
                path: normPath,
                contentHash: typeof doc.contentHash === 'string' ? doc.contentHash.trim() : '',
            });
        }

        const indexedPaths = new Set<string>();
        const staleList: Array<{ relPath: string; diskHash: string; dbHash: string; lines: string[] }> = [];
        const unindexedList: Array<{ relPath: string; lines: string[] }> = [];
        const ghostList: Array<{ relPath: string }> = [];

        for (const [relPath, info] of diskDocs.entries()) {
            const dbRow = dbByPath.get(relPath);
            if (!dbRow) {
                unindexedList.push({ relPath, lines: info.lines });
            } else {
                indexedPaths.add(relPath);
                if (dbRow.contentHash && dbRow.contentHash.toLowerCase() !== info.hash.toLowerCase()) {
                    staleList.push({
                        relPath,
                        diskHash: info.hash,
                        dbHash: dbRow.contentHash,
                        lines: info.lines,
                    });
                }
            }
        }

        for (const [dbPath] of dbByPath.entries()) {
            if (diskDocs.has(dbPath)) continue;
            ghostList.push({ relPath: dbPath });
        }

        const stats: ReconciliationPostgresStatsDto = {
            diskMarkdownCount: diskDocs.size,
            indexedDocsCount: dbByPath.size,
            unindexedCount: unindexedList.length,
            staleDbCount: staleList.length,
            ghostDbCount: ghostList.length,
        };

        // Stale, unindexed and ghost share ONE budget (MAX_INDEX_DRIFT_GAPS), applied in tier order.
        // Everything that survives the scope filter but not the budget is reported as truncated.
        const inScope = <T extends { relPath: string }>(list: T[]): T[] =>
            changedFiles ? list.filter((item) => changedFiles!.has(item.relPath)) : list;
        const scopedStale = emissions.budget('GAP_F_INDEX_DRIFT', inScope(staleList), MAX_INDEX_DRIFT_GAPS);
        const remainingBudget = Math.max(0, MAX_INDEX_DRIFT_GAPS - scopedStale.length);
        const scopedUnindexed = emissions.budget('GAP_F_INDEX_DRIFT', inScope(unindexedList), remainingBudget);
        const ghostBudget = Math.max(0, remainingBudget - scopedUnindexed.length);
        const scopedGhost = emissions.budget('GAP_F_INDEX_DRIFT', inScope(ghostList), ghostBudget);

        const driftGapByPath = new Map<string, string>();

        // 1. Stale DB rows (critical)
        for (const item of scopedStale) {
            const lineCount = Math.max(1, item.lines.length);
            const symbol = `Stale PG Index: ${item.relPath}`;
            const id = makeGapId('GAP_F_INDEX_DRIFT', item.relPath, symbol);
            driftGapByPath.set(item.relPath, id);
            out.push({
                id,
                type: 'GAP_F_INDEX_DRIFT',
                severity: 'critical',
                symbol,
                filePath: item.relPath,
                lines: `1-${lineCount}`,
                detectedAt: scannedAt,
                detail: `PostgreSQL knowledge_doc hash (${item.dbHash.slice(0, 12)}...) is stale compared to disk SHA-256 (${item.diskHash.slice(0, 12)}...) for '${item.relPath}'.`,
                suggestedTarget: item.relPath,
                promptTemplate: `Re-index '${item.relPath}' into PostgreSQL via KnowledgeIndexService so retrieval and governance checks reflect the current disk content.`,
                status: statusByGapId.get(id) ?? 'open',
                codeSnippet: extractCodeSnippet(item.lines, 1, lineCount),
            });
        }

        // 2. Unindexed disk files (warning)
        for (const item of scopedUnindexed) {
            const lineCount = Math.max(1, item.lines.length);
            const symbol = `Unindexed Doc: ${item.relPath}`;
            const id = makeGapId('GAP_F_INDEX_DRIFT', item.relPath, symbol);
            driftGapByPath.set(item.relPath, id);
            out.push({
                id,
                type: 'GAP_F_INDEX_DRIFT',
                severity: 'warning',
                symbol,
                filePath: item.relPath,
                lines: `1-${lineCount}`,
                detectedAt: scannedAt,
                detail: `Indexable markdown file '${item.relPath}' exists on disk but is missing from PostgreSQL knowledge_doc index.`,
                suggestedTarget: item.relPath,
                promptTemplate: `Run PostgreSQL index sync to ingest '${item.relPath}' into knowledge_doc for semantic retrieval and coverage tracking.`,
                status: statusByGapId.get(id) ?? 'open',
                codeSnippet: extractCodeSnippet(item.lines, 1, lineCount),
            });
        }

        // 3. Ghost DB rows (info)
        for (const item of scopedGhost) {
            const symbol = `Ghost PG Row: ${item.relPath}`;
            const id = makeGapId('GAP_F_INDEX_DRIFT', item.relPath, symbol);
            driftGapByPath.set(item.relPath, id);
            out.push({
                id,
                type: 'GAP_F_INDEX_DRIFT',
                severity: 'info',
                symbol,
                filePath: item.relPath,
                lines: '1-1',
                detectedAt: scannedAt,
                detail: `PostgreSQL knowledge_doc still indexes '${item.relPath}', which is no longer an indexable file on disk.`,
                suggestedTarget: item.relPath,
                promptTemplate: `Run PostgreSQL index sync to prune deleted ghost document '${item.relPath}' from knowledge_doc.`,
                status: statusByGapId.get(id) ?? 'open',
            });
        }

        return { stats, indexedPaths, driftGapByPath };
    }

    private evaluatePipelineStages(
        root: string,
        sdlcRootName: string,
        sdlcDocs: SdlcDocInfo[],
        effectiveScope: ReconciliationScanScope,
        scannedAt: string,
        statusByGapId: Map<string, ReconciliationGapStatus>,
        indexedPaths: Set<string>,
        driftGapByPath: Map<string, string>,
        out: ReconciliationGapDto[],
        artifacts: readonly ConsumerArtifact[],
    ): SdlcStageCoverageDto[] {
        const stages: SdlcStageCoverageDto[] = [];

        for (const def of SDLC_PIPELINE_STAGES) {
            if (def.stage === 'S14') {
                const codeRoots = ['eso', 'src', 'apps', 'packages'].map((d) => join(root, d));
                const codeFiles: string[] = [];
                for (const dir of codeRoots) {
                    if (codeFiles.length >= 50) break;
                    if (existsSync(dir)) {
                        walkFiles(dir, (_p, name) => isNonTestCodeFile(name), 50, codeFiles, CODE_SKIP_DIRS);
                    }
                }
                const hasCodeDrift = out.some(
                    (g) => g.type === 'GAP_A_ORPHAN_ROUTE' || g.type === 'GAP_B_UNFED_SCHEMA',
                );
                const firstCodeGap = out.find(
                    (g) => g.type === 'GAP_A_ORPHAN_ROUTE' || g.type === 'GAP_B_UNFED_SCHEMA',
                );
                stages.push({
                    stage: def.stage,
                    group: def.group,
                    label: def.label,
                    leadRole: def.leadRole,
                    expectedFolder: def.canonicalSubfolder,
                    docCount: codeFiles.length,
                    indexedCount: codeFiles.length,
                    status: codeFiles.length === 0 ? 'missing' : hasCodeDrift ? 'drift' : 'covered',
                    gapId: firstCodeGap?.id,
                });
                continue;
            }

            if (def.requiresSignOff || NON_SIGNOFF_D_STAGES.has(def.stage)) {
                // S16/S17: only an approved artifact for the stage can make them `covered` (BR-05).
                // S14 is handled above with code-file counting; S15 (Test) is NOT a sign-off stage and
                // falls through to the normal doc path below, where real index state decides its status.
                const evidenceDoc = sdlcDocs.find((doc) => def.matches(doc));
                const signOff: ConsumerArtifact | undefined = def.requiresSignOff
                    ? findSignOffArtifact(artifacts, def.stage, def.canonicalSubfolder)
                    : undefined;
                stages.push({
                    stage: def.stage,
                    group: def.group,
                    label: def.label,
                    leadRole: def.leadRole,
                    expectedFolder: evidenceDoc?.dirRel ?? `${sdlcRootName}/${def.canonicalSubfolder}`,
                    docCount: evidenceDoc ? 1 : 0,
                    indexedCount: evidenceDoc && indexedPaths.has(evidenceDoc.relPath) ? 1 : 0,
                    status: signOff ? 'covered' : 'missing',
                    // Never invent a gap id here: only a real drift gap for the evidence doc counts.
                    gapId: evidenceDoc ? driftGapByPath.get(evidenceDoc.relPath) : undefined,
                });
                continue;
            }

            const allMatched = sdlcDocs.filter((doc) => def.matches(doc));
            const substantive = allMatched.filter((doc) => !isIndexDoc(doc.baseNameLower));
            const matchedDocs = substantive.length > 0 ? substantive : allMatched;
            const docCount = matchedDocs.length;

            const canonicalFolder = `${sdlcRootName}/${def.canonicalSubfolder}`;
            const expectedFolder = docCount > 0 ? matchedDocs[0].dirRel : canonicalFolder;

            let indexedCount = 0;
            let stageDriftGapId: string | undefined;

            for (const doc of matchedDocs) {
                if (indexedPaths.has(doc.relPath)) {
                    indexedCount++;
                }
                if (!stageDriftGapId && driftGapByPath.has(doc.relPath)) {
                    stageDriftGapId = driftGapByPath.get(doc.relPath);
                }
            }

            if (docCount === 0) {
                let gapId: string | undefined;
                if (def.isDocStage && effectiveScope === 'full') {
                    const symbol = `Missing ${def.stage} (${def.label}) [${def.leadRole}]`;
                    gapId = makeGapId('GAP_E_MISSING_SDLC_DOC', canonicalFolder, symbol);
                    const suggestedTarget = `${canonicalFolder}${def.defaultFileName}`;
                    const severity: DiscrepancySeverity = def.coreSpec ? 'critical' : 'warning';

                    out.push({
                        id: gapId,
                        type: 'GAP_E_MISSING_SDLC_DOC',
                        severity,
                        symbol,
                        filePath: canonicalFolder,
                        lines: '1-1',
                        detectedAt: scannedAt,
                        detail: `Canonical SDLC pipeline stage ${def.stage} (${def.label}, lead: ${def.leadRole}) has 0 markdown documents under '${canonicalFolder}'.`,
                        suggestedTarget,
                        promptTemplate: `Acting as ${def.leadRole}, author the canonical ${def.stage} (${def.label}) specification at '${suggestedTarget}' with valid SDLC YAML frontmatter (id, type, status: DRAFT, owner: ${def.leadRole}) and submit it to the Artifacts Inbox.`,
                        status: statusByGapId.get(gapId) ?? 'open',
                    });
                }

                stages.push({
                    stage: def.stage,
                    group: def.group,
                    label: def.label,
                    leadRole: def.leadRole,
                    expectedFolder: canonicalFolder,
                    docCount: 0,
                    indexedCount: 0,
                    status: 'missing',
                    gapId,
                });
            } else {
                const hasDrift = Boolean(stageDriftGapId) || indexedCount < docCount;
                stages.push({
                    stage: def.stage,
                    group: def.group,
                    label: def.label,
                    leadRole: def.leadRole,
                    expectedFolder,
                    docCount,
                    indexedCount,
                    status: hasDrift ? 'drift' : 'covered',
                    gapId: stageDriftGapId,
                });
            }
        }

        return stages;
    }

    private scanOrphanRoutes(
        root: string,
        sdlcRootName: string,
        docCorpusLower: string,
        scannedAt: string,
        statusByGapId: Map<string, ReconciliationGapStatus>,
        changedFiles: Set<string> | null,
        out: ReconciliationGapDto[],
        emissions: ScanEmissionTracker,
    ): void {
        const searchRoots = ['src', 'apps', 'packages'].map((dir) => join(root, dir));
        const codeFiles: string[] = [];
        for (const dir of searchRoots) {
            if (codeFiles.length >= MAX_CODE_FILES) break;
            if (existsSync(dir)) {
                walkFiles(dir, (_p, name) => isNonTestCodeFile(name), MAX_CODE_FILES, codeFiles, CODE_SKIP_DIRS);
            }
        }

        let found = 0;
        const seen = new Set<string>();

        for (const absPath of codeFiles) {
            const relPath = toPosixPath(relative(root, absPath));
            if (changedFiles && !changedFiles.has(relPath)) continue;

            const content = safeReadText(absPath);
            if (!content) continue;

            const lines = content.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                let method: string | null = null;
                let routeStr: string | null = null;

                const stdMatch = DECORATOR_ROUTE_RE.exec(line) || CALL_ROUTE_RE.exec(line);
                if (stdMatch) {
                    method = stdMatch[1].toUpperCase();
                    routeStr = stdMatch[3].trim();
                } else {
                    const onMatch = ON_ROUTE_RE.exec(line);
                    if (onMatch) {
                        method = onMatch[2].toUpperCase();
                        routeStr = onMatch[4].trim();
                    } else {
                        const bunMatch = BUN_PATHNAME_EQ_RE.exec(line) || BUN_PATHNAME_SW_RE.exec(line);
                        if (bunMatch) {
                            method = 'HTTP';
                            routeStr = bunMatch[2].trim();
                        }
                    }
                }

                if (!method || !routeStr || isNoiseRoute(routeStr)) continue;

                if (docCorpusLower.includes(routeStr.toLowerCase())) {
                    continue;
                }

                const symbol = `${method} ${routeStr}`;
                const dedupKey = `${relPath}:${symbol}`;
                if (seen.has(dedupKey)) continue;
                seen.add(dedupKey);

                if (found >= MAX_GAPS_PER_CATEGORY) {
                    // Budget exhausted: still walk the candidates so the drop count is exact.
                    emissions.count('GAP_A_ORPHAN_ROUTE', 1);
                    continue;
                }

                const id = makeGapId('GAP_A_ORPHAN_ROUTE', relPath, symbol);
                const slug = toSlug(`${method}-${routeStr}`);
                const suggestedTarget = `${sdlcRootName}/07.technical/03.api/${slug}.api.md`;
                const lineRange = `${i + 1}-${i + 1}`;

                out.push({
                    id,
                    type: 'GAP_A_ORPHAN_ROUTE',
                    severity: 'critical',
                    symbol,
                    filePath: relPath,
                    lines: lineRange,
                    detectedAt: scannedAt,
                    detail: `Route '${symbol}' implemented in ${relPath}:${lineRange} is not documented in S8 API contracts (${sdlcRootName}/07.technical/03.api/) or S7 acceptance criteria (${sdlcRootName}/06.analysis/02.ac/).`,
                    suggestedTarget,
                    promptTemplate: `Examine implemented route '${symbol}' at '${relPath}:${lineRange}'. Draft a canonical S8 API contract in '${suggestedTarget}' (and cross-link S7 acceptance criteria under '${sdlcRootName}/06.analysis/02.ac/'), then submit it as a proposed artifact in the Artifacts Inbox.`,
                    status: statusByGapId.get(id) ?? 'open',
                    codeSnippet: extractCodeSnippet(lines, i + 1, i + 1),
                });
                found++;
            }
        }
    }

    private scanUnfedSchemas(
        root: string,
        sdlcRootName: string,
        docCorpusLower: string,
        scannedAt: string,
        statusByGapId: Map<string, ReconciliationGapStatus>,
        changedFiles: Set<string> | null,
        out: ReconciliationGapDto[],
        emissions: ScanEmissionTracker,
    ): void {
        const schemaFileSet = new Set<string>(
            walkFiles(root, (_p, name) => isSchemaFile(name), MAX_SCHEMA_FILES, [], CODE_SKIP_DIRS),
        );

        // Also scan all non-test .ts/.js/.mjs/.sql files under src/, apps/, packages/ for CREATE TABLE
        const codeRoots = ['src', 'apps', 'packages'].map((dir) => join(root, dir));
        for (const dir of codeRoots) {
            if (schemaFileSet.size >= MAX_SCHEMA_FILES * 2) break;
            if (existsSync(dir)) {
                const foundCode = walkFiles(
                    dir,
                    (_p, name) => isNonTestCodeFile(name) || name.toLowerCase().endsWith('.sql'),
                    MAX_CODE_FILES,
                    [],
                    CODE_SKIP_DIRS,
                );
                for (const f of foundCode) schemaFileSet.add(f);
            }
        }

        let found = 0;
        const seen = new Set<string>();
        const suggestedTarget = `${sdlcRootName}/07.technical/02.data-design/03.data-dictionary.md`;

        for (const absPath of schemaFileSet) {
            const relPath = toPosixPath(relative(root, absPath));
            if (changedFiles && !changedFiles.has(relPath)) continue;

            const content = safeReadText(absPath);
            if (!content) continue;

            const lines = content.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                let rawName: string | null = null;
                const prismaMatch = PRISMA_MODEL_RE.exec(line);
                if (prismaMatch) {
                    rawName = prismaMatch[1];
                } else {
                    const sqlMatch = CREATE_TABLE_RE.exec(line);
                    if (sqlMatch) {
                        rawName = sqlMatch[1];
                    } else {
                        const entityMatch = ENTITY_DECORATOR_RE.exec(line);
                        if (entityMatch) {
                            rawName = entityMatch[1];
                        }
                    }
                }

                if (!rawName) continue;
                const tableName = rawName.includes('.') ? rawName.split('.').pop() || rawName : rawName;
                if (!tableName || isNoiseSchema(tableName)) continue;

                if (
                    docCorpusLower.includes(tableName.toLowerCase()) ||
                    docCorpusLower.includes(rawName.toLowerCase())
                ) {
                    continue;
                }

                const symbol = `Schema ${tableName}`;
                const dedupKey = `${relPath}:${symbol}`;
                if (seen.has(dedupKey)) continue;
                seen.add(dedupKey);

                if (found >= MAX_GAPS_PER_CATEGORY) {
                    emissions.count('GAP_B_UNFED_SCHEMA', 1);
                    continue;
                }

                const id = makeGapId('GAP_B_UNFED_SCHEMA', relPath, symbol);
                const lineRange = `${i + 1}-${i + 1}`;

                out.push({
                    id,
                    type: 'GAP_B_UNFED_SCHEMA',
                    severity: 'warning',
                    symbol,
                    filePath: relPath,
                    lines: lineRange,
                    detectedAt: scannedAt,
                    detail: `Schema/table '${tableName}' defined in ${relPath}:${lineRange} is not referenced in ${sdlcRootName}/ or documents/.`,
                    suggestedTarget,
                    promptTemplate: `Analyze schema definition '${tableName}' at '${relPath}:${lineRange}'. Document columns, ownership, and constraints for '${suggestedTarget}' and submit as a proposed artifact in the Artifacts Inbox.`,
                    status: statusByGapId.get(id) ?? 'open',
                    codeSnippet: extractCodeSnippet(lines, i + 1, i + 1),
                });
                found++;
            }
        }

        // Also scan **/schema/*.schema.json files. When struct/sql pass already filled the budget
        // this pass runs purely to count its DROPPED items (nothing is emitted).
        {
            const jsonSchemas = walkFiles(
                root,
                (absPath, name) => {
                    const lowerName = name.toLowerCase();
                    if (!lowerName.endsWith('.schema.json')) return false;
                    const posix = toPosixPath(absPath).toLowerCase();
                    return posix.includes('/schema/');
                },
                100,
                [],
                SKIP_DIRS,
            );

            for (const absPath of jsonSchemas) {
                const relPath = toPosixPath(relative(root, absPath));
                if (changedFiles && !changedFiles.has(relPath)) continue;

                const fileName = basename(relPath);
                const stem = fileName.replace(/\.schema\.json$/i, '');
                if (
                    docCorpusLower.includes(fileName.toLowerCase()) ||
                    docCorpusLower.includes(stem.toLowerCase())
                ) {
                    continue;
                }

                const symbol = `Schema ${fileName}`;
                const dedupKey = `${relPath}:${symbol}`;
                if (seen.has(dedupKey)) continue;
                seen.add(dedupKey);

                if (found >= MAX_GAPS_PER_CATEGORY) {
                    emissions.count('GAP_B_UNFED_SCHEMA', 1);
                    continue;
                }

                const content = safeReadText(absPath) ?? '';
                const lines = content.split(/\r?\n/);
                const lineCount = Math.max(1, lines.length);
                const id = makeGapId('GAP_B_UNFED_SCHEMA', relPath, symbol);

                out.push({
                    id,
                    type: 'GAP_B_UNFED_SCHEMA',
                    severity: 'warning',
                    symbol,
                    filePath: relPath,
                    lines: `1-${lineCount}`,
                    detectedAt: scannedAt,
                    detail: `JSON Schema '${fileName}' at ${relPath} is not referenced in ${sdlcRootName}/ or documents/.`,
                    suggestedTarget,
                    promptTemplate: `Review JSON Schema '${fileName}' at '${relPath}'. Document its contract fields and versioning in '${suggestedTarget}' and submit as a proposed artifact in the Artifacts Inbox.`,
                    status: statusByGapId.get(id) ?? 'open',
                    codeSnippet: extractCodeSnippet(lines, 1, lineCount),
                });
                found++;
            }
        }
    }

    private scanStaleHashes(
        root: string,
        manifest: Record<string, any>,
        scannedAt: string,
        statusByGapId: Map<string, ReconciliationGapStatus>,
        changedFiles: Set<string> | null,
        out: ReconciliationGapDto[],
    ): void {
        const candidateLists = [
            manifest.documents,
            manifest.artifacts,
            manifest.files,
            manifest.entries,
        ].filter(Array.isArray) as Array<Array<Record<string, any>>>;

        const seenPaths = new Set<string>();

        for (const list of candidateLists) {
            for (const entry of list) {
                if (!entry || typeof entry !== 'object') continue;
                const rawPath = entry.path || entry.target_path || entry.file;
                const expectedHash = entry.sha256 || entry.hash || entry.content_hash;
                if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
                if (typeof expectedHash !== 'string' || !expectedHash.trim()) continue;

                const absPath = resolveInsideRoot(root, rawPath.trim());
                if (!absPath || !existsSync(absPath)) continue;

                let stats;
                try {
                    stats = statSync(absPath);
                } catch {
                    continue;
                }
                if (!stats.isFile()) continue;

                const normPath = toPosixPath(relative(root, absPath));
                if (changedFiles && !changedFiles.has(normPath)) continue;
                if (seenPaths.has(normPath)) continue;
                seenPaths.add(normPath);

                let actualHash: string;
                let fileLines: string[];
                try {
                    const buf = readFileSync(absPath);
                    actualHash = sha256Hex(buf);
                    fileLines = buf.toString('utf8').split(/\r?\n/);
                } catch {
                    continue;
                }

                if (actualHash.toLowerCase() === expectedHash.trim().toLowerCase()) {
                    continue;
                }

                const lineCount = Math.max(1, fileLines.length);
                const symbol = `Hash drift: ${normPath}`;
                const id = makeGapId('GAP_C_STALE_HASH', normPath, symbol);
                const suggestedTarget = '.harness/knowledge-manifest.json';

                out.push({
                    id,
                    type: 'GAP_C_STALE_HASH',
                    severity: 'critical',
                    symbol,
                    filePath: normPath,
                    lines: `1-${lineCount}`,
                    detectedAt: scannedAt,
                    detail: `SHA-256 mismatch for '${normPath}': manifest records ${expectedHash.trim().slice(0, 12)}..., disk has ${actualHash.slice(0, 12)}....`,
                    suggestedTarget,
                    promptTemplate: `Inspect '${normPath}' where on-disk SHA-256 (${actualHash.slice(0, 12)}) diverges from '${suggestedTarget}' (${expectedHash.trim().slice(0, 12)}). Reconcile the drift and re-index or submit a proposed update.`,
                    status: statusByGapId.get(id) ?? 'open',
                    codeSnippet: extractCodeSnippet(fileLines, 1, lineCount),
                });
            }
        }
    }

    private scanUnlinkedSpikes(
        root: string,
        sdlcRootName: string,
        docCorpusLower: string,
        manifestRawLower: string,
        scannedAt: string,
        statusByGapId: Map<string, ReconciliationGapStatus>,
        changedFiles: Set<string> | null,
        out: ReconciliationGapDto[],
    ): void {
        const spikeRoots = ['artifacts', 'scratch']
            .map((name) => findDirCaseInsensitive(root, name))
            .filter((name): name is string => Boolean(name))
            .map((name) => join(root, name));

        for (const spikeDir of spikeRoots) {
            const mdFiles = walkFiles(spikeDir, (_p, name) => name.toLowerCase().endsWith('.md'), 200);

            for (const absPath of mdFiles) {
                const relPath = toPosixPath(relative(root, absPath));
                if (changedFiles && !changedFiles.has(relPath)) continue;

                const fileName = basename(relPath);
                const relLower = relPath.toLowerCase();
                const baseLower = fileName.toLowerCase();

                const mentionedInSdlc =
                    docCorpusLower.includes(relLower) || docCorpusLower.includes(baseLower);
                const mentionedInManifest =
                    manifestRawLower.includes(relLower) || manifestRawLower.includes(baseLower);

                if (mentionedInSdlc || mentionedInManifest) {
                    continue;
                }

                const text = safeReadText(absPath) ?? '';
                const fileLines = text.split(/\r?\n/);
                const lineCount = Math.max(1, fileLines.length);
                const slug = toSlug(basename(relPath, '.md'));
                const symbol = `Unlinked spike: ${fileName}`;
                const id = makeGapId('GAP_D_UNLINKED_SPIKE', relPath, symbol);
                const suggestedTarget = `${sdlcRootName}/03.inception/02.decision-log/${slug}.md`;

                out.push({
                    id,
                    type: 'GAP_D_UNLINKED_SPIKE',
                    severity: 'info',
                    symbol,
                    filePath: relPath,
                    lines: `1-${lineCount}`,
                    detectedAt: scannedAt,
                    detail: `Markdown artifact '${relPath}' is not referenced in ${sdlcRootName}/, documents/, or .harness/knowledge-manifest.json.`,
                    suggestedTarget,
                    promptTemplate: `Review '${relPath}' and synthesize its findings into a canonical decision record at '${suggestedTarget}', submitting it as a proposed artifact in the Artifacts Inbox.`,
                    status: statusByGapId.get(id) ?? 'open',
                    codeSnippet: extractCodeSnippet(fileLines, 1, lineCount),
                });
            }
        }
    }
}
