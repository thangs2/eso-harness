/**
 * Host hook installer.
 *
 * ESO owns hook declaration (`agents/hooks/hooks.map.json`); the host owns installation and
 * execution. This module only materializes the host-specific hook config from that map.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface HookHostEntry {
    mode?: 'on' | 'off';
    file?: string;
    hooks?: Record<string, unknown>;
}

export interface HookMap {
    [host: string]: HookHostEntry;
}

export interface HookInstallResult {
    host: string;
    mode: 'on' | 'off';
    file: string;
    installed: boolean;
}

const HOST_TREES: Record<string, string> = {
    cursor: '.cursor',
    claude: '.claude',
    agents: '.agents',
    agy: '.agents',
};

function readMap(root: string): HookMap {
    const path = join(root, 'agents', 'hooks', 'hooks.map.json');
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as HookMap;
}

function render(value: unknown, tree: string): unknown {
    if (typeof value === 'string') return value.replace(/\{tree\}/g, tree);
    if (Array.isArray(value)) return value.map((item) => render(item, tree));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, render(item, tree)]));
    }
    return value;
}


function mergeHookConfig(existing: any, incoming: any): any {
    if (Array.isArray(incoming)) {
        if (!Array.isArray(existing)) return incoming;
        const seen = new Set(existing.map((item) => JSON.stringify(item)));
        return [...existing, ...incoming.filter((item) => !seen.has(JSON.stringify(item)))];
    }
    if (incoming && typeof incoming === 'object') {
        const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
        const out: Record<string, unknown> = { ...base };
        for (const [key, value] of Object.entries(incoming)) out[key] = mergeHookConfig(base[key], value);
        return out;
    }
    return incoming ?? existing;
}


function copyHookScripts(root: string, tree: string): void {
    const source = join(root, 'agents', 'hooks');
    const target = join(root, tree, 'hooks');
    if (!existsSync(source)) return;
    const copy = (dir: string, prefix = ''): void => {
        for (const name of readdirSync(dir)) {
            if (name === 'hooks.map.json' || name === 'README.md') continue;
            const rel = prefix ? `${prefix}/${name}` : name;
            const absolute = join(dir, name);
            if (statSync(absolute).isDirectory()) copy(absolute, rel);
            else if (!name.endsWith('.json')) {
                mkdirSync(join(target, dirname(rel)), { recursive: true });
                copyFileSync(absolute, join(target, rel));
            }
        }
    };
    copy(source);
}

export function installHostHooks(root: string, host: string, map?: HookMap): HookInstallResult {
    const resolved = map ?? readMap(root);
    const entry = resolved[host];
    if (!entry) throw new Error(`HOOK_HOST_UNKNOWN: ${host}`);
    if (entry.mode === 'off') return { host, mode: 'off', file: '', installed: false };
    const tree = HOST_TREES[host] ?? `.${host}`;
    const file = join(root, tree, entry.file || 'hooks.json');
    mkdirSync(dirname(file), { recursive: true });
    const incoming = render(entry.hooks || {}, tree) as Record<string, any>;
    let merged: Record<string, any> = incoming;
    if (existsSync(file)) {
        try {
            merged = mergeHookConfig(JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>, incoming);
        } catch {
            merged = incoming;
        }
    }
    writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    copyHookScripts(root, tree);
    return { host, mode: 'on', file: file.slice(root.length + 1).split('\\').join('/'), installed: true };
}
