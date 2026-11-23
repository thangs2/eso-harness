#!/usr/bin/env node
/**
 * Host-side capability probe runner (reference implementation for CR-012).
 *
 * This is a HOST component, not ESO: it reads evidence the host already produced and uploads a
 * card. It never starts a session, never calls a model, and never runs inside the control plane.
 * Control plane only validates the card (`HostProbeService.assess`).
 *
 * Evidence layout (relative to the consumer root):
 *   .harness/probe/<dimension>.json  -> { status, evidence: [{kind,summary,path?,digest?}], detail? }
 *   .harness/probe/blocked.json      -> { reason }  (policy forbids the probe)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DIMENSIONS = ['observe', 'inject', 'memoryRead', 'memoryWrite', 'mcpTools', 'multiAgentRemoteCi'];

const readJson = (file) => {
    if (!existsSync(file)) return null;
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
};

export function collectDimension(root, dimension) {
    const raw = readJson(join(root, '.harness', 'probe', `${dimension}.json`));
    if (!raw) return { dimension, status: 'unknown', evidence: [], detail: 'no evidence file' };
    const status = ['measured', 'partial', 'unknown', 'blocked'].includes(raw.status) ? raw.status : 'unknown';
    const evidence = Array.isArray(raw.evidence) ? raw.evidence.filter((e) => e && e.kind && e.summary) : [];
    if ((status === 'measured' || status === 'partial') && evidence.length === 0) {
        return { dimension, status: 'unknown', evidence: [], detail: 'claimed without evidence' };
    }
    const out = { dimension, status, evidence };
    if (typeof raw.detail === 'string') out.detail = raw.detail;
    return out;
}

/** Ladder: L1 observe, L2 +inject, L3 +memoryRead, L4 +memoryWrite AND cross-session evidence. */
export function deriveLevels(dimensions) {
    const at = (name) => dimensions.find((d) => d.dimension === name)?.status === 'measured';
    const crossSession = dimensions.some((d) => d.evidence.some((e) => String(e.kind).includes('cross-session')));
    let overall = 'unknown';
    if (at('observe')) overall = 'L1';
    if (overall === 'L1' && at('inject')) overall = 'L2';
    if (overall === 'L2' && at('memoryRead')) overall = 'L3';
    if (overall === 'L3' && at('memoryWrite') && crossSession) overall = 'L4';
    return {
        overall,
        chain: {
            observe: at('observe') ? 'L1' : 'unknown',
            inject: at('inject') ? 'L2' : 'unknown',
            memoryRead: at('memoryRead') ? 'L3' : 'unknown',
            memoryWrite: at('memoryWrite') ? (crossSession ? 'L4' : 'L3') : 'unknown',
        },
    };
}

export function buildCard({ hostId, hostVersion, root, now = new Date() }) {
    if (!hostId || !hostVersion) throw new Error('hostId and hostVersion are required');
    const dimensions = DIMENSIONS.map((dimension) => collectDimension(root, dimension));
    const blocked = readJson(join(root, '.harness', 'probe', 'blocked.json'));
    const limitations = [];
    let reason;
    let publishLevels = true;
    if (blocked?.reason) {
        reason = 'PROBE_BLOCKED';
        publishLevels = false;
        limitations.push(String(blocked.reason));
    }
    for (const dimension of dimensions) {
        if (dimension.status === 'blocked') { reason = 'PROBE_BLOCKED'; publishLevels = false; }
        if (dimension.status !== 'measured') limitations.push(`${dimension.dimension}: ${dimension.status}`);
    }
    const evidence = dimensions.flatMap((d) => d.evidence.map((e) => ({ ...e, kind: e.kind })));
    const levels = publishLevels ? deriveLevels(dimensions) : { overall: 'unknown', chain: { observe: 'unknown', inject: 'unknown', memoryRead: 'unknown', memoryWrite: 'unknown' } };
    const crossSession = evidence.some((e) => String(e.kind).includes('cross-session'));
    if (levels.overall === 'L4' && !crossSession) {
        levels.overall = 'L3';
        limitations.push('L4 not published: no cross-session evidence');
    } else if (levels.overall === 'L3' && !crossSession) {
        limitations.push('L4 not published: no cross-session evidence');
    }
    const measured = dimensions.every((d) => d.status === 'measured');
    return {
        schemaVersion: 1,
        host: { id: hostId, version: hostVersion },
        probedAt: now.toISOString(),
        status: publishLevels ? (measured ? 'measured' : 'partial') : 'unknown',
        ...(reason ? { reason } : {}),
        publishLevels,
        levels,
        dimensions,
        events: [],
        evidence,
        limitations,
    };
}

export async function upload({ baseUrl, consumerId, hostId, card, token, user = 'operator', password = 'secret' }) {
    const auth = token ? `Bearer ${token}` : `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    const response = await fetch(`${baseUrl}/api/v1/consumers/${encodeURIComponent(consumerId)}/hosts/${encodeURIComponent(hostId)}/capability`, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify(card),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
    if (!args.base || !args.consumer || !args['host-id'] || !args['host-version'] || !args.root) {
        console.error('usage: probe-runner.mjs --base=http://127.0.0.1:8787 --consumer=<id> --host-id=<id> --host-version=<v> --root=<consumer root> [--token=...]');
        process.exit(2);
    }
    const card = buildCard({ hostId: args['host-id'], hostVersion: args['host-version'], root: args.root });
    const result = await upload({ baseUrl: args.base, consumerId: args.consumer, hostId: args['host-id'], card, token: args.token });
    console.log(JSON.stringify({ status: result.status, levels: card.levels, publishLevels: card.publishLevels, limitations: card.limitations }, null, 2));
    process.exit(result.status === 200 ? 0 : 1);
}
