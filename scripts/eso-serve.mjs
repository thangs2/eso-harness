#!/usr/bin/env node
/**
 * `eso serve` equivalent for the baseline control plane.
 *
 * The HTTP server needs Bun.SQL (no `pg` dependency), so this wrapper starts
 * `eso/control-plane/src/common/http/server.ts` under Bun and forwards signals.
 *
 * Usage: node scripts/eso-serve.mjs   (source eso/.env first)
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(ROOT, 'eso', 'control-plane', 'src', 'common', 'http', 'server.ts');
const child = spawn('bun', [server], { stdio: 'inherit', env: process.env });

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
