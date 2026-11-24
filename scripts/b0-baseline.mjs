#!/usr/bin/env node
/**
 * B0 baseline harness — score the ten B0 capability items (audit §0.1) from the read-only
 * request-detail projection.
 *
 *   node scripts/b0-baseline.mjs --base http://127.0.0.1:8787 --consumer fineso --limit 20
 *   node scripts/b0-baseline.mjs --fixture --json /tmp/b0-baseline.json
 *
 * Source of the ten items: `sdlc/02.governance/02.records/25.expectation-gap-audit.md` §0.1
 * (B0-1 … B0-10). The harness only reads; it never writes product data.
 *
 * Contract:
 * - one item = `{id, present, evidence}`. `present` means the capability was observed in at
 *   least one sampled turn; `perTurn` records which turns carried it.
 * - `score` is the number of present items (0..10) — a floor, not a percentage.
 * - measurement never fails a build: exit 0 for any score, 2 only for invalid arguments.
 *   A server that cannot be reached yields a zero-turn report plus an `error` field.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BASE = 'http://127.0.0.1:8787';
export const DEFAULT_CONSUMER = 'fineso';
export const DEFAULT_LIMIT = 20;
export const DEFAULT_USER = 'operator';
export const DEFAULT_PASSWORD = 'eso-dev-only-token';
export const B0_MAX = 10;
export const MAX_LIMIT = 200;
export const EVIDENCE_MAX = 180;

/** The ten B0 items, in audit order. `label` is documentation only — output stays `{id,present,evidence}`. */
export const B0_ITEMS = Object.freeze([
    { id: 'B0-1', label: 'Preflight HOT/WARM/COLD + fingerprint G1/G2 + consent' },
    { id: 'B0-2', label: 'Law Gate with evidence (attached[].filePath)' },
    { id: 'B0-3', label: 'Decision Facade: winner, jevMode, enforcedVerdict, latency, HIL' },
    { id: 'B0-4', label: 'Recon adapter + real call count' },
    { id: 'B0-5', label: 'Sufficiency score/gaps + receipt' },
    { id: 'B0-6', label: 'Brain tier zero/flash/pro' },
    { id: 'B0-7', label: 'Execution: tool/edit/read-before-edit, files touched' },
    { id: 'B0-8', label: 'Distillation / memory save event' },
    { id: 'B0-9', label: 'Spec ↔ Trace toggle (normative reference)' },
    { id: 'B0-10', label: 'Design graph ↔ runtime graph' },
]);

/** Secrets embedded in the fixture so a test can prove no prompt body reaches the report. */
export const FIXTURE_SECRETS = Object.freeze([
    'FIXTURE-SECRET-QUERY-B0',
    'FIXTURE-SECRET-PROMPT-B0',
    'FIXTURE-SECRET-BODY-B0',
]);

export class UsageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UsageError';
        this.exitCode = 2;
    }
}

/* ------------------------------------------------------------------ */
/* Small read helpers                                                  */
/* ------------------------------------------------------------------ */

const str = (value) => (typeof value === 'string' ? value.trim() : '');
const arr = (value) => (Array.isArray(value) ? value : []);
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const PLACEHOLDERS = new Set(['', '—', '-', 'none', 'null', 'undefined', 'false', 'n/a', 'na']);

function meaningful(value) {
    if (value === true) return true;
    if (typeof value === 'string') return !PLACEHOLDERS.has(value.trim().toLowerCase());
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return false;
}

/** Collect every `{key, value}` whose key matches (case-insensitive) at any depth. */
export function collectKeyed(root, names) {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    const hits = [];
    const seen = new Set();
    const visit = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            for (const entry of node.slice(0, 400)) visit(entry, depth + 1);
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (wanted.has(key.toLowerCase())) hits.push({ key, value });
            visit(value, depth + 1);
        }
    };
    visit(root, 0);
    return hits;
}

