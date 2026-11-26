import type {
    EvidenceReceiptDto,
    KnowledgeSufficiencyDto,
    ReceiptEvidenceSourceDto,
} from '../../../../../../../../libs/api-client/types.js';
import type {
    ActionEventView,
    PreTurnGateView,
    ReceiptVerificationState,
    RequestDetailWithVerdict,
    TokenSummaryView,
    UnifiedGapItem,
} from './request-detail.models.js';
import { toPostTurnGaps } from './request-detail.selectors.js';

export type AxisState = 'strong' | 'partial' | 'weak' | 'not-captured';
export type OverallEffectivenessStatus = 'effective' | 'partial' | 'ineffective' | 'cannot-judge';
export type LearningBranchKind = 'form' | 'obligation' | 'model' | 'retrieval';

export interface ExplicitUnknownItem {
    id: string;
    area: 'pre-turn' | 'receipt' | 'write-gate' | 'architecture' | 'signals' | 'events' | 'knowledge';
    label: string;
    detail: string;
}

export interface LearningHandoffItem {
    branch: LearningBranchKind;
    badge: string;
    title: string;
    reason: string;
    triggeredBy: string[];
    targetRoute: string[];
    queryParams: Record<string, string>;
    actionLabel: string;
}

/** One file the turn touched, with the distinction the audit needs: used, or only loaded. */
export interface RetrievalFileItem {
    path: string;
    label: string;
    used: boolean;
}

export interface RetrievalPrecisionAxis {
    loadedCount: number;
    usedCount: number;
    ratioPct: number | null;
    readToolCount: number;
    searchToolCount: number;
    editToolCount: number;
    reconCallsTotal: number;
    /** Short labels for the card. The card never prints paths; the full list lives in `fileList`. */
    chips: string[];
    /**
     * Every touched file, sorted used-first then by path. The score card shows the progress only; the
     * list is disclosed on demand in a dialog, so the card keeps the same shape as the other four axes.
     */
    fileList: RetrievalFileItem[];
    state: AxisState;
    note: string;
}

export interface SufficiencyCoverageAxis {
    stepsWithEvidence: number | null;
    stepsTotal: number | null;
    coveragePct: number | null;
    verdictScore: number | null;
    gapCount: number;
    diagnosisKind: 'sufficient' | 'insufficient-kb' | 'unsurfaced-retrieval' | 'cannot-judge-model' | 'host-silent' | 'proof-gap';
    diagnosisLabel: string;
    state: AxisState;
}

export interface EvidenceBasisAxis {
    verifiedCount: number;
    retrievedOnlyCount: number;
    unverifiedCount: number;
    totalBasisCount: number;
    verifiedPct: number | null;
    retrievedPct: number | null;
    unverifiedPct: number | null;
    hasUnverifiedGap: boolean;
    readBeforeEditYes: number;
    readBeforeEditTotal: number;
    receiptVerification: ReceiptVerificationState;
    receiptSpecVersion: number | null;
    state: AxisState;
}

export interface ExecutionImpactAxis {
    durationMs: number | null;
    llmCalls: number;
    totalTokens: number | null;
    tokensEstimated: boolean;
    toolCalls: number;
    failures: number | null;
    writeGateStatus: 'allowed' | 'blocked' | 'not-recorded';
    writeGateCode: string | null;
    state: AxisState;
}

export interface ClosedLoopAxis {
    branches: LearningHandoffItem[];
    allClear: boolean;
    state: AxisState;
}

export interface EvidenceEffectivenessView {
    overallStatus: OverallEffectivenessStatus;
    overallLabel: string;
    summary: string;
    capturedAxes: number;
    totalAxes: 5;
    compositePct: number | null;
    axis1: RetrievalPrecisionAxis;
    axis2: SufficiencyCoverageAxis;
    axis3: EvidenceBasisAxis;
    axis4: ExecutionImpactAxis;
    axis5: ClosedLoopAxis;
    receiptSources: ReceiptEvidenceSourceDto[];
    explicitUnknowns: ExplicitUnknownItem[];
}

/**
 * Which side calls actually failed. Both are fetched with `.catch(() => null)` upstream, so a `null`
 * value alone cannot distinguish "the server has nothing" from "the request failed". BR-18 requires
 * the second case to be disclosed, so the page reports it explicitly instead of staying silent.
 */
export interface EvidenceFetchFailures {
    receiptFailed?: boolean;
    kbFailed?: boolean;
}

