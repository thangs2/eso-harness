#!/usr/bin/env node
/**
 * Deprecated — kept as a forwarder, not a second implementation.
 *
 * `AGENTS.local.md` is now one output of the single generator (`scripts/build-host-trees.mjs`, D-108 điều 5 + điều 6). This
 * file survives only because `sdlc/09.wbs/00.jira/packs/ESO-484.json` names this path; it forwards every argument, so
 * `--check` here checks **all** trees, which is stricter than the old file-only check.
 *
 *   node scripts/build-dsh-rules.mjs           → node scripts/build-host-trees.mjs
 *   node scripts/build-dsh-rules.mjs --check   → node scripts/build-host-trees.mjs --check
 */
import { run } from './build-host-trees.mjs';

process.exit(run(process.argv.slice(2)));
