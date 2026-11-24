#!/usr/bin/env node
/**
 * V3 replay harness — export a redacted 10-turn pack and score third-party answers.
 *
 *   node scripts/v3-replay.mjs --export --base http://127.0.0.1:8787 --consumer fineso \
 *        --limit 10 --out /tmp/v3-pack.json
 *   node scripts/v3-replay.mjs --fixture --out /tmp/v3-pack.json
 *   node scripts/v3-replay.mjs --score --pack /tmp/v3-pack.json --answers /tmp/v3-answers.json
 *
 * A pack is `{source, turns:[{turn_id, questions:{q1..q6}, allowed_evidence}]}`. Only record
 * surfaces are exported: ids, counts, outcomes and short strings. Raw prompt/request body and any
 * evidence string longer than 120 characters never reach the file.
 *
 * Scoring derives the truth for each of the six questions from `allowed_evidence` — the reviewer
 * never gets a truth key. A turn counts correct only when all six answers match; the run passes at
 * `overall >= 0.8` (target V3 ≥8/10 turns).
 *
 * Exit codes: 0 = pass/export ok, 1 = score below target or export runtime failure,
 * 2 = malformed arguments/input.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BASE = 'http://127.0.0.1:8787';
export const DEFAULT_CONSUMER = 'fineso';
export const DEFAULT_LIMIT = 10;
export const DEFAULT_OUT = '/tmp/v3-pack.json';
export const DEFAULT_USER = 'operator';
export const DEFAULT_PASSWORD = 'eso-dev-only-token';
export const MAX_LIMIT = 200;
export const MAX_STRING = 120;
export const TARGET = 0.8;
export const FIXTURE_TURNS = 10;

/** The six acceptance questions of plan §2. Choices are the answer vocabulary. */
export const QUESTIONS = Object.freeze({
    q1: Object.freeze({ id: 'q1', text: 'Was this turn allowed or blocked?', choices: Object.freeze(['allowed', 'blocked', 'unknown']) }),
    q2: Object.freeze({ id: 'q2', text: 'Does the record cite the rule or decision that decided it?', choices: Object.freeze(['cited', 'uncited', 'unknown']) }),
    q3: Object.freeze({ id: 'q3', text: 'Is the recorded evidence sufficient to justify the outcome?', choices: Object.freeze(['sufficient', 'insufficient', 'unknown']) }),
    q4: Object.freeze({ id: 'q4', text: 'What changed: were tools used or files touched?', choices: Object.freeze(['changed', 'none', 'unknown']) }),
    q5: Object.freeze({ id: 'q5', text: 'Is the record integrity verified by a receipt?', choices: Object.freeze(['verified', 'unverified', 'unknown']) }),
    q6: Object.freeze({ id: 'q6', text: 'Is a next action recorded for this turn?', choices: Object.freeze(['present', 'none', 'unknown']) }),
});
export const QUESTION_IDS = Object.freeze(Object.keys(QUESTIONS));

/** Secrets embedded in the fixture so a test can prove redaction on the exported pack. */
export const FIXTURE_SECRETS = Object.freeze(
    Array.from({ length: FIXTURE_TURNS }, (_, index) => {
        const n = String(index + 1).padStart(2, '0');
        return [
            `FIXTURE-SECRET-QUERY-${n}`,
            `FIXTURE-SECRET-PROMPT-${n}`,
            `FIXTURE-SECRET-BODY-${n}`,
            `FIXTURE-SECRET-LONG-${n}-${'x'.repeat(140)}`,
        ];
    }).flat(),
);

export class UsageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UsageError';
        this.exitCode = 2;
    }
}

/* ------------------------------------------------------------------ */
/* Read helpers                                                        */
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

