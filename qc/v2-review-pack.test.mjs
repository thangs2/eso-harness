import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURE_SECRETS } from '../scripts/export-v2-review-pack.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = path.join(REPO, 'scripts/export-v2-review-pack.mjs');
const SCORE = path.join(REPO, 'scripts/score-v2-review.mjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v2-review-pack-'));
const run = (script, args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: REPO, encoding: 'utf8' });
const read = (file) => fs.readFileSync(file, 'utf8');
const filesIn = (dir) => fs.readdirSync(dir).sort();
const turnPages = (dir) => filesIn(dir).filter((name) => name.endsWith('.md') && name !== 'README.md');

function exportedFixture() {
    const out = temp();
    const result = run(EXPORT, ['--fixture', '--out', out]);
    assert.equal(result.status, 0, result.stderr);
    return { out, manifest: JSON.parse(read(path.join(out, '_manifest.json'))) };
}

function answersFromManifest(manifest) {
    return manifest.turns.map((turn, index) => ({
        turn_id: turn.turn_id,
        answer: turn.pass ? 'pass' : 'fail',
        why: `event at 2026-11-20T09:00:0${index % 9}Z on worker build; gap ${turn.gaps}; artifacts ${turn.artifact_ids.join(', ') || 'none'}`,
    }));
}

