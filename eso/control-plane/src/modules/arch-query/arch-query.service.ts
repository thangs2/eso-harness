/**
 * Phase 2 F-20/F-21 — architecture questions answered from a static repo scan.
 *
 * Monolith (F-20): build a module graph from `import`/`require` statements, then answer
 * "changing module X affects whom" with `file:line` citations and name modules in dependency
 * cycles. Microservices (F-21): answer the four CQRS / event-sourcing / multi-tenant /
 * multi-domain groups from config, handler and schema lines (never from service names).
 *
 * Contract (BR-16, FRD/F-20 §2.4, FRD/F-21 §2.4-2.5):
 * - every `answered` result carries citations whose exact line still exists in the repo;
 * - not enough data ⇒ `unknown`, never a guess;
 * - a conclusion that cannot be derived from the scanned source ⇒ `DOC_CONTRACT_VIOLATION`;
 * - a question outside the architecture set ⇒ `INVALID_TASK`.
 *
 * `INVALID_TASK` and `DOC_CONTRACT_VIOLATION` are BRD codes (BRD/06 §1) that are not yet in
 * `ERROR_STATUS`; the registry helper rejects unregistered codes, so this capability throws the
 * same `{code,status,detail}` shape locally instead of editing the shared table.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.go', '.kt'];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.harness', '.next', 'target', 'vendor', '__pycache__']);

export const MICROSERVICE_GROUPS = ['cqrs', 'event-sourcing', 'multi-tenant', 'multi-domain'] as const;

export type MicroserviceGroup = (typeof MICROSERVICE_GROUPS)[number];
export type ArchKind = 'monolith' | 'microservices';
export type MonolithTask = 'impact' | 'cycles';

export interface ArchQuestion {
    kind: ArchKind;
    task?: MonolithTask;
    group?: MicroserviceGroup;
    /** Module path, basename or stem — resolved against the scanned import graph. */
    module?: string;
}

export interface ArchCitation {
    file: string;
    line: number;
    text: string;
}

export interface ArchAnswer {
    question: ArchQuestion;
    status: 'answered' | 'unknown';
    answer: string;
    evidence: ArchCitation[];
    modules?: string[];
    cycles?: string[][];
    reason?: string;
    scannedFiles: number;
}

interface ImportRef {
    specifier: string;
    line: number;
    text: string;
    resolved: string | null;
}

interface SourceFile {
    path: string;
    lines: string[];
    imports: ImportRef[];
}

interface RepoIndex {
    root: string;
    files: Map<string, SourceFile>;
    cycles: string[][];
    scannedFiles: number;
}

interface GroupSpec {
    label: string;
    patterns: RegExp[];
}

const GROUP_SPECS: Record<MicroserviceGroup, GroupSpec> = {
    cqrs: {
        label: 'CQRS command/query separation',
        patterns: [
            /\bcqrs\b/i,
            /command(?:handler|bus|service)?/i,
            /query(?:handler|bus|service)?/i,
            /\bread[_-]?model\b/i,
            /\bwrite[_-]?model\b/i,
        ],
    },
    'event-sourcing': {
        label: 'event sourcing',
        patterns: [
            /\bevent[_-]?store\b/i,
            /\bevent[_-]?sourcing\b/i,
            /\baggregate[_-]?root\b/i,
            /\bappend(?:ed)?[_-]?event\b/i,
            /\breplay(?:s|ed)?\b/i,
            /\bprojection\b/i,
        ],
    },
    'multi-tenant': {
        label: 'multi-tenancy',
        patterns: [
            /\bmulti[_-]?tenant\b/i,
            /\btenant[_-]?id\b/i,
            /\btenantId\b/,
            /\btenant[_-]?isolation\b/i,
            /\brow[_-]?level[_-]?security\b/i,
        ],
    },
    'multi-domain': {
        label: 'multi-domain boundaries',
        patterns: [
            /\bbounded[_-]?context\b/i,
            /\bdomain[_-]?(?:module|boundary)\b/i,
            /\bcontext[_-]?map\b/i,
            /\bdomains?\b\s*[:=]/i,
        ],
    },
};

const IMPORT_PATTERNS: RegExp[] = [
    /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/,
    /^\s*export\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/,
    /^\s*(?:const|let|var)\s+[^=]+=\s*require\(\s*['"]([^'"]+)['"]\s*\)/,
    /^\s*require\(\s*['"]([^'"]+)['"]\s*\)/,
];

