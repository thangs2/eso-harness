import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { install, verify, uninstall } from '../scripts/host-install-e2e.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eso-host-e2e-'));
const hashTree = (dir) => {
    const out = {};
    const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else out[path.relative(dir, full)] = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        }
    };
    walk(dir);
    return out;
};

test('AGY (primary) — install ⇒ verify ok, rules .md, skills, no symlink', () => {
    const root = temp();
    const manifest = install('antigravity', root);
    assert.ok(manifest.files.length > 20);
    const result = verify('antigravity', root);
    assert.equal(result.ok, true, result.errors.join('; '));
    assert.ok(result.rules >= 10);
    assert.equal(result.skills, true);
    assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')), 'law gate has AGENTS.md');
    const rules = fs.readdirSync(path.join(root, '.agents', 'rules'));
    assert.ok(rules.length >= 10 && rules.every((name) => name.endsWith('.md')));
    assert.equal(rules.some((name) => name.endsWith('.mdc')), false);
});

test('AGY — simulate host load: every rule has frontmatter, skills have SKILL.md', () => {
    const root = temp();
    install('antigravity', root);
    for (const name of fs.readdirSync(path.join(root, '.agents', 'rules'))) {
        const text = fs.readFileSync(path.join(root, '.agents', 'rules', name), 'utf8');
        assert.ok(text.startsWith('---\n'), `${name} has frontmatter`);
        assert.match(text, /description:/);
    }
    for (const skill of fs.readdirSync(path.join(root, '.agents', 'skills'), { withFileTypes: true })) {
        if (!skill.isDirectory()) continue;
        assert.ok(fs.existsSync(path.join(root, '.agents', 'skills', skill.name, 'SKILL.md')), `${skill.name} loadable`);
    }
});

test('AGY — uninstall removes ONLY installed paths, source agents/ unchanged', () => {
    const before = hashTree(path.join(REPO, 'agents'));
    const root = temp();
    fs.writeFileSync(path.join(root, 'keep.txt'), 'user file');
    install('antigravity', root);
    fs.writeFileSync(path.join(root, '.agents', 'user-note.md'), 'mine');
    uninstall(root);
    assert.equal(fs.existsSync(path.join(root, '.agents', 'rules')), false);
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'eso-install.json')), false);
    assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'user file', 'user file survives');
    assert.equal(fs.existsSync(path.join(root, '.agents', 'user-note.md')), true, 'not-in-manifest file survives');
    assert.deepEqual(hashTree(path.join(REPO, 'agents')), before, 'source of truth untouched');
});

test('AGY — install twice is idempotent (same manifest hashes)', () => {
    const root = temp();
    const first = install('antigravity', root);
    const second = install('antigravity', root);
    assert.deepEqual(first.files, second.files);
    assert.equal(verify('antigravity', root).ok, true);
});

test('Cursor (fallback) — install/verify/uninstall with .mdc contract', () => {
    const root = temp();
    install('cursor', root);
    const result = verify('cursor', root);
    assert.equal(result.ok, true, result.errors.join('; '));
    const rules = fs.readdirSync(path.join(root, '.cursor', 'rules'));
    assert.ok(rules.length >= 10 && rules.every((name) => name.endsWith('.mdc')));
    uninstall(root);
    assert.equal(fs.existsSync(path.join(root, '.cursor', 'rules')), false);
});

test('uninstall refuses without manifest (no guessing)', () => {
    const root = temp();
    assert.throws(() => uninstall(root), /missing manifest/);
});

test('verify fails when an installed file drifts', () => {
    const root = temp();
    install('antigravity', root);
    const target = fs.readdirSync(path.join(root, '.agents', 'rules'))[0];
    fs.appendFileSync(path.join(root, '.agents', 'rules', target), '\ntampered\n');
    const result = verify('antigravity', root);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((line) => line.includes('drifted')));
});
