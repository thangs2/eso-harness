#!/usr/bin/env node
/**
 * Preflight for Mode A/B regression tests.
 *
 * Verifies the consumer worker-placement matrix is FULL: every worker is
 * allowed on every required host, has a pinned model per host, both modes,
 * the matching host binding, and a host runtime with usable model tiers.
 *
 * ESO is read-only here. This script never runs a worker or calls a model.
 */
const env = process.env;
const base = (env.ESO_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const consumer = (env.ESO_CONSUMER || '').trim();
const token = (env.ESO_OPERATOR_TOKEN || env.ESO_AUTH_TOKEN || '').trim();
const flowId = (env.ESO_FLOW || 'that-tinh-tran').trim();
const args = process.argv.slice(2);
const json = args.includes('--json');
const allowUnpinned = args.includes('--allow-unpinned');
const hostsArgIndex = args.indexOf('--hosts');
const requiredHostsArg = hostsArgIndex >= 0 ? args[hostsArgIndex + 1] : '';
const requiredHosts = requiredHostsArg
    ? requiredHostsArg.split(',').map((item) => item.trim()).filter(Boolean)
    : [];

if (!consumer) failUsage('missing ESO_CONSUMER');
if (!token) failUsage('missing ESO_OPERATOR_TOKEN (or ESO_AUTH_TOKEN)');

function failUsage(message) {
    console.error(`[mode-ab-preflight] ${message}`);
    process.exit(2);
}

const auth = `Basic ${Buffer.from(`operator:${token}`).toString('base64')}`;
async function get(path) {
    const res = await fetch(`${base}${path}`, { headers: { authorization: auth } });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status} ${await res.text().catch(() => '')}`);
    return res.json();
}

function modelOf(placement, hostKey) {
    return placement.models?.[hostKey] || '';
}

function main() {
    return Promise.resolve().then(async () => {
        const [workersConfig, placementConfig, hostsConfig, flow] = await Promise.all([
            get(`/api/v1/consumers/${consumer}/workers`),
            get(`/api/v1/consumers/${consumer}/worker-placement`),
            get('/api/v1/hosts'),
            get(`/api/v1/consumers/${consumer}/flows/${flowId}`),
        ]);

        const workers = Array.isArray(workersConfig.workers) ? workersConfig.workers : [];
        const placements = Array.isArray(placementConfig.items) ? placementConfig.items : [];
        const runtimes = new Map();
        for (const host of hostsConfig.items || []) {
            for (const runtime of host.runtimes || []) runtimes.set(runtime.runtimeKey, runtime);
        }
        const allRuntimeKeys = [...runtimes.keys()].sort();
        const hosts = requiredHosts.length ? requiredHosts : allRuntimeKeys;
        const placementByWorker = new Map(placements.map((item) => [item.workerId, item]));
        const errors = [];
        const warnings = [];
        const rows = [];

        if (!hosts.length) errors.push('no host runtimes registered');
        if (!workers.length) errors.push('no workers found');
        if (flow?.status !== 'published') errors.push(`flow ${flowId} status is ${flow?.status ?? 'missing'}, not published`);
        const flowWorkers = new Set((flow?.nodes || []).map((node) => node.workerId).filter(Boolean));
        for (const workerId of flowWorkers) {
            if (!workers.some((worker) => worker.id === workerId)) errors.push(`flow worker missing from consumer: ${workerId}`);
        }

        for (const worker of workers) {
            const placement = placementByWorker.get(worker.id);
            if (!placement) {
                errors.push(`${worker.id}: missing worker placement`);
                rows.push({ worker: worker.id, host: '', model: '', mode: '', binding: '', status: 'MISSING' });
                continue;
            }
            if (worker.status !== 'active') errors.push(`${worker.id}: status=${worker.status}; regression requires active`);
            const modes = Array.isArray(placement.modes) ? placement.modes : ['A', 'B'];
            for (const mode of ['A', 'B']) {
                if (!modes.includes(mode)) errors.push(`${worker.id}: modes missing ${mode}`);
            }
            const allowed = Array.isArray(placement.allowedHosts) ? placement.allowedHosts : [];
            const bindings = new Set(worker.hostBindingIds || []);
            for (const host of hosts) {
                if (!allowed.includes(host)) errors.push(`${worker.id}: allowedHosts missing ${host}`);
                const runtime = runtimes.get(host);
                if (!runtime) {
                    errors.push(`${worker.id}: unknown host runtime ${host}`);
                    rows.push({ worker: worker.id, host, model: '', mode: modes.join(''), binding: '', status: 'UNKNOWN_HOST' });
                    continue;
                }
                const model = modelOf(placement, host);
                if (!model && !allowUnpinned) errors.push(`${worker.id}: models[${host}] is not pinned`);
                const hostId = host.split(':')[0];
                const expectedBinding = `hp-${consumer}-${hostId}`;
                if (!bindings.has(expectedBinding)) errors.push(`${worker.id}: hostBindingIds missing ${expectedBinding}`);
                rows.push({
                    worker: worker.id,
                    host,
                    model: model || `(tier:${placement.modelTier || 'balanced'})`,
                    mode: modes.join(''),
                    binding: bindings.has(expectedBinding) ? 'ok' : 'MISSING',
                    status: 'ok',
                });
            }
        }

        for (const workerId of flowWorkers) {
            if (!workers.some((worker) => worker.id === workerId)) continue;
            if (!placementByWorker.has(workerId)) errors.push(`flow worker ${workerId}: missing placement`);
        }

        for (const [key, runtime] of runtimes) {
            if (!requiredHosts.length || hosts.includes(key)) {
                const models = Array.isArray(runtime.models) ? runtime.models : [];
                if (!models.length) errors.push(`${key}: runtime.models is empty`);
                if (!runtime.defaultModel) errors.push(`${key}: defaultModel is missing`);
                else if (models.length && !models.includes(runtime.defaultModel)) errors.push(`${key}: defaultModel not in models`);
                const tiers = runtime.modelTiers || {};
                if (!Object.keys(tiers).length) {
                    errors.push(`${key}: modelTiers is empty (MODEL_TIER_NOT_MAPPED risk)`);
                }
                for (const tier of ['fast', 'balanced', 'reasoning']) {
                    const entry = tiers[tier];
                    if (!entry?.model) {
                        warnings.push(`${key}: modelTiers.${tier} not configured`);
                    } else if (models.length && !models.includes(entry.model)) {
                        errors.push(`${key}: modelTiers.${tier}.model not in runtime.models`);
                    }
                }
            }
        }

        const result = { ok: errors.length === 0, consumer, flowId, hosts, errors, warnings, rows };
        if (json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            printTable(rows);
            if (warnings.length) {
                console.log('\nWARN');
                for (const warning of warnings) console.log(`- ${warning}`);
            }
            if (errors.length) {
                console.log('\nFAIL');
                for (const error of errors) console.log(`- ${error}`);
            } else {
                console.log(`\nPASS: ${workers.length} workers × ${hosts.length} hosts, modes A+B, models pinned.`);
            }
        }
        process.exit(errors.length ? 1 : 0);
    });
}

function printTable(rows) {
    const headers = ['WORKER', 'HOST', 'MODEL', 'MODES', 'BINDING', 'STATUS'];
    const widths = headers.map((header) => header.length);
    for (const row of rows) {
        const values = [row.worker, row.host, row.model, row.mode, row.binding, row.status];
        values.forEach((value, index) => { widths[index] = Math.max(widths[index], String(value).length); });
    }
    const line = (values) => values.map((value, index) => String(value).padEnd(widths[index])).join('  ');
    console.log(line(headers));
    console.log(line(widths.map((width) => '-'.repeat(width))));
    for (const row of rows) console.log(line([row.worker, row.host, row.model, row.mode, row.binding, row.status]));
}

main().catch((error) => {
    console.error(`[mode-ab-preflight] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
});