function codedError(code: string, detail: string, status: number): never {
    const error = new Error(detail) as Error & { code: string; status: number; detail?: string };
    error.name = 'PlatformError';
    error.code = code;
    error.status = status;
    error.detail = detail;
    throw error;
}

function violation(detail: string): never {
    codedError('DOC_CONTRACT_VIOLATION', detail, 422);
}

function invalidTask(detail: string): never {
    codedError('INVALID_TASK', detail, 422);
}

function normalizePath(value: string): string {
    const parts: string[] = [];
    for (const part of String(value || '').replace(/\\/g, '/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!parts.length) return '';
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    return parts.join('/');
}

function readSpecifier(line: string): string | null {
    for (const pattern of IMPORT_PATTERNS) {
        const match = line.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function walkSources(dir: string, out: string[]): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) walkSources(absolute, out);
        else if (entry.isFile() && SOURCE_EXTENSIONS.includes(extname(entry.name).toLowerCase())) out.push(absolute);
    }
}

function resolveRelative(fromPath: string, specifier: string, files: Map<string, SourceFile>): string | null {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
    const base = normalizePath(`${dirname(fromPath)}/${specifier}`);
    if (!base) return null;
    const extension = extname(base).toLowerCase();
    const candidates = new Set<string>([base]);
    const stems = new Set<string>();
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) stems.add(base.slice(0, -extension.length));
    else if (!extension) stems.add(base);
    for (const stem of stems) {
        for (const candidate of SOURCE_EXTENSIONS) candidates.add(`${stem}${candidate}`);
        for (const candidate of SOURCE_EXTENSIONS) candidates.add(`${stem}/index${candidate}`);
    }
    for (const candidate of candidates) if (files.has(candidate)) return candidate;
    return null;
}

/**
 * Tarjan SCC. Returns components larger than one node plus self-loops; modules sorted so the
 * answer is stable across runs.
 */
function findCycles(edges: Map<string, string[]>): string[][] {
    let nextIndex = 0;
    const indices = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const cycles: string[][] = [];
    const nodes = new Set<string>();
    for (const [from, targets] of edges) {
        nodes.add(from);
        for (const target of targets) nodes.add(target);
    }

    const strongConnect = (node: string): void => {
        indices.set(node, nextIndex);
        low.set(node, nextIndex);
        nextIndex += 1;
        stack.push(node);
        onStack.add(node);
        for (const next of edges.get(node) ?? []) {
            if (!indices.has(next)) {
                strongConnect(next);
                low.set(node, Math.min(low.get(node) as number, low.get(next) as number));
            } else if (onStack.has(next)) {
                low.set(node, Math.min(low.get(node) as number, indices.get(next) as number));
            }
        }
        if (low.get(node) === indices.get(node)) {
            const component: string[] = [];
            let member: string;
            do {
                member = stack.pop() as string;
                onStack.delete(member);
                component.push(member);
            } while (member !== node);
            if (component.length > 1) cycles.push(component.sort());
            else if ((edges.get(node) ?? []).includes(node)) cycles.push([node]);
        }
    };

    for (const node of [...nodes].sort()) if (!indices.has(node)) strongConnect(node);
    return cycles.sort((left, right) => left[0].localeCompare(right[0]));
}

