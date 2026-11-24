/**
 * Capability vocabulary (REQ-30 / AC-30-3).
 *
 * The list is **open**: shipped adapters and host configs legitimately introduce new kinds
 * (`file_tools`, `deepseek_direct`, `codegraph`…). A closed enum would reject real providers, so:
 *   - DEFAULT_CAPABILITY_KINDS covers what ships in this repo;
 *   - a consumer may declare more in `.harness/capabilities.json` (`{ "kinds": [...] }`);
 *   - `ESO_CAPABILITY_KINDS=k1,k2` extends it for a machine/CI.
 * Only a kind absent from ALL of those is `UNKNOWN_CAPABILITY` — the "capability lạ" of AC-30-3.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CAPABILITY_KINDS = Object.freeze([
    // shipped adapter/host kinds
    'llm',
    'embedding',
    'tool',
    'mcp',
    'vision',
    'subagent',
    'subagents',
    'memory',
    'remote',
    'ci',
    'shell',
    'native',
    'file_tools',
    'codegraph',
    'codegraph_query',
    'graph',
    'agentmemory',
    'deepseek_direct',
]);

function fileKinds(root = process.cwd()) {
    try {
        const file = path.join(root, '.harness', 'capabilities.json');
        if (!fs.existsSync(file)) return [];
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(parsed?.kinds) ? parsed.kinds.filter((kind) => typeof kind === 'string') : [];
    } catch {
        return [];
    }
}

function envKinds() {
    const raw = process.env.ESO_CAPABILITY_KINDS;
    return typeof raw === 'string' && raw.trim() ? raw.split(',').map((kind) => kind.trim()).filter(Boolean) : [];
}

export function declaredCapabilityKinds(root = process.cwd()) {
    return new Set([...DEFAULT_CAPABILITY_KINDS, ...fileKinds(root), ...envKinds()]);
}

export function isCapabilityKind(value, root) {
    return typeof value === 'string' && declaredCapabilityKinds(root).has(value);
}

/** Throws a coded error so the API layer can answer 422 `UNKNOWN_CAPABILITY`. */
export function assertCapabilityKind(value, root) {
    if (!isCapabilityKind(value, root)) {
        const err = new Error(`UNKNOWN_CAPABILITY: '${String(value)}' is not declared (add it to .harness/capabilities.json or ESO_CAPABILITY_KINDS)`);
        err.code = 'UNKNOWN_CAPABILITY';
        err.capabilityKind = value;
        throw err;
    }
    return value;
}
