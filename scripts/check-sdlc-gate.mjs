#!/usr/bin/env node
/**
 * X7 · X10 · X11 · X12 — the document gates that were defined but never scripted.
 *
 * Law: sdlc/02.governance/02.records/01.document-status.md §3 (definitions) + §I.5 (instance).
 * Decision: sdlc/03.inception/02.decision-log/10.vertical-slice-page.md (D-127).
 *
 * Why this file exists: §3 of `01.document-status` defines X10…X13, but until now nothing ran them,
 * so the register could report ✅ while 735 cited paths were dead and 84 checklists had no mark.
 * A check that nobody runs is a sentence, not a check.
 *
 * Usage: node scripts/check-sdlc-gate.mjs [--json]
 * Exit:  0 = all implemented checks pass · 2 = findings (measured) · 1 = internal error
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SDLC = join(ROOT, 'sdlc');
const JSON_OUT = process.argv.includes('--json');

const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (name.endsWith('.md')) out.push(full);
    }
    return out;
};

const frontMatter = (text) => {
    const m = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split('\n')) {
        const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
        if (kv) out[kv[1]] = kv[2].trim().replace(/^"|"$/g, '');
    }
    return out;
};

/** X11 — every `path/file.ext` cited in sdlc/ must resolve from repo root. Templates (`<nn>`) are skipped. */
// Tombstone = path đã bị xoá/đổi tên và tài liệu đã ghi rõ sự kiện đó (không phải claim "đang tồn tại").
// Vẫn đếm riêng để không giấu nợ; chỉ không tính vào "dead".
const TOMBSTONES = [
    { prefix: 'qc/acceptance/', why: 'xoá 2026-11-09 (records/01 §X11)' },
    { prefix: 'qc/links.test.mjs', why: 'thay bằng gate X11/X15' },
    { prefix: 'qc/provision-storage.test.mjs', why: 'xoá cùng qc/acceptance' },
    { prefix: 'eso/harness/', why: 'planned per D-119, chưa tạo' },
];
const x11 = () => {
    const cited = [];
    const dead = [];
    const tombstoned = [];
    // Dòng mô tả một đường dẫn ĐÃ MẤT (audit finding, lịch sử xoá) không phải claim "đang tồn tại".
    const ABSENT = /không tồn tại|đã (bị )?xoá|bị xoá|deleted|removed|missing|không còn|không có file|revert/i;
    const token = /`((?:eso|sdlc|agents|scripts|tools|qc|host-runtime|deploy)\/[^`\s]+\.[a-z0-9]+)`/g;
    for (const file of walk(SDLC).filter((f) => f.endsWith('.md'))) {
        const lines = readFileSync(file, 'utf8').split('\n');
        for (const line of lines) {
            for (const m of line.matchAll(token)) {
                const path = m[1];
                if (path.includes('<') || path.includes('>') || path.includes('*') || path.includes('..') || path.includes('{') || path.includes('}') || path.includes('…')) continue;
                cited.push(path);
                if (existsSync(join(ROOT, path))) continue;
                const tomb = TOMBSTONES.find((t) => path === t.prefix.replace(/\/$/, '') || path.startsWith(t.prefix));
                if (tomb) { tombstoned.push({ path, why: tomb.why }); continue; }
                if (ABSENT.test(line)) { tombstoned.push({ path, why: 'dòng mô tả path đã mất' }); continue; }
                dead.push({ file: relative(ROOT, file), path });
            }
        }
    }
    const byPrefix = new Map();
    for (const d of dead) {
        const prefix = d.path.split('/').slice(0, 2).join('/');
        byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
    }
    return {
        id: 'X11', cited: cited.length, dead: dead.length, tombstoned: tombstoned.length,
        share: cited.length ? Math.round((dead.length / cited.length) * 100) : 0,
        top: [...byPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4),
        sample: dead.slice(0, 3),
    };
};

/** X7 — a `checklist` must carry marks AND evidence paths. */
const x7 = () => {
    const files = [];
    for (const file of walk(SDLC)) {
        const text = readFileSync(file, 'utf8');
        if (frontMatter(text)['type'] !== 'checklist') continue;
        const marks = (text.match(/^[-*]\s*\[[ xX]\]/gm) ?? []).length + (text.match(/✅|⚠️|❌/g) ?? []).length;
        files.push({ file: relative(ROOT, file), marks });
    }
    const unmarked = files.filter((f) => f.marks === 0);
    return { id: 'X7', total: files.length, unmarked: unmarked.length, sample: unmarked.slice(0, 3).map((f) => f.file) };
};

/** X10 — every AC cited by a real test must be an `id:` in sdlc/ (the join key that was 0/236). */
const x10 = () => {
    const ids = new Set();
    for (const file of walk(SDLC)) {
        const text = readFileSync(file, 'utf8');
        const id = frontMatter(text).id;
        if (id) ids.add(id);
        // AC ids sống ở dòng bảng, không chỉ front-matter
        for (const m of text.matchAll(/^\|\s*`(AC-[A-Z0-9-]+)`\s*\|/gm)) ids.add(m[1]);
    }
    const tests = existsSync(join(ROOT, 'qc'))
        ? readdirSync(join(ROOT, 'qc')).filter((n) => n.endsWith('.test.mjs'))
        : [];
    const cited = new Set();
    for (const name of tests) {
        const text = readFileSync(join(ROOT, 'qc', name), 'utf8');
        for (const m of text.matchAll(/\bAC-[A-Z0-9]+-\d+-\d+\b/g)) cited.add(m[0]);
    }
    const joined = [...cited].filter((id) => ids.has(id));
    return { id: 'X10', testFiles: tests.length, acInTests: cited.size, joined: joined.length };
};

/** X12 — a page in the slice registry is DONE only at 7/7 artifacts. */
const x12 = () => {
    const registry = join(SDLC, '02.governance', '02.records', '07.page-register.md');
    if (!existsSync(registry)) return { id: 'X12', pages: 0, incomplete: 0, rows: [] };
    const rows = [];
    for (const line of readFileSync(registry, 'utf8').split('\n')) {
        const cells = line.split('|').map((c) => c.trim());
        if (cells.length < 13) continue;
        if (!cells[1].startsWith('`/') && !cells[1].startsWith('`settings')) continue;
        const marks = cells.slice(3, 11);            // FRD SRS US AC SCN TRACE TECH UI
        const done = marks.filter((c) => c.includes('✅') || c.includes('N/A')).length;
        rows.push({ page: cells[1].replace(/`/g, ''), done, total: marks.length });
    }
    return { id: 'X12', pages: rows.length, incomplete: rows.filter((r) => r.done < r.total).length, rows };
};