function dedupeEvidence(citations: ArchCitation[]): ArchCitation[] {
    const seen = new Set<string>();
    const out: ArchCitation[] = [];
    for (const citation of citations) {
        const key = `${citation.file}:${citation.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(citation);
    }
    return out.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
}

export class ArchQueryService {
    private cached: RepoIndex | null = null;

    constructor(private readonly root: string) {}

    /** Drop the cached graph index (the FRD assumes a per-commit index, not a per-request scan). */
    refresh(): void {
        this.cached = null;
    }

    /** Synchronous on purpose: pure static scan, so `await` also works for callers. */
    ask(question: ArchQuestion): ArchAnswer {
        if (!question || typeof question !== 'object') invalidTask('an architecture question is required');
        const index = this.index;
        let answer: ArchAnswer;
        if (question.kind === 'monolith') {
            if (question.task === 'cycles') answer = this.monolithCycles(question, index);
            else if (!question.task || question.task === 'impact') answer = this.monolithImpact(question, index);
            else invalidTask(`unknown monolith task '${String(question.task)}'`);
        } else if (question.kind === 'microservices') {
            if (!question.group || !MICROSERVICE_GROUPS.includes(question.group)) {
                invalidTask(`unknown microservices group '${String(question.group)}'; expected ${MICROSERVICE_GROUPS.join('|')}`);
            }
            answer = this.microserviceAnswer(question, index);
        } else {
            invalidTask(`unknown architecture kind '${String((question as ArchQuestion).kind)}'`);
        }
        return this.assertContract(answer);
    }

    /** Answer all four F-21 groups against one snapshot of the graph. */
    askAll(): Record<MicroserviceGroup, ArchAnswer> {
        const index = this.index;
        const answers = {} as Record<MicroserviceGroup, ArchAnswer>;
        for (const group of MICROSERVICE_GROUPS) {
            const question: ArchQuestion = { kind: 'microservices', group };
            answers[group] = this.assertContract(this.microserviceAnswer(question, index));
        }
        return answers;
    }

    /**
     * BR-16 gate: `answered` needs at least one citation and every citation must still resolve to
     * the exact scanned line (derived ⊆ source). `unknown` is allowed, but must not smuggle claims
     * through evidence.
     */
    assertContract(answer: ArchAnswer): ArchAnswer {
        if (!answer || typeof answer !== 'object') violation('an answer is required');
        if (answer.status === 'unknown') {
            if (answer.evidence?.length) violation('an unknown answer must not carry evidence claims');
            return answer;
        }
        if (answer.status !== 'answered') violation(`answer status '${String((answer as ArchAnswer).status)}' must be answered|unknown`);
        if (!Array.isArray(answer.evidence) || answer.evidence.length === 0) {
            violation(`answer '${answer.answer}' has no file:line evidence (derived ⊆ source)`);
        }
        const index = this.index;
        for (const citation of answer.evidence) {
            const file = index.files.get(citation.file);
            if (!file) violation(`cited file '${citation.file}' is not in the scanned source set`);
            if (!Number.isInteger(citation.line) || citation.line < 1 || citation.line > file.lines.length) {
                violation(`cited line ${citation.file}:${citation.line} is outside the file`);
            }
            const actual = file.lines[citation.line - 1].trim();
            if (actual !== String(citation.text || '').trim()) {
                violation(`cited line ${citation.file}:${citation.line} does not match the scanned source`);
            }
        }
        return answer;
    }

    private get index(): RepoIndex {
        if (!this.cached) this.cached = this.buildIndex();
        return this.cached;
    }

    private buildIndex(): RepoIndex {
        const absoluteFiles: string[] = [];
        walkSources(this.root, absoluteFiles);
        const files = new Map<string, SourceFile>();
        for (const absolute of absoluteFiles.sort()) {
            const path = relative(this.root, absolute).split(sep).join('/');
            const text = readFileSync(absolute, 'utf8');
            files.set(path, { path, lines: text.split(/\r?\n/), imports: [] });
        }
        const edges = new Map<string, string[]>();
        for (const file of files.values()) {
            for (let position = 0; position < file.lines.length; position += 1) {
                const line = file.lines[position];
                const specifier = readSpecifier(line);
                if (!specifier) continue;
                const resolved = resolveRelative(file.path, specifier, files);
                file.imports.push({ specifier, line: position + 1, text: line.trim(), resolved });
                if (resolved) {
                    const targets = edges.get(file.path) ?? [];
                    if (!targets.includes(resolved)) targets.push(resolved);
                    edges.set(file.path, targets);
                }
            }
        }
        return { root: this.root, files, cycles: findCycles(edges), scannedFiles: files.size };
    }

    private unknown(question: ArchQuestion, index: RepoIndex, reason: string): ArchAnswer {
        return { question, status: 'unknown', answer: 'unknown', evidence: [], reason, scannedFiles: index.scannedFiles };
    }

    private monolithImpact(question: ArchQuestion, index: RepoIndex): ArchAnswer {
        if (index.scannedFiles === 0) return this.unknown(question, index, 'no source files found under the repository root');
        if (!question.module) invalidTask('monolith impact needs a module path or name');
        const target = this.resolveModule(index, question.module);
        if ('reason' in target) return this.unknown(question, index, target.reason);

        const reverse = new Map<string, { from: string; line: number; text: string }[]>();
        for (const file of index.files.values()) {
            for (const imported of file.imports) {
                if (!imported.resolved) continue;
                const list = reverse.get(imported.resolved) ?? [];
                list.push({ from: file.path, line: imported.line, text: imported.text });
                reverse.set(imported.resolved, list);
            }
        }

        const visited = new Set<string>([target.path]);
        const evidence: ArchCitation[] = [];
        const queue = [target.path];
        while (queue.length) {
            const node = queue.shift() as string;
            for (const edge of reverse.get(node) ?? []) {
                if (visited.has(edge.from)) continue;
                visited.add(edge.from);
                evidence.push({ file: edge.from, line: edge.line, text: edge.text });
                queue.push(edge.from);
            }
        }

        const dependents = [...visited].filter((path) => path !== target.path).sort();
        if (!dependents.length) {
            return this.unknown(question, index, `no dependent module found for '${target.path}' in the static import graph`);
        }

        const cycles = index.cycles.filter((cycle) => cycle.includes(target.path) || cycle.some((module) => visited.has(module)));
        for (const cycle of cycles) {
            for (const modulePath of cycle) {
                for (const imported of index.files.get(modulePath)?.imports ?? []) {
                    if (imported.resolved && cycle.includes(imported.resolved)) {
                        evidence.push({ file: modulePath, line: imported.line, text: imported.text });
                    }
                }
            }
        }

        const cycleNote = cycles.length ? ` Dependency cycle: ${cycles.map((cycle) => cycle.join(' -> ')).join('; ')}` : '';
        return {
            question,
            status: 'answered',
            answer: `Changing ${target.path} affects ${dependents.length} module(s): ${dependents.join(', ')}.${cycleNote}`,
            evidence: dedupeEvidence(evidence),
            modules: dependents,
            cycles,
            scannedFiles: index.scannedFiles,
        };
    }

    private monolithCycles(question: ArchQuestion, index: RepoIndex): ArchAnswer {
        if (!index.cycles.length) {
            return this.unknown(question, index, `no import cycle found in ${index.scannedFiles} scanned file(s); static imports cannot prove absence`);
        }
        const evidence: ArchCitation[] = [];
        for (const cycle of index.cycles) {
            for (const modulePath of cycle) {
                for (const imported of index.files.get(modulePath)?.imports ?? []) {
                    if (imported.resolved && cycle.includes(imported.resolved)) {
                        evidence.push({ file: modulePath, line: imported.line, text: imported.text });
                    }
                }
            }
        }
        const modules = [...new Set(index.cycles.flat())].sort();
        return {
            question,
            status: 'answered',
            answer: `${index.cycles.length} dependency cycle(s): ${index.cycles.map((cycle) => cycle.join(' -> ')).join('; ')}`,
            evidence: dedupeEvidence(evidence),
            modules,
            cycles: index.cycles,
            scannedFiles: index.scannedFiles,
        };
    }

    private microserviceAnswer(question: ArchQuestion, index: RepoIndex): ArchAnswer {
        const group = question.group as MicroserviceGroup;
        const spec = GROUP_SPECS[group];
        const evidence: ArchCitation[] = [];
        const maxEvidence = 20;
        outer: for (const file of index.files.values()) {
            for (let position = 0; position < file.lines.length; position += 1) {
                const text = file.lines[position];
                if (!text.trim()) continue;
                if (!spec.patterns.some((pattern) => pattern.test(text))) continue;
                evidence.push({ file: file.path, line: position + 1, text: text.trim() });
                if (evidence.length >= maxEvidence) break outer;
            }
        }
        if (!evidence.length) {
            return this.unknown(question, index, `no ${spec.label} evidence found in ${index.scannedFiles} scanned source file(s)`);
        }
        const citations = dedupeEvidence(evidence);
        const first = citations[0];
        const files = new Set(citations.map((citation) => citation.file)).size;
        return {
            question,
            status: 'answered',
            answer: `${spec.label} is evidenced at ${first.file}:${first.line} (${citations.length} citation(s) across ${files} file(s)).`,
            evidence: citations,
            scannedFiles: index.scannedFiles,
        };
    }

    private resolveModule(index: RepoIndex, raw: string): { path: string } | { reason: string } {
        const value = normalizePath(raw);
        if (!value) return { reason: 'module path or name is empty' };
        const candidates = new Set<string>();
        if (index.files.has(value)) candidates.add(value);
        for (const extension of SOURCE_EXTENSIONS) {
            if (index.files.has(`${value}${extension}`)) candidates.add(`${value}${extension}`);
        }
        for (const path of index.files.keys()) {
            if (path.endsWith(`/${value}`)) candidates.add(path);
            const baseName = path.split('/').pop() as string;
            if (baseName.replace(/\.[^.]+$/, '') === value) candidates.add(path);
        }
        const matches = [...candidates].sort();
        if (matches.length === 1) return { path: matches[0] };
        if (matches.length > 1) {
            return { reason: `module '${raw}' is ambiguous: ${matches.slice(0, 5).join(', ')}` };
        }
        return { reason: `module '${raw}' is not in the static import graph` };
    }
}
