#!/usr/bin/env node
// Apply WBS Bootstrap → Jira (epic → task/story → subtask, 4 quan hệ, Fibonacci + rollup).
// Dry-run mặc định; chỉ ghi khi --apply. Credential: .env, không có thì .cursor/mcp.json (jira.env) — không in giá trị.
//
//   node scripts/jira-apply-bootstrap.mjs            # dry-run
//   node scripts/jira-apply-bootstrap.mjs --apply
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const SP_FIELD = 'customfield_10016';

// ---------- credentials ----------
const env = {};
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
        const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}
for (const file of ['.cursor/mcp.json', '.agents/mcp_config.json']) {
    const p = join(ROOT, file);
    if (!existsSync(p)) continue;
    const cfg = JSON.parse(readFileSync(p, 'utf8'));
    const jira = (cfg.mcpServers || cfg.servers || {}).jira;
    if (jira?.env) for (const [k, v] of Object.entries(jira.env)) if (!env[k]) env[k] = v;
}
const base = (env.JIRA_BASE_URL || '').replace(/\/$/, '');
const email = env.JIRA_USER_EMAIL || '';
const token = env.JIRA_API_TOKEN || '';
if (!base || !email || !token) { console.error('ERROR: thiếu JIRA_BASE_URL/JIRA_USER_EMAIL/JIRA_API_TOKEN'); process.exit(1); }
if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.warn('⚠ TLS không kiểm chứng (NODE_TLS_REJECT_UNAUTHORIZED=0 trong config local).');
}
const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    return text.trim() ? JSON.parse(text) : {};
};

// ---------- data ----------
const EPICS = [
    { tmp: 'E1', key: 'ESO-292', reuse: true, summary: 'Bootstrap · DB + registry + event store', tasks: ['T1', 'T2', 'T3'] },
    { tmp: 'E2', key: 'ESO-367', reuse: true, summary: 'Bootstrap · Server + auth + envelope', tasks: ['T4', 'T5'] },
    { tmp: 'E3', reuse: false, summary: 'Bootstrap · Consumer API + provisioning', tasks: ['T6', 'T7'] },
    { tmp: 'E4', reuse: false, summary: 'Bootstrap · Profile + lifecycle', tasks: ['T8', 'T9', 'T10', 'T11'] },
    { tmp: 'E5', key: 'ESO-294', reuse: true, summary: 'Bootstrap · Control plane UI', tasks: ['S1'] },
    { tmp: 'E6', reuse: false, summary: 'Bootstrap · Isolation + DoD', tasks: ['T14', 'T15'] },
];

