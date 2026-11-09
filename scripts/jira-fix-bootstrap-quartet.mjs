#!/usr/bin/env node
// Rebuild Bootstrap subtasks theo TDD quartet của BAP (17.jira-slp-operating §2–§3):
//   [role] tdd-unit (2) → [role] Implement (DEV) (WBS SP) → [role] tdd-coverage (1)
//                                              └→ [qc] tdd-qc (3)
// Blocks: unit→impl, impl→coverage, impl→qc. Relates: qc↔impl, qc↔unit, qc↔coverage.
// Dry-run mặc định; --apply mới ghi. Credential `.env` hoặc `.cursor/mcp.json`.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const SP = 'customfield_10016';
const env = {};
const p0 = join(ROOT, '.env');
if (existsSync(p0)) for (const l of readFileSync(p0, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
for (const f of ['.cursor/mcp.json', '.agents/mcp_config.json']) {
    const fp = join(ROOT, f);
    if (!existsSync(fp)) continue;
    const j = (JSON.parse(readFileSync(fp, 'utf8')).mcpServers || {}).jira;
    if (j?.env) for (const [k, v] of Object.entries(j.env)) if (!env[k]) env[k] = v;
}
if (!env.JIRA_BASE_URL || !env.JIRA_USER_EMAIL || !env.JIRA_API_TOKEN) { console.error('ERROR: thiếu credential Jira'); process.exit(1); }
if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = env.JIRA_BASE_URL.replace(/\/$/, '');
const auth = 'Basic ' + Buffer.from(`${env.JIRA_USER_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
const call = async (m, p, b) => {
    const r = await fetch(base + p, { method: m, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
    const t = await r.text();
    if (!r.ok) throw new Error(`${m} ${p} → ${r.status} ${t.slice(0, 250)}`);
    return t.trim() ? JSON.parse(t) : {};
};
const search = async (jql, fields) => (await call('POST', '/rest/api/3/search/jql', { jql, fields, maxResults: 100 })).issues || [];

const tops = await search('project = ESO AND labels = bootstrap AND issuetype in (Task, Story) ORDER BY key', ['issuetype', 'summary', 'parent', 'subtasks', 'labels', SP]);
console.log(`DRY-RUN=${!apply} · tops=${tops.length}`);

const plan = [];
for (const t of tops) {
    const leaf = (t.fields.labels || []).find((l) => l.startsWith('leaf-'))?.replace('leaf-', '') || t.key;
    const role = t.fields.issuetype.name === 'Story' ? 'fe' : 'be';
    const dev = Number(t.fields[SP] || 0) || 3;
    const old = t.fields.subtasks || [];
    const quartet = [
        [`[${role}] ${leaf} — unit tests`, `tdd-unit`, 2],
        [`[${role}] ${leaf} — Implement (DEV)`, `tdd-impl`, dev],
        [`[${role}] ${leaf} — coverage gate`, `tdd-coverage`, 1],
        [`[qc] ${leaf} — run SCN + evidence`, `tdd-qc`, 3],
    ];
    plan.push({ top: t.key, type: t.fields.issuetype.name, leaf, old, quartet, dev });
    console.log(`  ${t.key} ${t.fields.issuetype.name} ${leaf} · old_subtasks=${old.length} → quartet SP ${quartet.map((q) => q[2]).join('+')}=${quartet.reduce((a, q) => a + q[2], 0)}`);
}
const del = plan.reduce((a, p) => a + p.old.length, 0);
const create = plan.reduce((a, p) => a + p.quartet.length, 0);
const links = create / 4 * 5; // 3 blocks + 2 relates? (qc↔impl, qc↔unit, qc↔coverage = 3) → 3+3=6
console.log(`\nDEL old subtasks: ${del} · CREATE quartet: ${create} · quartet links: ${create} (3 blocks + 3 relates mỗi top)`);
if (!apply) { console.log('nothing written — pass --apply'); process.exit(0); }

// delete old subtasks
for (const p of plan) for (const s of p.old) { await call('DELETE', `/rest/api/2/issue/${s.key}`); console.log(`deleted ${s.key}`); }
// create quartet + links
for (const p of plan) {
    const keys = {};
    for (const [summary, label, pts] of p.quartet) {
        const r = await call('POST', '/rest/api/2/issue', { fields: {
            project: { key: 'ESO' }, issuetype: { name: 'Subtask' }, parent: { key: p.top }, summary,
            labels: ['bootstrap', label], description: `h3. Parent\n* ${p.top} (${p.leaf})\n\nh3. Done when\n* Step test passes; parent AC still holds.`, [SP]: pts,
        } });
        keys[label] = r.key; console.log(`${p.top} + ${label} → ${r.key}`);
    }
    const link = async (a, b) => call('POST', '/rest/api/2/issueLink', { type: { name: 'Blocks' }, inwardIssue: { key: a }, outwardIssue: { key: b } });
    const rel = async (a, b) => call('POST', '/rest/api/2/issueLink', { type: { name: 'Relates' }, outwardIssue: { key: a }, inwardIssue: { key: b } });
    await link(keys['tdd-unit'], keys['tdd-impl']);
    await link(keys['tdd-impl'], keys['tdd-coverage']);
    await link(keys['tdd-impl'], keys['tdd-qc']);
    await rel(keys['tdd-qc'], keys['tdd-impl']);
    await rel(keys['tdd-qc'], keys['tdd-unit']);
    await rel(keys['tdd-qc'], keys['tdd-coverage']);
    const sum = p.quartet.reduce((a, q) => a + q[2], 0);
    await call('PUT', `/rest/api/2/issue/${p.top}`, { fields: { [SP]: sum } });
    console.log(`  ${p.top} points → ${sum}`);
}
// dedupe Relates among tops (duplicate pairs created earlier by two-way writes)
const seen = new Set(); let removed = 0;
for (const p of plan) {
    const d = await call('GET', `/rest/api/2/issue/${p.top}?fields=issuelinks`);
    for (const l of d.fields.issuelinks || []) {
        if (l.type.name !== 'Relates') continue;
        const target = l.outwardIssue?.key || l.inwardIssue?.key;
        const key = [p.top, target].sort().join('|');
        if (seen.has(key)) { await call('DELETE', `/rest/api/2/issueLink/${l.id}`); removed++; } else seen.add(key);
    }
}
// epic relates adjacent (single link each)
const epics = await search('project = ESO AND labels = bootstrap AND issuetype = Epic ORDER BY key', ['issuelinks']);
for (let i = 0; i < epics.length - 1; i++) {
    const a = epics[i], b = epics[i + 1];
    const has = (a.fields.issuelinks || []).some((l) => l.type.name === 'Relates' && (l.outwardIssue?.key === b.key || l.inwardIssue?.key === b.key));
    if (!has) await call('POST', '/rest/api/2/issueLink', { type: { name: 'Relates' }, outwardIssue: { key: a.key }, inwardIssue: { key: b.key } });
}
// epic points = Σ tops
const epicPoint = new Map();
for (const p of plan) { const e = tops.find((x) => x.key === p.top).fields.parent.key; epicPoint.set(e, (epicPoint.get(e) || 0) + p.quartet.reduce((a, q) => a + q[2], 0)); }
for (const [e, v] of epicPoint) await call('PUT', `/rest/api/2/issue/${e}`, { fields: { [SP]: v } });
console.log(`\nremoved duplicate relates: ${removed} · epics updated: ${epicPoint.size}`);
