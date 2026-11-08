#!/usr/bin/env node
/**
 * Dual-harness gate: the extension contract between provider trees (D-108 điều 4 + điều 7).
 *
 * Each host reads a fixed path and a fixed extension, so a file of the wrong extension in a tree is not
 * a style problem — it is a rule that silently never loads. This gate has to run on **this** repository,
 * not only on provisioned consumers: measured 2026-11-08, `.agents/rules/` held 10 `.mdc` files and no
 * test noticed, because the consumer-maturity probes only ever ran against scratch roots.
 *
 * It also rejects symlinks inside the managed trees. A symlink is the one failure mode with no error
 * message: git checks it out as a text file on Windows and the host loads nothing (D-108 điều 3).
 *
 *   node scripts/check-dual-harness.mjs          # exit 1 on any violation
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOSTS } from './build-host-trees.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Extension each tree must contain, derived from the same table the generator writes from. */
function expectedExtension(hostKey) {
    return HOSTS[hostKey].rulesExt;
}

/**
 * @returns {string[]} violations, empty when the trees honour the contract.
 */
export function checkDualHarness(root = ROOT) {
    const violations = [];
    const at = (rel) => path.join(root, rel);

    if (!fs.existsSync(at('agents/rules'))) {
        violations.push("missing source: agents/rules/ does not exist — a tree without a source is a hand copy");
    }

    for (const hostKey of Object.keys(HOSTS)) {
        const host = HOSTS[hostKey];
        if (host.tree === null || host.mode !== 'on') continue;
        const rulesDir = `${host.tree}/rules`;
        if (!fs.existsSync(at(rulesDir))) continue;

        const wanted = expectedExtension(hostKey);
        for (const name of fs.readdirSync(at(rulesDir))) {
            const full = at(`${rulesDir}/${name}`);
            if (fs.lstatSync(full).isSymbolicLink()) {
                violations.push(`symlink: ${rulesDir}/${name} — trees must hold real files (D-108 điều 3)`);
                continue;
            }
            if (!fs.statSync(full).isFile()) continue;
            if (wanted === '.mdc' && name.endsWith('.md')) {
                violations.push(`${rulesDir}/${name}: Cursor rules must end with .mdc, not .md`);
            }
            if (wanted === '.md' && name.endsWith('.mdc')) {
                violations.push(`${rulesDir}/${name}: this tree reads plain Markdown — .mdc is forbidden here`);
            }
        }

        for (const dir of [host.tree, `${host.tree}/hooks`, `${host.tree}/skills`, `${host.tree}/${host.subagentsDir}`]) {
            if (!fs.existsSync(at(dir))) continue;
            if (fs.lstatSync(at(dir)).isSymbolicLink()) {
                violations.push(`symlink: ${dir} — the tree itself must be a real directory (D-108 điều 3)`);
            }
        }
    }

    if (fs.existsSync(at('.cursor/mcp_config.json'))) {
        violations.push('cross-contamination: .cursor/mcp_config.json — Antigravity config inside the Cursor tree');
    }
    if (fs.existsSync(at('.agents/mcp.json'))) {
        violations.push('cross-contamination: .agents/mcp.json — Cursor config inside the Antigravity tree');
    }

    return violations;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const violations = checkDualHarness();
    if (violations.length === 0) {
        const trees = Object.values(HOSTS).filter((h) => h.tree !== null && h.mode === 'on');
        console.log(`dual-harness clean (${trees.length} tree(s): ${trees.map((h) => `${h.tree} ${h.rulesExt}`).join(' · ')})`);
        process.exit(0);
    }
    console.error(`dual-harness violations:\n  ${violations.join('\n  ')}`);
    process.exit(1);
}