/** Visit every plain object in the tree (arrays included). */
export function walkObjects(root, visit, depth = 0, seen = new Set()) {
    if (!root || typeof root !== 'object' || depth > 8 || seen.has(root)) return;
    seen.add(root);
    if (Array.isArray(root)) {
        for (const entry of root.slice(0, 400)) walkObjects(entry, visit, depth + 1, seen);
        return;
    }
    visit(root);
    for (const value of Object.values(root)) walkObjects(value, visit, depth + 1, seen);
}

function clip(text, max = EVIDENCE_MAX) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function unique(values) {
    return [...new Set(values.filter((value) => meaningful(value)).map((value) => String(value).trim()))];
}

/* ------------------------------------------------------------------ */
/* Item detectors                                                      */
/* ------------------------------------------------------------------ */

function detectPreflight(detail) {
    const events = arr(detail?.events).filter((event) => /preflight|consent/i.test(str(event?.event)));
    const checks = arr(detail?.checks).filter(
        (check) => /preflight|consent|fingerprint/i.test(str(check?.checkId)) && /pass|ok/i.test(str(check?.status)),
    );
    const hits = collectKeyed(detail, ['preflight', 'preflightChecks', 'consent', 'fingerprint', 'fingerprints']).filter(({ value }) =>
        meaningful(value),
    );
    const facts = unique([
        ...hits.flatMap(({ value }) => {
            if (typeof value === 'string') return [value];
            if (value && typeof value === 'object') return Object.entries(value).slice(0, 3).map(([key, item]) => `${key}=${typeof item === 'object' ? '…' : item}`);
            return [];
        }),
        ...events.map((event) => `event ${str(event.event)}`),
        ...checks.map((check) => `check ${str(check.checkId)}`),
    ]);
    if (facts.length === 0) {
        return { present: false, evidence: 'no HOT/WARM/COLD preflight, fingerprint G1/G2 or consent record' };
    }
    return { present: true, evidence: `preflight/consent: ${facts.slice(0, 4).join(', ')}` };
}

function detectLawProof(detail) {
    const attached = [];
    walkObjects(detail, (object) => {
        const entries = Array.isArray(object.attached) ? object.attached : [];
        for (const entry of entries) {
            if (entry && typeof entry === 'object' && str(entry.filePath)) attached.push(str(entry.filePath));
        }
    });
    for (const { key, value } of collectKeyed(detail, ['ruleRefs', 'rule_refs', 'refs', 'attached', 'rules'])) {
        const list = Array.isArray(value) ? value : [value];
        for (const entry of list) {
            if (!entry || typeof entry !== 'object') continue;
            const refPath = str(entry.filePath ?? entry.path ?? entry.file);
            if (!refPath) continue;
            const kind = str(entry.kind ?? entry.type ?? key).toLowerCase();
            if (key.toLowerCase() === 'refs' && !/rule|law|decision|doc|spec/.test(kind)) continue;
            attached.push(refPath);
        }
    }
    const files = unique(attached);
    if (files.length > 0) {
        return { present: true, evidence: `${files.length} rule file(s) attached: ${files.slice(0, 2).map((file) => path.basename(file)).join(', ')}` };
    }
    const layers = arr(detail?.recon).filter((adapter) => /law/i.test(str(adapter?.kind)) || /law/i.test(str(adapter?.id)));
    const stage = arr(detail?.systemStages).find((item) => str(item?.id) === 'law');
    const configured = layers.length > 0 || Boolean(stage);
    return {
        present: false,
        evidence: configured
            ? 'law layer configured only (0 attached[].filePath, 0 calls)'
            : 'no law layer and no attached[].filePath',
    };
}

function nonEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0 && !PLACEHOLDERS.has(value.trim().toLowerCase());
}

