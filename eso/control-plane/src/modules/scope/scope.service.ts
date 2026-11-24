/**
 * @mu/eso-control-plane — Scope check facade (P6 / US-AGENT-01).
 *
 * Wraps the domain guard so the same scope rules back both the HTTP surface and the worker file
 * write path (`WorkerPolicyService.write`). No scope logic lives here: target normalization and the
 * BLOCKED_SCOPE / EMPTY_SCOPE / DANGLING_SCOPE verdicts come from `domain/scope.ts`.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';
import { checkFileWriteScope } from './domain/scope.js';

export interface ScopeCheckInput {
    allowedFiles?: unknown;
    target?: unknown;
    emptyScope?: unknown;
    /** Q2 — the turn this check belongs to. Absent ⇒ no row is written (never guess a trace). */
    traceId?: unknown;
    /** Q2 — optional actor persisted verbatim with the decision. */
    actor?: unknown;
}

export interface ScopeCheckResult {
    allowed: boolean;
    target: string;
    code?: string;
    error?: string;
    message?: string;
}

/** Resolve `target` against the consumer root, refusing escapes as BLOCKED_SCOPE (never silently). */
function relativeTarget(root: string, target: string): string | null {
    const absolute = resolve(root, target);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    return rel.replace(/\\/g, '/');
}

export class ScopeService {
    constructor(private readonly store: PlatformStore) {}

    async check(consumerId: string, input: ScopeCheckInput = {}): Promise<ScopeCheckResult> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status === 'purged') fail('CONSUMER_NOT_FOUND');
        if (!consumer.root) fail('ROOT_NOT_FOUND');

        const root = resolve(consumer.root);
        const target = typeof input.target === 'string' ? input.target.trim() : '';
        const rel = target ? relativeTarget(root, target) : null;
        let result: ScopeCheckResult;
        if (!rel) {
            result = {
                allowed: false,
                target,
                code: 'BLOCKED_SCOPE',
                error: 'BLOCKED_SCOPE',
                message: `Target '${target}' is empty or outside the consumer root.`,
            };
        } else {
            const allowedFiles = input.emptyScope === true
                ? []
                : (Array.isArray(input.allowedFiles) ? input.allowedFiles.map((item) => String(item)) : []);
            const dirExists = (dir: string): boolean => existsSync(resolve(root, dir));

            const verdict = checkFileWriteScope({ allowedFiles, targetPath: rel, dirExists });
            if (verdict.allowed) {
                result = { allowed: true, target: verdict.targetPath };
            } else {
                result = {
                    allowed: false,
                    target: verdict.targetPath,
                    code: verdict.error,
                    error: verdict.error,
                    message: verdict.message,
                };
            }
        }

        await this.recordDecision(id, result, input);
        return result;
    }

    /**
     * Q2 — persist the decision so the detail page can answer "why was this file write allowed?".
     * A check that did not name a trace cannot be attributed to a turn, so it records nothing.
     * The stored row never changes the result returned to the caller.
     */
    private async recordDecision(consumerId: string, result: ScopeCheckResult, input: ScopeCheckInput): Promise<void> {
        const traceId = typeof input.traceId === 'string' ? input.traceId.trim() : '';
        if (!traceId) return;
        const actor = input.actor && typeof input.actor === 'object' && !Array.isArray(input.actor)
            ? (input.actor as Record<string, unknown>)
            : null;
        await this.store.insertScopeDecision({
            decisionId: randomUUID(),
            consumerId,
            traceId,
            target: result.target,
            allowed: result.allowed,
            code: result.code ?? null,
            message: result.message ?? null,
            actor,
            at: new Date().toISOString(),
        });
    }
}
