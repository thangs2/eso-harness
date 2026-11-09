#!/usr/bin/env node
// Đặt điểm cho mọi Epic = tổng Story/Task con. Chỉ ghi field điểm.
//   node scripts/jira-points-rollup.mjs [--apply]
import { readFileSync } from 'node:fs';
const apply = process.argv.includes('--apply');
for (const l of readFileSync('/Users/thangs2net/Workspaces/eso-harness/.env', 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const base = process.env.JIRA_BASE_URL, auth = 'Basic ' + Buffer.from(process.env.JIRA_USER_EMAIL + ':' + process.env.JIRA_API_TOKEN).toString('base64');
const g = async (p) => (await fetch(base + p, { headers: { Authorization: auth, Accept: 'application/json' } })).json();
const put = async (k, v) => { const r = await fetch(base + '/rest/api/2/issue/' + k, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { customfield_10016: v } }) }); return r.ok ? 'OK' : r.status; };
const all = []; let tok;
do { const d = await g(`/rest/api/3/search/jql?jql=${encodeURIComponent('project = ESO ORDER BY key')}&fields=issuetype,parent,customfield_10016&maxResults=100${tok ? '&nextPageToken=' + tok : ''}`); all.push(...(d.issues || [])); tok = d.nextPageToken; } while (tok);
const kids = new Map();
for (const i of all) { const p = i.fields.parent?.key; if (p) kids.set(p, [...(kids.get(p) || []), i.key]); }
const spOf = new Map(all.map((i) => [i.key, i.fields.customfield_10016 ?? 0]));
let n = 0;
const byKey = new Map(all.map((i) => [i.key, i]));
const memo = new Map();
// Điểm của một ticket = Σ điểm con (đệ quy); subtask = điểm nhập tay.
const points = (key) => {
    if (memo.has(key)) return memo.get(key);
    const kidsOf = kids.get(key) || [];
    const value = kidsOf.length
        ? kidsOf.reduce((a, k) => a + points(k), 0)
        : Number(spOf.get(key) ?? 0);
    memo.set(key, value);
    return value;
};
// Cha trước con? Không: điểm con phải có trước. Sắp theo độ sâu tăng dần để task (cha của subtask) trước epic.
const depth = (key) => {
    let d = 0; let cur = key;
    while (byKey.get(cur)?.fields?.parent?.key) { cur = byKey.get(cur).fields.parent.key; d++; }
    return d;
};
const parents = all
    .filter((i) => (kids.get(i.key) || []).length > 0 && i.fields.issuetype.name !== 'Subtask')
    .sort((a, b) => depth(a.key) - depth(b.key));
for (const i of parents) {
    const sum = points(i.key);
    if (Number(spOf.get(i.key) ?? 0) === sum) continue;
    console.log(`${i.key} → ${sum}`, apply ? await put(i.key, sum) : '(dry-run)');
    n++;
}
console.log(`\n${n} parent (Task/Story/Epic) cần cập nhật${apply ? '' : ' — thêm --apply'}`);