function detectDecision(detail) {
    const facade = [];
    walkObjects(detail, (object) => {
        const hasFacade = ['winner', 'jevMode', 'jev_mode', 'enforcedVerdict', 'enforced_verdict'].some((key) => nonEmpty(object[key]));
        if (!hasFacade) return;
        const parts = ['winner', 'jevMode', 'jev_mode', 'enforcedVerdict', 'enforced_verdict', 'latencyMs', 'hil']
            .map((key) => (meaningful(object[key]) ? `${key}=${object[key]}` : ''))
            .filter(Boolean);
        facade.push(parts.join(' '));
    });
    const verdicts = collectKeyed(detail, ['verdict', 'turnVerdict', 'judgment'])
        .map(({ value }) => value)
        .filter((value) => value && typeof value === 'object')
        .filter((value) => nonEmpty(value.level) || nonEmpty(value.verdict) || typeof value.pass === 'boolean');
    if (facade.length > 0) return { present: true, evidence: clip(facade[0]) };
    if (verdicts.length > 0) {
        const value = verdicts[0];
        const level = str(value.level ?? value.verdict ?? (typeof value.pass === 'boolean' ? (value.pass ? 'pass' : 'fail') : ''));
        const basis = str(value.basis);
        const actor = value.actor && typeof value.actor === 'object' ? str(value.actor.id ?? value.actor.kind) : str(value.actor);
        return {
            present: true,
            evidence: `verdict ${level}${basis ? ` · basis ${basis}` : ''}${actor ? ` · actor ${actor}` : ''}`,
        };
    }
    return { present: false, evidence: 'no winner/jevMode/enforcedVerdict/latency/HIL and no verdict object' };
}

function eventReconCalls(detail) {
    let calls = 0;
    for (const event of arr(detail?.events)) {
        const reported = event?.evidence?.recon;
        if (!Array.isArray(reported)) continue;
        for (const entry of reported) {
            if (!entry || typeof entry !== 'object') continue;
            const name = str(entry.adapter ?? entry.id);
            if (!name) continue;
            calls += num(entry.calls) ?? 1;
        }
    }
    return calls;
}

function detectRecon(detail) {
    const adapters = arr(detail?.recon);
    const configured = adapters.length;
    const calls = adapters.reduce((sum, adapter) => sum + (num(adapter?.calls) ?? 0), 0);
    const observed = adapters.filter((adapter) => str(adapter?.status) === 'observed').length;
    const fallback = eventReconCalls(detail);
    const total = calls || fallback;
    if (total > 0 || observed > 0) {
        return {
            present: true,
            evidence: `${configured} adapter(s) configured · ${total} call(s) observed · ${observed} marked observed`,
        };
    }
    return {
        present: false,
        evidence: `${configured} adapter(s) configured · 0 call(s) — config only`,
    };
}

function detectSufficiencyAndReceipt(detail) {
    const suffHits = collectKeyed(detail, ['sufficiency', 'sufficiencyScore', 'gaps']);
    let suffFound = false;
    let score = null;
    let gapsCount = null;
    for (const { value } of suffHits) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            suffFound = true;
            score = value;
        } else if (Array.isArray(value)) {
            suffFound = true;
            gapsCount = value.length;
        } else if (value && typeof value === 'object') {
            if (num(value.score) != null) {
                suffFound = true;
                score = num(value.score);
            }
            if (Array.isArray(value.gaps)) {
                suffFound = true;
                gapsCount = value.gaps.length;
            }
            if (nonEmpty(value.level)) suffFound = true;
        }
    }
    if (score == null) {
        walkObjects(detail, (object) => {
            if (score == null && Array.isArray(object.gaps) && num(object.score) != null) score = num(object.score);
        });
    }
    // A receipt id alone is not proof: B0-5 asks for hash/HMAC (D2). P2 stores `receiptId: null`;
    // P4 adds the hash/HMAC this detector is waiting for.
    const receiptHits = collectKeyed(detail, ['receipt', 'receiptProof', 'evidenceReceipt', 'receiptHash', 'hmac', 'hmacSig', 'signature']);
    let receipt = null;
    for (const { key, value } of receiptHits) {
        if (typeof value === 'string' && meaningful(value) && /hash|hmac|signature/i.test(key)) {
            receipt = value;
            break;
        }
        if (value && typeof value === 'object') {
            const hash = str(value.hash ?? value.hmac ?? value.signature ?? value.value);
            if (hash) {
                receipt = hash;
                break;
            }
            if (value.verified === true) {
                receipt = 'verified';
                break;
            }
        }
    }
    if (suffFound && receipt) {
        const scoreText = score != null ? `score ${score}` : `gaps ${gapsCount ?? 0}`;
        return { present: true, evidence: `sufficiency ${scoreText} · receipt ${clip(receipt, 24)}` };
    }
    if (suffFound || receipt) {
        return {
            present: false,
            evidence: suffFound
                ? `sufficiency present (${score != null ? `score ${score}` : `gaps ${gapsCount ?? 0}`}) · receipt missing`
                : 'receipt present · sufficiency score/gaps missing',
        };
    }
    return { present: false, evidence: 'no sufficiency score/gaps and no hash/HMAC receipt' };
}

