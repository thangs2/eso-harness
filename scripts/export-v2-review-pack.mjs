#!/usr/bin/env node
/**
 * V2 reviewer-study pack — export one Markdown page per recorded turn, built **only** from ESO
 * evidence surfaces (verdict level/basis, gap summary, event timeline, artifact ids).
 *
 *   node scripts/export-v2-review-pack.mjs --fixture --out /tmp/v2-review
 *   node scripts/export-v2-review-pack.mjs --input turns.jsonl --out /tmp/v2-review --limit 10
 *
 * Guarantees:
 * - Raw user query / model input / request body / evidence blobs never reach disk: values are
 *   collected while walking the record and replaced with `[redacted]` in every rendered string.
 * - `--fixture` writes 10 synthetic turns and marks every page + the manifest as FIXTURE, so a
 *   dry-run can never be mistaken for a measurement.
 * - Output is scratch: default `/tmp/v2-review`, never the repo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_OUT = '/tmp/v2-review';
export const DEFAULT_LIMIT = 10;
export const FIXTURE_TURNS = 10;
export const PASS_LEVEL = 'sufficient';

export const LEVELS = Object.freeze([
    'insufficient',
    'partial',
    'sufficient',
    'cannot-judge',
    'unsurfaced',
]);
export const BASES = Object.freeze(['declared', 'retrieved', 'verified', 'inferred']);

const FIXTURE_SECRET_PREFIX = Object.freeze({
    query: 'FIXTURE-SECRET-QUERY',
    input: 'FIXTURE-SECRET-INPUT',
    body: 'FIXTURE-SECRET-BODY',
    evidence: 'FIXTURE-SECRET-EVIDENCE',
});

/** Secret values embedded in the fixture so tests can prove redaction on every run. */
export const FIXTURE_SECRETS = Object.freeze(
    Array.from({ length: FIXTURE_TURNS }, (_, index) => {
        const n = String(index + 1).padStart(2, '0');
        return [
            `${FIXTURE_SECRET_PREFIX.query}-${n}`,
            `${FIXTURE_SECRET_PREFIX.input}-${n}`,
            `${FIXTURE_SECRET_PREFIX.body}-${n}`,
            `${FIXTURE_SECRET_PREFIX.evidence}-${n}`,
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
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

const keyId = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Keys whose values are raw input/log/evidence and must never be rendered. `payload` covers the
 * evidence_item payload column; `messages` covers chat request bodies.
 */
const SENSITIVE_KEYS = new Set([
    'userquery',
    'prompt',
    'prompts',
    'systemprompt',
    'requestbody',
    'request',
    'body',
    'messages',
    'evidence',
    'rawevidence',
    'rawlog',
    'transcript',
    'payload',
    'headers',
    'authorization',
    'cookies',
]);

/** Collect every string leaf under a sensitive key (plus its JSON serialisation). */
export function collectSensitiveValues(node, sensitive = false, bag = new Set()) {
    if (typeof node === 'string') {
        if (sensitive && node.trim().length >= 4) bag.add(node);
        return bag;
    }
    if (Array.isArray(node)) {
        for (const entry of node) collectSensitiveValues(entry, sensitive, bag);
        return bag;
    }
    if (node && typeof node === 'object') {
        if (sensitive) {
            try {
                bag.add(JSON.stringify(node));
            } catch {
                /* circular — leaf strings are already collected */
            }
        }
        for (const [key, value] of Object.entries(node)) {
            collectSensitiveValues(value, sensitive || SENSITIVE_KEYS.has(keyId(key)), bag);
        }
    }
    return bag;
}

/**
 * Return a scrubber that replaces every collected value and any `key: value` shape for the raw
 * input keys. Longest values first so a value that contains another is still fully removed.
 */
export function makeRedactor(values) {
    const needles = [...new Set(values)]
        .filter((value) => typeof value === 'string' && value.trim().length >= 4)
        .sort((a, b) => b.length - a.length);
    return (input) => {
        let text = String(input ?? '');
        for (const needle of needles) {
            if (text.includes(needle)) text = text.split(needle).join('[redacted]');
        }
        // `userQuery: "..."` / `requestBody={...}` shapes that survived as prose.
        text = text.replace(
            /\b(?:userQuery|user_query|requestBody|request_body|prompt)\b\s*[:=]\s*(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s,;]+)/g,
            '[redacted]',
        );
        text = text.replace(/\b(?:userQuery|user_query|requestBody|request_body)\b/g, '[redacted]');
        return text;
    };
}

/* ------------------------------------------------------------------ */
/* Turn normalisation + rendering                                      */
/* ------------------------------------------------------------------ */

export function normalizeVerdict(record = {}) {
    const raw = record.verdict ?? record.level ?? record.outcome;
    let level = null;
    let basis = record.verdict_basis ?? record.basis ?? null;
    let pass;
    if (typeof raw === 'boolean') {
        pass = raw;
        level = raw ? PASS_LEVEL : 'insufficient';
    } else if (typeof raw === 'string') {
        const value = raw.trim().toLowerCase();
        if (value === 'pass' || value === 'passed') {
            level = PASS_LEVEL;
            pass = true;
        } else if (value === 'fail' || value === 'failed') {
            level = 'insufficient';
            pass = false;
        } else if (LEVELS.includes(value)) {
            level = value;
        }
    } else if (raw && typeof raw === 'object') {
        const rawLevel = raw.level ?? raw.verdict ?? raw.status;
        if (typeof rawLevel === 'string') {
            const value = rawLevel.trim().toLowerCase();
            if (LEVELS.includes(value)) level = value;
            else if (value === 'pass' || value === 'passed') {
                level = PASS_LEVEL;
                pass = true;
            } else if (value === 'fail' || value === 'failed') {
                level = 'insufficient';
                pass = false;
            }
        }
        if (basis == null && typeof raw.basis === 'string') basis = raw.basis;
        if (typeof raw.pass === 'boolean') pass = raw.pass;
    }
    if (typeof record.pass === 'boolean') pass = record.pass;
    if (!level) level = 'unsurfaced';
    if (pass == null) pass = level === PASS_LEVEL;
    basis = typeof basis === 'string' && basis.trim() ? basis.trim().toLowerCase() : null;
    return { level, basis, pass };
}

function textOf(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('; ');
    if (typeof value === 'object') {
        for (const key of ['summary', 'message', 'reason', 'outcome', 'detail', 'description', 'code']) {
            if (key in value) return textOf(value[key]);
        }
        return `[structured: ${Object.keys(value).length} fields]`;
    }
    return '';
}

function cell(value, redact, max = 240) {
    let text = textOf(value).replace(/\s+/g, ' ').trim();
    text = redact(text);
    if (!text) text = '—';
    if (text.length > max) text = `${text.slice(0, max - 1)}…`;
    return text.replace(/\|/g, '\\|').replace(/`/g, "'");
}

function eventRow(event, redact) {
    if (typeof event === 'string') {
        return { at: '—', worker: '—', event: cell(event, redact, 80), outcome: '—' };
    }
    const entry = event && typeof event === 'object' ? event : {};
    return {
        at: cell(entry.at ?? entry.time ?? entry.timestamp ?? '—', redact, 40),
        worker: cell(entry.worker ?? entry.actor ?? entry.role ?? '—', redact, 40),
        event: cell(entry.event ?? entry.kind ?? entry.type ?? '—', redact, 60),
        outcome: cell(entry.outcome ?? entry.result ?? entry.status ?? '—', redact, 240),
    };
}

function gapLines(gaps, redact) {
    if (gaps == null) return ['- not surfaced'];
    if (!Array.isArray(gaps)) {
        if (typeof gaps === 'number') return [`- ${gaps} gap(s) recorded — no detail surfaced`];
        return [`- ${cell(gaps, redact, 240)}`];
    }
    if (gaps.length === 0) return ['- none surfaced'];
    return gaps.map((gap, index) => {
        if (gap && typeof gap === 'object') {
            const id = gap.gap_id ?? gap.id ?? gap.code ?? `gap-${index + 1}`;
            const summary = textOf(
                gap.summary ?? gap.message ?? gap.reason ?? gap.detail ?? gap.description ?? gap.kind ?? '',
            );
            return `- \`${cell(id, redact, 60)}\` — ${cell(summary || '[structured gap]', redact, 240)}`;
        }
        return `- ${cell(gap, redact, 240)}`;
    });
}

function artifactIds(record) {
    const ids = [];
    const push = (value) => {
        if (typeof value === 'string') ids.push(value);
        else if (value && typeof value === 'object') {
            const id = value.id ?? value.artifact_id ?? value.artifactId;
            if (typeof id === 'string') ids.push(id);
        }
    };
    if (Array.isArray(record.artifacts)) record.artifacts.forEach(push);
    if (Array.isArray(record.artifact_ids)) record.artifact_ids.forEach(push);
    if (typeof record.artifact_id === 'string') ids.push(record.artifact_id);
    for (const event of Array.isArray(record.events) ? record.events : []) {
        if (!event || typeof event !== 'object') continue;
        push(event.artifact);
        push(event.artifact_id);
        push(event.artifactId);
    }
    return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function renderTurnPage(record, { source, redact, index }) {
    const verdict = normalizeVerdict(record);
    const events = Array.isArray(record.events) ? record.events : [];
    const artifacts = artifactIds(record);
    const banner =
        source === 'fixture'
            ? '> **FIXTURE** — synthetic turn for dry-runs. Not a measurement.'
            : '> **RECORDED** — evidence surfaces only. Raw input and raw evidence are redacted.';
    const lines = [
        banner,
        '',
        `# Turn ${index + 1}: \`${cell(record.turn_id, redact, 80)}\``,
        '',
        '| field | value |',
        '| --- | --- |',
        `| project | ${cell(record.project ?? '—', redact, 80)} |`,
        `| turn | \`${cell(record.turn_id, redact, 80)}\` |`,
        `| verdict level | \`${cell(verdict.level, redact, 40)}\` |`,
        `| verdict basis | \`${cell(verdict.basis ?? 'not surfaced', redact, 40)}\` |`,
        `| events | ${events.length} |`,
        `| gaps | ${Array.isArray(record.gaps) ? record.gaps.length : record.gaps == null ? 'not surfaced' : 1} |`,
        `| artifacts | ${artifacts.length} |`,
        '| raw input / evidence | [redacted] |',
        '',
        '## Gaps',
        '',
        ...gapLines(record.gaps, redact),
        '',
        '## Event timeline',
        '',
        '| at | worker | event | outcome |',
        '| --- | --- | --- | --- |',
    ];
    if (events.length === 0) lines.push('| — | — | — | no events surfaced |');
    else for (const event of events) {
        const row = eventRow(event, redact);
        lines.push(`| ${row.at} | ${row.worker} | ${row.event} | ${row.outcome} |`);
    }
    lines.push('', '## Artifact ids', '');
    if (artifacts.length === 0) lines.push('- none surfaced');
    else for (const id of artifacts) lines.push(`- \`${cell(id, redact, 120)}\``);
    lines.push('');
    return { markdown: lines.join('\n'), verdict, events: events.length, artifacts };
}

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const FIXTURE_SPECS = Object.freeze([
    {
        level: 'sufficient',
        basis: 'verified',
        gaps: [],
        events: [
            ['2026-11-20T09:00:01Z', 'plan', 'plan.ready', 'scope + acceptance supplied'],
            ['2026-11-20T09:00:05Z', 'build', 'build.done', '3 files changed'],
            ['2026-11-20T09:00:09Z', 'verify', 'verify.done', 'gate 2/2 pass'],
        ],
        artifacts: ['art-plan-01', 'art-build-01', 'art-verify-01'],
    },
    {
        level: 'partial',
        basis: 'retrieved',
        gaps: [{ gap_id: 'gap-verify-missing', summary: 'no test run surfaced for the changed module' }],
        events: [
            ['2026-11-20T09:10:01Z', 'scout', 'recon.done', 'repo layout read'],
            ['2026-11-20T09:10:06Z', 'build', 'build.done', '2 files changed'],
            ['2026-11-20T09:10:11Z', 'audit', 'audit.blocked', 'missing verify evidence'],
        ],
        artifacts: ['art-recon-02', 'art-build-02'],
    },
    {
        level: 'insufficient',
        basis: 'declared',
        gaps: [{ gap_id: 'gap-no-surface', summary: 'worker returned a claim without an event trail' }],
        events: [['2026-11-20T09:20:01Z', 'build', 'build.claimed', 'no artifacts attached']],
        artifacts: [],
    },
    {
        level: 'sufficient',
        basis: 'retrieved',
        gaps: [],
        events: [
            ['2026-11-20T09:30:01Z', 'plan', 'plan.ready', 'slice boundary recorded'],
            ['2026-11-20T09:30:04Z', 'build', 'build.done', '1 file changed'],
            ['2026-11-20T09:30:08Z', 'verify', 'verify.done', 'test exit 0'],
            ['2026-11-20T09:30:12Z', 'audit', 'audit.pass', 'rubric 92, 0 critical'],
        ],
        artifacts: ['art-plan-04', 'art-build-04', 'art-audit-04'],
    },
    {
        level: 'cannot-judge',
        basis: 'inferred',
        gaps: [{ gap_id: 'gap-worker-gone', summary: 'terminal event missing; worker status unknown' }],
        events: [
            ['2026-11-20T09:40:01Z', 'build', 'build.started', 'no terminal event'],
            ['2026-11-20T09:40:02Z', 'build', 'build.heartbeat', 'stale after start'],
        ],
        artifacts: ['art-build-05'],
    },
    {
        level: 'sufficient',
        basis: 'verified',
        gaps: [],
        events: [
            ['2026-11-20T09:50:01Z', 'plan', 'plan.ready', 'risk opened and accepted'],
            ['2026-11-20T09:50:03Z', 'build', 'build.done', '4 files changed'],
            ['2026-11-20T09:50:07Z', 'verify', 'verify.done', 'gate pass'],
            ['2026-11-20T09:50:09Z', 'audit', 'risk.accepted', 'risk-12 accepted by owner'],
        ],
        artifacts: ['art-plan-06', 'art-build-06', 'art-verify-06'],
    },
    {
        level: 'partial',
        basis: 'verified',
        gaps: [{ gap_id: 'gap-artifact-mismatch', summary: 'verify artifact id does not match build artifact' }],
        events: [
            ['2026-11-20T10:00:01Z', 'build', 'build.done', 'artifact art-build-07'],
            ['2026-11-20T10:00:05Z', 'verify', 'verify.done', 'artifact art-verify-99'],
            ['2026-11-20T10:00:07Z', 'qc', 'qc.flag', 'artifact lineage mismatch'],
        ],
        artifacts: ['art-build-07', 'art-verify-99'],
    },
    {
        level: 'sufficient',
        basis: 'declared',
        gaps: [],
        events: [
            ['2026-11-20T10:10:01Z', 'plan', 'plan.ready', 'declared plan only'],
            ['2026-11-20T10:10:04Z', 'build', 'build.done', 'declared completion'],
            ['2026-11-20T10:10:08Z', 'verify', 'verify.skipped', 'declared out of scope by owner'],
        ],
        artifacts: ['art-plan-08'],
    },
    {
        level: 'insufficient',
        basis: 'inferred',
        gaps: [{ gap_id: 'gap-authz-refusal', summary: 'authz refusal surfaced; no work performed' }],
        events: [
            ['2026-11-20T10:20:01Z', 'build', 'authz.refused', 'actor lacks write scope'],
            ['2026-11-20T10:20:02Z', 'build', 'build.aborted', 'no mutation attempted'],
        ],
        artifacts: [],
    },
    {
        level: 'sufficient',
        basis: 'verified',
        gaps: [],
        events: [
            ['2026-11-20T10:30:01Z', 'plan', 'plan.ready', 'single slice'],
            ['2026-11-20T10:30:03Z', 'build', 'build.done', '5 files changed'],
            ['2026-11-20T10:30:07Z', 'verify', 'verify.done', 'gate 3/3 pass'],
            ['2026-11-20T10:30:10Z', 'audit', 'audit.pass', 'rubric 88, 0 critical'],
            ['2026-11-20T10:30:12Z', 'qc', 'qc.pass', 'spot check ok'],
        ],
        artifacts: ['art-plan-10', 'art-build-10', 'art-verify-10', 'art-audit-10'],
    },
]);

/** Build the 10 synthetic turns. Each carries raw-looking fields so redaction is exercised. */
export function buildFixtureTurns() {
    return FIXTURE_SPECS.map((spec, index) => {
        const n = String(index + 1).padStart(2, '0');
        const secretQuery = `${FIXTURE_SECRET_PREFIX.query}-${n}`;
        const secretInput = `${FIXTURE_SECRET_PREFIX.input}-${n}`;
        const secretBody = `${FIXTURE_SECRET_PREFIX.body}-${n}`;
        const secretEvidence = `${FIXTURE_SECRET_PREFIX.evidence}-${n}`;
        return {
            turn_id: `fixture-${n}`,
            project: 'fixture-eso',
            verdict: { level: spec.level, basis: spec.basis },
            gaps: spec.gaps.map((gap) => ({ ...gap, evidence: { raw: secretEvidence } })),
            events: spec.events.map(([at, worker, event, outcome], eventIndex) => ({
                at,
                worker,
                event,
                outcome: eventIndex === 1 ? `${outcome} (input ${secretBody})` : outcome,
                evidence: { raw: secretEvidence },
                requestBody: { messages: [{ role: 'user', content: secretBody }] },
            })),
            artifacts: spec.artifacts,
            userQuery: secretQuery,
            prompt: secretInput,
            requestBody: { messages: [{ role: 'user', content: secretBody }] },
            evidence: {
                raw: secretEvidence,
                items: [{ kind: 'state_snapshot', payload: { note: secretEvidence } }],
            },
        };
    });
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

function ensurePositiveLimit(value) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1) throw new UsageError(`--limit must be a positive integer, got ${value}`);
    return limit;
}

export function readRecords(input) {
    let raw;
    try {
        raw = fs.readFileSync(input, 'utf8');
    } catch (error) {
        throw new UsageError(`cannot read --input ${input}: ${error.message}`);
    }
    const trimmed = raw.trim();
    if (!trimmed) throw new UsageError(`--input ${input} is empty`);

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            // A JSONL file also starts with '{' but is not one document; fall through to line mode.
            if (!trimmed.includes('\n')) {
                throw new UsageError(`--input ${input} is not valid JSON: ${error.message}`);
            }
            parsed = undefined;
        }
        if (parsed !== undefined) {
            if (Array.isArray(parsed)) return parsed;
            if (parsed && Array.isArray(parsed.turns)) return parsed.turns;
            throw new UsageError('--input JSON must be an array of turns or an object with "turns"');
        }
    }

    const records = [];
    trimmed.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        try {
            records.push(JSON.parse(line));
        } catch (error) {
            throw new UsageError(`--input ${input} line ${index + 1} is not valid JSON: ${error.message}`);
        }
    });
    return records;
}

