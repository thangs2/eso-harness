/**
 * P7/P8 — the artifact-contract merge gate.
 *
 * Proves the gate is CI-usable: exit codes, findings, and a stable `--json` shape. The rulebook is
 * the same module the control-plane service imports (`eso/knowledge/src/artifact-contract.mjs`), so
 * these fixtures test one implementation, not a copy.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const GATE = join(REPO, 'scripts', 'check-artifact-contract.mjs');
const SHARED = join(REPO, 'eso', 'knowledge', 'src', 'artifact-contract.mjs');
const SERVICE = join(REPO, 'eso', 'control-plane', 'src', 'modules', 'knowledge', 'knowledge-mapping-check.service.ts');

const HUMAN_BODY = 'The human document is the source of truth for this topic. An agent projection may index it, cite it and point at it, but it must never repeat the body, because a copy becomes a second source that silently drifts away from the original.';
const HUMAN_DOC = `---\nrepresentation: human\n---\n${HUMAN_BODY}\n`;

const roots = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** Build a consumer root. `manifest` = 'auto' (hash every file) or an explicit documents array or null. */
function fixture(files, manifest = 'auto') {
    const root = mkdtempSync(join(tmpdir(), 'artifact-gate-'));
    roots.push(root);
    for (const [relative, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, relative)), { recursive: true });
        writeFileSync(join(root, relative), text);
    }
    if (manifest !== null) {
        const documents = manifest === 'auto'
            ? Object.keys(files).map((relative) => ({ path: relative, content_hash: sha(readFileSync(join(root, relative), 'utf8')) }))
            : manifest;
        mkdirSync(join(root, '.harness'), { recursive: true });
        writeFileSync(join(root, '.harness', 'knowledge-manifest.json'), JSON.stringify({ documents }));
    }
    return root;
}

function run(root, args = []) {
    const proc = spawnSync(process.execPath, [GATE, ...(root ? ['--root', root] : []), ...args], { encoding: 'utf8' });
    return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr, json: args.includes('--json') ? JSON.parse(proc.stdout) : null };
}

test('copied body ⇒ exit 1 with COPIED_BODY + DOC_CONTRACT_VIOLATION', () => {
    const root = fixture({
        'docs/human.md': HUMAN_DOC,
        'docs/ai.md': `---\nrepresentation: agent\nhuman_sot: docs/human.md\n---\n# AI index\n\n${HUMAN_BODY}\n`,
    });

    const result = run(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /COPIED_BODY/);
    assert.match(result.stdout, /DOC_CONTRACT_VIOLATION/);
    assert.match(result.stdout, /FAIL — 2 error\(s\), 0 warning\(s\)/);

    const json = run(root, ['--json']);
    assert.equal(json.status, 1);
    assert.equal(json.json.status, 'fail');
    assert.deepEqual(json.json.findings.map((finding) => finding.code), ['DOC_CONTRACT_VIOLATION', 'COPIED_BODY']);
    assert.equal(json.json.findings.every((finding) => finding.path === 'docs/ai.md' && finding.severity === 'error'), true);
    assert.deepEqual(Object.keys(json.json.findings[0]).sort(), ['code', 'detail', 'path', 'severity']);
});

