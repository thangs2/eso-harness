/**
 * X16 — the artifact-contract check inside `scripts/check-sdlc-gate.mjs`.
 *
 * Proves the wiring: the human line reports `errors=N`, strict (default) turns errors into exit 1 with
 * the `X16 artifact contract N error` summary, and `ESO_ARTIFACT_GATE=warn` downgrades X16 without
 * touching the exit code of the existing X7…X15 checks.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const GATE = join(REPO, 'scripts', 'check-sdlc-gate.mjs');

const HUMAN_BODY = 'The human document is the source of truth for this topic. An agent projection may index it, cite it and point at it, but it must never repeat the body, because a copy becomes a second source that silently drifts away from the original.';
const HUMAN_DOC = `---\nrepresentation: human\n---\n${HUMAN_BODY}\n`;
const COPIED_AI_DOC = `---\nrepresentation: agent\nhuman_sot: docs/human.md\n---\n# AI index\n\n${HUMAN_BODY}\n`;

const roots = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Minimal repo root: an (empty) sdlc/ so X7…X15 run, plus whatever docs the case needs. */
function fixture(files = {}) {
    const root = mkdtempSync(join(tmpdir(), 'gate-x16-'));
    roots.push(root);
    const all = { 'sdlc/00.index.md': '# fixture\n', ...files };
    for (const [relative, text] of Object.entries(all)) {
        mkdirSync(dirname(join(root, relative)), { recursive: true });
        writeFileSync(join(root, relative), text);
    }
    return root;
}

function run(root, env = {}) {
    const childEnv = { ...process.env, ...env };
    if (!('ESO_ARTIFACT_GATE' in env)) delete childEnv.ESO_ARTIFACT_GATE;
    delete childEnv.ESO_GATE_ROOT;
    const proc = spawnSync(process.execPath, [GATE, '--root', root], { encoding: 'utf8', env: childEnv });
    return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

const xLines = (stdout) => stdout.split('\n').filter((line) => /^X(7|10|11|12|13|14|15)\b/.test(line));

test('clean fixture ⇒ X16 errors=0, exit 0, X7…X15 still printed', () => {
    const root = fixture({ 'docs/human.md': HUMAN_DOC });
    const result = run(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^X16 artifact contract\s+errors=0\b/m);
    assert.equal(xLines(result.stdout).length, 7, result.stdout);
    assert.match(result.stdout, /^DONE \(test = evidence\)/m);
});

test('copied-body doc ⇒ strict exit 1, X16 reports errors=2 and the summary names it', () => {
    const root = fixture({ 'docs/human.md': HUMAN_DOC, 'docs/ai.md': COPIED_AI_DOC });
    const result = run(root);

    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /^X16 artifact contract\s+errors=2\b/m);
    assert.match(result.stdout, /^status measured · X16 artifact contract 2 error$/m);
    assert.equal(xLines(result.stdout).length, 7, result.stdout);
    assert.match(result.stdout, /^DONE \(test = evidence\)/m);
});

test('ESO_ARTIFACT_GATE=warn ⇒ exit 0, line still reports errors=2 and documents the flag', () => {
    const root = fixture({ 'docs/human.md': HUMAN_DOC, 'docs/ai.md': COPIED_AI_DOC });
    const result = run(root, { ESO_ARTIFACT_GATE: 'warn' });

    assert.equal(result.status, 0, result.stdout);
    const line = result.stdout.split('\n').find((entry) => entry.startsWith('X16 artifact contract'));
    assert.match(line, /errors=2\b/);
    assert.match(line, /phase=warn/);
    assert.match(line, /ESO_ARTIFACT_GATE=warn/);
    assert.doesNotMatch(result.stdout, /X16 artifact contract 2 error/);
    assert.match(result.stdout, /^status clean$/m);
});

test('warn only downgrades X16 — an X7 finding still exits 2', () => {
    const root = fixture({
        'sdlc/06.analysis/checklist.md': '---\ntype: checklist\n---\n# No marks here\n',
        'docs/human.md': HUMAN_DOC,
        'docs/ai.md': COPIED_AI_DOC,
    });
    const result = run(root, { ESO_ARTIFACT_GATE: 'warn' });

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stdout, /^X7\s+checklist\s+1\/1/m);
    assert.match(result.stdout, /^X16 artifact contract\s+errors=2\b/m);
});
