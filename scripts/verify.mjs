#!/usr/bin/env node
/**
 * Provider-neutral verification entrypoint.
 *
 * Any CI (GitHub, GitLab, Jenkins, Buildkite, local) can call this. ESO has no runtime
 * dependency on a CI provider; pipeline files are optional adapters.
 *
 *   node scripts/verify.mjs --fast
 *   node scripts/verify.mjs --full
 *   node scripts/verify.mjs --full --coverage
 *   node scripts/verify.mjs --load
 *   node scripts/verify.mjs --stress
 *   node scripts/verify.mjs --e2e-consumers
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const full = args.has('--full');
const coverage = args.has('--coverage');
const load = args.has('--load');
const e2e = args.has('--e2e-consumers');
const stress = args.has('--stress');
const skipTests = args.has('--fast');
const runTests = !skipTests && (full || (!load && !e2e && !stress));

function run(label, command, commandArgs, cwd = root, env = process.env) {
    process.stdout.write(`\n== ${label}\n$ ${command} ${commandArgs.join(' ')}\n`);
    const result = spawnSync(command, commandArgs, { cwd, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        process.stderr.write(`\nFAIL ${label} (exit ${result.status})\n`);
        process.exit(result.status ?? 1);
    }
    process.stdout.write(`PASS ${label}\n`);
}

run('host trees', 'node', ['scripts/build-host-trees.mjs', '--check']);
run('dual harness', 'node', ['scripts/check-dual-harness.mjs'], root);

if (load) run('load smoke', 'node', ['scripts/ci/load-test.mjs']);
if (stress) run('stress smoke', 'node', ['scripts/ci/load-test.mjs'], root, { ...process.env, ESO_LOAD_CONCURRENCY: '100', ESO_LOAD_REQUESTS: '1000', ESO_LOAD_P95_MS: '1000' });
if (e2e) run('consumer e2e', 'node', ['scripts/ci/e2e-consumers.mjs']);

if (runTests) {
    const cp = join(root, 'eso/control-plane');
    const ui = join(root, 'eso/ui');
    const host = join(root, 'host-runtime');
    if (!process.env.ESO_TEST_DB_URL) {
        process.stderr.write('\nESO_TEST_DB_URL is required for --full (Postgres test database)\n');
        process.exit(2);
    }
    run('control-plane tests', 'bun', ['test', ...(coverage ? ['--coverage'] : []), 'test/'], cp);
    run('control-plane build', 'bun', ['run', 'build'], cp);
    run('host-runtime tests', 'bun', ['test'], host);
    run('host-runtime typecheck', 'bun', ['run', 'typecheck'], host);
    run('ui typecheck', 'bun', ['run', 'typecheck'], ui);
    run('ui tests', 'bun', ['run', 'test'], ui);
    run('ui build', 'bun', ['run', 'build:ng'], ui);
}

process.stdout.write('\nverify PASS\n');
