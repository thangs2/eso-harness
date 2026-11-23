/**
 * F-14 — inventory artifact (US-22, AC-22-1…3, REQ-22).
 *
 * Maps every template `kind` to the instances found in the consumer knowledge base and reports
 * the absences BR-17/BR-18 forbid the caller to paper over:
 *   - `MISSING_KIND`    — a required kind has zero instances;
 *   - `ORPHAN_ARTIFACT` — an artifact whose kind is absent from (or unmapped by) the template;
 *   - `OWNER_MISSING`   — no owner can be derived from the kind map or the artifact header.
 *
 * Read-only and deterministic: the result is reproducible from (consumer, KB content) alone, so
 * the same KB always produces the same bytes (FRD F-14 §5). No model calls.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { fail } from '../../platform/registry/errors.js';
import { assertConsumerId, type PlatformStore } from '../../platform/registry/store.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.harness', '.cursor', '.agents', '.claude', 'coverage']);
const TEMPLATE_FILE = '.harness/knowledge-template.json';

/** One kind declared by the consumer template. `owner` is the accountable role for the kind. */
export interface InventoryTemplateKind {
    kind: string;
    required: boolean;
    owner: string | null;
}

type TemplateEntry = string | (Partial<InventoryTemplateKind> & { kind?: string });

/** Raw template input: `['frd', …]`, `{ kinds: … }` or `{ requiredKinds: … }`. */
export type InventoryTemplateInput =
    | ReadonlyArray<TemplateEntry>
    | { kinds?: ReadonlyArray<TemplateEntry> }
    | { requiredKinds?: ReadonlyArray<TemplateEntry> };

export type InventoryFindingCode = 'MISSING_KIND' | 'ORPHAN_ARTIFACT' | 'OWNER_MISSING';

export interface InventoryFinding {
    code: InventoryFindingCode;
    kind: string | null;
    path: string | null;
    reason: string;
    consequence: string;
    severity: 'error' | 'warning';
}

/** Indexed artifact: kind + owner + body, enough for F-15 to check content without re-walking. */
export interface InventoryDoc {
    path: string;
    kind: string | null;
    owner: string | null;
    id: string | null;
    representation: string | null;
    humanSot: string | null;
    content: string;
}

export interface InventoryKindRow {
    kind: string;
    required: boolean;
    owner: string | null;
    instanceCount: number;
    status: 'present' | 'missing' | 'optional';
    paths: string[];
}

export interface InventoryOptions {
    template?: InventoryTemplateInput;
}

export interface InventoryResult {
    consumerId: string;
    template: InventoryTemplateKind[];
    kinds: InventoryKindRow[];
    orphans: Array<{ path: string; kind: string | null; reason: string }>;
    findings: InventoryFinding[];
    summary: {
        kinds: number;
        instances: number;
        presentKinds: number;
        missingKinds: number;
        orphanArtifacts: number;
    };
}

export interface InventoryInspection {
    consumer: { id: string; root: string };
    docs: InventoryDoc[];
    result: InventoryResult;
}

interface Header {
    kind?: string;
    type?: string;
    owner?: string;
    id?: string;
    representation?: string;
    human_sot?: string;
}

/**
 * `INVALID_TASK` is a BRD code (BRD/06) that is not yet in `ERROR_STATUS`; the registry helper
 * rejects unregistered codes. Keep the FRD §3 contract (422 + code) without editing the shared
 * registry table for a single capability.
 */
export function invalidTask(detail: string): never {
    const error = new Error('Invalid task') as Error & { code: string; status: number; detail?: string };
    error.name = 'PlatformError';
    error.code = 'INVALID_TASK';
    error.status = 422;
    error.detail = detail;
    throw error;
}

function parseFrontmatter(text: string): { header: Header; body: string } {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) return { header: {}, body: text };
    const header: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index <= 0) continue;
        header[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    }
    return { header: header as Header, body: text.slice(match[0].length) };
}