/** X13 — every priority page has a doc, and every tab/section the code declares appears in it. */
const x13 = () => {
    const dir = join(SDLC, '08.ui-design', '20.pages');
    if (!existsSync(dir)) return { id: 'X13', pages: 0, documented: 0, tabs: 0, tabsCovered: 0, sections: 0, sectionsCovered: 0 };
    // Nguồn: mọi page doc trong 20.pages/ (không phụ thuộc link trong index).
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '00.index.md');
    const texts = files.map((f) => readFileSync(join(dir, f), 'utf8'));
    const docs = texts.join('\n');
    const documented = texts.filter((t) => /^id:\s*\S*PAGE-/m.test(t) && /^\|\s*Route\s*\|/m.test(t)).length;
    // Settings đã/đang được tách thành nhiều file (tabs/ + *.base.ts) — quét cả subtree.
    const features = join(ROOT, 'eso/ui/apps/control-plane/src/app/features/consumers');
    const sourceFiles = existsSync(features)
        ? readdirSync(features, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))
        : [];
    const code = sourceFiles.map((f) => readFileSync(join(features, f), 'utf8')).join('\n');
    const tabBlock = /readonly tabs = \[([\s\S]*?)\];/.exec(code);
    const tabs = tabBlock ? [...tabBlock[1].matchAll(/id:\s*'([a-z-]+)'/g)].map((m) => m[1]) : [];
    const sectionBlock = /\['overview'[^\]]*\]/.exec(code);
    const sections = sectionBlock ? [...sectionBlock[0].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]) : [];
    return {
        id: 'X13', pages: files.length, documented,
        tabs: tabs.length, tabsCovered: tabs.filter((t) => docs.includes(`tab=${t}`)).length,
        sections: sections.length, sectionsCovered: sections.filter((t) => docs.includes(`section=${t}`)).length,
    };
};

