#!/usr/bin/env node
// Rebuild ESO baseline ticket graph theo luật ESO (07.jira-ticket-law + 03.ticket-model §6):
// - quartet subtasks (giữ), lane links, top-level WBS DAG, sibling relates
// - mỗi ticket KHAI BÁO 4 quan hệ trong description; `none` phải kèm lý do (không bịa link)
// Dry-run mặc định; --apply mới ghi.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply'); const SP = 'customfield_10016';
const env = {};
for (const f of ['.env', '.cursor/mcp.json', '.agents/mcp_config.json']) { const p = join(ROOT, f); if (!existsSync(p)) continue; if (f === '.env') { for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } continue; } const j = (JSON.parse(readFileSync(p, 'utf8')).mcpServers || {}).jira; if (j?.env) for (const [k, v] of Object.entries(j.env)) if (!env[k]) env[k] = v; }
if (!env.JIRA_BASE_URL) { console.error('thiếu credential'); process.exit(1); }
if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = env.JIRA_BASE_URL.replace(/\/$/, ''); const auth = 'Basic ' + Buffer.from(`${env.JIRA_USER_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
const call = async (m, p, b, soft) => { const r = await fetch(base + p, { method: m, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) { if (soft) return {}; throw new Error(`${m} ${p} → ${r.status} ${t.slice(0, 200)}`); } return t.trim() ? JSON.parse(t) : {}; };
const get = async (p) => (await fetch(base + p, { headers: { Authorization: auth, Accept: 'application/json' } })).json();
// Legacy Jira label `bootstrap` is retained for existing issues; do not rewrite labels.
const q = await call('POST', '/rest/api/3/search/jql', { jql: 'project = ESO AND labels = bootstrap ORDER BY key', fields: ['issuetype', 'summary', 'parent', 'labels', 'subtasks', 'description', SP], maxResults: 200 });
const iss = q.issues || [];
const type = new Map(iss.map((i) => [i.key, i.fields.issuetype.name]));
const kids = new Map(); for (const i of iss) { const p = i.fields.parent?.key; if (p) kids.set(p, [...(kids.get(p) || []), i.key]); }
const subOf = (top, lab) => (kids.get(top) || []).find((k) => (iss.find((i) => i.key === k).fields.labels || []).includes(lab));
const tops = iss.filter((i) => ['Task', 'Story'].includes(type.get(i.key))).map((i) => i.key).sort();
const epics = iss.filter((i) => type.get(i.key) === 'Epic').map((i) => i.key).sort();
const leaf = (k) => { const l = (iss.find((i) => i.key === k).fields.labels || []).find((x) => x.startsWith('leaf-')); return l ? l.slice(5).toUpperCase().replace(/-/g, '.') : ''; };
// WBS DAG (leaf → leaf)
const D = { L1: ['L2', 'L3', 'L4'], L2: ['L1'], L3: ['L1'], L4: ['L1'], L5: ['L3', 'L6'], L6: ['L3'], L7: ['L5'], L8: [] };
const byLeaf = new Map(tops.map((t) => [leaf(t), t]));
const story = tops.find((t) => leaf(t).startsWith('US'));
if (story) { byLeaf.set('L5.1', story); byLeaf.set('L5.2', story); }
const pairs = []; // [from,to,type]
const add = (a, b, ty) => pairs.push([a, b, ty]);
// quartet lane + relates
for (const t of tops) {
    const u = subOf(t, 'tdd-unit'), i = subOf(t, 'tdd-impl'), c = subOf(t, 'tdd-coverage'), qc = subOf(t, 'tdd-qc');
    if (!u || !i || !c || !qc) continue;
    add(u, i, 'Blocks'); add(i, c, 'Blocks'); add(i, qc, 'Blocks');
    add(qc, i, 'Relates'); add(qc, u, 'Relates'); add(qc, c, 'Relates');
}
// top-level WBS DAG
const dag = { 'L1.1': ['L1.2', 'L2.1', 'L3.1', 'L4.4'], 'L1.2': ['L1.3'], 'L2.1': ['L2.2'], 'L3.1': ['L3.2', 'L4.1', 'L4.4'], 'L3.2': ['L5.1', 'L6.1'], 'L4.1': ['L4.2'], 'L4.2': ['L4.3'], 'L4.4': ['L5.2'], 'L5.1': ['L5.2'], 'L5.2': ['L6.2'], 'L6.1': ['L6.2'] };
for (const [a, bs] of Object.entries(dag)) for (const b of bs) { const ka = byLeaf.get(a), kb = byLeaf.get(b); if (ka && kb && ka !== kb) add(ka, kb, 'Blocks'); }
// sibling relates within epic
const byEpic = new Map(); for (const t of tops) { const e = iss.find((i) => i.key === t).fields.parent?.key; byEpic.set(e, [...(byEpic.get(e) || []), t]); }
for (const ks of byEpic.values()) for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) add(ks[i], ks[j], 'Relates');
// UI story relates profile/isolation
const s1 = byLeaf.get('L5.1'); if (s1) { add(s1, byLeaf.get('L4.4'), 'Relates'); add(s1, byLeaf.get('L6.1'), 'Relates'); }
// epics chain
for (let i = 0; i < epics.length - 1; i++) { add(epics[i], epics[i + 1], 'Blocks'); add(epics[i], epics[i + 1], 'Relates'); }
// dedupe
const seen = new Set(); const links = pairs.filter(([a, b, t]) => { const s = `${a}|${b}|${t}`; if (seen.has(s) || a === b) return false; seen.add(s); return true; });
console.log(`DRY-RUN=${!apply} · issues=${iss.length} · tops=${tops.length} · epics=${epics.length} · links=${links.length}`);
if (!apply) process.exit(0);
// 1) delete all links among legacy-bootstrap set
let del = 0;
for (const i of iss) { const x = await get('/rest/api/2/issue/' + i.key + '?fields=issuelinks'); for (const l of x.fields.issuelinks || []) { const o = l.outwardIssue?.key || l.inwardIssue?.key; if (o && type.has(o)) { await call('DELETE', '/rest/api/2/issueLink/' + l.id, undefined, true); del++; } } }
console.log('deleted links:', del);
// 2) create links
for (const [a, b, t] of links) {
    const body = t === 'Blocks' ? { type: { name: 'Blocks' }, inwardIssue: { key: a }, outwardIssue: { key: b } } : { type: { name: 'Relates' }, outwardIssue: { key: a }, inwardIssue: { key: b } };
    await call('POST', '/rest/api/2/issueLink', body);
}
console.log('created links:', links.length);
// 3) declarations
const out = new Map(), inn = new Map(), rel = new Map();
for (const [a, b, t] of links) {
    if (t === 'Blocks') { out.set(a, [...(out.get(a) || []), b]); inn.set(b, [...(inn.get(b) || []), a]); }
    else { rel.set(a, [...(rel.get(a) || []), b]); rel.set(b, [...(rel.get(b) || []), a]); }
}
const list = (m, k, why) => (m.get(k) || []).length ? (m.get(k) || []).join(', ') : `none — ${why}`;
for (const i of iss) {
    const k = i.key, t = type.get(k);
    const desc = (typeof i.fields.description === 'string' ? i.fields.description : '').split('h4. Relations')[0].trimEnd();
    const subs = t === 'Epic' ? `children: ${(kids.get(k) || []).join(', ') || 'none'}` : t === 'Subtask' ? 'none — Jira prohibits subtasks on a subtask' : `4 (tdd-unit · tdd-impl · tdd-coverage · tdd-qc)`;
    const whySub = t === 'Subtask' ? 'Jira prohibits subtasks on a subtask' : 'atomic ticket — one verify command';
    const sec = ['', 'h4. Relations', `* subtasks: ${subs}`, `* relates: ${list(rel, k, 'no sibling or traceability relation')}`, `* blocks: ${list(out, k, 'sink — nothing depends on this ticket')}`, `* is blocked by: ${list(inn, k, 'root — no incoming dependency')}`].join('\n');
    await call('PUT', `/rest/api/2/issue/${k}`, { fields: { description: (desc + '\n' + sec).trim() } });
}
// 4) points rollup: subtasks giữ nguyên; tops = Σ subtask; epics = Σ tops
const spOf = new Map(iss.map((i) => [i.key, Number(i.fields[SP] || 0)]));
for (const t of tops) { const sum = (kids.get(t) || []).reduce((a, k) => a + (spOf.get(k) || 0), 0); await call('PUT', `/rest/api/2/issue/${t}`, { fields: { [SP]: sum } }); }
for (const e of epics) { const sum = (kids.get(e) || []).reduce((a, k) => a + (spOf.get(k) || 0), 0); await call('PUT', `/rest/api/2/issue/${e}`, { fields: { [SP]: sum } }); }
console.log('declarations + points done');