function validateRecords(records) {
    const seen = new Set();
    records.forEach((record, index) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new UsageError(`turn ${index + 1} is not an object`);
        }
        if (typeof record.turn_id !== 'string' || !record.turn_id.trim()) {
            throw new UsageError(`turn ${index + 1} is missing a non-empty "turn_id"`);
        }
        if (seen.has(record.turn_id)) throw new UsageError(`duplicate turn_id "${record.turn_id}"`);
        seen.add(record.turn_id);
    });
    return records;
}

function safeFileBase(turnId) {
    const base = String(turnId)
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/^\.+/, '_')
        .slice(0, 120);
    return base || 'turn';
}

function cleanPrevious(outDir) {
    const manifestPath = path.join(outDir, '_manifest.json');
    if (!fs.existsSync(manifestPath)) return;
    try {
        const previous = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        for (const turn of Array.isArray(previous.turns) ? previous.turns : []) {
            const file = typeof turn?.file === 'string' ? turn.file : '';
            if (!file.endsWith('.md') || path.basename(file) !== file) continue;
            const target = path.join(outDir, file);
            if (fs.existsSync(target)) fs.unlinkSync(target);
        }
    } catch {
        /* a broken previous manifest is not worth failing a fresh export over */
    }
}

/* ------------------------------------------------------------------ */
/* README                                                              */
/* ------------------------------------------------------------------ */