function detectBrainTier(detail) {
    const hits = collectKeyed(detail, ['tier', 'brainTier', 'brain_tier', 'brain']);
    const tiers = [];
    for (const { key, value } of hits) {
        if (typeof value === 'string' && /^(zero|flash|pro)$/i.test(value.trim())) tiers.push(value.trim().toLowerCase());
        if (value && typeof value === 'object') {
            for (const candidate of [value.tier, value.level, value.mode]) {
                if (typeof candidate === 'string' && /^(zero|flash|pro)$/i.test(candidate.trim())) {
                    tiers.push(candidate.trim().toLowerCase());
                }
            }
        }
        void key;
    }
    const models = arr(detail?.telemetry?.llmCalls).map((call) => str(call?.model)).filter((model) => meaningful(model));
    const calls = arr(detail?.telemetry?.llmCalls).length;
    if (unique(tiers).length > 0) {
        return { present: true, evidence: `tier ${unique(tiers).join('/')} · ${calls} call(s)` };
    }
    return {
        present: false,
        evidence: models.length
            ? `model list only (${unique(models).slice(0, 2).join(', ')}) — no zero/flash/pro tier`
            : 'no zero/flash/pro tier recorded',
    };
}

function detectActions(detail) {
    const telemetry = detail?.telemetry ?? {};
    const tools = arr(telemetry.tools);
    const files = arr(telemetry.files);
    const events = arr(detail?.events).filter((event) => /action\.|tool\.|file\.|edit\./i.test(str(event?.event)));
    const actionHits = collectKeyed(detail, ['actions', 'actionLog', 'fileOps']);
    const recorded = actionHits.reduce((sum, { value }) => sum + (Array.isArray(value) ? value.length : 0), 0);
    const readBeforeEdit = collectKeyed(detail, ['readBeforeEdit', 'read_before_edit']).some(({ value }) => value === true);
    if (tools.length + files.length + recorded + events.length > 0) {
        return {
            present: true,
            evidence: `${tools.length} tool(s) · ${files.length} file(s) · ${events.length} action event(s) · read-before-edit ${readBeforeEdit ? 'yes' : 'not captured'}`,
        };
    }
    return { present: false, evidence: '0 tools · 0 files · no action.recorded event' };
}