function writeAnswers(dir, answers) {
    const file = path.join(dir, `answers-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(answers, null, 2));
    return file;
}

test('export --fixture: 10 pages + manifest source fixture, FIXTURE label, no raw values', () => {
    const { out, manifest } = exportedFixture();

    assert.equal(manifest.source, 'fixture');
    assert.equal(manifest.turnCount, 10);
    assert.equal(Array.isArray(manifest.turns), true);
    assert.equal(manifest.turns.length, 10);
    assert.ok(!Number.isNaN(Date.parse(manifest.generatedAt)), 'generatedAt is an ISO timestamp');
    assert.equal(turnPages(out).length, 10, 'ten turn pages, README excluded');
    assert.ok(filesIn(out).includes('README.md'));
    assert.ok(filesIn(out).includes('_manifest.json'));

    const generated = filesIn(out).map((name) => ({ name, text: read(path.join(out, name)) }));
    for (const { name, text } of generated) {
        assert.match(text, /FIXTURE/, `${name} is labelled FIXTURE`);
        for (const secret of FIXTURE_SECRETS) {
            assert.equal(text.includes(secret), false, `${name} leaks fixture raw value ${secret}`);
        }
        assert.equal(/userQuery|requestBody|prompt/.test(text), false, `${name} leaks a raw-input key name`);
        assert.equal(text.includes('[redacted]') || name === '_manifest.json', true, `${name} shows redaction marker`);
    }

    const page = read(path.join(out, manifest.turns[0].file));
    assert.match(page, /\| at \| worker \| event \| outcome \|/);
    assert.match(page, /verdict level/);
    assert.match(page, /verdict basis/);
    assert.match(page, /## Gaps/);
    assert.match(page, /## Artifact ids/);
    assert.match(page, /art-verify-01/);

    const readme = read(path.join(out, 'README.md'));
    assert.match(readme, /≥ 8 \/ 10/);
    assert.match(readme, /Allowed surfaces/);
    assert.match(readme, /pass/);
    assert.match(readme, /fail/);
    assert.match(readme, /redacted/);
});

test('export --input: records source, limit honoured, sensitive values redacted', () => {
    const dir = temp();
    const out = path.join(dir, 'pack');
    const input = path.join(dir, 'turns.jsonl');
    const secrets = [
        'SECRET-QUERY-ALPHA-001',
        'SECRET-INPUT-BETA-002',
        'SECRET-BODY-GAMMA-003',
        'SECRET-EVIDENCE-DELTA-004',
    ];
    const lines = Array.from({ length: 12 }, (_, index) => {
        const n = String(index + 1).padStart(2, '0');
        return JSON.stringify({
            turn_id: `rec-${n}`,
            project: 'measured-project',
            verdict: { level: index % 3 === 0 ? 'partial' : 'sufficient', basis: 'verified' },
            gaps: index % 3 === 0 ? [{ gap_id: `gap-${n}`, summary: `missing verify evidence ${secrets[3]}` }] : [],
            events: [
                {
                    at: `2026-11-21T10:00:${n}Z`,
                    worker: 'build',
                    event: 'build.done',
                    outcome: `changed 2 files with ${secrets[2]}`,
                    evidence: { raw: secrets[3] },
                },
                {
                    at: `2026-11-21T10:01:${n}Z`,
                    worker: 'verify',
                    event: 'verify.done',
                    outcome: 'gate pass',
                },
            ],
            artifacts: [`art-${n}`],
            userQuery: secrets[0],
            prompt: secrets[1],
            requestBody: { messages: [{ role: 'user', content: secrets[2] }] },
            evidence: { raw: secrets[3], items: [{ payload: { note: secrets[3] } }] },
        });
    });
    fs.writeFileSync(input, `${lines.join('\n')}\n`);

    const result = run(EXPORT, ['--input', input, '--out', out, '--limit', '10']);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(read(path.join(out, '_manifest.json')));
    assert.equal(manifest.source, 'records');
    assert.equal(manifest.turns.length, 10);
    assert.equal(turnPages(out).length, 10);
    assert.equal(fs.existsSync(path.join(out, 'rec-11.md')), false, 'limit cuts turn 11');
    assert.ok(fs.existsSync(path.join(out, 'rec-01.md')));

    for (const name of filesIn(out)) {
        const text = read(path.join(out, name));
        for (const secret of secrets) assert.equal(text.includes(secret), false, `${name} leaks ${secret}`);
    }
    const page = read(path.join(out, 'rec-01.md'));
    assert.match(page, /## Event timeline/);
    assert.match(page, /missing verify evidence/);
    assert.match(page, /art-01/);
    assert.match(page, /partial/);
});

test('score: 8/10 correct passes, 7/10 fails, 10/10 is exact', () => {
    const { out, manifest } = exportedFixture();
    const truth = path.join(out, '_manifest.json');
    const base = answersFromManifest(manifest);

    const eight = base.map((entry, index) => (index < 2 ? { ...entry, answer: entry.answer === 'pass' ? 'fail' : 'pass' } : entry));
    const eightFile = writeAnswers(out, eight);
    const eightRun = run(SCORE, ['--answers', eightFile, '--truth', truth]);
    assert.equal(eightRun.status, 0, eightRun.stderr);
    const eightResult = JSON.parse(eightRun.stdout);
    assert.equal(eightResult.correct, 8);
    assert.equal(eightResult.ratio, 0.8);
    assert.equal(eightResult.pass, true);
    assert.equal(eightResult.threshold, 0.8);
    assert.equal(eightResult.correct_without_raw_log, true);
    assert.match(eightResult.correct_without_raw_log_note, /by construction/);

    const seven = base.map((entry, index) => (index < 3 ? { ...entry, answer: entry.answer === 'pass' ? 'fail' : 'pass' } : entry));
    const sevenRun = run(SCORE, ['--answers', writeAnswers(out, seven), '--truth', truth]);
    assert.equal(sevenRun.status, 1, 'below target exits 1');
    const sevenResult = JSON.parse(sevenRun.stdout);
    assert.equal(sevenResult.correct, 7);
    assert.equal(sevenResult.ratio, 0.7);
    assert.equal(sevenResult.pass, false);

    const perfectRun = run(SCORE, ['--answers', writeAnswers(out, base), '--truth', truth]);
    assert.equal(perfectRun.status, 0, perfectRun.stderr);
    assert.equal(JSON.parse(perfectRun.stdout).ratio, 1);

    // Missing answers count as incorrect, not as absent from the denominator.
    const gaps = base.slice(0, 7);
    const gapsRun = run(SCORE, ['--answers', writeAnswers(out, gaps), '--truth', truth]);
    assert.equal(gapsRun.status, 1);
    const gapsResult = JSON.parse(gapsRun.stdout);
    assert.equal(gapsResult.correct, 7);
    assert.equal(gapsResult.missing.length, 3);
});

test('score: malformed answers, unknown turns, and malformed truth exit 2', () => {
    const { out, manifest } = exportedFixture();
    const truth = path.join(out, '_manifest.json');
    const base = answersFromManifest(manifest);

    const badValue = path.join(out, 'bad-value.json');
    fs.writeFileSync(badValue, JSON.stringify([{ ...base[0], answer: 'maybe' }]));
    assert.equal(run(SCORE, ['--answers', badValue, '--truth', truth]).status, 2);

    const noWhy = path.join(out, 'no-why.json');
    fs.writeFileSync(noWhy, JSON.stringify([{ turn_id: base[0].turn_id, answer: base[0].answer }]));
    assert.equal(run(SCORE, ['--answers', noWhy, '--truth', truth]).status, 2);

    const notJson = path.join(out, 'not-json.json');
    fs.writeFileSync(notJson, '{ this is not json');
    assert.equal(run(SCORE, ['--answers', notJson, '--truth', truth]).status, 2);

    const missingFile = path.join(out, 'does-not-exist.json');
    assert.equal(run(SCORE, ['--answers', missingFile, '--truth', truth]).status, 2);

    const unknownTurn = path.join(out, 'unknown-turn.json');
    fs.writeFileSync(unknownTurn, JSON.stringify([...base, { turn_id: 'turn-not-in-truth', answer: 'pass', why: 'x' }]));
    assert.equal(run(SCORE, ['--answers', unknownTurn, '--truth', truth]).status, 2);

    const badTruth = path.join(out, 'bad-truth.json');
    fs.writeFileSync(badTruth, JSON.stringify([{ turn_id: 't1' }]));
    assert.equal(run(SCORE, ['--answers', writeAnswers(out, base), '--truth', badTruth]).status, 2);
});

test('score --truth accepts recorded JSONL with verdict levels', () => {
    const dir = temp();
    const truth = path.join(dir, 'truth.jsonl');
    const input = path.join(dir, 'turns.jsonl');
    const records = [
        { turn_id: 't-1', project: 'p', verdict: { level: 'sufficient', basis: 'verified' }, gaps: [], events: [] },
        { turn_id: 't-2', project: 'p', verdict: 'partial', gaps: [], events: [] },
    ];
    fs.writeFileSync(input, records.map((record) => JSON.stringify(record)).join('\n'));
    fs.writeFileSync(truth, records.map((record) => JSON.stringify(record)).join('\n'));

    const answers = path.join(dir, 'answers.json');
    fs.writeFileSync(
        answers,
        JSON.stringify([
            { turn_id: 't-1', answer: 'pass', why: 'verify.done gate pass; artifact art-1' },
            { turn_id: 't-2', answer: 'fail', why: 'gap-verify missing; only build.done surfaced' },
        ]),
    );
    const result = run(SCORE, ['--answers', answers, '--truth', truth]);
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.source, 'records');
    assert.equal(output.correct, 2);
    assert.equal(output.ratio, 1);
    assert.equal(output.truth_levels.sufficient, 1);
    assert.equal(output.truth_levels.partial, 1);
});
