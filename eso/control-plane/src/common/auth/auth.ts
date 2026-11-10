import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import type { Actor } from '../../platform/registry/types.js';

/**
 * L2.1 — operator auth.
 *
 * Credential source: `eso/.env` (`ESO_AUTH_USER`, `ESO_AUTH_PASSWORD`, `ESO_API_TOKEN`).
 * Basic for the UI, Bearer for machines. Comparison is constant-time and the error never says
 * which half failed. No credential is stored in the DB or returned in a response.
 */
export interface AuthConfig {
    user: string;
    password: string;
    token: string;
}

export interface AuthMe {
    kind: 'operator' | 'machine';
    configured: true;
}

export function parseEnvFile(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
        if (!match) continue;
        out[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
    return out;
}

export function loadAuthConfig(options: { env?: Record<string, string | undefined>; file?: string } = {}): AuthConfig {
    let source: Record<string, string | undefined> = options.env ?? process.env;
    if (options.file) {
        try {
            source = { ...parseEnvFile(readFileSync(resolve(options.file), 'utf8')), ...source };
        } catch {
            fail('AUTH_NOT_CONFIGURED', `could not read ${options.file}`);
        }
    }
    const user = source.ESO_AUTH_USER;
    const password = source.ESO_AUTH_PASSWORD;
    const token = source.ESO_API_TOKEN;
    if (!user || !password || !token) {
        fail('AUTH_NOT_CONFIGURED', 'ESO_AUTH_USER, ESO_AUTH_PASSWORD and ESO_API_TOKEN are required');
    }
    return { user, password, token };
}

/** Hash both sides first so the comparison is length-independent as well as value-safe. */
export function safeEqual(left: string, right: string): boolean {
    const a = createHash('sha256').update(String(left ?? '')).digest();
    const b = createHash('sha256').update(String(right ?? '')).digest();
    return timingSafeEqual(a, b);
}

export function parseAuthorization(header: string | undefined | null): { scheme: 'basic'; value: string } | { scheme: 'bearer'; value: string } | null {
    if (!header || typeof header !== 'string') return null;
    const match = /^(Basic|Bearer)\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    return { scheme: match[1].toLowerCase() as 'basic' | 'bearer', value: match[2].trim() };
}

export type HttpActor = Actor & { kind: 'operator' | 'machine' };

export class AuthService {
    constructor(private readonly config: AuthConfig) {}

    authenticate(header: string | undefined | null): HttpActor {
        const parsed = parseAuthorization(header);
        if (!parsed) fail('AUTH_REQUIRED');
        if (parsed.scheme === 'bearer') {
            if (!safeEqual(parsed.value, this.config.token)) fail('AUTH_INVALID');
            return { kind: 'machine', label: 'machine' };
        }

        let decoded: string;
        try {
            decoded = Buffer.from(parsed.value, 'base64').toString('utf8');
        } catch {
            fail('AUTH_INVALID');
        }
        const separator = decoded.indexOf(':');
        if (separator < 0) fail('AUTH_INVALID');
        const user = decoded.slice(0, separator);
        const password = decoded.slice(separator + 1);
        // Evaluate both comparisons unconditionally: no early exit on the username.
        const userOk = safeEqual(user, this.config.user);
        const passOk = safeEqual(password, this.config.password);
        if (!userOk || !passOk) fail('AUTH_INVALID');
        return { kind: 'operator', label: user };
    }

    me(header: string | undefined | null): AuthMe {
        const actor = this.authenticate(header);
        return { kind: actor.kind, configured: true };
    }
}
