/**
 * Test helpers: a temp workspace, a fake DSH plugin context, and log reading.
 *
 * No Harness import anywhere — the plugin may only rely on the context surface
 * these helpers fake, and every test in this suite must pass offline.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mcp-server.mjs');

/** Create a temp workspace. `files` maps relative path → object (JSON) or string. */
export function makeWorkspace(files = {}) {
    const root = mkdtempSync(join(tmpdir(), 'agentmemory-plugin-'));
    for (const [relative, content] of Object.entries(files)) {
        const path = join(root, relative);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
    }
    return root;
}

export function removeWorkspace(root) {
    try {
        rmSync(root, { recursive: true, force: true });
    } catch {
        /* a failed cleanup must not fail the test it follows */
    }
}

/** `{ event, ...}` lines from a fixture log, in order. */
export function readEvents(path) {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

/**
 * A DSH plugin context with only the surface this plugin touches.
 *
 * `dirs` maps session id → working directory; `existingAgents` seeds the agent
 * list (the bootstrap path); `credentials` maps ref → secret.
 *
 * `services` copies Cordis' inject enforcement: a service listed there can be
 * read as `ctx.<name>`; any other property read throws the same
 * `cannot get property "…" without inject` a real Harness throws. `ctx.get(name)`
 * bypasses it, exactly like Cordis. Pass `services: inject` from the plugin to
 * keep this suite honest about undeclared service reads.
 */
export function createFakeContext({ dirs = {}, existingAgents = [], credentials = {}, services = null } = {}) {
    const workingDirs = new Map(Object.entries(dirs));
    const listeners = new Map();
    const effects = [];
    const logs = { info: [], error: [] };

    const workingDirectory = {
        get: (session) => workingDirs.get(session) ?? null,
    };
    const credentialsService = {
        async resolve(ref) {
            const value = credentials[ref];
            return value ? { value, source: 'test-store' } : undefined;
        },
    };
    const agentsService = {
        list: () => existingAgents,
    };
    /** Root-context guard registry: the Harness also accepts `ctx.tools.guard(fn)` there. */
    const toolGuards = [];
    const toolsService = {
        guard(fn) {
            toolGuards.push(fn);
            return () => {
                const index = toolGuards.indexOf(fn);
                if (index !== -1) toolGuards.splice(index, 1);
            };
        },
    };

    const allowed = services ? new Set(services) : null;
    /** Mimic the Cordis service proxy: throw unless declared in `inject`. */
    const gate = (name, value) => {
        if (!allowed || allowed.has(name)) return value;
        throw new Error(`cannot get property "${name}" without inject`);
    };

    const ctx = {
        logger: {
            info: (message) => logs.info.push(String(message)),
            error: (message) => logs.error.push(String(message)),
        },
        /** Optional-service lookup, the seam a real Cordis context provides. */
        get(name) {
            if (name === 'agents') return agentsService;
            if (name === 'tools') return toolsService;
            if (name === 'credentials') return credentialsService;
            if (name === 'workingDirectory') return workingDirectory;
            return undefined;
        },
        on(event, listener) {
            const list = listeners.get(event) ?? [];
            list.push(listener);
            listeners.set(event, list);
            return () => {
                const index = list.indexOf(listener);
                if (index !== -1) list.splice(index, 1);
            };
        },
        effect(fn) {
            if (typeof fn !== 'function') return;
            const cleanup = fn();
            if (typeof cleanup === 'function') effects.push(cleanup);
        },
        agents: agentsService,
        /** Deliver an event and wait for every listener, like `ctx.serial` does. */
        async emit(event, payload) {
            const list = [...(listeners.get(event) ?? [])];
            await Promise.all(list.map((listener) => listener(payload)));
        },
        /** Run the plugin's registered `ctx.effect` cleanups (plugin unload). */
        cleanup() {
            for (const cleanup of effects.splice(0)) {
                try {
                    cleanup();
                } catch {
                    /* cleanup must not throw into the test */
                }
            }
        },
        logs,
        workingDirs,
        toolGuards,
        /** The decision the Harness would reach from the plugin-context guard: reason or undefined. */
        decideTool(exec) {
            return toolGuards.reduce((reason, guard) => {
                if (reason !== undefined) return reason;
                return guard(exec);
            }, undefined);
        },
    };
    for (const [name, service] of Object.entries({
        workingDirectory,
        credentials: credentialsService,
        agents: agentsService,
        tools: toolsService,
    })) {
        Object.defineProperty(ctx, name, {
            enumerable: true,
            get: () => gate(name, service),
        });
    }
    return ctx;
}

/**
 * A fake Agent with the tool registry, the guard registry, and its own event bus.
 *
 * `decide(name, args)` runs every registered guard the way `ctx.tools.guard` does: the first reason
 * wins, `undefined` means allowed. `emit(event, ...args)` delivers on the agent's own context —
 * that is where per-agent behaviour is registered, so tests exercise the same surface the Harness
 * gives the plugin.
 */
export function createFakeAgent(session) {
    const tools = new Map();
    const guards = [];
    const listeners = new Map();
    const remove = (list, item) => {
        const index = list.indexOf(item);
        if (index !== -1) list.splice(index, 1);
    };
    const agent = {
        session,
        ctx: {
            tools: {
                register(definition) {
                    tools.set(definition.name, definition);
                    return () => tools.delete(definition.name);
                },
                guard(fn) {
                    guards.push(fn);
                    return () => remove(guards, fn);
                },
            },
            on(event, listener) {
                const list = listeners.get(event) ?? [];
                list.push(listener);
                listeners.set(event, list);
                return () => remove(list, listener);
            },
        },
    };
    /** The decision the Harness would reach for this tool call: a reason, or undefined. */
    const decide = (name, args = {}) =>
        guards.reduce((reason, guard) => {
            if (reason !== undefined) return reason;
            return guard({ name, arguments: args, agent });
        }, undefined);
    const emit = async (event, ...payload) => {
        for (const listener of [...(listeners.get(event) ?? [])]) await listener(...payload);
    };
    return { agent, tools, guards, decide, emit };
}

/** Register a session → workspace mapping on the fake context. */
export function addSession(ctx, session, workspace) {
    ctx.workingDirs.set(session, workspace);
}

/** Poll until `predicate()` is truthy, or throw with a useful message. */
export async function waitFor(predicate, { timeoutMs = 8_000, intervalMs = 20, label = 'condition' } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`timed out waiting for ${label}`);
}

/** Sleep, for tests that must prove something does NOT happen. */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