export interface BuildEvidenceEffectivenessParams {
    detail: RequestDetailWithVerdict;
    preTurnGate: PreTurnGateView | null;
    actionEvents: ActionEventView[];
    tokenSummary: TokenSummaryView;
    fullReceipt: EvidenceReceiptDto | null;
    receiptVerification: ReceiptVerificationState;
    kbSufficiency: KnowledgeSufficiencyDto | null;
    /** Absent ⇒ no fetch was attempted; never inferred from a `null` value. */
    fetchFailures?: EvidenceFetchFailures;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * Short label for a path. The previous version kept the last two path segments, which for a nested
 * doc (`…/01.landscape/05.packages-matrix.md`) was almost as long as the path itself and could drop
 * the extension. The label only has to let a reader recognise the file, so it keeps the basename
 * (with extension) and, when two files share a basename, the shortest parent prefix that differs.
 */
function baseName(filePath: string): string {
    const clean = filePath.trim();
    if (!clean) return '';
    const parts = clean.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : clean;
}

/** Extract server-verified v2 sources from a sealed receipt without inventing entries. */
export function extractReceiptSources(receipt: EvidenceReceiptDto | null | undefined): ReceiptEvidenceSourceDto[] {
    const sources = receipt?.payload?.sources;
    if (!Array.isArray(sources)) return [];
    return sources.map((src) => ({
        requirementId: typeof src.requirementId === 'string' && src.requirementId.trim() ? src.requirementId.trim() : null,
        where: asString(src.where) || '—',
        hash: typeof src.hash === 'string' && src.hash.trim() ? src.hash.trim() : null,
        verifiedAt: asString(src.verifiedAt) || '',
        verified: Boolean(src.verified),
    }));
}

/**
 * Sources ESO itself verified on the trace (`evidence.verified`). This proof is produced at ingest,
 * before any receipt is sealed, so it survives a failed `GET .../receipt` call. Entries are accepted
 * only when `verified === true`: an unproven source must never be promoted to "verified".
 */
export function extractTraceVerifiedSources(detail: RequestDetailWithVerdict | null | undefined): ReceiptEvidenceSourceDto[] {
    const events = Array.isArray(detail?.events) ? detail!.events : [];
    const seen = new Set<string>();
    const out: ReceiptEvidenceSourceDto[] = [];
    for (const event of events) {
        if (event.event !== 'evidence.verified' || !isRecord(event.evidence)) continue;
        const sources = Array.isArray(event.evidence['sources']) ? event.evidence['sources'] : [];
        for (const entry of sources) {
            if (!isRecord(entry) || entry['verified'] !== true) continue;
            const where = asString(entry['where'] ?? entry['id']);
            const hash = asString(entry['hash']) || null;
            const key = `${where}::${hash ?? ''}`;
            if (!where || seen.has(key)) continue;
            seen.add(key);
            out.push({
                requirementId: asString(entry['requirementId']) || null,
                where,
                hash,
                verifiedAt: asString(entry['verifiedAt']) || '',
                verified: true,
            });
        }
    }
    return out;
}

/** BR-18: Deterministically enumerate every missing or unverified evidence dimension. */
export function collectExplicitUnknowns(
    detail: RequestDetailWithVerdict,
    preTurnGate: PreTurnGateView | null,
    receipt: EvidenceReceiptDto | null,
    kbSufficiency: KnowledgeSufficiencyDto | null,
    fetchFailures: EvidenceFetchFailures = {},
): ExplicitUnknownItem[] {
    const unknowns: ExplicitUnknownItem[] = [];
    const events = Array.isArray(detail.events) ? detail.events : [];

    if (!preTurnGate) {
        unknowns.push({
            id: 'no-pre-turn-judgment',
            area: 'pre-turn',
            label: 'No pre-turn judgment recorded',
            detail: 'No observation carried evidence.judgment; pre-turn sufficiency (G-K) cannot be independently verified for this turn.',
        });
    }

    const sources = extractReceiptSources(receipt);
    if (fetchFailures.receiptFailed) {
        // The call failed — distinguish it from a sealed receipt that is merely empty.
        unknowns.push({
            id: 'receipt-fetch-failed',
            area: 'receipt',
            label: 'Receipt request failed',
            detail: 'GET /requests/:requestId/receipt failed; receipt-level source verification is unavailable for this page load.',
        });
    } else if (!receipt) {
        unknowns.push({
            id: 'no-receipt-payload',
            area: 'receipt',
            label: 'Full sealed receipt unavailable',
            detail: 'GET /requests/:requestId/receipt did not return a receipt payload; third-party source verification is unavailable.',
        });
    } else if (sources.length === 0) {
        unknowns.push({
            id: 'no-verified-receipt-sources',
            area: 'receipt',
            label: 'No server-verified receipt sources (sources[])',
            detail: `Receipt spec v${receipt.specVersion} contains 0 server-verified evidence sources; source hashes cannot be audited from the receipt alone.`,
        });
    }

    if (fetchFailures.kbFailed && !kbSufficiency) {
        unknowns.push({
            id: 'kb-sufficiency-unavailable',
            area: 'knowledge',
            label: 'Knowledge sufficiency unavailable',
            detail: 'GET .../knowledge/sufficiency failed for this consumer; the knowledge-axis diagnosis cannot be established for this turn.',
        });
    }

    if (!detail.writeGate) {
        unknowns.push({
            id: 'no-write-gate',
            area: 'write-gate',
            label: 'No write-gate scope decision recorded',
            detail: 'No file-write scope decision (platform.scope_decision) was recorded for this trace.',
        });
    }

    const pipelineActive = (detail.pipeline ?? []).filter((stage) => stage.status !== 'PENDING').length;
    if ((detail.pipeline ?? []).length === 0 || pipelineActive === 0) {
        unknowns.push({
            id: 'no-architecture-graph',
            area: 'architecture',
            label: 'No runtime worker topology captured',
            detail: 'Configured pipeline vs observed worker execution has no active stages captured for this turn.',
        });
    }

    if (!detail.signals) {
        unknowns.push({
            id: 'no-host-signals',
            area: 'signals',
            label: 'Host signals (preflight / recon / distill) not reported',
            detail: 'No decision observation reported preflight, recon, brainTier, or distill telemetry.',
        });
    }

    const hasActionEvents = events.some((e) => {
        const name = asString(e.event).toLowerCase();
        return name.includes('action') || name.includes('tool') || name.includes('write') || name.includes('file');
    });
    if (events.length === 0 || !hasActionEvents) {
        unknowns.push({
            id: 'missing-action-events',
            area: 'events',
            label: 'No action / tool execution events captured',
            detail: events.length === 0
                ? 'Trace contains 0 observations.'
                : 'Observations exist, but none record concrete tool or file action events.',
        });
    }

    if (!kbSufficiency && !fetchFailures.kbFailed) {
        // Quiet absence: the snapshot was not loaded, but the request did not fail either. When the call
        // actually failed, the `kb-sufficiency-unavailable` item above is the precise report — never both.
        unknowns.push({
            id: 'kb-sufficiency-unavailable',
            area: 'knowledge',
            label: 'Consumer knowledge sufficiency snapshot not loaded',
            detail: 'Knowledge sufficiency check (/knowledge/sufficiency) was not available when rendering this view.',
        });
    }

    return unknowns;
}

/**
 * Deduplicate pre-turn and post-turn gaps when decision.recorded mirrors preTurnGate.gaps.
 * Uses multiset union keyed by `code::what` so identical mirrored items are counted once
 * without collapsing distinct occurrences within postGaps.
 */
export function dedupeGaps(preGaps: UnifiedGapItem[], postGaps: UnifiedGapItem[]): UnifiedGapItem[] {
    const exactKey = (g: UnifiedGapItem): string =>
        `${(g.code || '').trim().toUpperCase()}::${(g.what || '').trim().toLowerCase()}`;
    const whatKey = (g: UnifiedGapItem): string => (g.what || '').trim().toLowerCase();
    const postExact = new Map<string, number>();
    const postWhat = new Map<string, number>();
    const merged: UnifiedGapItem[] = [];
    for (const gap of postGaps) {
        const ek = exactKey(gap);
        const wk = whatKey(gap);
        postExact.set(ek, (postExact.get(ek) ?? 0) + 1);
        if (wk) postWhat.set(wk, (postWhat.get(wk) ?? 0) + 1);
        merged.push(gap);
    }
    for (const gap of preGaps) {
        const ek = exactKey(gap);
        const wk = whatKey(gap);
        const exactRem = postExact.get(ek) ?? 0;
        if (exactRem > 0) {
            postExact.set(ek, exactRem - 1);
            if (wk && (postWhat.get(wk) ?? 0) > 0) postWhat.set(wk, (postWhat.get(wk) ?? 1) - 1);
            continue;
        }
        const whatRem = wk ? (postWhat.get(wk) ?? 0) : 0;
        if (whatRem > 0) {
            postWhat.set(wk, whatRem - 1);
            continue;
        }
        merged.push(gap);
    }
    return merged;
}

/** Axis 5 (P5): Deterministically classify turn gaps into the 4 closed-loop SDLC learning branches. */
export function classifyLearningBranches(
    consumerId: string,
    preTurnGate: PreTurnGateView | null,
    postGaps: UnifiedGapItem[],
    explicitUnknowns: ExplicitUnknownItem[],
    detail: RequestDetailWithVerdict,
    kbSufficiency: KnowledgeSufficiencyDto | null,
): LearningHandoffItem[] {
    const safeConsumer = consumerId || detail.request?.consumerId || '';
    const traceId = detail.request?.traceId || detail.request?.id || '';
    const preGaps = preTurnGate?.gaps ?? [];
    const allGaps = dedupeGaps(preGaps, postGaps);
    const codes = allGaps.map((g) => g.code.toUpperCase());
    const preLevel = preTurnGate?.level.toLowerCase() ?? '';
    const cards: LearningHandoffItem[] = [];

    // 1. Form / KB branch
    const formTriggers: string[] = [];
    if (preLevel === 'insufficient') formTriggers.push('pre-turn: insufficient');
    for (const code of codes) {
        if (
            code.includes('MISSING_KIND')
            || code.includes('CONTENT_CONTRADICTS')
            || code.includes('EVIDENCE_MISSING')
            || code.includes('MISSING_EVIDENCE')
        ) {
            formTriggers.push(code);
        }
    }
    if (kbSufficiency && kbSufficiency.status === 'findings') {
        if (kbSufficiency.summary.missingKind > 0) formTriggers.push(`KB missingKind=${kbSufficiency.summary.missingKind}`);
        if (kbSufficiency.summary.contradicts > 0) formTriggers.push(`KB contradicts=${kbSufficiency.summary.contradicts}`);
    }
    if (formTriggers.length > 0) {
        cards.push({
            branch: 'form',
            badge: '① Form / KB',
            title: 'Knowledge Corpus Gap',
            reason: 'Required document kinds, skills, or verified evidence are missing or contradictory in the KB.',
            triggeredBy: Array.from(new Set(formTriggers)),
            targetRoute: safeConsumer ? ['/consumers', safeConsumer, 'settings'] : ['/consumers'],
            queryParams: { tab: 'knowledge', fromTrace: traceId, branch: 'form' },
            actionLabel: 'Inspect Knowledge Base',
        });
    }

    // 2. Obligation / Bar branch
    const obligationTriggers: string[] = [];
    if (preLevel === 'partial') obligationTriggers.push('pre-turn: partial');
    if (detail.writeGate && !detail.writeGate.allowed) {
        obligationTriggers.push(`writeGate: ${detail.writeGate.code || 'BLOCKED'}`);
    }
    for (const code of codes) {
        if (
            code.includes('ROLE_INSUFFICIENT')
            || code.includes('UNSPECIFIED_PARTIAL')
            || code.includes('ACTOR_MISSING')
            || code.includes('SCOPE')
        ) {
            obligationTriggers.push(code);
        }
    }
    if (obligationTriggers.length > 0) {
        cards.push({
            branch: 'obligation',
            badge: '② Obligation / Bar',
            title: 'Role Bar or Scope Gate',
            reason: 'Actor identity, role bar, or write-scope obligation blocked or partially satisfied this turn.',
            triggeredBy: Array.from(new Set(obligationTriggers)),
            targetRoute: safeConsumer ? ['/consumers', safeConsumer, 'learning'] : ['/consumers'],
            queryParams: { branch: 'obligation', fromTrace: traceId },
            actionLabel: 'Open Learning Proposals',
        });
    }

    // 3. Model / Graph branch
    const modelTriggers: string[] = [];
    if (preLevel === 'cannot-judge') modelTriggers.push('pre-turn: cannot-judge');
    for (const code of codes) {
        if (code.includes('NO_REQUIREMENTS') || code.includes('CANNOT_JUDGE') || code.includes('BLAST')) {
            modelTriggers.push(code);
        }
    }
    if (explicitUnknowns.some((u) => u.id === 'no-architecture-graph')) {
        modelTriggers.push('topology: not captured');
    }
    if (modelTriggers.length > 0) {
        cards.push({
            branch: 'model',
            badge: '③ Model / Graph',
            title: 'Model or Blast-Radius Gap',
            reason: 'Architecture graph or requirement model is missing — upgrade the model rather than stuffing extra skills.',
            triggeredBy: Array.from(new Set(modelTriggers)),
            targetRoute: safeConsumer ? ['/consumers', safeConsumer, 'architecture'] : ['/consumers'],
            queryParams: { fromTrace: traceId, branch: 'model' },
            actionLabel: 'Inspect Architecture Graph',
        });
    }

    // 4. Retrieval / Index branch
    const retrievalTriggers: string[] = [];
    if (preLevel === 'unsurfaced') retrievalTriggers.push('pre-turn: unsurfaced');
    for (const code of codes) {
        if (code.includes('EVIDENCE_UNVERIFIED') || code.includes('UNSURFACED') || code.includes('RECON') || code.includes('HOST_SILENT')) {
            retrievalTriggers.push(code);
        }
    }
    const reconCalls = (detail.recon ?? []).reduce((sum, r) => sum + (Number(r.calls) || 0), 0)
        + (detail.signals?.recon ?? []).reduce((sum, r) => sum + (Number(r.calls) || 0), 0);
    if (reconCalls === 0) {
        retrievalTriggers.push('recon calls = 0');
    }
    if (retrievalTriggers.length > 0) {
        cards.push({
            branch: 'retrieval',
            badge: '④ Retrieval / Index',
            title: 'Retrieval / Recon Recall',
            reason: 'Knowledge may exist in the corpus but was not surfaced or verified during recon; audit hybrid retrieval & index.',
            triggeredBy: Array.from(new Set(retrievalTriggers)),
            targetRoute: safeConsumer ? ['/consumers', safeConsumer, 'learning'] : ['/consumers'],
            queryParams: { branch: 'retrieval', fromTrace: traceId },
            actionLabel: 'Review Retrieval in Learning',
        });
    }

    return cards;
}

function buildAxis1RetrievalPrecision(detail: RequestDetailWithVerdict): RetrievalPrecisionAxis {
    const loadedSet = new Set<string>();
    const usedSet = new Set<string>();
    const chips: string[] = [];

    const rawFiles = Array.isArray(detail.telemetry?.files) ? detail.telemetry.files : [];
    for (const item of rawFiles) {
        if (typeof item === 'string' && item.trim()) {
            loadedSet.add(item.trim());
        } else if (isRecord(item)) {
            const p = asString(item['path'] ?? item['file'] ?? item['target']);
            if (p) {
                loadedSet.add(p);
                const op = asString(item['op'] ?? item['action'] ?? item['kind']).toLowerCase();
                if (op.includes('edit') || op.includes('write') || op.includes('create') || op.includes('modify')) {
                    usedSet.add(p);
                }
            }
        }
    }

    // Files referenced in action.recorded events count as used
    for (const evt of detail.events ?? []) {
        if (evt.event !== 'action.recorded' || !isRecord(evt.evidence)) continue;
        const files = Array.isArray(evt.evidence['files']) ? evt.evidence['files'] : [];
        for (const f of files) {
            const s = asString(f);
            if (s) {
                usedSet.add(s);
                loadedSet.add(s);
            }
        }
    }

    // Rule refs cited in verdict count as used evidence
    for (const ref of detail.verdict?.ruleRefs ?? []) {
        const p = asString(ref.path);
        if (p) {
            usedSet.add(p);
            loadedSet.add(p);
        }
    }

    // Classify tool calls (read / search / grep / edit)
    let readToolCount = 0;
    let searchToolCount = 0;
    let editToolCount = 0;
    const rawTools = Array.isArray(detail.telemetry?.tools) ? detail.telemetry.tools : [];
    for (const tool of rawTools) {
        const name = (typeof tool === 'string' ? tool : isRecord(tool) ? asString(tool['name'] ?? tool['tool']) : '').toLowerCase();
        if (!name) continue;
        if (name.includes('read') || name.includes('view') || name.includes('cat') || name.includes('open')) readToolCount += 1;
        else if (name.includes('search') || name.includes('grep') || name.includes('find') || name.includes('glob') || name.includes('graph') || name.includes('memory')) searchToolCount += 1;
        else if (name.includes('edit') || name.includes('write') || name.includes('replace') || name.includes('patch')) editToolCount += 1;
    }

    // Recon adapter calls
    const reconSignalCalls = (detail.signals?.recon ?? []).reduce((sum, r) => sum + (Number(r.calls) || 0), 0);
    const reconTableCalls = (detail.recon ?? []).reduce((sum, r) => sum + (Number(r.calls) || 0), 0);
    const reconCallsTotal = Math.max(reconSignalCalls, reconTableCalls);

    for (const r of detail.signals?.recon ?? []) {
        if (r.adapter && r.calls > 0) chips.push(`${r.adapter} (${r.calls})`);
    }
    if (chips.length === 0) {
        for (const r of detail.recon ?? []) {
            if (r.calls > 0) chips.push(`${r.label || r.id} (${r.calls})`);
        }
    }
    // The card shows progress only; `fileList` carries the full set for the on-demand dialog.
    // Used files come first because they explain the ratio; each entry keeps the used/loaded split
    // the audit needs, which the card can no longer show.
    const fileList: RetrievalFileItem[] = Array.from(loadedSet)
        .map((path) => ({ path, label: baseName(path), used: usedSet.has(path) }))
        .sort((left, right) => (left.used === right.used ? left.path.localeCompare(right.path) : left.used ? -1 : 1));
    const usedLabels = fileList.filter((item) => item.used).map((item) => item.label);
    if (usedLabels.length) chips.push(usedLabels[0]);
    if (loadedSet.size > 1) chips.push(`+${loadedSet.size - 1} more`);

    const loadedCount = loadedSet.size;
    const usedCount = usedSet.size;
    const ratioPct = loadedCount > 0 ? Math.min(100, Math.round((usedCount / loadedCount) * 100)) : null;

    let state: AxisState = 'not-captured';
    let note = 'No file reads or recon calls captured for this turn.';
    if (ratioPct !== null) {
        if (ratioPct >= 60) {
            state = 'strong';
            note = `${usedCount} of ${loadedCount} touched file(s) cited in actions or verdict rules.`;
        } else if (ratioPct >= 25) {
            state = 'partial';
            note = `${usedCount} of ${loadedCount} touched file(s) directly used; some context may be noisy.`;
        } else {
            state = 'weak';
            note = `Only ${usedCount} of ${loadedCount} touched file(s) appeared in actions or rules.`;
        }
    } else if (reconCallsTotal > 0 || readToolCount + searchToolCount > 0) {
        state = 'partial';
        note = `${reconCallsTotal} recon call(s) · ${readToolCount + searchToolCount} read/search tool(s); file-level list not captured.`;
    }

    return {
        loadedCount,
        usedCount,
        ratioPct,
        readToolCount,
        searchToolCount,
        editToolCount,
        reconCallsTotal,
        chips: chips.slice(0, 6),
        fileList,
        state,
        note,
    };
}

function buildAxis2SufficiencyCoverage(
    detail: RequestDetailWithVerdict,
    preTurnGate: PreTurnGateView | null,
    postGaps: UnifiedGapItem[],
): SufficiencyCoverageAxis {
    const stepsWithEvidence = typeof detail.effectiveness?.stepsWithEvidence === 'number'
        ? detail.effectiveness.stepsWithEvidence
        : null;
    const stepsTotal = typeof detail.effectiveness?.stepsTotal === 'number'
        ? detail.effectiveness.stepsTotal
        : (detail.systemStages?.length ? detail.systemStages.length : null);
    const verdictScore = typeof detail.verdict?.score === 'number' ? detail.verdict.score : null;
    const mergedGaps = dedupeGaps(preTurnGate?.gaps ?? [], postGaps);
    const allCodes = mergedGaps.map((g) => g.code.toUpperCase());
    const gapCount = mergedGaps.length;
    const preLevel = preTurnGate?.level.toLowerCase() ?? '';

    const coveragePct = stepsWithEvidence !== null && stepsTotal && stepsTotal > 0
        ? Math.min(100, Math.round((stepsWithEvidence / stepsTotal) * 100))
        : verdictScore;

    let diagnosisKind: SufficiencyCoverageAxis['diagnosisKind'] = 'sufficient';
    let diagnosisLabel = 'Sufficient';

    if (allCodes.some((c) => c.includes('HOST_SILENT')) || (stepsWithEvidence === 0 && verdictScore === null)) {
        diagnosisKind = 'host-silent';
        diagnosisLabel = 'Host silent (HOST_SILENT)';
    } else if (preLevel === 'unsurfaced' || allCodes.some((c) => c.includes('UNSURFACED'))) {
        diagnosisKind = 'unsurfaced-retrieval';
        diagnosisLabel = 'Retrieval miss (unsurfaced)';
    } else if (preLevel === 'cannot-judge' || allCodes.some((c) => c.includes('CANNOT_JUDGE') || c.includes('NO_REQUIREMENTS'))) {
        diagnosisKind = 'cannot-judge-model';
        diagnosisLabel = 'Model / Graph gap (cannot-judge)';
    } else if (
        preLevel === 'insufficient'
        || allCodes.some((c) => c.includes('MISSING_KIND') || c.includes('CONTENT_CONTRADICTS') || c.includes('EVIDENCE_MISSING') || c.includes('MISSING_EVIDENCE'))
    ) {
        diagnosisKind = 'insufficient-kb';
        diagnosisLabel = 'KB gap (insufficient)';
    } else if (gapCount > 0 || detail.verdict?.level === 'deny' || detail.verdict?.level === 'partial') {
        diagnosisKind = 'proof-gap';
        diagnosisLabel = `${gapCount} proof gap(s)`;
    } else if (coveragePct === null) {
        diagnosisKind = 'host-silent';
        diagnosisLabel = 'Not captured';
    }

    let state: AxisState = 'not-captured';
    if (coveragePct !== null) {
        if (diagnosisKind === 'sufficient' && coveragePct >= 75 && (verdictScore === null || verdictScore >= 80)) {
            state = 'strong';
        } else if (coveragePct >= 40 && diagnosisKind !== 'host-silent' && detail.verdict?.level !== 'deny') {
            state = 'partial';
        } else {
            state = 'weak';
        }
    }

    return {
        stepsWithEvidence,
        stepsTotal,
        coveragePct,
        verdictScore,
        gapCount,
        diagnosisKind,
        diagnosisLabel,
        state,
    };
}

function buildAxis3EvidenceBasis(
    detail: RequestDetailWithVerdict,
    preTurnGate: PreTurnGateView | null,
    postGaps: UnifiedGapItem[],
    actionEvents: ActionEventView[],
    receiptSources: ReceiptEvidenceSourceDto[],
    fullReceipt: EvidenceReceiptDto | null,
    receiptVerification: ReceiptVerificationState,
): EvidenceBasisAxis {
    const verifiedCount = receiptSources.filter((s) => s.verified).length;
    const unverifiedSourceCount = receiptSources.filter((s) => !s.verified).length;
    const allCodes = dedupeGaps(preTurnGate?.gaps ?? [], postGaps).map((g) => g.code.toUpperCase());
    const hasUnverifiedGap = allCodes.some((c) => c.includes('EVIDENCE_UNVERIFIED'));

    // Retrieved-only = ruleRefs + recon adapters observed that are not already counted in verified receipt sources
    const ruleRefCount = detail.verdict?.ruleRefs?.length ?? 0;
    const retrievedOnlyCount = Math.max(0, ruleRefCount - verifiedCount);
    const unverifiedCount = unverifiedSourceCount + (hasUnverifiedGap && unverifiedSourceCount === 0 ? 1 : 0);
    const totalBasisCount = verifiedCount + retrievedOnlyCount + unverifiedCount;

    const verifiedPct = totalBasisCount > 0 ? Math.round((verifiedCount / totalBasisCount) * 100) : null;
    const retrievedPct = totalBasisCount > 0 ? Math.round((retrievedOnlyCount / totalBasisCount) * 100) : null;
    const unverifiedPct = totalBasisCount > 0 ? Math.max(0, 100 - (verifiedPct ?? 0) - (retrievedPct ?? 0)) : null;

    const rbeMeasured = actionEvents.filter((a) => a.readBeforeEdit === 'yes' || a.readBeforeEdit === 'no');
    const readBeforeEditYes = rbeMeasured.filter((a) => a.readBeforeEdit === 'yes').length;
    const readBeforeEditTotal = rbeMeasured.length;
    const receiptSpecVersion = fullReceipt?.specVersion ?? detail.receipt?.specVersion ?? null;

    let state: AxisState = 'not-captured';
    // Every source is server-verified on the trace or in the receipt, with nothing contradicting it.
    // This is provable without the recompute endpoint, so it must not decay to "partial" when the
    // verification call did not run — the proof is the sources, not the call.
    const allSourcesVerified = verifiedCount > 0 && unverifiedCount === 0;
    if (receiptVerification === 'failed' || hasUnverifiedGap || (totalBasisCount > 0 && unverifiedCount > verifiedCount)) {
        state = 'weak';
    } else if (receiptVerification === 'verified' && verifiedCount > 0 && unverifiedCount === 0) {
        state = 'strong';
    } else if (allSourcesVerified) {
        // Reached only when `receiptVerification !== 'failed'` (the first branch already returned 'weak').
        state = 'strong';
    } else if (receiptVerification === 'verified' || totalBasisCount > 0 || readBeforeEditTotal > 0) {
        state = 'partial';
    }

    return {
        verifiedCount,
        retrievedOnlyCount,
        unverifiedCount,
        totalBasisCount,
        verifiedPct,
        retrievedPct,
        unverifiedPct,
        hasUnverifiedGap,
        readBeforeEditYes,
        readBeforeEditTotal,
        receiptVerification,
        receiptSpecVersion,
        state,
    };
}

function buildAxis4ExecutionImpact(
    detail: RequestDetailWithVerdict,
    tokenSummary: TokenSummaryView,
): ExecutionImpactAxis {
    const durationMs = typeof detail.effectiveness?.durationMs === 'number'
        ? detail.effectiveness.durationMs
        : null;
    const llmCalls = detail.telemetry?.llmCalls?.length ?? 0;
    const toolCalls = detail.telemetry?.tools?.length ?? 0;
    const failures = typeof detail.effectiveness?.failures === 'number'
        ? detail.effectiveness.failures
        : null;

    const hasTokens = tokenSummary.input !== null || tokenSummary.output !== null || tokenSummary.cacheRead !== null;
    const totalTokens = hasTokens
        ? (tokenSummary.input ?? 0) + (tokenSummary.output ?? 0) + (tokenSummary.cacheRead ?? 0)
        : null;

    const writeGateStatus: ExecutionImpactAxis['writeGateStatus'] = detail.writeGate
        ? (detail.writeGate.allowed ? 'allowed' : 'blocked')
        : 'not-recorded';
    const writeGateCode = detail.writeGate?.code ?? null;

    const hasAnyExec = durationMs !== null || llmCalls > 0 || totalTokens !== null || toolCalls > 0 || failures !== null || detail.writeGate !== null;
    let state: AxisState = 'not-captured';
    if (hasAnyExec) {
        if (writeGateStatus === 'blocked' || (failures !== null && failures > 0)) {
            state = 'weak';
        } else if (durationMs !== null || totalTokens !== null || llmCalls > 0) {
            state = 'strong';
        } else {
            state = 'partial';
        }
    }

    return {
        durationMs,
        llmCalls,
        totalTokens,
        tokensEstimated: tokenSummary.estimated,
        toolCalls,
        failures,
        writeGateStatus,
        writeGateCode,
        state,
    };
}

function axisScoreOf(state: AxisState): number | null {
    if (state === 'strong') return 100;
    if (state === 'partial') return 60;
    if (state === 'weak') return 20;
    return null;
}

/** Build the complete 5-Axis Evidence Effectiveness view strictly from real backend DTOs (BR-12). */
export function buildEvidenceEffectivenessView(params: BuildEvidenceEffectivenessParams): EvidenceEffectivenessView {
    const { detail, preTurnGate, actionEvents, tokenSummary, fullReceipt, receiptVerification, kbSufficiency } = params;
    const fetchFailures = params.fetchFailures ?? {};
    const postGaps = toPostTurnGaps(detail.verdict?.gaps ?? []);
    const receiptSources = extractReceiptSources(fullReceipt);
    // The sealed receipt is the stronger proof; the trace's own `evidence.verified` is the fallback that
    // keeps Axis 3 honest when the receipt call failed. Both are server proofs — never an inference.
    const receiptSourcesForAxis = receiptSources.length > 0 ? receiptSources : extractTraceVerifiedSources(detail);
    const explicitUnknowns = collectExplicitUnknowns(detail, preTurnGate, fullReceipt, kbSufficiency, fetchFailures);

    const axis1 = buildAxis1RetrievalPrecision(detail);
    const axis2 = buildAxis2SufficiencyCoverage(detail, preTurnGate, postGaps);
    const axis3 = buildAxis3EvidenceBasis(detail, preTurnGate, postGaps, actionEvents, receiptSourcesForAxis, fullReceipt, receiptVerification);
    const axis4 = buildAxis4ExecutionImpact(detail, tokenSummary);

    const learningBranches = classifyLearningBranches(
        detail.request.consumerId,
        preTurnGate,
        postGaps,
        explicitUnknowns,
        detail,
        kbSufficiency,
    );
    const axis5: ClosedLoopAxis = {
        branches: learningBranches,
        allClear: learningBranches.length === 0,
        state: learningBranches.length === 0
            ? (detail.verdict ? 'strong' : 'not-captured')
            : learningBranches.length >= 3
                ? 'weak'
                : 'partial',
    };

    const states: AxisState[] = [axis1.state, axis2.state, axis3.state, axis4.state, axis5.state];
    const scores = states.map(axisScoreOf).filter((s): s is number => s !== null);
    const capturedAxes = scores.length;
    const compositePct = scores.length > 0
        ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
        : null;

    let overallStatus: OverallEffectivenessStatus = 'cannot-judge';
    let overallLabel = 'Cannot judge — missing evidence';

    if (capturedAxes === 0 || (!detail.verdict && !preTurnGate && detail.events.length === 0)) {
        overallStatus = 'cannot-judge';
        overallLabel = 'Cannot judge — missing evidence';
    } else if (
        detail.verdict?.level === 'deny'
        || receiptVerification === 'failed'
        || axis2.diagnosisKind === 'host-silent'
        || (compositePct !== null && compositePct < 45)
    ) {
        overallStatus = 'ineffective';
        overallLabel = 'Ineffective / Unverified';
    } else if (
        detail.verdict?.level === 'allow'
        && axis2.gapCount === 0
        && !axis3.hasUnverifiedGap
        && (compositePct ?? 0) >= 80
    ) {
        overallStatus = 'effective';
        overallLabel = 'Effective with proof';
    } else {
        overallStatus = 'partial';
        overallLabel = 'Partially effective — gaps found';
    }

    const reasons: string[] = [];
    if (overallStatus === 'cannot-judge') {
        reasons.push('Telemetry and verdict signals are too sparse to judge whether evidence helped this prompt.');
    } else if (overallStatus === 'effective') {
        reasons.push(`Verdict allowed (score ${detail.verdict?.score ?? '—'}/100) with ${axis3.verifiedCount} verified receipt source(s) and 0 blocking gaps.`);
    } else {
        if (axis2.diagnosisKind !== 'sufficient') reasons.push(`Sufficiency diagnosed as ${axis2.diagnosisLabel}.`);
        if (axis3.hasUnverifiedGap || receiptVerification === 'failed') reasons.push('Unverified evidence or receipt check failure lowered trust.');
        if (axis4.writeGateStatus === 'blocked') reasons.push(`Write gate blocked target (${axis4.writeGateCode || 'scope'}).`);
        if (axis5.branches.length > 0) reasons.push(`${axis5.branches.length} closed-loop learning branch(es) flagged for remediation.`);
        if (reasons.length === 0) reasons.push(`${capturedAxes}/5 axes captured with ${explicitUnknowns.length} explicit unknown(s).`);
    }

    return {
        overallStatus,
        overallLabel,
        summary: reasons.slice(0, 2).join(' '),
        capturedAxes,
        totalAxes: 5,
        compositePct,
        axis1,
        axis2,
        axis3,
        axis4,
        axis5,
        receiptSources,
        explicitUnknowns,
    };
}