function detectMemory(detail) {
    const events = arr(detail?.events).filter((event) => /distill|memory/i.test(str(event?.event)));
    if (events.length > 0) {
        const sample = events[0];
        const saved = str(sample?.evidence?.memoryId ?? sample?.evidence?.memory_id ?? sample?.evidence?.saved ?? '');
        return {
            present: true,
            evidence: `event ${str(sample.event)}${saved ? ` → ${clip(saved, 32)}` : ''} (${events.length} event(s))`,
        };
    }
    const saved = collectKeyed(detail, ['distill', 'distilled', 'distillation', 'memorySave', 'memory_save', 'memoryId', 'memory_id'])
        .map(({ value }) => value)
        .find((value) => meaningful(value));
    if (saved != null) {
        const text = typeof saved === 'object' ? Object.keys(saved).slice(0, 3).join(', ') : String(saved);
        return { present: true, evidence: `distill/memory record: ${clip(text, 60)}` };
    }
    return { present: false, evidence: 'memory layer configured only — no distill/memory event' };
}

function detectSpec(detail) {
    const hits = collectKeyed(detail, ['spec', 'specRef', 'spec_ref', 'specMode', 'spec_mode', 'specVersion', 'normative']);
    for (const { value } of hits) {
        if (typeof value === 'string' && meaningful(value)) {
            return { present: true, evidence: `spec reference ${clip(value, 60)}` };
        }
        if (Array.isArray(value) && value.length > 0) {
            return { present: true, evidence: `spec reference: ${clip(value.length, 4)} entr(ies)` };
        }
        if (value && typeof value === 'object') {
            const ref = str(value.ref ?? value.docPath ?? value.path ?? value.id ?? value.version);
            if (ref) return { present: true, evidence: `spec ${clip(ref, 60)}` };
            if (nonEmpty(value.mode) || value.enabled === true) {
                return { present: true, evidence: `spec mode ${clip(str(value.mode) || 'enabled', 24)}` };
            }
        }
    }
    return { present: false, evidence: 'no normative spec reference or spec↔trace toggle data' };
}

function detectGraph(detail) {
    const hits = collectKeyed(detail, ['graph', 'designGraph', 'design_graph', 'runtimeGraph', 'runtime_graph', 'nodeIds', 'node_ids', 'edges', 'topology']);
    for (const { value } of hits) {
        if (!value || typeof value !== 'object') continue;
        const nodes = Array.isArray(value.nodes) ? value.nodes.length : arr(value.nodeIds).length;
        const edges = Array.isArray(value.edges) ? value.edges.length : num(value.edges) ?? 0;
        const matched = num(value.matched) ?? num(value.matchedNodes) ?? 0;
        if (nodes > 0 || edges > 0 || matched > 0) {
            return { present: true, evidence: `${nodes} node(s) · ${edges} edge(s) · ${matched} matched at runtime` };
        }
    }
    return { present: false, evidence: 'topology config only — no design↔runtime graph link' };
}

const DETECTORS = Object.freeze({
    'B0-1': detectPreflight,
    'B0-2': detectLawProof,
    'B0-3': detectDecision,
    'B0-4': detectRecon,
    'B0-5': detectSufficiencyAndReceipt,
    'B0-6': detectBrainTier,
    'B0-7': detectActions,
    'B0-8': detectMemory,
    'B0-9': detectSpec,
    'B0-10': detectGraph,
});