function clip(value, max = MAX_STRING) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function unique(values) {
    return [...new Set(values.filter((value) => meaningful(value)).map((value) => String(value).trim()))];
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

function firstObject(root, names) {
    for (const { value } of collectKeyed(root, names)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
    return null;
}

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

const keyId = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

const SENSITIVE_KEYS = new Set([
    'userquery',
    'prompt',
    'prompts',
    'systemprompt',
    'requestbody',
    'request',
    'body',
    'messages',
    'payload',
    'rawevidence',
    'rawlog',
    'transcript',
    'headers',
    'authorization',
    'cookies',
]);

/**
 * Deep-redact a pack: sensitive keys are dropped at every depth and every string longer than
 * `MAX_STRING` is replaced. Ids, counts and outcomes survive because they are short.
 */
export function sanitize(node) {
    if (typeof node === 'string') return node.length <= MAX_STRING ? node : '[redacted:long]';
    if (Array.isArray(node)) return node.map((entry) => sanitize(entry));
    if (node && typeof node === 'object') {
        const output = {};
        for (const [key, value] of Object.entries(node)) {
            if (SENSITIVE_KEYS.has(keyId(key))) continue;
            output[key] = sanitize(value);
        }
        return output;
    }
    return node;
}

/* ------------------------------------------------------------------ */
/* Verdict / evidence normalisation                                    */
/* ------------------------------------------------------------------ */

const LEVEL_ALIASES = new Map([
    ['pass', 'sufficient'],
    ['passed', 'sufficient'],
    ['allow', 'sufficient'],
    ['allowed', 'sufficient'],
    ['sufficient', 'sufficient'],
    ['ok', 'sufficient'],
    ['verified', 'sufficient'],
    ['fail', 'insufficient'],
    ['failed', 'insufficient'],
    ['deny', 'insufficient'],
    ['denied', 'insufficient'],
    ['blocked', 'insufficient'],
    ['insufficient', 'insufficient'],
    ['partial', 'partial'],
    ['unknown', 'unknown'],
    ['cannot-judge', 'cannot-judge'],
    ['cannotjudge', 'cannot-judge'],
    ['unsurfaced', 'unsurfaced'],
]);

function normalizeLevel(value) {
    if (typeof value !== 'string') return null;
    return LEVEL_ALIASES.get(value.trim().toLowerCase()) ?? null;
}

function idList(value, limit = 20) {
    const list = Array.isArray(value) ? value : value == null ? [] : [value];
    return unique(
        list.slice(0, limit).map((entry) => {
            if (typeof entry === 'string') return clip(entry);
            if (entry && typeof entry === 'object') {
                return clip(str(entry.id ?? entry.ruleId ?? entry.rule_id ?? entry.ref ?? entry.code ?? entry.path ?? entry.filePath));
            }
            return '';
        }),
    );
}

function gapList(value, limit = 50) {
    const list = Array.isArray(value) ? value : value == null ? null : [value];
    if (list == null) return null;
    return unique(
        list.slice(0, limit).map((entry) => {
            if (typeof entry === 'string') return clip(entry);
            if (entry && typeof entry === 'object') return clip(str(entry.gap_id ?? entry.id ?? entry.code ?? entry.kind));
            return clip(entry);
        }),
    );
}

function actorFrom(value) {
    if (typeof value === 'string') return { actor: str(value) || null, role: null };
    if (!value || typeof value !== 'object') return { actor: null, role: null };
    const id = str(value.id ?? value.name ?? value.email ?? value.sub ?? '');
    const role = str(value.role ?? value.kind ?? '');
    return { actor: id || null, role: role || null };
}

function normalizeVerdict(detail) {
    const object =
        firstObject(detail, ['verdict', 'turnVerdict', 'judgment']) ??
        arr(detail?.events)
            .map((event) => firstObject(event?.evidence, ['verdict', 'turnVerdict']))
            .find(Boolean) ??
        null;
    const declared = str(detail?.request?.decisionVerdict);
    if (!object) {
        const stringVerdict = collectKeyed(detail, ['verdict', 'turnVerdict'])
            .map(({ value }) => (typeof value === 'string' ? value : ''))
            .find((value) => normalizeLevel(value));
        if (!stringVerdict && !meaningful(declared)) return null;
        const level = normalizeLevel(stringVerdict || declared);
        if (!level) return null;
        return {
            level,
            basis: 'declared',
            pass: level === 'sufficient',
            actor: null,
            role: null,
            rule_refs: [],
            gaps: null,
            sufficiency: null,
            receipt: null,
            next_action: null,
        };
    }
    let level = normalizeLevel(object.level ?? object.verdict ?? object.status);
    let pass = typeof object.pass === 'boolean' ? object.pass : null;
    if (!level && pass != null) level = pass ? 'sufficient' : 'insufficient';
    if (pass == null) pass = level === 'sufficient' ? true : level === 'insufficient' ? false : null;
    const actor = actorFrom(object.actor);
    return {
        level,
        basis: str(object.basis) || null,
        pass,
        actor: actor.actor,
        role: str(object.role) || actor.role,
        rule_refs: idList(object.rule_refs ?? object.ruleRefs ?? object.rules ?? object.refs ?? object.decision_refs),
        gaps: object.gaps ?? object.gap_ids ?? null,
        score: num(object.score),
        sufficiency: object.sufficiency ?? null,
        receipt: object.receipt ?? null,
        next_action: object.next_action ?? object.nextAction ?? null,
    };
}

function normalizeActions(detail) {
    const telemetry = detail?.telemetry ?? {};
    const tools = arr(telemetry.tools);
    const files = arr(telemetry.files);
    const actionEvents = arr(detail?.events).filter((event) => /action\.|tool\.|file\.|edit\./i.test(str(event?.event)));
    const captureCheck = arr(detail?.checks).find((check) => str(check?.checkId) === 'tool-file-capture');
    const captured =
        captureCheck != null
            ? str(captureCheck.status) === 'pass'
            : tools.length + files.length > 0 || actionEvents.length > 0;
    if (!captured && actionEvents.length === 0) return null;
    const readBeforeEdit =
        collectKeyed(detail, ['readBeforeEdit', 'read_before_edit']).some(({ value }) => value === true) || files.some(
            (file) => file && typeof file === 'object' && (file.readBeforeEdit === true || file.read_before_edit === true),
        );
    return {
        tool_count: tools.length,
        file_count: files.length,
        tools: idList(tools.map((tool) => (tool && typeof tool === 'object' ? tool.id ?? tool.name ?? tool.type : tool))),
        files: idList(
            files.map((file) => (file && typeof file === 'object' ? file.path ?? file.filePath ?? file.name : file)),
        ),
        read_before_edit: readBeforeEdit ? true : null,
    };
}

function normalizeReceipt(detail, verdict) {
    const receiptId = str(verdict?.receiptId ?? verdict?.receipt_id);
    const source = verdict?.receipt ?? firstObject(detail, ['receipt', 'receiptProof', 'evidenceReceipt']) ?? (receiptId || null);
    if (!source) return null;
    if (typeof source === 'string') {
        return { status: 'unverified', verified: false, hash_prefix: clip(source, 12) };
    }
    const status = str(source.status ?? source.state ?? source.result).toLowerCase();
    const hash = str(source.hash ?? source.hmac ?? source.receipt_id ?? source.receiptId ?? source.id);
    const verified = source.verified === true || /^(verified|valid|ok|pass|passed)$/.test(status);
    return {
        status: verified ? 'verified' : status || 'unverified',
        verified,
        hash_prefix: hash ? clip(hash, 12) : null,
    };
}

function normalizeNextAction(detail, verdict) {
    const source = verdict?.next_action ?? verdict?.nextAction ?? firstObject(detail, ['next_action', 'nextAction']);
    if (!source) return null;
    if (typeof source === 'string') return { action: clip(source), owner: null };
    const action = str(source.action ?? source.next ?? source.kind ?? source.code);
    if (!meaningful(action)) return null;
    return { action: clip(action), owner: str(source.owner ?? source.assignee) || null };
}

/** Build `allowed_evidence` from one request detail. Truth is derivable from this object alone. */
export function evidenceFromDetail(detail = {}) {
    const verdict = normalizeVerdict(detail);
    const gapsObject = firstObject(detail, ['gaps', 'gapSummary']);
    const gapsArray = collectKeyed(detail, ['gaps'])
        .map(({ value }) => value)
        .find((value) => Array.isArray(value));
    const gaps = gapList(verdict?.gaps ?? gapsArray ?? gapsObject?.gaps ?? gapsObject);
    const gapsCount = Array.isArray(gaps) ? gaps.length : num(gapsObject?.count) ?? num(gapsObject?.gap_count);

    const sufficiencyKeyed = collectKeyed(detail, ['sufficiency', 'sufficiencyScore', 'sufficiency_score']);
    const sufficiencyObject =
        (verdict?.sufficiency && typeof verdict.sufficiency === 'object' ? verdict.sufficiency : null) ??
        sufficiencyKeyed.map(({ value }) => value).find((value) => value && typeof value === 'object') ??
        null;
    const sufficiencyScore =
        num(sufficiencyObject?.score) ??
        num(verdict?.score) ??
        sufficiencyKeyed.map(({ value }) => num(value)).find((value) => value != null) ??
        null;
    // Scores arrive on two scales: 0..1 from the plan, 0..100 from `verdict.service`. Normalise
    // both to 0..1 so `threshold` means the same thing in every pack.
    const scale = sufficiencyScore != null && sufficiencyScore > 1 ? 100 : 1;
    const rawThreshold = num(sufficiencyObject?.threshold);
    const threshold = rawThreshold == null ? 0.8 : rawThreshold > 1 ? rawThreshold / 100 : rawThreshold;
    const score = sufficiencyScore == null ? null : Math.round((sufficiencyScore / scale) * 1000) / 1000;
    const sufficiency =
        sufficiencyObject || sufficiencyScore != null
            ? {
                  score,
                  threshold,
                  gaps_count:
                      num(sufficiencyObject?.gaps_count) ??
                      num(sufficiencyObject?.gap_count) ??
                      (gapsCount ?? (Array.isArray(gaps) ? gaps.length : null)),
              }
            : gapsCount != null
              ? { score: null, threshold, gaps_count: gapsCount }
              : null;

    const events = arr(detail?.events);
    const timeline = events.slice(0, 40).map((event) => ({
        at: clip(str(event?.at), 40),
        event: clip(str(event?.event), 80),
        outcome: str(event?.outcome) ? clip(str(event.outcome), 20) : null,
    }));
    const llmCalls = arr(detail?.telemetry?.llmCalls).length;
    const reconCalls = arr(detail?.recon).reduce((sum, adapter) => sum + (num(adapter?.calls) ?? 0), 0);

    const evidence = {
        verdict: verdict
            ? {
                  level: verdict.level ?? null,
                  pass: verdict.pass,
                  basis: verdict.basis,
                  actor: verdict.actor,
                  role: verdict.role,
                  rule_refs: verdict.rule_refs,
              }
            : null,
        gaps,
        events_timeline: timeline,
        actions: normalizeActions(detail),
        sufficiency,
        receipt: normalizeReceipt(detail, verdict),
        next_action: normalizeNextAction(detail, verdict),
        capture: {
            events: events.length,
            llm_calls: llmCalls,
            tools: arr(detail?.telemetry?.tools).length,
            files: arr(detail?.telemetry?.files).length,
            checks: arr(detail?.checks).length,
            recon_calls: reconCalls,
        },
    };
    return sanitize(evidence);
}

/* ------------------------------------------------------------------ */
/* Truth + scoring                                                     */
/* ------------------------------------------------------------------ */

function verdictLevel(verdict) {
    if (!verdict || typeof verdict !== 'object') return null;
    if (verdict.level) return verdict.level;
    if (typeof verdict.pass === 'boolean') return verdict.pass ? 'sufficient' : 'insufficient';
    return null;
}

function eventOutcome(timeline) {
    const outcomes = arr(timeline).map((event) => str(event?.outcome).toUpperCase());
    if (outcomes.includes('BLOCKED')) return 'blocked';
    if (outcomes.includes('FAIL')) return 'blocked';
    if (outcomes.includes('PASS')) return 'allowed';
    return null;
}

/**
 * Derive the six expected answers from a pack turn. This is the single source of truth for
 * scoring — the exported pack carries no truth keys.
 */
export function deriveTruth(turn) {
    const evidence = turn?.allowed_evidence && typeof turn.allowed_evidence === 'object' ? turn.allowed_evidence : {};
    const verdict = evidence.verdict && typeof evidence.verdict === 'object' ? evidence.verdict : null;
    const level = verdictLevel(verdict);

    const q1 =
        verdict != null
            ? level === 'sufficient'
                ? 'allowed'
                : level === 'insufficient'
                  ? 'blocked'
                  : 'unknown'
            : eventOutcome(evidence.events_timeline) ?? 'unknown';

    const refs = arr(verdict?.rule_refs);
    const q2 = verdict == null ? 'unknown' : refs.length > 0 ? 'cited' : 'uncited';

    const gaps = Array.isArray(evidence.gaps) ? evidence.gaps : null;
    const sufficiency = evidence.sufficiency && typeof evidence.sufficiency === 'object' ? evidence.sufficiency : null;
    const gapCount = gaps ? gaps.length : num(sufficiency?.gaps_count);
    let q3 = 'unknown';
    if (gapCount != null && gapCount > 0) {
        q3 = 'insufficient';
    } else if (num(sufficiency?.score) != null) {
        const threshold = num(sufficiency.threshold) ?? TARGET;
        q3 = num(sufficiency.score) >= threshold ? 'sufficient' : 'insufficient';
    } else if (level === 'sufficient') {
        q3 = 'sufficient';
    }

    const actions = evidence.actions && typeof evidence.actions === 'object' ? evidence.actions : null;
    let q4 = 'unknown';
    if (actions) {
        const tools = num(actions.tool_count) ?? arr(actions.tools).length;
        const files = num(actions.file_count) ?? arr(actions.files).length;
        q4 = tools + files > 0 ? 'changed' : 'none';
    }

    const receipt = evidence.receipt && typeof evidence.receipt === 'object' ? evidence.receipt : null;
    const q5 = receipt == null ? 'unknown' : receipt.verified === true || str(receipt.status) === 'verified' ? 'verified' : 'unverified';

    const nextAction = evidence.next_action && typeof evidence.next_action === 'object' ? evidence.next_action : null;
    // Unambiguous on purpose: no recorded next action is `none`, even when the verdict is
    // missing — the question asks what the record contains, not what the reader would do.
    const q6 = nextAction ? 'present' : 'none';

    return { q1, q2, q3, q4, q5, q6 };
}

const ANSWER_ALIASES = new Map([
    ['pass', 'allowed'],
    ['passed', 'allowed'],
    ['allow', 'allowed'],
    ['fail', 'blocked'],
    ['failed', 'blocked'],
    ['deny', 'blocked'],
    ['denied', 'blocked'],
    ['cannot-determine', 'unknown'],
    ['cannot-judge', 'unknown'],
    ['n/a', 'none'],
    ['na', 'none'],
]);

function normalizeAnswer(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim().toLowerCase();
    if (!text) return null;
    return ANSWER_ALIASES.get(text) ?? text;
}

function readJson(file, label) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (error) {
        throw new UsageError(`cannot read ${label} ${file}: ${error.message}`);
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new UsageError(`${label} ${file} is not valid JSON: ${error.message}`);
    }
}

/** Load and validate the exported pack. */
export function loadPack(file) {
    const parsed = readJson(file, '--pack');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new UsageError(`--pack ${file} must be a JSON object`);
    }
    const turns = Array.isArray(parsed.turns) ? parsed.turns : null;
    if (!turns || turns.length === 0) throw new UsageError(`--pack ${file} has no turns`);
    const seen = new Set();
    turns.forEach((turn, index) => {
        if (!turn || typeof turn !== 'object') throw new UsageError(`--pack ${file} turn ${index + 1} is not an object`);
        if (typeof turn.turn_id !== 'string' || !turn.turn_id.trim()) {
            throw new UsageError(`--pack ${file} turn ${index + 1} is missing "turn_id"`);
        }
        if (seen.has(turn.turn_id)) throw new UsageError(`--pack ${file} has duplicate turn_id "${turn.turn_id}"`);
        seen.add(turn.turn_id);
        if (!turn.allowed_evidence || typeof turn.allowed_evidence !== 'object') {
            throw new UsageError(`--pack ${file} turn "${turn.turn_id}" is missing "allowed_evidence"`);
        }
    });
    return {
        source: typeof parsed.source === 'string' ? parsed.source : 'records',
        turns,
        file,
    };
}

