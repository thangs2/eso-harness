import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installHostHooks } from '../src/hooks';

describe('host hook installer', () => {
    it('renders {tree} and installs cursor hooks without executing them', () => {
        const root = mkdtempSync(join(tmpdir(), 'hooks-'));
        mkdirSync(join(root, 'agents', 'hooks'), { recursive: true });
        writeFileSync(join(root, 'agents', 'hooks', 'hooks.map.json'), JSON.stringify({
            cursor: { mode: 'on', file: 'hooks.json', hooks: { version: 1, hooks: { stop: [{ command: 'node {tree}/hooks/stop.mjs' }] } } },
        }));
        const result = installHostHooks(root, 'cursor');
        expect(result.installed).toBe(true);
        expect(result.file).toBe('.cursor/hooks.json');
        const config = JSON.parse(readFileSync(join(root, '.cursor', 'hooks.json'), 'utf8'));
        expect(config.hooks.stop[0].command).toBe('node .cursor/hooks/stop.mjs');
        rmSync(root, { recursive: true, force: true });
    });

    it('preserves legacy hook entries while adding the map entries', () => {
        const root = mkdtempSync(join(tmpdir(), 'hooks-merge-'));
        mkdirSync(join(root, 'agents', 'hooks'), { recursive: true });
        mkdirSync(join(root, '.cursor'), { recursive: true });
        writeFileSync(join(root, '.cursor', 'hooks.json'), JSON.stringify({
            version: 1, hooks: { preToolUse: [{ command: 'legacy-guard', matcher: 'Write' }] },
        }));
        writeFileSync(join(root, 'agents', 'hooks', 'hooks.map.json'), JSON.stringify({
            cursor: { mode: 'on', file: 'hooks.json', hooks: { version: 1, hooks: { preToolUse: [{ command: 'node {tree}/hooks/write-gate.mjs', matcher: 'Write' }] } } },
        }));
        installHostHooks(root, 'cursor');
        const config = JSON.parse(readFileSync(join(root, '.cursor', 'hooks.json'), 'utf8'));
        expect(config.hooks.preToolUse.map((entry: any) => entry.command)).toEqual(['legacy-guard', 'node .cursor/hooks/write-gate.mjs']);
        rmSync(root, { recursive: true, force: true });
    });

    it('does not install a disabled host', () => {
        const result = installHostHooks('/tmp/unused', 'claude', { claude: { mode: 'off' } });
        expect(result.installed).toBe(false);
    });
});