/** Score one request detail: ten `{id, present, evidence}` rows in audit order. */
export function scoreDetail(detail) {
    return B0_ITEMS.map(({ id }) => {
        const detector = DETECTORS[id];
        try {
            const result = detector(detail);
            return { id, present: result.present === true, evidence: clip(result.evidence) };
        } catch (error) {
            return { id, present: false, evidence: clip(`detector failed: ${error.message}`) };
        }
    });
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

/**
 * Build the report from `[{turn_id, at?, detail?, error?}]`.
 *
 * `b0.items[].present` is the union over turns (capability observed at least once);
 * `perTurn` keeps the distribution so a consumer can see consistency per turn.
 */
export function buildReport(turns, { consumer, source = 'records', error = null } = {}) {
    const scored = turns.map((turn) => ({
        turn,
        items: turn.detail ? scoreDetail(turn.detail) : B0_ITEMS.map(({ id }) => ({
            id,
            present: false,
            evidence: turn.error ? `turn failed: ${turn.error}` : 'no detail',
        })),
    }));

    const perTurn = scored.map(({ turn, items }) => ({
        turn_id: String(turn.turn_id),
        at: str(turn.at),
        score: items.filter((item) => item.present).length,
        present: items.filter((item) => item.present).map((item) => item.id),
        missing: items.filter((item) => !item.present).map((item) => item.id),
        ...(turn.error ? { error: String(turn.error) } : {}),
    }));

    const items = B0_ITEMS.map(({ id }) => {
        const carrier = scored.find(({ items: rows }) => rows.find((row) => row.id === id)?.present);
        if (carrier) {
            const row = carrier.items.find((item) => item.id === id);
            return { id, present: true, evidence: `turn ${carrier.turn.turn_id}: ${row.evidence}` };
        }
        const first = scored[0]?.items.find((item) => item.id === id);
        const reason = scored.length === 0
            ? 'no turn measured'
            : `${scored.length} turn(s) sampled · ${first ? first.evidence : 'not observed'}`;
        return { id, present: false, evidence: clip(reason) };
    });

    return {
        generatedAt: new Date().toISOString(),
        consumer: String(consumer),
        source,
        turns: turns.length,
        b0: { score: items.filter((item) => item.present).length, max: B0_MAX, items },
        perTurn,
        ...(error ? { error: String(error) } : {}),
    };
}

/* ------------------------------------------------------------------ */
/* Fixture — the legacy shape the audit measured, no network            */
/* ------------------------------------------------------------------ */

/** A synthetic legacy-shaped detail: recon calls + tool/file capture, everything else absent. */
export function fixtureDetail() {
    const evidence = {
        userQuery: FIXTURE_SECRETS[0],
        promptText: FIXTURE_SECRETS[1],
        requestBody: FIXTURE_SECRETS[2],
        decisionVerdict: '—',
        model: 'deepseek-chat',
        adapter: 'cursor',
        tier: null,
        recon: [
            { adapter: 'codegraph', calls: 2 },
            { adapter: 'docgraph', calls: 0 },
        ],
        tools: [
            { id: 'tool-read', name: 'read', outcome: 'PASS' },
            { id: 'tool-edit', name: 'edit', outcome: 'PASS' },
        ],
        files: [{ path: 'src/modules/requests/request.service.ts', op: 'edit', readBeforeEdit: true }],
    };
    return {
        request: {
            id: 'fixture-b0-01',
            traceId: 'fixture-b0-01',
            consumerId: 'fineso',
            userQuery: FIXTURE_SECRETS[0],
            startedAt: '2026-11-24T00:00:00.000Z',
            endedAt: '2026-11-24T00:01:00.000Z',
            status: 'completed',
            taskType: 'build',
            flowId: '',
            workerId: 'worker-build',
            hostId: 'cursor',
            runtimeKey: 'cursor',
            model: 'deepseek-chat',
            adapter: 'cursor',
            promptHash: 'fixture-hash',
            promptLength: 240,
        },
        requestMetrics: {
            callCount: 3,
            toolCount: 2,
            hasFailures: false,
            inputTokens: 1200,
            outputTokens: 420,
            tokensEstimated: false,
        },
        context: {},
        routing: { adapter: 'cursor', model: 'deepseek-chat', tier: null, effort: null, taskType: 'build' },
        checks: [
            { checkId: 'prompt-captured', status: 'pass', detail: '240 chars captured' },
            { checkId: 'worker-events', status: 'pass', detail: '3 worker event(s)' },
            { checkId: 'tool-file-capture', status: 'pass', detail: '2 tools / 1 files' },
        ],
        recon: [
            { id: 'codegraph', label: 'code · codegraph', kind: 'code', source: '.harness/integrations.json', required: true, status: 'observed', calls: 2 },
            { id: 'law-layer', label: 'law · rules', kind: 'law', source: '.harness/integrations.json', required: true, status: 'not-captured', calls: 0 },
        ],
        systemStages: [
            { id: 'law', stepNumber: 2, title: 'Law Gate', sub: 'law-layer', status: 'ok', tab: 'rules', details: [{ label: 'Layer', value: 'law-layer', detail: 'config only' }] },
            { id: 'brain', stepNumber: 6, title: 'Brain Tier', sub: '3 calls · 1 models', status: 'ok', tab: 'telemetry', details: [{ label: 'Models', value: 'deepseek-chat', detail: '—' }] },
            { id: 'memory', stepNumber: 8, title: 'Distill & Memory', sub: 'pass-through', status: 'ok', tab: 'waterfall', details: [{ label: 'Layer', value: 'memory-layer', detail: 'config only' }] },
        ],
        pipeline: [],
        events: [
            {
                observationId: 'obs-fixture-1',
                traceId: 'fixture-b0-01',
                hostId: 'cursor',
                runtimeKey: 'cursor',
                workerId: 'worker-build',
                event: 'prompt.submitted',
                outcome: null,
                at: '2026-11-24T00:00:00.000Z',
                evidence,
            },
            {
                observationId: 'obs-fixture-2',
                traceId: 'fixture-b0-01',
                hostId: 'cursor',
                runtimeKey: 'cursor',
                workerId: 'worker-build',
                event: 'worker.build.completed',
                outcome: 'PASS',
                at: '2026-11-24T00:01:00.000Z',
                evidence,
            },
        ],
        telemetry: {
            llmCalls: [
                { id: 'call-1', workerId: 'worker-build', model: 'deepseek-chat', adapter: 'cursor', durationMs: 900, inputTokens: 400, outputTokens: 140, estimated: false, outcome: 'PASS' },
                { id: 'call-2', workerId: 'worker-build', model: 'deepseek-chat', adapter: 'cursor', durationMs: 1200, inputTokens: 400, outputTokens: 140, estimated: false, outcome: 'PASS' },
                { id: 'call-3', workerId: 'worker-build', model: 'deepseek-chat', adapter: 'cursor', durationMs: 800, inputTokens: 400, outputTokens: 140, estimated: false, outcome: 'PASS' },
            ],
            tools: evidence.tools,
            files: evidence.files,
        },
    };
}

export function fixtureTurns() {
    return [{ turn_id: 'fixture-b0-01', at: '2026-11-24T00:00:00.000Z', detail: fixtureDetail() }];
}

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

export function authHeader(env = process.env) {
    const user = env.ESO_AUTH_USER || DEFAULT_USER;
    const password = env.ESO_AUTH_PASSWORD || DEFAULT_PASSWORD;
    return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

async function fetchJson(url, { timeoutMs = 10000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json', Authorization: authHeader() },
            signal: controller.signal,
        });
        const text = await response.text();
        let body = null;
        try {
            body = text ? JSON.parse(text) : null;
        } catch {
            body = text;
        }
        if (!response.ok) {
            const detail = body && typeof body === 'object' && (body.error || body.message);
            throw new Error(`HTTP ${response.status}${detail ? ` ${String(detail).slice(0, 120)}` : ''}`);
        }
        return body;
    } finally {
        clearTimeout(timer);
    }
}

