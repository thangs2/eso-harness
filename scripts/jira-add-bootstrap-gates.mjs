#!/usr/bin/env node
// Boundary gates để mọi Task/Story có đủ 4 chiều: subtask · relates · blocks · is blocked.
// Start gate (E1) ← E1 blocks gate → gate blocks T1.
// DoD gate (E6) ← sinks block gate → gate blocks E6.
// Kèm quartet cho gate, why-exception cho subtask đầu/cuối lane, sprint + rollup.
// Dry-run mặc định; --apply mới ghi.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const SP = 'customfield_10016';
const env = {};
for (const f of ['.env', '.cursor/mcp.json', '.agents/mcp_config.json']) {
    const p = join(ROOT, f); if (!existsSync(p)) continue;
    if (f === '.env') { for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } continue; }
    const j = (JSON.parse(readFileSync(p, 'utf8')).mcpServers || {}).jira; if (j?.env) for (const [k, v] of Object.entries(j.env)) if (!env[k]) env[k] = v;
}
if (!env.JIRA_BASE_URL) { console.error('thiếu credential'); process.exit(1); }
if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = env.JIRA_BASE_URL.replace(/\/$/, ''); const auth = 'Basic ' + Buffer.from(`${env.JIRA_USER_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${p} → ${r.status} ${t.slice(0, 250)}`); return t.trim() ? JSON.parse(t) : {}; };
const get = async (p) => (await fetch(base + p, { headers: { Authorization: auth, Accept: 'application/json' } })).json();
const search = async (jql, fields) => (await call('POST', '/rest/api/3/search/jql', { jql, fields, maxResults: 100 })).issues || [];

const E1 = 'ESO-292', E6 = 'ESO-491', T1 = 'ESO-492', SINKS = ['ESO-498', 'ESO-504', 'ESO-519', 'ESO-531'];
const GATES = [
    { tmp: 'START', parent: E1, summary: 'Bootstrap — start gate', blocks: [T1], blockedBy: [E1], relates: [E1, T1] },
    { tmp: 'DOD', parent: E6, summary: 'Bootstrap — DoD gate', blocks: [E6], blockedBy: SINKS, relates: [E6, ...SINKS] },
];
console.log(`DRY-RUN=${!apply} · gates=${GATES.length} · quartet subtasks=${GATES.length * 4}`);
if (!apply) { for (const g of GATES) console.log(` ${g.summary}: blocks ${g.blocks.join(',')} | by ${g.blockedBy.join(',')} | relates ${g.relates.join(',')}`); process.exit(0); }

const link = async (blocker, blocked) => call('POST', '/rest/api/2/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: blocker }, outwardIssue: { key: blocked } });
const rel = async (a, b) => call('POST', '/rest/api/2/issueLink', { type: { name: 'Relates' }, outwardIssue: { key: a }, inwardIssue: { key: b } });
const created = [];
for (const g of GATES) {
    const r = await call('POST', '/rest/api/2/issue', { fields: { project: { key: 'ESO' }, issuetype: { name: 'Task' }, parent: { key: g.parent }, summary: g.summary, labels: ['bootstrap', 'gate'], description: 'h3. Boundary gate\n* Anchors the relation graph: every work ticket keeps blocks + is blocked by.', [SP]: 7 } });
    const key = r.key; created.push(key); console.log('gate', g.tmp, '→', key);
    for (const b of g.blocks) await link(key, b);
    for (const b of g.blockedBy) await link(b, key);
    for (const b of g.relates) await rel(key, b);
    const role = 'be';
    const specs = [[`[${role}] ${g.summary} — unit tests`, 'tdd-unit', 2, 'first step in quartet lane — no incoming dependency'], [`[${role}] ${g.summary} — Implement (DEV)`, 'tdd-impl', 1, ''], [`[${role}] ${g.summary} — coverage gate`, 'tdd-coverage', 1, 'last step in quartet lane — no outgoing dependency'], [`[qc] ${g.summary} — run SCN + evidence`, 'tdd-qc', 3, 'last step in quartet lane — no outgoing dependency']];
    const subs = {};
    for (const [summary, label, pts, why] of specs) {
        const s = await call('POST', '/rest/api/2/issue', { fields: { project: { key: 'ESO' }, issuetype: { name: 'Subtask' }, parent: { key }, summary, labels: ['bootstrap', label], description: `h3. Parent\n* ${key} (${g.tmp})\n\nh3. Done when\n* Step test passes; parent gate holds.` + (why ? `\n\nh3. Link exception\n* ${why}` : ''), [SP]: pts } });
        subs[label] = s.key; console.log('  ', label, '→', s.key);
    }
    await link(subs['tdd-unit'], subs['tdd-impl']); await link(subs['tdd-impl'], subs['tdd-coverage']); await link(subs['tdd-impl'], subs['tdd-qc']);
    for (const l of ['tdd-impl', 'tdd-unit', 'tdd-coverage']) await rel(subs['tdd-qc'], subs[l]);
}
// whys cho 56 subtask cũ
const subs = await search('project = ESO AND labels = bootstrap AND issuetype = Subtask ORDER BY key', ['labels', 'description']);
const why = { 'tdd-unit': 'first step in quartet lane — no incoming dependency', 'tdd-coverage': 'last step in quartet lane — no outgoing dependency', 'tdd-qc': 'last step in quartet lane — no outgoing dependency' };
let upd = 0;
for (const s of subs) {
    const lb = (s.fields.labels || []).find((l) => l.startsWith('tdd-'));
    if (!why[lb]) continue;
    const cur = typeof s.fields.description === 'string' ? s.fields.description : '';
    if (cur.includes('h3. Link exception')) continue;
    await call('PUT', `/rest/api/2/issue/${s.key}`, { fields: { description: (cur || 'h3. Parent\n* gate quartet\n') + `\n\nh3. Link exception\n* ${why[lb]}` } });
    upd++;
}
// sprint + points
for (const k of created) await call('POST', '/rest/agile/1.0/sprint/73/issue', { issues: [k] }).catch(() => {});
const tops = await search('project = ESO AND labels = bootstrap AND issuetype in (Task, Story) ORDER BY key', ['parent', SP]);
const ePts = new Map();
for (const t of tops) ePts.set(t.fields.parent.key, (ePts.get(t.fields.parent.key) || 0) + Number(t.fields[SP] || 0));
for (const [e, v] of ePts) await call('PUT', `/rest/api/2/issue/${e}`, { fields: { [SP]: v } });
console.log(`gates=${created.length} · subtask why updated=${upd} · epic points=${JSON.stringify([...ePts])}`);