/** Load answers as `Map<turn_id, {q1..q6}>`. Structural violations are malformed (exit 2). */
export function loadAnswers(file, pack) {
    const parsed = readJson(file, '--answers');
    const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.answers) ? parsed.answers : null;
    if (!list) throw new UsageError(`--answers ${file} must be an array or an object with "answers" array`);
    if (list.length === 0) throw new UsageError(`--answers ${file} has no answers`);
    const known = new Set(pack.turns.map((turn) => turn.turn_id));
    const answers = new Map();
    list.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new UsageError(`--answers ${file} entry ${index + 1} is not an object`);
        }
        if (typeof entry.turn_id !== 'string' || !entry.turn_id.trim()) {
            throw new UsageError(`--answers ${file} entry ${index + 1} is missing "turn_id"`);
        }
        const turnId = entry.turn_id.trim();
        if (!known.has(turnId)) throw new UsageError(`--answers ${file} names unknown turn_id "${turnId}"`);
        if (answers.has(turnId)) throw new UsageError(`--answers ${file} has duplicate turn_id "${turnId}"`);
        const row = {};
        for (const id of QUESTION_IDS) row[id] = normalizeAnswer(entry[id]);
        answers.set(turnId, row);
    });
    return { answers, file };
}

/** Score a validated pack + answers. Pure, so a caller can re-score without spawning. */
export function scorePack(pack, answers) {
    const perTurn = [];
    const perQuestion = Object.fromEntries(
        QUESTION_IDS.map((id) => [id, { correct: 0, total: pack.turns.length, accuracy: 0 }]),
    );
    let correctTurns = 0;
    let correctAnswers = 0;

    for (const turn of pack.turns) {
        const truth = deriveTruth(turn);
        const answer = answers.get(turn.turn_id) ?? Object.fromEntries(QUESTION_IDS.map((id) => [id, null]));
        const wrong = [];
        for (const id of QUESTION_IDS) {
            if (answer[id] === truth[id]) {
                perQuestion[id].correct += 1;
                correctAnswers += 1;
            } else {
                wrong.push(id);
            }
        }
        const correct = wrong.length === 0;
        if (correct) correctTurns += 1;
        perTurn.push({
            turn_id: turn.turn_id,
            correct,
            answers: Object.fromEntries(QUESTION_IDS.map((id) => [id, answer[id]])),
            truth,
            ...(wrong.length > 0 ? { wrong } : {}),
        });
    }

    for (const id of QUESTION_IDS) {
        perQuestion[id].accuracy = round4(perQuestion[id].correct / pack.turns.length);
    }
    const overall = round4(correctTurns / pack.turns.length);
    return {
        generatedAt: new Date().toISOString(),
        pack: pack.file ?? null,
        source: pack.source,
        turns: pack.turns.length,
        perQuestion,
        perTurn,
        total: {
            correct: correctAnswers,
            total: pack.turns.length * QUESTION_IDS.length,
            accuracy: round4(correctAnswers / (pack.turns.length * QUESTION_IDS.length)),
        },
        overall,
        target: TARGET,
        pass: overall >= TARGET,
    };
}