const trimBase = (base) => String(base).replace(/\/+$/, '');
const listUrl = (base, consumer, limit) =>
    `${trimBase(base)}/api/v1/consumers/${encodeURIComponent(consumer)}/requests?limit=${limit}`;
const detailUrl = (base, consumer, id) =>
    `${trimBase(base)}/api/v1/consumers/${encodeURIComponent(consumer)}/requests/${encodeURIComponent(id)}`;

export async function loadTurns({ base, consumer, limit }) {
    let list;
    try {
        list = await fetchJson(listUrl(base, consumer, limit));
    } catch (error) {
        return { turns: [], error: `request list failed: ${error.message}` };
    }
    const items = Array.isArray(list)
        ? list
        : Array.isArray(list?.items)
          ? list.items
          : Array.isArray(list?.requests)
            ? list.requests
            : [];
    const turns = [];
    for (const item of items.slice(0, limit)) {
        const id = str(item?.id ?? item?.traceId ?? item?.requestId);
        if (!id) continue;
        try {
            const detail = await fetchJson(detailUrl(base, consumer, id));
            turns.push({
                turn_id: id,
                at: str(item?.startedAt ?? item?.at ?? detail?.request?.startedAt),
                detail,
            });
        } catch (error) {
            turns.push({ turn_id: id, at: str(item?.startedAt ?? item?.at), error: error.message });
        }
    }
    return { turns, error: null };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

const USAGE = `Usage: node scripts/b0-baseline.mjs [options]

  --base <url>        control plane origin (default ${DEFAULT_BASE})
  --consumer <id>     consumer id (default ${DEFAULT_CONSUMER})
  --limit <n>         max requests to sample, 1..${MAX_LIMIT} (default ${DEFAULT_LIMIT})
  --json <file>       also write the report to this path
  --fixture           synthetic legacy detail, no network (CI dry-run)
  --help              show this help

Exit: 0 for any score; 2 invalid arguments.`;

function positiveLimit(raw) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
        throw new UsageError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return value;
}

