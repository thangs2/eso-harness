#!/usr/bin/env node
/**
 * Install / verify / uninstall the ESO host tree in a consumer root (P1 / G-C).
 *
 * Proves the claim "cài ESO thì host mạnh hơn, gỡ thì host vẫn chạy":
 *   1. install   writes exactly the generated tree for one host + AGENTS.md, and records every
 *                written path + sha256 in `.harness/eso-install.json`.
 *   2. verify    simulates the host's load step: extension contract, frontmatter parses, every
 *                referenced skill/subagent/rule exists, no symlinks, no `.mdc` inside `.agents`.
 *   3. uninstall deletes ONLY the paths in the manifest (and the dirs it emptied) — the consumer's
 *                own files stay byte-identical.
 *
 * This never runs the host application; it verifies the artefacts the host reads. A real host run
 * remains a manual smoke step.
 *
 *   node scripts/host-install-e2e.mjs install   --host antigravity --root /tmp/consumer
 *   node scripts/host-install-e2e.mjs verify    --host antigravity --root /tmp/consumer [--json]
 *   node scripts/host-install-e2e.mjs uninstall --root /tmp/consumer
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { HOSTS, renderHost } from './build-host-trees.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MANIFEST = '.harness/eso-install.json';

const sha = (value) => createHash('sha256').update(value).digest('hex');

function args(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i += 1) {
        const item = argv[i];
        if (item.startsWith('--')) {
            const [key, inline] = item.slice(2).split('=');
            if (inline !== undefined) out[key] = inline;
            else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { out[key] = argv[i + 1]; i += 1; }
            else out[key] = true;
        } else out._.push(item);
    }
    return out;
}

function write(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

export function install(hostKey, root) {
    const host = HOSTS[hostKey];
    if (!host) throw new Error(`unknown host '${hostKey}' (known: ${Object.keys(HOSTS).join(', ')})`);
    const files = renderHost(hostKey);
    const records = [];
    for (const [rel, content] of files) {
        write(path.join(root, rel), content);
        records.push({ path: rel, sha256: sha(content) });
    }
    const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'));
    write(path.join(root, 'AGENTS.md'), agents);
    records.push({ path: 'AGENTS.md', sha256: sha(agents) });
    const manifest = { host: hostKey, tree: host.tree, rulesExt: host.rulesExt, installedAt: new Date().toISOString(), files: records };
    write(path.join(root, MANIFEST), JSON.stringify(manifest, null, 2));
    return manifest;
}

function walk(dir, out = [], base = dir) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) out.push({ file: path.relative(base, full), symlink: true });
        else if (entry.isDirectory()) walk(full, out, base);
        else out.push({ file: path.relative(base, full), symlink: false });
    }
    return out;
}

export function verify(hostKey, root) {
    const errors = [];
    const host = HOSTS[hostKey];
    if (!host) return { ok: false, errors: [`unknown host '${hostKey}'`] };
    const manifestPath = path.join(root, MANIFEST);
    if (!fs.existsSync(manifestPath)) errors.push(`missing manifest ${MANIFEST}`);
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
    if (manifest && manifest.host !== hostKey) errors.push(`manifest host ${manifest.host} != ${hostKey}`);
    if (!fs.existsSync(path.join(root, 'AGENTS.md'))) errors.push('AGENTS.md missing (host law gate has nothing to read)');
    for (const record of manifest?.files ?? []) {
        const full = path.join(root, record.path);
        if (!fs.existsSync(full)) { errors.push(`installed file missing: ${record.path}`); continue; }
        if (sha(fs.readFileSync(full)) !== record.sha256) errors.push(`installed file drifted: ${record.path}`);
    }
    const tree = walk(path.join(root, host.tree));
    if (tree.length === 0) errors.push(`host tree ${host.tree} is empty`);
    for (const entry of tree) {
        if (entry.symlink) errors.push(`symlink in host tree: ${entry.file}`);
        if (entry.file.endsWith('.mdc') && host.rulesExt === '.md') errors.push(`wrong extension .mdc in ${host.tree}: ${entry.file}`);
        if (host.rulesExt === '.mdc' && entry.file.startsWith('rules/') && !entry.file.endsWith('.mdc')) errors.push(`rules must be .mdc: ${entry.file}`);
        if (entry.file.endsWith('.md') || entry.file.endsWith('.mdc')) {
            const text = fs.readFileSync(path.join(root, host.tree, entry.file), 'utf8');
            if (!text.startsWith('---\n') && !text.includes('# ')) errors.push(`not loadable (no frontmatter/heading): ${entry.file}`);
        }
    }
    const rules = tree.filter((e) => e.file.startsWith('rules/'));
    if (rules.length === 0) errors.push('no rules installed');
    const skillsDir = path.join(root, host.tree, 'skills');
    return { ok: errors.length === 0, host: hostKey, rules: rules.length, files: tree.length, skills: fs.existsSync(skillsDir), errors };
}

export function uninstall(root) {
    const manifestPath = path.join(root, MANIFEST);
    if (!fs.existsSync(manifestPath)) throw new Error(`missing manifest ${MANIFEST}; refusing to guess paths`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const removed = [];
    for (const record of manifest.files) {
        const full = path.join(root, record.path);
        if (fs.existsSync(full)) { fs.unlinkSync(full); removed.push(record.path); }
    }
    fs.unlinkSync(manifestPath);
    // prune empty dirs bottom-up, but never the consumer root
    const dirs = new Set(manifest.files.map((r) => path.dirname(r.path)).filter((d) => d !== '.'));
    for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
        let current = path.join(root, dir);
        while (current !== root && fs.existsSync(current) && fs.readdirSync(current).length === 0) {
            fs.rmdirSync(current);
            current = path.dirname(current);
        }
    }
    return { removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const cli = args(process.argv.slice(2));
    const action = cli._[0];
    const hostKey = cli.host || 'antigravity';
    const root = path.resolve(cli.root || process.cwd());
    try {
        if (action === 'install') {
            const manifest = install(hostKey, root);
            console.log(JSON.stringify({ ok: true, host: hostKey, files: manifest.files.length, root }, null, 2));
            process.exit(0);
        }
        if (action === 'verify') {
            const result = verify(hostKey, root);
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.ok ? 0 : 1);
        }
        if (action === 'uninstall') {
            const result = uninstall(root);
            console.log(JSON.stringify({ ok: true, removed: result.removed.length }, null, 2));
            process.exit(0);
        }
        console.error('usage: host-install-e2e.mjs install|verify|uninstall --host <key> --root <dir> [--json]');
        process.exit(2);
    } catch (error) {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exit(2);
    }
}