function walk(dir: string, out: string[]): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute, out);
        else if (entry.isFile() && entry.name.endsWith('.md')) out.push(absolute);
    }
}

function normalizeKindValue(value: unknown): InventoryTemplateKind | null {
    if (typeof value === 'string') {
        const kind = value.trim();
        return kind ? { kind, required: true, owner: null } : null;
    }
    if (value && typeof value === 'object') {
        const candidate = value as Partial<InventoryTemplateKind> & { kind?: unknown };
        const kind = typeof candidate.kind === 'string' ? candidate.kind.trim() : '';
        if (!kind) return null;
        return {
            kind,
            required: candidate.required !== false,
            owner: typeof candidate.owner === 'string' && candidate.owner.trim() ? candidate.owner.trim() : null,
        };
    }
    return null;
}

function normalizeTemplate(input: unknown, origin: string): InventoryTemplateKind[] {
    const list = Array.isArray(input)
        ? input
        : input && typeof input === 'object'
            ? (input as any).kinds ?? (input as any).requiredKinds
            : null;
    if (!Array.isArray(list)) invalidTask(`${origin} must declare a \`kinds\` array`);
    const kinds = list.map(normalizeKindValue).filter((kind): kind is InventoryTemplateKind => kind !== null);
    if (kinds.length === 0) invalidTask(`${origin} declares no usable \`kind\``);
    // Last declaration wins so a consumer can override a kind; first-seen order is preserved.
    const byKind = new Map<string, InventoryTemplateKind>();
    for (const kind of kinds) byKind.set(kind.kind, kind);
    return [...byKind.values()];
}

