#!/usr/bin/env node
/** Read-only consumer E2E: setup, schema/material, index, flow, placement, P8 check. */
const base = (process.env.ESO_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const token = process.env.ESO_OPERATOR_TOKEN || process.env.ESO_AUTH_TOKEN || '';
const consumers = (process.env.ESO_E2E_CONSUMERS || 'fineso,atrievefin,baplatform').split(',').map((x) => x.trim()).filter(Boolean);
if (!token) { console.error('ESO_OPERATOR_TOKEN is required'); process.exit(2); }
const headers = { authorization: `Basic ${Buffer.from(`operator:${token}`).toString('base64')}` };
async function get(path) {
    const res = await fetch(`${base}${path}`, { headers });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return res.json();
}
const rows = [];
let failed = 0;
for (const consumer of consumers) {
    try {
        const [setup, mapping, flows, placement, check] = await Promise.all([
            get(`/api/v1/consumers/${consumer}/setup`),
            get(`/api/v1/consumers/${consumer}/knowledge/mapping`),
            get(`/api/v1/consumers/${consumer}/flows`),
            get(`/api/v1/consumers/${consumer}/worker-placement`),
            get(`/api/v1/consumers/${consumer}/knowledge/mapping/check`),
        ]);
        const flow = flows.find((item) => item.isDefault) ?? flows[0];
        const row = {
            consumer,
            setup: Boolean(setup.setup?.ready),
            material: Boolean(setup.material?.materialized),
            indexed: Number(mapping.summary?.fresh || 0),
            flow: flow?.status || 'none',
            placement: placement.items?.length || 0,
            p8: check.status,
        };
        row.ok = row.setup && row.material && row.indexed > 0 && row.flow === 'published' && row.placement > 0 && row.p8 !== 'fail';
        if (!row.ok) failed += 1;
        rows.push(row);
    } catch (error) {
        failed += 1;
        rows.push({ consumer, ok: false, error: error.message });
    }
}
console.log(JSON.stringify(rows, null, 2));
process.exit(failed === 0 ? 0 : 1);
