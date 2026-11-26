/**
 * Deterministic local answer collector for host-runtime.
 *
 * Performs real filesystem existence + SHA-256 content checks under `cwd`.
 * Never trusts LLM self-claims and never fabricates `present` for missing files.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

interface NodeCryptoHash {
    update(data: string): NodeCryptoHash;
    digest(encoding: 'hex'): string;
}

interface NodeCryptoModule {
    createHash(algorithm: string): NodeCryptoHash;
}

const nodeCrypto = (await import('node:crypto' as string)) as NodeCryptoModule;

export interface RequirementTarget {
    subject: string;
    where_hint?: string;
    source?: string;
}

export interface CollectLocalAnswersInput {
    cwd: string;
    files?: string[];
    requirements?: RequirementTarget[];
}

export interface LocalAnswer {
    requirement: string;
    claim: string | null;
    basis: 'verified';
    exists: 'present' | 'absent';
    provider: 'host-runtime:fs-hash';
    hash: string | null;
}

export interface EvidencePacketItem {
    id: string;
    kind: 'file';
    hash: string;
    requirementId?: string;
}

export interface LocalAnswerCollection {
    answers: LocalAnswer[];
    packetItems: EvidencePacketItem[];
    packetHash: string | null;
}

interface VerifiedFile {
    relPath: string;
    hash: string;
}

function sha256Text(data: string): string {
    return nodeCrypto.createHash('sha256').update(data).digest('hex');
}

function tryVerifyLocalFile(root: string, candidate: string | undefined): VerifiedFile | null {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
    if (!trimmed) return null;

    const resolved = resolve(root, trimmed);
    const rel = relative(root, resolved);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        return null;
    }

    if (!existsSync(resolved)) return null;
    let stat;
    try {
        stat = statSync(resolved);
    } catch {
        return null;
    }
    if (!stat.isFile()) return null;

    const hash = sha256Text(readFileSync(resolved, 'utf8'));
    const relPath = rel.split(sep).join('/');
    return { relPath, hash };
}

export function computePacketHash(items: ReadonlyArray<EvidencePacketItem>): string {
    const canonical = [...items]
        .map((item) => `${item.kind}:${item.id}:${item.hash}`)
        .sort()
        .join('\n');
    return sha256Text(canonical);
}

const FILE_URI_RE = /file:\/\/\/([^\s)"'<>`]+)/g;
const RELATIVE_PATH_RE = /(?<![A-Za-z0-9_:/])((?:\.\.?\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,12})(?::\d+(?::\d+)?)?(?:#[^\s)"'`\],;]+)?/g;
const DEFAULT_MAX_CITED_FILES = 25;

function normalizeCandidatePath(raw: string): string {
    let candidate = raw.trim();
    const hashIdx = candidate.indexOf('#');
    if (hashIdx >= 0) candidate = candidate.slice(0, hashIdx);
    const queryIdx = candidate.indexOf('?');
    if (queryIdx >= 0) candidate = candidate.slice(0, queryIdx);
    candidate = candidate.replace(/:\d+(?::\d+)?$/, '');
    candidate = candidate.replace(/[.,;:'")\]}]+$/, '');
    return candidate.trim();
}

function resolveExistingRelativeFile(root: string, candidate: string): string | null {
    const cleaned = normalizeCandidatePath(candidate);
    if (!cleaned) return null;
    const resolved = resolve(root, cleaned);
    const rel = relative(root, resolved);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        return null;
    }
    if (!existsSync(resolved)) return null;
    let stat;
    try {
        stat = statSync(resolved);
    } catch {
        return null;
    }
    if (!stat.isFile()) return null;
    return rel.split(sep).join('/');
}

/**
 * Extract real, existing file paths cited in adapter stdout (`file:///...` URIs and
 * relative paths under `cwd`). Rejects path traversal and non-existent paths.
 */