function renderReadme({ source, turns }) {
    const passCount = turns.filter((turn) => turn.pass).length;
    const failCount = turns.length - passCount;
    const fixture = source === 'fixture';
    return `# V2 reviewer study — evidence surfaces only

Source: **${fixture ? 'FIXTURE — synthetic turns, not a measurement' : 'RECORDED turns'}**  
Turns: ${turns.length} (${passCount} pass / ${failCount} fail by recorded verdict level)

## Question

For each turn page, answer **pass** or **fail** and explain **why**, using only the surfaces in
this pack. The study tests whether a person who does not know the repository can reconstruct the
turn's outcome from ESO evidence — not whether they can read raw logs.

## Allowed surfaces

- this README, \`_manifest.json\`, and the per-turn Markdown pages
- verdict level + verdict basis
- gap summary (gap ids, gap text)
- event timeline (\`at\` · \`worker\` · \`event\` · \`outcome\`)
- artifact ids

Not allowed: raw logs or transcripts, model input, request bodies, raw evidence blobs, repository
source, network calls, or asking the author.

## Answer format

\`answers.json\` — either a bare array or \`{ "answers": [ ... ] }\`:

\`\`\`json
{
  "answers": [
    {
      "turn_id": "fixture-01",
      "answer": "pass",
      "why": "verify.done at 2026-11-20T09:00:09Z reports gate 2/2 pass; no gaps; artifacts art-plan-01, art-build-01, art-verify-01 line up."
    }
  ]
}
\`\`\`

Every turn must be answered exactly once. \`answer\` is \`pass\` or \`fail\`; \`why\` is required and must
cite at least two independent surfaces (an event with timestamp/worker, a gap id, or an artifact
id). A bare pass/fail with no evidence is not a valid study answer.

## Rubric

| item | rule |
| --- | --- |
| correct | your \`answer\` matches the turn's recorded verdict |
| why | manually reviewed; must cite timeline/gap/artifact surfaces |
| target | **≥ 8 / 10 correct** (ratio ≥ 0.8) to pass the study |
| mapping | recorded level \`sufficient\` = **pass**; every other level = **fail** |

The pack shows the recorded verdict level because it is an evidence surface. The graded judgement
is still the pass/fail answer plus the justification; the scorer only checks the answer, so the
\`why\` is what makes the study meaningful.

## Score a round

\`\`\`bash
node scripts/score-v2-review.mjs \\
  --answers answers.json \\
  --truth ${fixture ? '<this pack>/_manifest.json' : '<records>.jsonl'}
\`\`\`

Exit 0 = ratio ≥ 0.8; exit 1 = below target; exit 2 = malformed answers or truth.

## Redaction

User queries, model inputs, raw request bodies and raw evidence blobs are replaced with
\`[redacted]\`. The pages contain only the surfaces listed above; nothing else from the recorded
turn is copied.

## Limits

- A **FIXTURE** pack is a dry-run of the harness: it is synthetic and must never be reported as a
  measurement.
- Answer accuracy is partly traceable from the verdict level shown on each page; the discriminating
  signal is the \`why\`, which is reviewed by hand (the scorer does not judge prose).
- The pack does not prove the verdict itself was correct — only that it is explainable from the
  surfaces that were recorded.
`;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function exportPack({
    input = null,
    out = DEFAULT_OUT,
    limit = DEFAULT_LIMIT,
    fixture = false,
    now = new Date(),
} = {}) {
    if (fixture && input) throw new UsageError('use either --fixture or --input, not both');
    if (!fixture && !input) throw new UsageError('either --input <jsonl> or --fixture is required');
    const maxTurns = ensurePositiveLimit(limit);
    const source = fixture ? 'fixture' : 'records';
    const records = validateRecords(fixture ? buildFixtureTurns() : readRecords(input));
    if (records.length === 0) throw new UsageError('no turns found');

    const selected = records.slice(0, maxTurns);
    fs.mkdirSync(out, { recursive: true });
    cleanPrevious(out);

    const usedNames = new Set(['README.md', '_manifest.json']);
    const turns = [];
    selected.forEach((record, index) => {
        const redact = makeRedactor(collectSensitiveValues(record));
        const rendered = renderTurnPage(record, { source, redact, index });
        let base = safeFileBase(record.turn_id);
        let file = `${base}.md`;
        let suffix = 2;
        while (usedNames.has(file)) file = `${base}-${suffix++}.md`;
        usedNames.add(file);
        const content = rendered.markdown;
        fs.writeFileSync(path.join(out, file), content, 'utf8');
        turns.push({
            turn_id: record.turn_id,
            project: typeof record.project === 'string' ? record.project : null,
            file,
            verdict: { level: rendered.verdict.level, basis: rendered.verdict.basis },
            pass: rendered.verdict.pass,
            gaps: Array.isArray(record.gaps) ? record.gaps.length : record.gaps == null ? 0 : 1,
            events: rendered.events,
            artifact_ids: rendered.artifacts,
        });
    });

    const manifest = {
        turns,
        turnCount: turns.length,
        source,
        sourceLabel:
            source === 'fixture'
                ? 'FIXTURE — synthetic dry-run, not a measurement'
                : 'recorded turns — evidence surfaces only',
        generatedAt: now.toISOString(),
        generator: 'scripts/export-v2-review-pack.mjs',
        totals: {
            pass: turns.filter((turn) => turn.pass).length,
            fail: turns.filter((turn) => !turn.pass).length,
        },
    };
    fs.writeFileSync(path.join(out, '_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(out, 'README.md'), renderReadme({ source, turns }), 'utf8');
    return manifest;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const USAGE = `Usage: node scripts/export-v2-review-pack.mjs (--input <jsonl> | --fixture) [--out <dir>] [--limit N]

  --input <jsonl>   one recorded turn per line: {turn_id, project, verdict, gaps, events[]}
  --fixture         write 10 synthetic FIXTURE turns for a dry-run (never a measurement)
  --out <dir>       output directory (default ${DEFAULT_OUT})
  --limit N         export at most N turns (default ${DEFAULT_LIMIT})
`;

export function parseArgs(argv) {
    const options = { input: null, out: DEFAULT_OUT, limit: DEFAULT_LIMIT, fixture: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
        const value = () => {
            if (inline != null) return inline;
            const next = argv[index + 1];
            if (next == null || next.startsWith('--')) throw new UsageError(`${flag} needs a value`);
            index += 1;
            return next;
        };
        switch (flag) {
            case '--input':
                options.input = value();
                break;
            case '--out':
                options.out = value();
                break;
            case '--limit':
                options.limit = ensurePositiveLimit(value());
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

export function main(argv = process.argv.slice(2)) {
    try {
        const options = parseArgs(argv);
        if (options.help) {
            process.stdout.write(USAGE);
            return 0;
        }
        const manifest = exportPack(options);
        process.stdout.write(
            `${JSON.stringify(
                {
                    out: options.out,
                    source: manifest.source,
                    turnCount: manifest.turnCount,
                    files: manifest.turns.map((turn) => turn.file),
                },
                null,
                2,
            )}\n`,
        );
        return 0;
    } catch (error) {
        if (error instanceof UsageError) {
            process.stderr.write(`[v2-review] ${error.message}\n\n${USAGE}`);
            return error.exitCode;
        }
        process.stderr.write(`[v2-review] ${error.stack || error.message}\n`);
        return 1;
    }
}

const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main();