/** X14 — chuỗi AC↔SCN↔RTM: mỗi AC có ≥1 SCN, mỗi SCN trỏ AC có thật, RTM phủ mọi AC và nói rõ test. */
const x14 = () => {
    const dirOf = (name) => join(SDLC, '06.analysis', name);
    const acIds = new Set();
    const acFiles = existsSync(dirOf('02.ac')) ? readdirSync(dirOf('02.ac')).filter((n) => n.endsWith('.md')) : [];
    for (const name of acFiles) {
        const text = readFileSync(join(dirOf('02.ac'), name), 'utf8');
        for (const m of text.matchAll(/^\|\s*`(AC-[A-Z0-9-]+)`\s*\|/gm)) acIds.add(m[1]);
    }
    const scnRows = [];
    const scnFiles = existsSync(dirOf('03.scn')) ? readdirSync(dirOf('03.scn')).filter((n) => n.endsWith('.md')) : [];
    for (const name of scnFiles) {
        const text = readFileSync(join(dirOf('03.scn'), name), 'utf8');
        for (const m of text.matchAll(/^\|\s*`(SCN-[A-Z0-9-]+)`\s*\|\s*`(AC-[A-Z0-9-]+)`\s*\|/gm)) scnRows.push({ scn: m[1], ac: m[2] });
    }
    const scnACs = new Set(scnRows.map((r) => r.ac));
    const missingAC = scnRows.filter((r) => !acIds.has(r.ac)).map((r) => r.scn);
    const acWithoutSCN = [...acIds].filter((id) => !scnACs.has(id));
    const rtmRows = [];
    const rtmDir = dirOf('04.rtm');
    const rtmFiles = existsSync(rtmDir) ? readdirSync(rtmDir).filter((n) => n.endsWith('.md') && !n.startsWith('00.')) : [];
    for (const name of rtmFiles) {
        const text = readFileSync(join(rtmDir, name), 'utf8');
        for (const m of text.matchAll(/^\|\s*`(AC-[A-Z0-9-]+)`\s*\|(.*)\|\s*$/gm)) {
            const cells = m[2].split('|').map((c) => c.trim());
            rtmRows.push({ ac: m[1], test: cells[cells.length - 1] || '' });
        }
    }
    const rtmACs = new Set(rtmRows.map((r) => r.ac));
    const acWithoutRTM = [...acIds].filter((id) => !rtmACs.has(id));
    const missingTest = rtmRows.filter((r) => /MISSING/i.test(r.test)).length;

    // DONE (D-128): đủ ô hạng mục + mỗi AC của page có test thật. Test là evidence, không cần ảnh.
    const register = join(SDLC, '02.governance', '02.records', '07.page-register.md');
    const pages = [];
    if (existsSync(register)) {
        for (const line of readFileSync(register, 'utf8').split('\n')) {
            const cells = line.split('|').map((c) => c.trim());
            if (cells.length < 13) continue;
            if (!cells[1].startsWith('`/') && !cells[1].startsWith('`settings')) continue;
            const slots = cells.slice(3, 11);
            const filled = slots.every((c) => c.includes('✅') || c.includes('N/A'));
            const url = cells[1].replace(/`/g, '');
            const token = cells[2].replace(/`/g, '').trim();
            const rows = rtmRows.filter((r) => token && r.ac.startsWith(`AC-${token}-`));
            const missing = rows.filter((r) => /MISSING/i.test(r.test)).length;
            pages.push({ page: url, filled, rows: rows.length, missing });
        }
    }
    const done = pages.filter((p) => p.filled && p.rows > 0 && p.missing === 0);
    return { id: 'X14', ac: acIds.size, scn: scnRows.length, missingAC: missingAC.length, acWithoutSCN: acWithoutSCN.length, acWithoutRTM: acWithoutRTM.length, rtm: rtmRows.length, missingTest, pages, done: done.length };
};


