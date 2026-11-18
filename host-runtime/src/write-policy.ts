/**
 * Host-side FolderPolicy evaluator.
 *
 * ESO publishes policy + grants in the config snapshot; the host evaluates them before a write.
 * This module never executes policy remotely and never grants permissions on its own.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export type PathType = 'file' | 'directory' | 'glob';
export type ReadMode = 'allow' | 'deny';
export type WriteMode = 'allow' | 'bypass' | 'gated' | 'warn' | 'deny';

export interface FolderPolicy {
    id?: string;
    path: string;
    pathType?: PathType;
    read?: ReadMode;
    write?: WriteMode;
    index?: boolean;
    priority?: number;
}

export interface AccessGrant {
    grantId: string;
    kind: 'read' | 'write';
    targetPrefix: string;
    mode?: 'once' | 'always';
    expiresAt?: string | null;
    revokedAt?: string | null;
}

export interface AccessDecision {
    allowed: boolean;
    effect: 'allow' | 'deny' | 'warn' | 'gated';
    policy: FolderPolicy | null;
    grant: AccessGrant | null;
    external: boolean;
    reason: string;
}

function realTarget(target: string): string {
    let candidate = resolve(target);
    if (existsSync(candidate)) return realpathSync(candidate);
    let parent = dirname(candidate);
    while (parent !== dirname(parent) && !existsSync(parent)) parent = dirname(parent);
    return resolve(existsSync(parent) ? realpathSync(parent) : parent, relative(parent, candidate));
}

export function isInsideRoot(root: string, target: string): boolean {
    const realRoot = realTarget(root);
    const real = realTarget(target);
    const rel = relative(realRoot, real);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function globToRegExp(glob: string): RegExp {
    const normalized = glob.replace(/\\/g, '/');
    let out = '^';
    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        if (char === '*' && normalized[index + 1] === '*') {
            out += '.*';
            index += 1;
        } else if (char === '*') out += '[^/]*';
        else if (char === '?') out += '[^/]';
        else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`${out}$`);
}

function matches(policy: FolderPolicy, target: string, pathType?: PathType): boolean {
    const pattern = policy.path.replace(/\\/g, '/');
    const value = target.replace(/\\/g, '/');
    const type = policy.pathType ?? pathType ?? 'glob';
    if (type === 'file') return value === pattern;
    if (type === 'directory') return value === pattern || value.startsWith(`${pattern.replace(/\/$/, '')}/`);
    return globToRegExp(pattern).test(value);
}

function specificity(policy: FolderPolicy): number {
    const literal = policy.path.replace(/[*?]/g, '').length;
    const exact = policy.pathType === 'file' ? 10_000 : policy.pathType === 'directory' ? 5_000 : 0;
    return exact + literal + (policy.path.includes('**') ? 0 : 100);
}

function grantValid(grant: AccessGrant, now: number): boolean {
    if (grant.revokedAt) return false;
    if (!grant.expiresAt) return true;
    return Date.parse(grant.expiresAt) > now;
}

export function evaluateAccess(input: {
    root: string;
    target: string;
    kind: 'read' | 'write';
    policies: FolderPolicy[];
    grants?: AccessGrant[];
    now?: number;
}): AccessDecision {
    const root = realTarget(input.root);
    const target = realTarget(input.target);
    const relativeTarget = relative(root, target).split('\\').join('/');
    const external = !isInsideRoot(root, target);
    const now = input.now ?? Date.now();
    const grants = (input.grants ?? []).filter((grant) => grant.kind === input.kind && grantValid(grant, now));

    if (external) {
        const grant = grants.find((item) => {
            const prefix = isAbsolute(item.targetPrefix) ? realTarget(item.targetPrefix) : item.targetPrefix;
            return target === prefix || target.startsWith(`${prefix.replace(/\/$/, '')}/`);
        });
        return grant
            ? { allowed: true, effect: 'allow', policy: null, grant, external: true, reason: `external ${input.kind} grant ${grant.grantId}` }
            : { allowed: false, effect: 'deny', policy: null, grant: null, external: true, reason: 'outside repo root and no grant' };
    }

    const candidates = input.policies
        .filter((policy) => matches(policy, relativeTarget, policy.pathType))
        .sort((left, right) => specificity(right) - specificity(left) || (right.priority ?? 0) - (left.priority ?? 0));
    const policy = candidates[0] ?? null;
    if (!policy) return { allowed: false, effect: 'deny', policy: null, grant: null, external: false, reason: 'no policy matched' };

    if (input.kind === 'read') {
        const effect = policy.read ?? 'deny';
        return { allowed: effect === 'allow', effect, policy, grant: null, external: false, reason: `policy ${policy.id ?? policy.path} read=${effect}` };
    }

    const mode = policy.write ?? 'deny';
    if (mode === 'deny' || mode === 'allow' || mode === 'bypass') {
        return { allowed: mode !== 'deny', effect: mode === 'deny' ? 'deny' : 'allow', policy, grant: null, external: false, reason: `policy ${policy.id ?? policy.path} write=${mode}` };
    }
    if (mode === 'warn') {
        return { allowed: true, effect: 'warn', policy, grant: null, external: false, reason: `policy ${policy.id ?? policy.path} write=warn` };
    }
    const grant = grants.find((item) => {
        const prefix = isAbsolute(item.targetPrefix) ? realTarget(item.targetPrefix) : item.targetPrefix;
        return target === prefix || target.startsWith(`${prefix.replace(/\/$/, '')}/`);
    });
    return grant
        ? { allowed: true, effect: 'allow', policy, grant, external: false, reason: `policy ${policy.id ?? policy.path} gated grant ${grant.grantId}` }
        : { allowed: false, effect: 'gated', policy, grant: null, external: false, reason: `policy ${policy.id ?? policy.path} gated without grant` };
}