function docKind(header: Header): string | null {
    const value = header.kind ?? header.type;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export class InventoryService {
    constructor(private readonly store: PlatformStore) {}

    /** Read the consumer KB once; F-15 reuses the same records instead of walking twice. */
    async scan(consumerId: string): Promise<{ consumer: { id: string; root: string }; docs: InventoryDoc[] }> {
        const id = assertConsumerId(consumerId);
        const consumer = await this.store.getConsumer(id);
        if (!consumer || consumer.status !== 'ready') fail('CONSUMER_NOT_FOUND');

        const files: string[] = [];
        walk(consumer.root, files);
        const docs = files.sort().map((absolute) => {
            const path = relative(consumer.root, absolute).split(sep).join('/');
            const text = readFileSync(absolute, 'utf8');
            const { header, body } = parseFrontmatter(text);
            return {
                path,
                kind: docKind(header),
                owner: header.owner?.trim() || null,
                id: header.id?.trim() || null,
                representation: header.representation?.trim() || null,
                humanSot: header.human_sot?.trim() || null,
                content: body,
            };
        });
        return { consumer: { id: consumer.id, root: consumer.root }, docs };
    }

    async inventory(consumerId: string, options: InventoryOptions = {}): Promise<InventoryResult> {
        return (await this.inspect(consumerId, options)).result;
    }

    /** Scan + resolve the template once, so F-15 can run over the same byte-identical snapshot. */
    async inspect(consumerId: string, options: InventoryOptions = {}): Promise<InventoryInspection> {
        const { consumer, docs } = await this.scan(consumerId);
        const template = options.template !== undefined
            ? normalizeTemplate(options.template, 'template')
            : this.templateFromFile(consumer.root);
        return { consumer, docs, result: this.project(consumer.id, docs, template) };
    }

    /** Pure projection over already-scanned docs (deterministic; no I/O). */
    evaluate(consumerId: string, docs: InventoryDoc[], templateInput: InventoryTemplateInput): InventoryResult {
        const id = assertConsumerId(consumerId);
        return this.project(id, docs, normalizeTemplate(templateInput, 'template'));
    }

    private templateFromFile(root: string): InventoryTemplateKind[] {
        const path = join(root, TEMPLATE_FILE);
        if (!existsSync(path)) invalidTask(`template not found; declare it at ${TEMPLATE_FILE}`);
        let parsed: unknown;
        try {
            parsed = JSON.parse(readFileSync(path, 'utf8'));
        } catch {
            invalidTask(`template ${TEMPLATE_FILE} is not valid JSON`);
        }
        return normalizeTemplate(parsed, `template ${TEMPLATE_FILE}`);
    }

    private project(consumerId: string, docs: InventoryDoc[], template: InventoryTemplateKind[]): InventoryResult {
        const kindIndex = new Map(template.map((entry) => [entry.kind, entry]));
        const byKind = new Map<string, InventoryDoc[]>();
        const orphans: Array<{ path: string; kind: string | null; reason: string }> = [];
        const findings: InventoryFinding[] = [];

        const sortedDocs = [...docs].sort((left, right) => left.path.localeCompare(right.path));
        for (const doc of sortedDocs) {
            if (!doc.kind || !kindIndex.has(doc.kind)) {
                const reason = doc.kind
                    ? `artifact kind \`${doc.kind}\` is not declared by the consumer template`
                    : 'artifact declares no `kind` (or `type`) in its frontmatter';
                orphans.push({ path: doc.path, kind: doc.kind, reason });
                findings.push({
                    code: 'ORPHAN_ARTIFACT',
                    kind: doc.kind,
                    path: doc.path,
                    reason,
                    consequence: 'an unmapped artifact is invisible to the kind gate; its content can rot or contradict a mapped artifact without being noticed',
                    severity: 'warning',
                });
                continue;
            }
            const bucket = byKind.get(doc.kind) ?? [];
            bucket.push(doc);
            byKind.set(doc.kind, bucket);
        }

        const kinds: InventoryKindRow[] = template.map((entry) => {
            const instances = byKind.get(entry.kind) ?? [];
            const status: InventoryKindRow['status'] = instances.length > 0
                ? 'present'
                : entry.required ? 'missing' : 'optional';
            if (status === 'missing') {
                findings.push({
                    code: 'MISSING_KIND',
                    kind: entry.kind,
                    path: null,
                    reason: `required kind \`${entry.kind}\` has no instance in the knowledge base`,
                    consequence: `coverage can be claimed for \`${entry.kind}\` although no artifact exists; BR-17 cannot be verified`,
                    severity: 'error',
                });
            }
            return {
                kind: entry.kind,
                required: entry.required,
                owner: entry.owner,
                instanceCount: instances.length,
                status,
                paths: instances.map((doc) => doc.path),
            };
        });

        for (const doc of sortedDocs) {
            if (!doc.kind || !kindIndex.has(doc.kind)) continue;
            const owner = doc.owner ?? kindIndex.get(doc.kind)?.owner ?? null;
            if (!owner) {
                findings.push({
                    code: 'OWNER_MISSING',
                    kind: doc.kind,
                    path: doc.path,
                    reason: 'owner cannot be derived from the artifact header or the kind template',
                    consequence: 'no one is accountable for this artifact; drift and staleness go unreported (MET-11)',
                    severity: 'warning',
                });
            }
        }

        const sortedFindings = findings.sort((left, right) =>
            left.code.localeCompare(right.code)
            || String(left.kind ?? '').localeCompare(String(right.kind ?? ''))
            || String(left.path ?? '').localeCompare(String(right.path ?? '')));

        return {
            consumerId,
            template,
            kinds,
            orphans: orphans.sort((left, right) => left.path.localeCompare(right.path)),
            findings: sortedFindings,
            summary: {
                kinds: kinds.length,
                instances: sortedDocs.length - orphans.length,
                presentKinds: kinds.filter((row) => row.status === 'present').length,
                missingKinds: kinds.filter((row) => row.status === 'missing').length,
                orphanArtifacts: orphans.length,
            },
        };
    }
}