/** X15 — mọi link markdown nội bộ trong sdlc/ phải resolve (bắt thay file/đổi tên). */
const x15 = () => {
    const dead = [];
    let total = 0;
    for (const file of walk(SDLC)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/\]\(([^)#\s]+)\)/g)) {
            const url = m[1];
            if (url.startsWith('http') || url.startsWith('mailto:')) continue;
            total += 1;
            if (!existsSync(join(dirname(file), url))) dead.push({ file: relative(ROOT, file), url });
        }
    }
    return { id: 'X15', total, dead: dead.length, sample: dead.slice(0, 4) };
};

const main = () => {
    try {
        const results = [x7(), x10(), x11(), x12(), x13(), x14(), x15()];
        if (JSON_OUT) {
            console.log(JSON.stringify(results, null, 2));
            process.exitCode = 0;
            return;
        }
        const x7r = results[0], x10r = results[1], x11r = results[2], x12r = results[3], x13r = results[4], x14r = results[5], x15r = results[6];
        console.log(`X7  checklist      ${x7r.unmarked}/${x7r.total} file không mark            ${x7r.unmarked ? '❌' : '✅'}`);
        console.log(`X10 AC → id sdlc    ${x10r.joined}/${x10r.acInTests} AC join được (${x10r.testFiles} test)  ${x10r.joined ? '✅' : '❌'}`);
        console.log(`X11 path resolve    ${x11r.dead}/${x11r.cited} chết (${x11r.share}%)            ${x11r.dead ? '❌' : '✅'}`);
        console.log(`X12 slice            ${x12r.incomplete}/${x12r.pages} page chưa đủ hạng mục   ${x12r.incomplete ? '❌' : '✅'}`);
        console.log(`X13 page inventory   ${x13r.documented}/${x13r.pages} page có id · tab ${x13r.tabsCovered}/${x13r.tabs} · section ${x13r.sectionsCovered}/${x13r.sections}  ${x13r.documented === x13r.pages && x13r.tabsCovered === x13r.tabs ? '✅' : '❌'}`);
        console.log(`X14 chain AC-SCN-RTM   AC=${x14r.ac} · SCN=${x14r.scn} · AC thiếu SCN=${x14r.acWithoutSCN} · SCN trỏ AC lạ=${x14r.missingAC} · AC thiếu RTM=${x14r.acWithoutRTM} · test MISSING=${x14r.missingTest}/${x14r.rtm}  ${x14r.acWithoutSCN || x14r.missingAC || x14r.acWithoutRTM ? '❌' : (x14r.missingTest ? '⏳' : '✅')}`);
        const filledPages = x14r.pages.filter((p) => p.filled);
        const blocked = filledPages.filter((p) => p.missing > 0).map((p) => `${p.page} (0/${p.rows} test)`);
        console.log(`X15 link markdown     ${x15r.dead}/${x15r.total} chết  ${x15r.dead ? '❌' : '✅'}`);
        console.log(`DONE (test = evidence)  ${x14r.done}/${filledPages.length} page · ${blocked.length ? 'thiếu test: ' + blocked.join(' · ') : 'không có page nào bị chặn'}`);
        if (x11r.top.length) console.log(`    X11 top: ${x11r.top.map(([p, n]) => `${p} (${n})`).join(' · ')}`);
        const failing = x7r.unmarked + (x10r.joined === x10r.acInTests ? 0 : 1) + x11r.dead + x12r.incomplete
            + (x13r.documented === x13r.pages ? 0 : x13r.pages - x13r.documented)
            + x14r.acWithoutSCN + x14r.missingAC + x14r.acWithoutRTM + x15r.dead;
        console.log('');
        console.log(`status ${failing ? 'measured' : 'clean'}`);
        process.exitCode = failing ? 2 : 0;
    } catch (error) {
        console.error(`error: ${error?.message ?? error}`);
        process.exitCode = 1;
    }
};

main();