test('clean human/agent pair ⇒ exit 0 and no findings', () => {
    const root = fixture({
        'docs/human.md': HUMAN_DOC,
        'docs/ai.md': '---\nrepresentation: agent\nhuman_sot: docs/human.md\n---\n# AI index\n\nSee [the human source](human.md); this projection only points at it.\n',
    });

    const result = run(root, ['--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.status, 'pass');
    assert.deepEqual(result.json.findings, []);
    assert.deepEqual(result.json.counts, { errors: 0, warnings: 0 });
    assert.deepEqual(result.json.checked, { total: 2, human: 1, agent: 1, machine: 0, fresh: 2, stale: 0, unindexed: 0 });
});

test('agent projection without human_sot ⇒ MISSING_HUMAN_SOT, exit 1', () => {
    const root = fixture({
        'docs/orphan.md': '---\nrepresentation: agent\n---\n# Orphan\n\nNo human source is declared.\n',
    });

    const result = run(root, ['--json']);
    assert.equal(result.status, 1);
    assert.equal(result.json.status, 'fail');
    assert.deepEqual(result.json.findings.map((finding) => finding.code), ['MISSING_HUMAN_SOT']);
    assert.equal(result.json.findings[0].detail, 'agent projection has no human_sot pointer');
});

test('stale indexed hash ⇒ warning only, exit 0', () => {
    const root = fixture({
        'docs/human.md': HUMAN_DOC,
        'docs/ai.md': '---\nrepresentation: agent\nhuman_sot: docs/human.md\n---\n# AI index\n\nSee [the human source](human.md).\n',
    }, [
        { path: 'docs/human.md', content_hash: 'f'.repeat(64) },
        { path: 'docs/ai.md', content_hash: 'e'.repeat(64) },
    ]);

    const result = run(root, ['--json']);
    assert.equal(result.status, 0);
    assert.equal(result.json.status, 'warn');
    // Only projections are compared with their human source; a stale human doc is visible in `checked.stale`.
    assert.deepEqual(result.json.findings.map((finding) => finding.code), ['STALE_PROJECTION']);
    assert.deepEqual(result.json.counts, { errors: 0, warnings: 1 });
    assert.equal(result.json.checked.stale, 2);
});

test('missing manifest ⇒ manifestPresent false, no false finding, exit 0', () => {
    const root = fixture({ 'docs/human.md': HUMAN_DOC }, null);

    const result = run(root, ['--json']);
    assert.equal(result.status, 0);
    assert.equal(result.json.status, 'pass');
    assert.equal(result.json.manifestPresent, false);
    assert.deepEqual(result.json.findings, []);
    assert.equal(result.json.checked.unindexed, 1);

    const text = run(root);
    assert.match(text.stdout, /knowledge-manifest\.json missing or unreadable/);
});

test('--json shape is stable for CI', () => {
    const root = fixture({ 'docs/human.md': HUMAN_DOC });
    const result = run(root, ['--json']);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(Object.keys(result.json).sort(), ['checked', 'consumerId', 'counts', 'findings', 'gate', 'manifestPresent', 'root', 'status', 'version']);
    assert.equal(result.json.gate, 'artifact-contract');
    assert.equal(result.json.version, 1);
    assert.equal(result.json.manifestPresent, true);
    assert.equal(result.json.consumerId, root.split('/').pop());
    assert.deepEqual(Object.keys(result.json.checked).sort(), ['agent', 'fresh', 'human', 'machine', 'stale', 'total', 'unindexed']);
    assert.deepEqual(Object.keys(result.json.counts).sort(), ['errors', 'warnings']);
});

test('one rulebook: service and gate both import the shared module', () => {
    const shared = readFileSync(SHARED, 'utf8');
    const service = readFileSync(SERVICE, 'utf8');
    const gate = readFileSync(GATE, 'utf8');

    assert.match(shared, /export const COPY_MIN_CHARS = 120;/);
    assert.match(service, /knowledge\/src\/artifact-contract\.mjs/);
    assert.match(gate, /knowledge\/src\/artifact-contract\.mjs/);
    assert.doesNotMatch(service, /COPY_MIN_CHARS/, 'threshold must live only in the shared module');
    assert.doesNotMatch(service, /DOC_CONTRACT_VIOLATION/, 'finding codes must live only in the shared module');
});

test('bad input ⇒ exit 2', () => {
    const missingRoot = run(null);
    assert.equal(missingRoot.status, 2);
    assert.match(missingRoot.stderr, /--root is required/);

    const unknown = run(fixture({}), ['--nope']);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown argument/);
});
