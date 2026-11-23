#!/usr/bin/env node
/**
 * P7/P8 merge gate — the artifact contract, enforced in CI.
 *
 * The control-plane already *measured* the HUMAN/AI contract (`KnowledgeMappingCheckService` →
 * `DOC_CONTRACT_VIOLATION`, `COPIED_BODY`, `MISSING_HUMAN_SOT`) but nothing consumed the findings, so
 * a PR could merge with an agent document that copied its human source. This gate is that consumer:
 * plain Node ESM, no TypeScript build, no DB, no running server.
 *
 * It imports the *same* rule module as the service —
 * `eso/knowledge/src/artifact-contract.mjs` — so the verdict cannot drift from `/knowledge/mapping/check`.
 *
 * Usage:
 *   node scripts/check-artifact-contract.mjs --root <consumer root> [--json]
 *
 * Reads `<root>/.harness/knowledge-manifest.json` and every `*.md` under `<root>`
 * (skipping `.git`, `node_modules`, `dist`, `.harness`, `.cursor`, `.agents`, `.claude`, `coverage`).
 *
 * Exit: 0 = no `error` finding (pass or warn) · 1 = at least one `error` finding · 2 = bad input.
 */
import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildContractReport, collectDocuments, createBodyReader } from '../eso/knowledge/src/artifact-contract.mjs';

const GATE = 'artifact-contract';
const VERSION = 1;

function usage() {
    return [
        'Usage: node scripts/check-artifact-contract.mjs --root <consumer root> [--json]',
        '',
        '  --root <dir>  consumer repository root (must contain .harness/knowledge-manifest.json)',
        '  --json        machine output only; stable shape for CI',
        '  -h, --help    this message',
        '',
        'Exit: 0 no error finding · 1 error finding · 2 bad input',
    ].join('\n');
}

function parseArgs(argv) {
    const options = { root: null, json: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--json') options.json = true;
        else if (arg === '--root') {
            const value = argv[index + 1];
            if (!value || value.startsWith('--')) return { error: '--root needs a directory' };
            options.root = value;
            index += 1;
        } else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length);
        else if (arg === '--help' || arg === '-h') options.help = true;
        else return { error: `unknown argument: ${arg}` };
    }
    return options;
}

function table(report, root, manifestPresent) {
    const lines = [];
    lines.push(`ARTIFACT CONTRACT — ${root}`);
    lines.push('');
    if (report.findings.length === 0) {
        lines.push('  (no findings)');
    } else {
        const codeWidth = Math.max('CODE'.length, ...report.findings.map((finding) => finding.code.length));
        const pathWidth = Math.max('PATH'.length, ...report.findings.map((finding) => finding.path.length));
        lines.push(`  ${'SEVERITY'.padEnd(8)}  ${'CODE'.padEnd(codeWidth)}  ${'PATH'.padEnd(pathWidth)}  DETAIL`);
        for (const finding of report.findings) {
            lines.push(`  ${finding.severity.padEnd(8)}  ${finding.code.padEnd(codeWidth)}  ${finding.path.padEnd(pathWidth)}  ${finding.detail}`);
        }
    }
    const checked = report.checked;
    lines.push('');
    if (!manifestPresent) lines.push('  note: .harness/knowledge-manifest.json missing or unreadable — freshness unknown');
    lines.push(`  ${checked.total} doc(s): ${checked.human} human · ${checked.agent} agent · ${checked.machine} machine · fresh ${checked.fresh} · stale ${checked.stale} · unindexed ${checked.unindexed}`);
    lines.push(`  ${report.status.toUpperCase()} — ${report.counts.errors} error(s), ${report.counts.warnings} warning(s)`);
    return `${lines.join('\n')}\n`;
}

function main(argv) {
    const options = parseArgs(argv);
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return 0;
    }
    if (options.error) {
        process.stderr.write(`${options.error}\n\n${usage()}\n`);
        return 2;
    }
    if (!options.root) {
        process.stderr.write(`--root is required\n\n${usage()}\n`);
        return 2;
    }

    const root = resolve(options.root);
    if (!existsSync(root) || !statSync(root).isDirectory()) {
        process.stderr.write(`not a directory: ${root}\n`);
        return 2;
    }

    const { docs, summary, manifestPresent } = collectDocuments(root);
    const report = buildContractReport({
        consumerId: basename(root) || root,
        docs,
        summary,
        bodyOf: createBodyReader(root),
    });

    if (options.json) {
        const payload = {
            gate: GATE,
            version: VERSION,
            root,
            consumerId: report.consumerId,
            status: report.status,
            manifestPresent,
            checked: report.checked,
            findings: report.findings,
            counts: report.counts,
        };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
        process.stdout.write(table(report, root, manifestPresent));
    }

    return report.counts.errors > 0 ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
