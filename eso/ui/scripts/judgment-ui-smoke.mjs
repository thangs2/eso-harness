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
    await command('Runtime.evaluate', { expression: `sessionStorage.setItem('eso.auth', ${JSON.stringify(AUTH)}); location.href='${UI}/consumers/${CONSUMER}/settings?tab=stack';` });
    await sleep(4000);

    // JEV is the only judgment surface rendered by consumer settings; the old "Judgment / sufficiency"
    // panel and its "Run verdict" button no longer exist in the UI (see UI-PAGE-SETTINGS-OBSERVATION E26),
    // so this smoke asserts the JEV policy controls only.
    const before = await command('Runtime.evaluate', {
        expression: `({hasJevGroup: !!document.querySelector('.jev-group'), hasJevButton: [...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Evaluate decision')})`,
        returnByValue: true,
    });
    assert(before.result.value.hasJevGroup, 'JEV group missing from Stack tab');
    assert(before.result.value.hasJevButton, 'Evaluate decision button missing');

    // The verdict button is gone; keep the variable so the summary line below stays stable.
    const verdict = { result: { value: '' } };

    await command('Runtime.evaluate', { expression: `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Evaluate decision')?.click()` });
    await sleep(2500);
    const jev = await command('Runtime.evaluate', { expression: `document.querySelector('.jev-group .jev-result')?.innerText || document.querySelector('.jev-group .form-error')?.innerText || ''`, returnByValue: true });
    assert(/active|shadow|off/.test(jev.result.value), `JEV summary unexpected: ${jev.result.value}`);
    const stackHasTimeline = await command('Runtime.evaluate', { expression: `document.body.innerText.toLowerCase().includes('observation timeline')`, returnByValue: true });
    assert(!stackHasTimeline.result.value, 'Observation timeline must not render on the Stack tab');

    // The observation tab is consent + event scope only: no evidence rows, no JEV.
    await command('Runtime.evaluate', { expression: `location.href='${UI}/consumers/${CONSUMER}/settings?tab=observation';` });
    await sleep(3000);
    const observation = await command('Runtime.evaluate', {
        expression: `({hasTimeline: document.body.innerText.toLowerCase().includes('observation timeline'), hasRows: !!document.querySelector('.observation-list'), hasJev: !!document.querySelector('.jev-group'), hasConsent: document.body.innerText.includes('Enable observation'), hasObservatoryLink: !!document.querySelector('.observatory-link')})`,
        returnByValue: true,
    });
    assert(!observation.result.value.hasTimeline, 'Observation timeline still rendered on ?tab=observation');
    assert(!observation.result.value.hasRows, 'Observation rows still rendered on ?tab=observation');
    assert(!observation.result.value.hasJev, 'JEV panel still rendered on ?tab=observation');
    assert(observation.result.value.hasConsent, 'Consent toggle missing from ?tab=observation');
    assert(observation.result.value.hasObservatoryLink, 'Observatory link missing from ?tab=observation');

    console.log(JSON.stringify({ ok: true, url: `${UI}/consumers/${CONSUMER}/settings?tab=stack`, verdict: verdict.result.value, jev: jev.result.value, observation: observation.result.value }, null, 2));
} finally {
    ws.close();
}