// type, leaf, epic, title, ac, packet, sp, subtasks[[id,title,sp]], relates[], blocks[], blockedBy[], why
const TOPS = [
    ['Task', 'L1.1', 'E1', 'Platform schema + DDL runner', 'AC-14-1', 'l1-1.bip', 5, [['T1a', 'Platform DDL + schema_version', 2], ['T1b', 'Transfer runner + idempotent test', 3]], ['T2'], ['T2'], [], 'root of Bootstrap — no incoming dependency'],
    ['Task', 'L1.2', 'E1', 'Event store + write event', 'AC-14-2', 'l1-2.bip', 3, [['T2a', 'consumer_event table + index', 1], ['T2b', 'Write event in transaction', 2]], ['T1'], ['T3'], ['T1']],
    ['Task', 'L1.3', 'E1', 'Event read API (append-only)', 'AC-14-3', 'l1-3.bip', 3, [['T3a', 'GET /events + limit', 1], ['T3b', 'No update/delete endpoint + test', 2]], ['T2'], ['T4'], ['T2']],
    ['Task', 'L2.1', 'E2', 'Auth middleware Basic/Bearer', 'AC-01-1…4', 'l2-1.bip', 5, [['T4a', 'Read .env + constant-time compare', 2], ['T4b', '/auth/me + 401 AUTH_*', 3]], ['T3'], ['T5'], ['T3']],
    ['Task', 'L2.2', 'E2', 'Error envelope + CORS', 'AC-16-1…3', 'l2-2.bip', 3, [['T5a', 'Envelope {code,message,detail}', 1], ['T5b', 'CORS allowlist + status mapping', 2]], ['T4'], ['T6'], ['T4']],
    ['Task', 'L3.1', 'E3', 'Register consumer (transaction)', 'AC-02/03', 'l3-1.bip', 5, [['T6a', 'Validate slug/root + transaction schema+record', 2], ['T6b', 'Materialize after commit + errors', 3]], ['T5'], ['T7'], ['T5']],
    ['Task', 'L3.2', 'E3', 'Registry list/detail', 'AC-04/05', 'l3-2.bip', 3, [['T7a', 'List + filter + hide deleted/purged', 1], ['T7b', 'Detail + no credential leak', 2]], ['T6'], ['T8'], ['T6']],
    ['Task', 'L4.1', 'E4', 'Update profile + version', 'AC-06-1…3', 'l4-1.bip', 3, [['T8a', 'PUT + optimistic lock', 1], ['T8b', 'version+1 + re-materialize', 2]], ['T7'], ['T9'], ['T7']],
    ['Task', 'L4.2', 'E4', 'Retire/soft delete/restore', 'AC-07/08', 'l4-2.bip', 5, [['T9a', 'Retire ⇄ reactivate + route 404', 2], ['T9b', 'Soft delete + restore', 3]], ['T8'], ['T10'], ['T8']],
    ['Task', 'L4.3', 'E4', 'Purge', 'AC-09-1…3', 'l4-3.bip', 3, [['T10a', 'confirm_id + INVALID_STATE', 1], ['T10b', 'DROP SCHEMA + keep audit', 2]], ['T9'], ['T11'], ['T9']],
    ['Task', 'L4.4', 'E4', 'Materialize + drift check', 'AC-10/11', 'l4-4.bip', 5, [['T11a', 'Atomic file write + hash', 2], ['T11b', 'check ok/drift/missing/invalid', 3]], ['T10'], ['S1'], ['T10']],
    ['Story', 'US-15', 'E5', 'Use the control plane via the UI (US-15)', 'AC-15-1…3', 'l5-1.fip + l5-2.fip', 8, [['S1a', 'UI login + list (L5.1)', 3], ['S1b', 'UI wizard + detail + drift (L5.2)', 5]], ['T11'], ['T14'], ['T11']],
    ['Task', 'L6.1', 'E6', 'Isolation middleware + 6 tests', 'AC-12-1…3', 'l6-1.bip', 5, [['T14a', 'search_path per route + fail-closed', 2], ['T14b', '6 adversarial tests + pool', 3]], ['S1'], ['T15'], ['S1']],
    ['Task', 'L6.2', 'E6', 'Unified 404 + E2E + smoke', 'AC-13-1…3', 'l6-2.bip', 5, [['T15a', 'Unified 404 + slug 400', 2], ['T15b', 'E2E 9 steps + smoke screenshot', 3]], ['T14'], [], ['T14'], 'sink — no outgoing dependency'],
];
const FIB = new Set([1, 2, 3, 5, 8, 13]);
const TID = { 'L1.1': 'T1', 'L1.2': 'T2', 'L1.3': 'T3', 'L2.1': 'T4', 'L2.2': 'T5', 'L3.1': 'T6', 'L3.2': 'T7', 'L4.1': 'T8', 'L4.2': 'T9', 'L4.3': 'T10', 'L4.4': 'T11', 'US-15': 'S1', 'L6.1': 'T14', 'L6.2': 'T15' };

// ---------- validate ----------
const errors = [];
const tmpIds = new Set();
for (const e of EPICS) tmpIds.add(e.tmp);
for (const t of TOPS) {
    const tid = TID[t[1]];
    if (tmpIds.has(tid)) errors.push(`trùng temp id ${tid}`);
    tmpIds.add(tid);
    for (const s of t[7]) { if (tmpIds.has(s[0])) errors.push(`trùng temp id ${s[0]}`); tmpIds.add(s[0]); }
}
for (const t of TOPS) {
    const [type, leaf, epic, title, ac, packet, sp, subs, relates, blocks, blockedBy, why] = t;
    const sum = subs.reduce((a, s) => a + s[2], 0);
    if (sum !== sp) errors.push(`${leaf}: Σ subtask ${sum} ≠ SP ${sp}`);
    for (const s of subs) if (!FIB.has(s[2])) errors.push(`${s[0]}: SP ${s[2]} không thuộc Fibonacci`);
    for (const ref of [...relates, ...blocks, ...blockedBy]) if (!tmpIds.has(ref)) errors.push(`${leaf}: ref lạ ${ref}`);
    if (blocks.length === 0 && !why) errors.push(`${leaf}: blocks rỗng không why`);
    if (blockedBy.length === 0 && !why) errors.push(`${leaf}: blockedBy rỗng không why`);
    if (relates.length === 0) errors.push(`${leaf}: relates rỗng`);
}
if (errors.length) { console.error('REFUSED:'); for (const e of errors) console.error(' ✗', e); process.exit(3); }

