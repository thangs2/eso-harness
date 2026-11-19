#!/usr/bin/env bun
/**
 * Automated UI smoke test for the Phase 2 judgment/JEV panels.
 *
 * Requires the Angular dev server and a Chrome remote-debugging endpoint:
 *   ESO_UI_URL=http://127.0.0.1:4200
 *   CHROME_DEBUG_URL=http://127.0.0.1:9282
 *   ESO_UI_CONSUMER=fineso
 *   ESO_UI_AUTH="Basic ..."
 */
const UI = process.env.ESO_UI_URL || 'http://127.0.0.1:4200';
const CHROME = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9282';
const CONSUMER = process.env.ESO_UI_CONSUMER || 'fineso';
const AUTH = process.env.ESO_UI_AUTH || `Basic ${Buffer.from('operator:eso-dev-only-token').toString('base64')}`;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function connect() {
    const response = await fetch(`${CHROME}/json/new?${encodeURIComponent(`${UI}/login`)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`Chrome debug endpoint returned ${response.status}`);
    const target = await response.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 0;
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        }
    };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
        ws.send(JSON.stringify({ id, method, params }));
    });
    return { ws, command };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { ws, command } = await connect();
try {
    await command('Runtime.enable');
    await command('Page.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await command('Runtime.evaluate', { expression: `sessionStorage.setItem('eso.auth', ${JSON.stringify(AUTH)}); location.href='${UI}/consumers/${CONSUMER}/settings?tab=observation';` });
    await sleep(4000);

    const before = await command('Runtime.evaluate', {
        expression: `({hasPanel: document.body.innerText.toLowerCase().includes('judgment / sufficiency'), hasVerdictButton: [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Run verdict'), hasJevButton: [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Evaluate decision')})`,
        returnByValue: true,
    });
    assert(before.result.value.hasPanel, 'Judgment panel missing');
    assert(before.result.value.hasVerdictButton, 'Run verdict button missing');
    assert(before.result.value.hasJevButton, 'Evaluate decision button missing');

    await command('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Run verdict')?.click()` });
    await sleep(2500);
    const verdict = await command('Runtime.evaluate', { expression: `document.querySelector('.judgment-summary')?.innerText || ''`, returnByValue: true });
    assert(verdict.result.value.includes('cannot-judge'), `verdict summary unexpected: ${verdict.result.value}`);
    assert(verdict.result.value.includes('mode block'), `verdict mode unexpected: ${verdict.result.value}`);
    assert(verdict.result.value.includes('decision allow'), `verdict decision unexpected: ${verdict.result.value}`);

    await command('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Evaluate decision')?.click()` });
    await sleep(2500);
    const jev = await command('Runtime.evaluate', { expression: `document.querySelector('.jev-panel .judgment-summary')?.innerText || ''`, returnByValue: true });
    assert(/active|shadow|off/.test(jev.result.value), `JEV summary unexpected: ${jev.result.value}`);

    console.log(JSON.stringify({ ok: true, url: `${UI}/consumers/${CONSUMER}/settings?tab=observation`, verdict: verdict.result.value, jev: jev.result.value }, null, 2));
} finally {
    ws.close();
}
