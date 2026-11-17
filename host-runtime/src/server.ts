#!/usr/bin/env bun
/**
 * `serve` entry point for the Mode B remote runtime.
 *
 *   bun run src/server.ts serve --runtime-key agy:agy --port 8788
 *
 * Env: ESO_BASE_URL, ESO_CONSUMER, ESO_HOST_TOKEN (host B scoped), ESO_REMOTE_TOKEN (shared),
 *      ESO_REMOTE_ALLOWED_WS (comma-separated allowed workspace roots).
 */

import { main } from './cli';

if (import.meta.main) {
    void main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    });
}