const round4 = (value) => Math.round(value * 10000) / 10000;

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

function questionSet() {
    return Object.fromEntries(QUESTION_IDS.map((id) => [id, { ...QUESTIONS[id], choices: [...QUESTIONS[id].choices] }]));
}

const FIXTURE_CASES = Object.freeze([
    { level: 'sufficient', refs: ['D-108'], gaps: [], score: 0.95, actions: 'changed', receipt: 'verified', next: false },
    { level: 'sufficient', refs: ['D-108', 'D-90'], gaps: [], score: 0.9, actions: 'changed', receipt: 'verified', next: false },
    { level: 'sufficient', refs: [], gaps: [], score: 0.85, actions: 'none', receipt: 'verified', next: false },
    { level: 'insufficient', refs: ['core.slp'], gaps: ['GAP-NO-VERIFY'], score: 0.4, actions: 'changed', receipt: 'verified', next: true },
    { level: 'insufficient', refs: ['core.law-gate'], gaps: ['GAP-NO-EVIDENCE', 'GAP-STALE'], score: 0.2, actions: 'changed', receipt: 'unverified', next: true },
    { level: 'sufficient', refs: ['D-108'], gaps: [], score: 0.92, actions: 'changed', receipt: 'verified', next: false },
    { level: null, refs: [], gaps: null, score: null, actions: null, receipt: null, next: false },
    { level: 'sufficient', refs: [], gaps: [], score: null, actions: null, receipt: null, next: false },
    { level: 'insufficient', refs: [], gaps: [], score: null, actions: 'changed', receipt: 'unverified', next: false },
    { level: 'sufficient', refs: ['D-108'], gaps: [], score: 0.9, actions: 'changed', receipt: 'verified', next: false },
]);

