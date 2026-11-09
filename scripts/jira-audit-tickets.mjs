#!/usr/bin/env node
// Audit ESO ticket law (07.jira-ticket-law.md · 03.ticket-model §6). Read-only; exit 1 nếu vi phạm.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const f of ['.env', '.cursor/mcp.json', '.agents/mcp_config.json']) { const p = join(ROOT, f); if (!existsSync(p)) continue; if (f === '.env') { for (const l of readFileSync(p, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } continue; } const j = (JSON.parse(readFileSync(p, 'utf8')).mcpServers || {}).jira; if (j?.env) for (const [k, v] of Object.entries(j.env)) if (!env[k]) env[k] = v; }
if (!env.JIRA_BASE_URL) { console.error('thiếu credential Jira'); process.exit(2); }
if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = env.JIRA_BASE_URL.replace(/\/$/, ''); const auth = 'Basic ' + Buffer.from(`${env.JIRA_USER_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${p} → ${r.status} ${t.slice(0, 200)}`); return t.trim() ? JSON.parse(t) : {}; };
const SP = 'customfield_10016'; const FIB = new Set([1, 2, 3, 5, 8, 13]);
const issues = []; let tok;
do { const d = await call('POST', '/rest/api/3/search/jql', { jql: 'project = ESO ORDER BY key', fields: ['issuetype', 'summary', 'labels', 'parent', 'subtasks', 'issuelinks', 'description', SP], maxResults: 100, ...(tok ? { nextPageToken: tok } : {}) }); issues.push(...(d.issues || [])); tok = d.nextPageToken; } while (tok);
const byKey = new Map(issues.map((i) => [i.key, i])); const VI = /[ăâđêôơư]/i; const bad = [];
const kids = new Map(); for (const i of issues) { const p = i.fields.parent?.key; if (p) kids.set(p, [...(kids.get(p) || []), i.key]); }
const pts = new Map(issues.map((i) => [i.key, Number(i.fields[SP] || 0)]));
const descs = new Map();
for (const i of issues) { const x = await (await fetch(base + `/rest/api/2/issue/${i.key}?fields=description`, { headers: { Authorization: auth, Accept: 'application/json' } })).json(); descs.set(i.key, x.fields?.description || ''); }
const descOf = (i) => descs.get(i.key);
const linksOf = (i) => { const rel = [], out = [], inn = []; for (const l of i.fields.issuelinks || []) { if (l.type.name === 'Relates') { const o = l.outwardIssue?.key || l.inwardIssue?.key; if (o) rel.push(o); } else if (l.type.name === 'Blocks') { if (l.outwardIssue) out.push(l.outwardIssue.key); if (l.inwardIssue) inn.push(l.inwardIssue.key); } } return { rel, out, inn }; };
const DECL = (d, k) => { const sec = d.split('Relations')[1] || ''; const line = (sec.split('\n').find((l) => l.includes(`${k}:`)) || ''); const i = line.indexOf(`${k}:`); return i >= 0 ? line.slice(i + k.length + 1).trim() : ''; };
for (const i of issues) {
    const key = i.key, t = i.fields.issuetype.name, labels = i.fields.labels || [];
    if (labels.includes('legacy-v1')) { if (kids.get(key)?.length) bad.push(`${key} legacy-v1 nhưng có con`); continue; }
    if (VI.test(i.fields.summary || '')) bad.push(`${key} summary không English`);
    const d = descOf(i); const L = linksOf(i);
    for (const k of ['subtasks', 'relates', 'blocks', 'is blocked by']) {
        const v = DECL(d, k); if (!v) bad.push(`${key} thiếu khai "${k}"`); else if (v.startsWith('none') && !v.includes('—')) bad.push(`${key} "${k}" = none thiếu lý do`); else if (!v.startsWith('none') && !v.trim()) bad.push(`${key} "${k}" rỗng`);
    }
    if (t === 'Epic') {
        if ((kids.get(key) || []).length < 1) bad.push(`${key} Epic không có ticket con`);
        const sum = (kids.get(key) || []).reduce((a, k) => a + (pts.get(k) || 0), 0); if (sum > 0 && pts.get(key) !== sum) bad.push(`${key} Epic điểm ${pts.get(key)} ≠ Σ ${sum}`);
        continue;
    }
    if (t === 'Task' || t === 'Story' || t === 'Bug') {
        const subs = (i.fields.subtasks || []).map((s) => byKey.get(s.key));
        const labelsOf = subs.map((s) => s?.fields.labels || []);
        const isPerf = labels.includes('tdd-perf');
        if (isPerf) {
            if (subs.length !== 0) bad.push(`${key} perf Task phải 0 subtask (decision ticket)`);
            if (!DECL(d, 'subtasks').startsWith('none')) bad.push(`${key} perf Task thiếu khai subtasks: none`);
            for (const s of subs) if (!(linksOf(byKey.get(key)).out.includes(s.key))) bad.push(`${key} perf không blocks ${s.key}`);
        } else {
            const withPerf = labelsOf.some((ls) => ls.includes('tdd-load')) || labelsOf.some((ls) => ls.includes('tdd-stress'));
            const expected = withPerf ? 6 : 4;
            if (subs.length !== expected) bad.push(`${key} có ${subs.length} subtask (cần ${expected})`);
            const need = ['tdd-unit', 'tdd-impl', 'tdd-coverage', 'tdd-qc'];
            for (const n of need) if (!labelsOf.some((ls) => ls.includes(n))) bad.push(`${key} thiếu subtask ${n}`);
            if (withPerf) for (const n of ['tdd-load', 'tdd-stress']) if (!labelsOf.some((ls) => ls.includes(n))) bad.push(`${key} thiếu subtask ${n}`);
            const sum = subs.reduce((a, s) => a + (pts.get(s?.key) || 0), 0); if (sum > 0 && pts.get(key) !== sum) bad.push(`${key} điểm ${pts.get(key)} ≠ Σ subtask ${sum}`);
            const get = (n) => subs.find((s) => (s.fields.labels || []).includes(n))?.key;
            const [u, im, c, qc] = ['tdd-unit', 'tdd-impl', 'tdd-coverage', 'tdd-qc'].map(get);
            if (u && im && !linksOf(byKey.get(u)).out.includes(im)) bad.push(`${key} unit không blocks impl`);
            if (im && c && !linksOf(byKey.get(im)).out.includes(c)) bad.push(`${key} impl không blocks coverage`);
            if (im && qc && !linksOf(byKey.get(im)).out.includes(qc)) bad.push(`${key} impl không blocks qc`);
            if (qc && im && !linksOf(byKey.get(qc)).rel.includes(im)) bad.push(`${key} qc không relates impl`);
            for (const n of ['tdd-load', 'tdd-stress']) { const k = get(n); if (k && im && !linksOf(byKey.get(im)).out.includes(k)) bad.push(`${key} impl không blocks ${n}`); if (k && qc && !linksOf(byKey.get(qc)).rel.includes(k)) bad.push(`${key} qc không relates ${n}`); }
            if (im && qc && get('tdd-load') && !linksOf(byKey.get(qc)).rel.includes(get('tdd-load'))) bad.push(`${key} qc không relates load`);
        }
        continue;
    }
    if (t === 'Subtask') {
        const lb = labels.find((l) => l.startsWith('tdd-'));
        if (!lb) bad.push(`${key} thiếu label tdd-*`);
        if (!FIB.has(pts.get(key))) bad.push(`${key} SP ${pts.get(key)} không Fibonacci`);
        const qcRel = L.rel.length; if (qcRel < 1) bad.push(`${key} không có relates`);
    }
}
// top-level DAG check
const tops = issues.filter((i) => ['Task', 'Story'].includes(i.fields.issuetype.name) && !(i.fields.labels || []).includes('legacy-v1') && !(i.fields.labels || []).includes('tdd-perf'));
const leafOf = (k) => { const l = (byKey.get(k).fields.labels || []).find((x) => x.startsWith('leaf-')); return l ? l.slice(5).toUpperCase().replace(/-/g, '.') : ''; };
const byLeaf = new Map(tops.map((t) => [leafOf(t.key), t.key]));
const story = tops.find((t) => leafOf(t.key).startsWith('US')); if (story) { byLeaf.set('L5.1', story.key); byLeaf.set('L5.2', story.key); }
const D = { 'L1.1': ['L1.2', 'L2.1', 'L3.1', 'L4.4'], 'L1.2': ['L1.3'], 'L2.1': ['L2.2'], 'L3.1': ['L3.2', 'L4.1', 'L4.4'], 'L3.2': ['L5.1', 'L6.1'], 'L4.1': ['L4.2'], 'L4.2': ['L4.3'], 'L4.4': ['L5.2'], 'L5.1': ['L5.2'], 'L5.2': ['L6.2'], 'L6.1': ['L6.2'] };
for (const [a, bs] of Object.entries(D)) for (const b of bs) { const ka = byLeaf.get(a), kb = byLeaf.get(b); if (ka && kb && ka !== kb && !linksOf(byKey.get(ka)).out.includes(kb)) bad.push(`${ka} thiếu Blocks → ${kb} (${a}→${b})`); }
const active = issues.filter((i) => !(i.fields.labels || []).includes('legacy-v1'));
console.log(`issues=${issues.length} · active=${active.length} · legacy=${issues.length - active.length} · vi phạm=${bad.length}`);
for (const b of bad) console.log(' ✗', b);
process.exit(bad.length ? 1 : 0);