// ---------- plan ----------
const epicTasks = (tmp) => TOPS.filter((t) => t[2] === tmp);
const total = TOPS.reduce((a, t) => a + t[6], 0);
console.log(`DRY-RUN=${!apply} · project=ESO\n`);
console.log('EPIC:');
for (const e of EPICS) console.log(`  ${e.tmp} ${e.reuse ? 'UPDATE ' + e.key : 'CREATE'}: ${e.summary} · task=${e.tasks.join(',')} · ΣSP=${epicTasks(e.tmp).reduce((a, t) => a + t[6], 0)}`);
console.log('\nTOP:');
for (const t of TOPS) console.log(`  ${t[0].padEnd(5)} ${t[1].padEnd(5)} ${t[2]} SP=${t[6]} subtasks=${t[7].length} rel=${t[8].length} blocks=${t[9].length} by=${t[10].length}${t[11] ? ' why' : ''} · ${t[3]}`);
console.log(`\nSUBTASK: ${TOPS.reduce((a, t) => a + t[7].length, 0)} · TOP: ${TOPS.length} · EPIC: ${EPICS.length} · ΣSP=${total}`);
if (!apply) { console.log('\nnothing written — pass --apply to create.'); process.exit(0); }

// ---------- apply ----------
const label = (tmp) => `bootstrap-${tmp.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const existing = await call('POST', '/rest/api/3/search/jql', { jql: 'project = ESO AND labels = bootstrap ORDER BY key', fields: ['summary', 'labels', 'parent', 'issuetype', SP_FIELD], maxResults: 100 });
const byLabel = new Map();
for (const i of existing.issues || []) for (const l of i.fields.labels || []) if (l.startsWith('bootstrap-')) byLabel.set(l, i.key);
const keyOf = new Map();
const isNew = new Set();
const ensure = async (tmp, fields) => {
    if (byLabel.has(label(tmp))) { keyOf.set(tmp, byLabel.get(label(tmp))); return 'existing'; }
    const r = await call('POST', '/rest/api/2/issue', { fields });
    keyOf.set(tmp, r.key); isNew.add(tmp); return r.key;
};
const dm = (lines) => lines.join('\n');

// ---------- translate (English-only rule §6.5) ----------
if (process.argv.includes('--translate')) {
    let n = 0;
    const epicsByKey = new Map(EPICS.map((e) => [e.tmp, e.reuse ? e.key : byLabel.get(label(e.tmp))]));
    for (const e of EPICS) {
        const key = epicsByKey.get(e.tmp);
        if (!key) { console.log(`skip epic ${e.tmp} (chưa có)`); continue; }
        await call('PUT', `/rest/api/2/issue/${key}`, { fields: { summary: e.summary, description: dm(['h3. Bootstrap deliverable', '* Source: 09.wbs/01.bootstrap', '* Packets: 09.wbs/02.bootstrap-packets']) } });
        n++;
    }
    for (const t0 of TOPS) {
        const [type, leaf, , title, ac, packet, , subs, , , , why] = t0;
        const tid = TID[leaf];
        const key = byLabel.get(label(tid));
        if (!key) { console.log(`skip ${tid} (chưa có)`); continue; }
        let desc = dm(['h3. Source', `* Leaf: ${leaf}`, `* AC: ${ac}`, `* Packet: 09.wbs/02.bootstrap-packets (${packet})`, '', 'h3. Done when', '* AC pass · SCN green · DoD met']);
        if (why) desc += `\n\nh3. Link exception\n* ${why}`;
        await call('PUT', `/rest/api/2/issue/${key}`, { fields: { summary: title, description: desc } });
        n++;
        for (const [sid, stitle] of subs) {
            const sk = byLabel.get(label(sid));
            if (!sk) continue;
            await call('PUT', `/rest/api/2/issue/${sk}`, { fields: { summary: stitle, description: dm(['h3. Parent', `* ${tid} (${leaf})`, '', 'h3. Done when', '* Step test passes; parent AC still holds.']) } });
            n++;
        }
    }
    console.log(`translated ${n} issue(s) — English-only rule §6.5`);
    process.exit(0);
}


// epics
for (const e of EPICS) {
    if (e.reuse) {
        const cur = await call('GET', `/rest/api/2/issue/${e.key}?fields=labels`);
        const labels = [...new Set([...(cur.fields.labels || []), 'bootstrap', label(e.tmp)])];
        await call('PUT', `/rest/api/2/issue/${e.key}`, { fields: { summary: e.summary, labels } });
        keyOf.set(e.tmp, e.key); console.log(`updated epic ${e.key}`);
    } else {
        const r = await ensure(e.tmp, { project: { key: 'ESO' }, issuetype: { name: 'Epic' }, summary: e.summary, labels: ['bootstrap', label(e.tmp)], description: dm(['h3. Bootstrap · deliverable', `* Nguồn: 09.wbs/01.bootstrap`, '* Packet: 09.wbs/02.bootstrap-packets']) });
        console.log(`epic ${e.tmp} → ${keyOf.get(e.tmp)} (${r})`);
    }
}
// tops
for (const t of TOPS) {
    const [type, leaf, epic, title, ac, packet, sp, subs, relates, blocks, blockedBy, why] = t;
    const fields = { project: { key: 'ESO' }, issuetype: { name: type }, summary: title, parent: { key: keyOf.get(epic) }, labels: ['bootstrap', label(TID[leaf]), `leaf-${leaf.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`], description: dm(['h3. Source', `* Leaf: ${leaf}`, `* AC: ${ac}`, `* Packet: 09.wbs/02.bootstrap-packets (${packet})`, '', 'h3. Done when', '* AC pass · SCN green · DoD met'] ) };
    if (why) fields.description += `\n\nh3. Link exception\n* ${why}`;
    const tid = TID[leaf];
    const r = await ensure(tid, fields);
    console.log(`${type} ${tid} (${leaf}) → ${keyOf.get(tid)} (${r})`);
    // subtasks
    for (const [sid, stitle, ssp] of subs) {
        const sr = await ensure(sid, { project: { key: 'ESO' }, issuetype: { name: 'Subtask' }, summary: stitle, parent: { key: keyOf.get(TID[leaf]) }, labels: ['bootstrap', label(sid)], [SP_FIELD]: ssp });
        console.log(`  subtask ${sid} → ${keyOf.get(sid)} (${sr})`);
    }
}
// links
const link = async (from, to, type) => {
    // Idempotent: chỉ tạo link khi ít nhất một đầu là issue vừa tạo trong lần chạy này.
    if (!isNew.has(from) && !isNew.has(to)) return;
    const body = type === 'Blocks'
        ? { type: { name: 'Blocks' }, inwardIssue: { key: keyOf.get(from) }, outwardIssue: { key: keyOf.get(to) } }
        : { type: { name: 'Relates' }, outwardIssue: { key: keyOf.get(from) }, inwardIssue: { key: keyOf.get(to) } };
    await call('POST', '/rest/api/2/issueLink', body);
};
for (const t of TOPS) {
    const tid = TID[t[1]];
    const [, , , , , , , subs, relates, blocks, blockedBy] = t;
    for (const b of blocks) await link(tid, b, 'Blocks');
    for (const r of relates) await link(tid, r, 'Relates');
    // subtask chain: s1 blocks s2; s1 relates parent
    await link(subs[0][0], subs[1][0], 'Blocks');
    await link(subs[0][0], tid, 'Relates');
}
// epic chain
for (let i = 0; i < EPICS.length - 1; i++) await link(EPICS[i].tmp, EPICS[i + 1].tmp, 'Blocks');
// points rollup
const pts = (tmp) => TOPS.find((t) => TID[t[1]] === tmp)[6];
for (const t of TOPS) await call('PUT', `/rest/api/2/issue/${keyOf.get(TID[t[1]])}`, { fields: { [SP_FIELD]: t[6] } });
for (const e of EPICS) await call('PUT', `/rest/api/2/issue/${keyOf.get(e.tmp)}`, { fields: { [SP_FIELD]: epicTasks(e.tmp).reduce((a, t) => a + t[6], 0) } });
console.log(`\nDONE · map:`);
for (const [k, v] of keyOf) console.log(`  ${k} = ${v}`);