export function extractCitedFilePaths(
    stdout: string,
    cwd: string,
    maxFiles: number = DEFAULT_MAX_CITED_FILES,
): string[] {
    if (typeof stdout !== 'string' || !stdout.trim()) return [];
    if (typeof cwd !== 'string' || !cwd.trim()) return [];
    const cap = Number.isFinite(maxFiles) && maxFiles > 0 ? Math.trunc(maxFiles) : DEFAULT_MAX_CITED_FILES;
    const root = resolve(cwd);
    const seen = new Set<string>();
    const results: string[] = [];

    const tryAdd = (rawCandidate: string): void => {
        if (results.length >= cap) return;
        const relPath = resolveExistingRelativeFile(root, rawCandidate);
        if (!relPath || seen.has(relPath)) return;
        seen.add(relPath);
        results.push(relPath);
    };

    for (const match of stdout.matchAll(FILE_URI_RE)) {
        if (results.length >= cap) break;
        const rawUriPath = match[1] ?? '';
        const cleanedUri = normalizeCandidatePath(rawUriPath);
        if (!cleanedUri) continue;
        let decoded = cleanedUri;
        try {
            decoded = decodeURIComponent(cleanedUri);
        } catch {
            decoded = cleanedUri;
        }
        tryAdd(`/${decoded}`);
    }

    for (const match of stdout.matchAll(RELATIVE_PATH_RE)) {
        if (results.length >= cap) break;
        const token = match[1] ?? '';
        if (!token) continue;
        tryAdd(token);
    }

    return results;
}

/**
 * Deterministically inspect local files under `cwd` via `node:fs` + SHA-256.
 *
 * - Existing files produce `basis: 'verified', exists: 'present'` and an `EvidencePacketItem`.
 * - Missing files produce `exists: 'absent'` and are never added to `packetItems`.
 */
export function collectLocalAnswers(input: CollectLocalAnswersInput): LocalAnswerCollection {
    const root = resolve(input.cwd);
    const answers: LocalAnswer[] = [];
    const packetById = new Map<string, EvidencePacketItem>();
    const answeredRequirements = new Set<string>();

    for (const req of input.requirements ?? []) {
        const subject = typeof req?.subject === 'string' ? req.subject.trim() : '';
        if (!subject || answeredRequirements.has(subject)) continue;
        answeredRequirements.add(subject);

        const verified = tryVerifyLocalFile(root, subject) ?? tryVerifyLocalFile(root, req.where_hint);
        if (verified) {
            answers.push({
                requirement: subject,
                claim: verified.relPath,
                basis: 'verified',
                exists: 'present',
                provider: 'host-runtime:fs-hash',
                hash: verified.hash,
            });
            if (!packetById.has(verified.relPath)) {
                packetById.set(verified.relPath, {
                    id: verified.relPath,
                    kind: 'file',
                    hash: verified.hash,
                    requirementId: subject,
                });
            }
        } else {
            answers.push({
                requirement: subject,
                claim: null,
                basis: 'verified',
                exists: 'absent',
                provider: 'host-runtime:fs-hash',
                hash: null,
            });
        }
    }

    for (const rawFile of input.files ?? []) {
        const target = typeof rawFile === 'string' ? rawFile.trim() : '';
        if (!target) continue;

        const verified = tryVerifyLocalFile(root, target);
        if (verified) {
            if (!answeredRequirements.has(verified.relPath)) {
                answeredRequirements.add(verified.relPath);
                answers.push({
                    requirement: verified.relPath,
                    claim: verified.relPath,
                    basis: 'verified',
                    exists: 'present',
                    provider: 'host-runtime:fs-hash',
                    hash: verified.hash,
                });
            }
            if (!packetById.has(verified.relPath)) {
                packetById.set(verified.relPath, {
                    id: verified.relPath,
                    kind: 'file',
                    hash: verified.hash,
                });
            }
        } else if (!answeredRequirements.has(target)) {
            answeredRequirements.add(target);
            answers.push({
                requirement: target,
                claim: null,
                basis: 'verified',
                exists: 'absent',
                provider: 'host-runtime:fs-hash',
                hash: null,
            });
        }
    }

    const packetItems = [...packetById.values()];
    return {
        answers,
        packetItems,
        packetHash: packetItems.length > 0 ? computePacketHash(packetItems) : null,
    };
}