function fixtureTurn(index) {
    const n = String(index + 1).padStart(2, '0');
    const spec = FIXTURE_CASES[index];
    const verdict = spec.level
        ? {
              level: spec.level,
              pass: spec.level === 'sufficient',
              basis: 'declared',
              actor: 'operator',
              role: 'owner',
              rule_refs: spec.refs,
          }
        : null;
    const actions =
        spec.actions === 'changed'
            ? {
                  tool_count: 2,
                  file_count: 1,
                  tools: ['read', 'edit'],
                  files: ['src/modules/requests/request.service.ts'],
                  read_before_edit: true,
              }
            : spec.actions === 'none'
              ? { tool_count: 0, file_count: 0, tools: [], files: [], read_before_edit: null }
              : null;
    const evidence = {
        verdict,
        gaps: spec.gaps,
        events_timeline: [
            { at: '2026-11-24T09:00:00Z', event: 'prompt.submitted', outcome: null },
            {
                at: '2026-11-24T09:00:05Z',
                event: 'worker.build.completed',
                outcome: spec.level == null ? null : spec.level === 'insufficient' ? 'BLOCKED' : 'PASS',
            },
        ],
        actions,
        sufficiency:
            spec.score != null || spec.gaps != null
                ? {
                      score: spec.score,
                      threshold: 0.8,
                      gaps_count: spec.gaps ? spec.gaps.length : null,
                  }
                : null,
        receipt: spec.receipt
            ? { status: spec.receipt, verified: spec.receipt === 'verified', hash_prefix: `sha256:fix${n}` }
            : null,
        next_action: spec.next ? { action: 'escalate-to-operator', owner: 'operator' } : null,
        capture: { events: 2, llm_calls: 2, tools: actions?.tool_count ?? 0, files: actions?.file_count ?? 0, checks: 4, recon_calls: 2 },
        // Redaction fixtures: every one of these must be gone from the written pack.
        debug: {
            userQuery: FIXTURE_SECRETS[index * 4],
            prompt: FIXTURE_SECRETS[index * 4 + 1],
            requestBody: FIXTURE_SECRETS[index * 4 + 2],
            notes: FIXTURE_SECRETS[index * 4 + 3],
        },
    };
    return { turn_id: `fixture-v3-${n}`, questions: questionSet(), allowed_evidence: evidence };
}