function validBase(raw) {
    const value = String(raw);
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new UsageError(`--base is not a valid URL: ${value}`);
    }
    if (!/^https?:$/.test(url.protocol)) throw new UsageError(`--base must be http(s): ${value}`);
    return value;
}

export function parseArgs(argv) {
    const options = {
        base: DEFAULT_BASE,
        consumer: DEFAULT_CONSUMER,
        limit: DEFAULT_LIMIT,
        json: null,
        fixture: false,
        help: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const cut = arg.startsWith('--') && arg.includes('=') ? arg.indexOf('=') : -1;
        const flag = cut === -1 ? arg : arg.slice(0, cut);
        const inline = cut === -1 ? null : arg.slice(cut + 1);
        const value = () => {
            if (inline != null) return inline;
            const next = argv[index + 1];
            if (next == null || next.startsWith('--')) throw new UsageError(`${flag} needs a value`);
            index += 1;
            return next;
        };
        switch (flag) {
            case '--base':
                options.base = validBase(value());
                break;
            case '--consumer': {
                const consumer = value().trim();
                if (!consumer) throw new UsageError('--consumer must be a non-empty id');
                options.consumer = consumer;
                break;
            }
            case '--limit':
                options.limit = positiveLimit(value());
                break;
            case '--json':
                options.json = value();
                break;
            case '--fixture':
                options.fixture = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            default:
                throw new UsageError(`unknown argument ${arg}`);
        }
    }
    return options;
}

export async function main(argv = process.argv.slice(2)) {
    try {
        const options = parseArgs(argv);
        if (options.help) {
            process.stdout.write(`${USAGE}\n`);
            return 0;
        }
        const { turns, error } = options.fixture
            ? { turns: fixtureTurns(), error: null }
            : await loadTurns(options);
        const report = buildReport(turns, {
            consumer: options.consumer,
            source: options.fixture ? 'fixture' : 'records',
            error,
        });
        const text = `${JSON.stringify(report, null, 2)}\n`;
        process.stdout.write(text);
        if (options.json) {
            fs.mkdirSync(path.dirname(path.resolve(options.json)), { recursive: true });
            fs.writeFileSync(options.json, text);
        }
        return 0;
    } catch (error) {
        if (error instanceof UsageError) {
            process.stderr.write(`[b0-baseline] ${error.message}\n\n${USAGE}\n`);
            return error.exitCode;
        }
        process.stderr.write(`[b0-baseline] ${error.message}\n`);
        return 1;
    }
}

const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = await main();
