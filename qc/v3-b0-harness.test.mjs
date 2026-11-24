import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURE_SECRETS, deriveTruth } from '../scripts/v3-replay.mjs';
import { fixtureDetail, fixtureSignalDetail, scoreDetail } from '../scripts/b0-baseline.mjs';

// P0.2 measurement harness: both scripts must run offline in fixture mode so CI never needs a
// control plane, and the V3 scorer must gate on the 8/10 turn target. Every script invocation goes
// through `node scripts/...` (the same way a consumer would call it).
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B0 = path.join(REPO, 'scripts/b0-baseline.mjs');
const V3 = path.join(REPO, 'scripts/v3-replay.mjs');
const STARTED_AT = Date.now();

const QUESTION_CHOICES = Object.freeze({
    q1: Object.freeze(['allowed', 'blocked', 'unknown']),
    q2: Object.freeze(['cited', 'uncited', 'unknown']),
    q3: Object.freeze(['sufficient', 'insufficient', 'unknown']),
    q4: Object.freeze(['changed', 'none', 'unknown']),
    q5: Object.freeze(['verified', 'unverified', 'unknown']),
    q6: Object.freeze(['present', 'none', 'unknown']),
});

function temp(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-b0-harness-'));
    if (t) t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function run(script, args) {
    return spawnSync(process.execPath, [script, ...args], {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 5000,
    });
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Walk every string/key in the written pack and report redaction violations. */
function violations(pack) {
    const found = [];
    const seen = new Set();
    const visit = (node, trail) => {
        if (typeof node === 'string') {
            if (node.length > 120) found.push(`${trail}: string of ${node.length} chars`);
            return;
        }
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            node.forEach((entry, index) => visit(entry, `${trail}[${index}]`));
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (/^(userQuery|prompt|requestBody)$/i.test(key)) found.push(`${trail}.${key}: leaked key`);
            visit(value, `${trail}.${key}`);
        }
    };
    visit(pack, 'pack');
    return found;
}

function writePack(t) {
    const dir = temp(t);
    const file = path.join(dir, 'v3-pack.json');
    const result = run(V3, ['--fixture', '--out', file]);
    assert.equal(result.status, 0, result.stderr);
    return { dir, file, pack: readJson(file) };
}

function answersFromPack(pack, correctTurns) {
    return pack.turns.map((turn, index) => {
        const truth = deriveTruth(turn);
        const row = { turn_id: turn.turn_id, ...truth };
        if (index >= correctTurns) {
            const choices = QUESTION_CHOICES.q1;
            row.q1 = choices.find((choice) => choice !== truth.q1) ?? choices[0];
        }
        return row;
    });
}

test('v3 --fixture: 10 turns, source fixture, no prompt keys or long strings', (t) => {
    const { file, pack } = writePack(t);

    assert.equal(pack.source, 'fixture');
    assert.equal(pack.turns.length, 10);
    assert.deepEqual(
        pack.turns.map((turn) => turn.turn_id),
        Array.from({ length: 10 }, (_, index) => `fixture-v3-${String(index + 1).padStart(2, '0')}`),
    );

    for (const turn of pack.turns) {
        assert.equal(typeof turn.turn_id, 'string');
        assert.deepEqual(Object.keys(turn.questions).sort(), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']);
        for (const id of Object.keys(turn.questions)) {
            assert.deepEqual(turn.questions[id].choices, QUESTION_CHOICES[id]);
        }
        assert.equal(typeof turn.allowed_evidence, 'object');
        assert.ok(turn.allowed_evidence !== null);
    }

    assert.deepEqual(violations(pack), [], 'no leaked prompt keys and no string longer than 120 chars');
    const text = fs.readFileSync(file, 'utf8');
    for (const secret of FIXTURE_SECRETS) {
        assert.equal(text.includes(secret), false, `fixture secret leaked into the pack: ${secret.slice(0, 24)}`);
    }
});

test('b0 --fixture: ten items, numeric score, deterministic', (t) => {
    const dir = temp(t);
    const first = path.join(dir, 'b0-1.json');
    const second = path.join(dir, 'b0-2.json');

    const runA = run(B0, ['--fixture', '--json', first]);
    assert.equal(runA.status, 0, runA.stderr);
    const runB = run(B0, ['--fixture', '--json', second]);
    assert.equal(runB.status, 0, runB.stderr);

    const report = readJson(first);
    assert.equal(report.consumer, 'fineso');
    assert.equal(report.source, 'fixture');
    assert.equal(report.turns, 1);
    assert.deepEqual(
        report.b0.items.map((item) => item.id),
        Array.from({ length: 10 }, (_, index) => `B0-${index + 1}`),
    );
    for (const item of report.b0.items) {
        assert.equal(typeof item.present, 'boolean');
        assert.equal(typeof item.evidence, 'string');
        assert.ok(item.evidence.length > 0);
    }
    assert.equal(typeof report.b0.score, 'number');
    assert.ok(report.b0.score >= 0 && report.b0.score <= 10, `score ${report.b0.score} outside 0..10`);
    assert.equal(report.b0.score, report.b0.items.filter((item) => item.present).length);
    assert.equal(report.perTurn.length, 1);
    assert.equal(report.perTurn[0].score, report.b0.score);

    const strip = ({ generatedAt, ...rest }) => rest;
    assert.deepEqual(strip(readJson(second)), strip(report), 'same fixture must produce the same report');
});

test('b0 fixture: projection proves B0-1; signals raise B0-4/6/8', () => {
    const row = (items, id) => items.find((item) => item.id === id);
    const legacy = scoreDetail(fixtureDetail());
    const signalled = scoreDetail(fixtureSignalDetail());

    assert.ok(
        signalled.filter((item) => item.present).length > legacy.filter((item) => item.present).length,
        'signals must score higher than the legacy fixture',
    );
    assert.equal(row(legacy, 'B0-1').present, true, 'decision projection is independent of signals');
    assert.equal(row(legacy, 'B0-6').present, false);
    assert.equal(row(legacy, 'B0-8').present, false);

    const proofs = {
        'B0-1': /projection: verdict allow/,
        'B0-4': /detail\.signals\.recon: .*3 call\(s\)/,
        'B0-6': /SLP roles \d+/,
        'B0-8': /detail\.signals\.distill\.memorySaved=true/,
    };
    for (const [id, pattern] of Object.entries(proofs)) {
        const item = row(signalled, id);
        assert.equal(item.present, true, `${id} should be proven by signals`);
        assert.match(item.evidence, pattern, `${id} evidence must name the proving field`);
    }

    // A host that reports "not saved" / "0 calls" is not proof; the signal does not fall back.
    const legacyTierOnly = fixtureSignalDetail();
    legacyTierOnly.pipeline = [];
    const tierOnlyRows = scoreDetail(legacyTierOnly);
    assert.equal(row(tierOnlyRows, 'B0-6').present, false, 'brainTier alone must not satisfy B0-6');
    assert.match(row(tierOnlyRows, 'B0-6').evidence, /legacy substitute/);

    const denied = fixtureSignalDetail();
    denied.signals.distill = { memorySaved: false };
    denied.signals.recon = [{ adapter: 'codegraph', calls: 0 }];
    const deniedRows = scoreDetail(denied);
    assert.equal(row(deniedRows, 'B0-8').present, false);
    assert.match(row(deniedRows, 'B0-8').evidence, /memorySaved=false/);
    assert.equal(row(deniedRows, 'B0-4').present, false);
    assert.match(row(deniedRows, 'B0-4').evidence, /0 call\(s\)/);
});

test('v3 --score: 8/10 passes (0), 6/10 fails (1), malformed answers exit 2', (t) => {
    const { dir, pack } = writePack(t);
    const answers = (count, name) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, JSON.stringify(answersFromPack(pack, count), null, 2));
        return file;
    };

    const pass = run(V3, ['--score', '--pack', path.join(dir, 'v3-pack.json'), '--answers', answers(8, 'answers-8.json')]);
    assert.equal(pass.status, 0, pass.stderr);
    const passReport = JSON.parse(pass.stdout);
    assert.equal(passReport.overall, 0.8);
    assert.equal(passReport.pass, true);
    assert.equal(passReport.turns, 10);
    for (const id of Object.keys(QUESTION_CHOICES)) {
        assert.equal(typeof passReport.perQuestion[id].accuracy, 'number');
    }

    const fail = run(V3, ['--score', '--pack', path.join(dir, 'v3-pack.json'), '--answers', answers(6, 'answers-6.json')]);
    assert.equal(fail.status, 1, fail.stderr);
    const failReport = JSON.parse(fail.stdout);
    assert.equal(failReport.overall, 0.6);
    assert.equal(failReport.pass, false);

    const malformed = path.join(dir, 'answers-malformed.json');
    fs.writeFileSync(malformed, JSON.stringify({ answers: 'not-a-list' }));
    const broken = run(V3, ['--score', '--pack', path.join(dir, 'v3-pack.json'), '--answers', malformed]);
    assert.equal(broken.status, 2, broken.stderr);
});

test('harness suite stays under 5s', () => {
    assert.ok(Date.now() - STARTED_AT < 5000, `suite took ${Date.now() - STARTED_AT}ms`);
});