/** Ten synthetic turns, `source:'fixture'` — never a measurement. Redacted at build time. */
export function buildFixturePack() {
    return sanitize({
        source: 'fixture',
        generatedAt: new Date().toISOString(),
        turns: Array.from({ length: FIXTURE_TURNS }, (_, index) => fixtureTurn(index)),
    });
}

/* ------------------------------------------------------------------ */
/* Export from records                                                 */
/* ------------------------------------------------------------------ */

export function authHeader(env = process.env) {
    const user = env.ESO_AUTH_USER || DEFAULT_USER;
    const password = env.ESO_AUTH_PASSWORD || DEFAULT_PASSWORD;
    return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

const trimBase = (base) => String(base).replace(/\/+$/, '');
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
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return body;
    } finally {
        clearTimeout(timer);
    }
}

export async function exportPack({ base, consumer, limit }) {
    const root = trimBase(base);
    const list = await fetchJson(
        `${root}/api/v1/consumers/${encodeURIComponent(consumer)}/requests?limit=${limit}`,
    );
    const items = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : Array.isArray(list?.requests) ? list.requests : [];
    const turns = [];
    for (const item of items.slice(0, limit)) {
        const id = str(item?.id ?? item?.traceId ?? item?.requestId);
        if (!id) continue;
        const detail = await fetchJson(
            `${root}/api/v1/consumers/${encodeURIComponent(consumer)}/requests/${encodeURIComponent(id)}`,
        );
        turns.push({
            turn_id: id,
            questions: questionSet(),
            allowed_evidence: evidenceFromDetail(detail),
        });
    }
    return sanitize({ source: 'records', generatedAt: new Date().toISOString(), consumer, turns });
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

const USAGE = `Usage: node scripts/v3-replay.mjs <mode> [options]

Modes (exactly one):
  --export             pull recorded turns from a control plane
  --fixture            write ${FIXTURE_TURNS} synthetic fixture turns (no network)
  --score              score answers against a pack

Export options:
  --base <url>         control plane origin (default ${DEFAULT_BASE})
  --consumer <id>      consumer id (default ${DEFAULT_CONSUMER})
  --limit <n>          max turns, 1..${MAX_LIMIT} (default ${DEFAULT_LIMIT})
  --out <file>         pack path (default ${DEFAULT_OUT})

Score options:
  --pack <file>        pack written by --export/--fixture
  --answers <file>     [{turn_id, q1..q6}] or {answers:[...]}

Exit: 0 pass, 1 below target/export failure, 2 malformed input.`;

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
        mode: null,
        base: DEFAULT_BASE,
        consumer: DEFAULT_CONSUMER,
        limit: DEFAULT_LIMIT,
        out: DEFAULT_OUT,
        pack: null,
        answers: null,
        help: false,
    };
    const setMode = (mode) => {
        if (options.mode && options.mode !== mode) throw new UsageError(`pick one mode: --${options.mode} conflicts with --${mode}`);
        options.mode = mode;
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
            case '--export':
                setMode('export');
                break;
            case '--fixture':
                setMode('fixture');
                break;
            case '--score':
                setMode('score');
                break;
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
            case '--out':
                options.out = value();
                break;
            case '--pack':
                options.pack = value();
                break;
            case '--answers':
                options.answers = value();
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            default:
                throw new UsageError(`unknown argument ${arg}`);
        }
    }
    if (options.help) return options;
    if (!options.mode) throw new UsageError('pick a mode: --export, --fixture or --score');
    if (options.mode === 'score') {
        if (!options.pack) throw new UsageError('--score needs --pack');
        if (!options.answers) throw new UsageError('--score needs --answers');
    }
    return options;
}

function writePack(file, pack) {
    const target = path.resolve(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const text = `${JSON.stringify(pack, null, 2)}\n`;
    fs.writeFileSync(target, text);
    return { out: file, source: pack.source, turns: pack.turns.length };
}

export async function main(argv = process.argv.slice(2)) {
    try {
        const options = parseArgs(argv);
        if (options.help) {
            process.stdout.write(`${USAGE}\n`);
            return 0;
        }
        if (options.mode === 'score') {
            const pack = loadPack(options.pack);
            const { answers } = loadAnswers(options.answers, pack);
            const result = scorePack(pack, answers);
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return result.pass ? 0 : 1;
        }
        const pack = options.mode === 'fixture' ? buildFixturePack() : await exportPack(options);
        const summary = writePack(options.out, sanitize(pack));
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        return 0;
    } catch (error) {
        if (error instanceof UsageError) {
            process.stderr.write(`[v3-replay] ${error.message}\n\n${USAGE}\n`);
            return error.exitCode;
        }
        process.stderr.write(`[v3-replay] ${error.message}\n`);
        return 1;
    }
}

const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = await main();
