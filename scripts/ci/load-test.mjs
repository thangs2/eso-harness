#!/usr/bin/env node
/** Bounded HTTP load smoke. Not a benchmark: fails on errors or p95 above threshold. */
const base = (process.env.ESO_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const token = process.env.ESO_OPERATOR_TOKEN || process.env.ESO_AUTH_TOKEN || '';
const concurrency = Number(process.env.ESO_LOAD_CONCURRENCY || 20);
const total = Number(process.env.ESO_LOAD_REQUESTS || 200);
const p95Limit = Number(process.env.ESO_LOAD_P95_MS || 500);
if (!token) { console.error('ESO_OPERATOR_TOKEN is required'); process.exit(2); }
const headers = { authorization: `Basic ${Buffer.from(`operator:${token}`).toString('base64')}` };
const latencies = [];
let errors = 0;
let started = 0;
async function worker() {
    while (started < total) {
        started += 1;
        const t = performance.now();
        try {
            const res = await fetch(`${base}/api/v1/consumers`, { headers });
            if (!res.ok) errors += 1;
            await res.arrayBuffer();
        } catch { errors += 1; }
        latencies.push(performance.now() - t);
    }
}
await Promise.all(Array.from({ length: concurrency }, worker));
latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
const max = latencies.at(-1) ?? 0;
const result = { requests: total, concurrency, errors, p50: Math.round(p50), p95: Math.round(p95), max: Math.round(max), p95Limit };
console.log(JSON.stringify(result, null, 2));
process.exit(errors === 0 && p95 <= p95Limit ? 0 : 1);
