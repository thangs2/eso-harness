import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { PlatformError } from '../../platform/registry/errors.js';

/**
 * F-29 · REQ-37 · US-37 · AC-37 — harness adapter packaging gate.
 *
 * Layout is fixed by `D-119`: `eso/harness/{protocol,core,adapters,manifests}`. Each adapter has a
 * manifest declaring host · version · capabilities · entrypoint; a missing directory, manifest or
 * entrypoint is `MISSING_MANIFEST` (fail closed — the package is not publishable). `core` is
 * host-agnostic: a static scan rejects host-SDK imports and imports from `adapters/`.
 *
 * Build-time only: the scan never executes adapter code and never publishes.
 */

/** The required package layout, in declaration order. */
export const HARNESS_PACKAGE_COMPONENTS = ['protocol', 'core', 'adapters', 'manifests'] as const;

/** Hosts from `F-29` §2 step 1; Paseo/Orca are orchestrator adapters, not harness sources. */
export const HARNESS_HOSTS = ['cursor', 'antigravity', 'claude', 'codex', 'dsh', 'paseo', 'orca'] as const;

/** Protocol version every adapter manifest must agree with (bump on breaking change). */
export const HARNESS_PROTOCOL_VERSION = 'eso.event.v1';

/** Core package version every adapter manifest must agree with. */
export const HARNESS_CORE_VERSION = '0.1.0';

/** Repo-relative package root; callers pass an absolute directory. */
export const HARNESS_PACKAGE_RELATIVE = 'eso/harness';

/** Host SDK module prefixes/specifiers that must never appear in `core`. */
export const HOST_SDK_MODULES: ReadonlyArray<string> = [
    '@cursor/',
    'cursor-sdk',
    '@anthropic-ai/',
    '@openai/',
    'codex-sdk',
    '@codex/',
    '@antigravity/',
    '@deepseek-ai/',
    '@dsh/',
    'dsh-sdk',
    '@paseo/',
    '@orca/',
    'paseo-sdk',
    'orca-sdk',
];

export type PackagingViolationCode =
    | 'MISSING_MANIFEST'
    | 'UNSUPPORTED_HOST'
    | 'VERSION_MISMATCH'
    | 'CORE_IMPORTS_HOST_SDK';

export interface PackagingViolation {
    code: PackagingViolationCode;
    detail: string;
}

export interface CoreImportHit {
    file: string;
    line: number;
    module: string;
}

export interface AdapterReport {
    host: string;
    manifestPath: string;
    entrypoint: string | null;
    version: string | null;
    capabilities: string[];
    conformant: boolean;
}

export interface PackagingReport {
    root: string;
    components: Record<string, boolean>;
    adapters: AdapterReport[];
    coreImports: CoreImportHit[];
    violations: PackagingViolation[];
    /** Layout + manifests + core scan all pass. */
    conformant: boolean;
    /** Same gate as `conformant`; named for the publish step it blocks. */
    publishable: boolean;
}

const SCANNABLE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const SPECIFIER_PATTERN = /(?:\bfrom\s*|^\s*import\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

function walkFiles(directory: string, out: string[] = []): string[] {
    let entries: Dirent[];
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            walkFiles(path, out);
        } else if (entry.isFile() && SCANNABLE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
            // Conformance fixtures/tests may import a host SDK on purpose; they are not shipped core.
            if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
            out.push(path);
        }
    }
    return out;
}

/** True when the specifier is a host SDK or reaches into `adapters/` from `core`. */
export function isHostCoupledSpecifier(specifier: string): boolean {
    const module = specifier.trim();
    if (module === 'eso/harness/adapters' || module.startsWith('eso/harness/adapters/')) return true;
    if (module.replace(/^(\.\.?\/)+/, '').startsWith('adapters/')) return true;
    return HOST_SDK_MODULES.some((prefix) => module === prefix || module.startsWith(prefix));
}

export class HarnessPackagingService {
    constructor(private readonly root: string) {}

    /** Scan without throwing; every problem is a violation in the report. */
    async inspect(): Promise<PackagingReport> {
        const root = resolve(this.root);
        const violations: PackagingViolation[] = [];
        const components: Record<string, boolean> = {};

        if (!isDirectory(root)) {
            violations.push({ code: 'MISSING_MANIFEST', detail: `harness package root not found: ${root}` });
            for (const component of HARNESS_PACKAGE_COMPONENTS) components[component] = false;
            return {
                root,
                components,
                adapters: [],
                coreImports: [],
                violations,
                conformant: false,
                publishable: false,
            };
        }

        for (const component of HARNESS_PACKAGE_COMPONENTS) {
            const present = isDirectory(join(root, component));
            components[component] = present;
            if (!present) {
                violations.push({ code: 'MISSING_MANIFEST', detail: `missing component: ${component}/` });
            }
        }

        const coreImports = components.core ? this.scanCore(join(root, 'core')) : [];
        for (const hit of coreImports) {
            violations.push({
                code: 'CORE_IMPORTS_HOST_SDK',
                detail: `${hit.file}:${hit.line} imports ${hit.module}`,
            });
        }

        const adapters = components.manifests ? this.readAdapters(root, violations) : [];
        if (components.manifests && adapters.length === 0 && !violations.some((v) => v.code === 'UNSUPPORTED_HOST')) {
            violations.push({ code: 'MISSING_MANIFEST', detail: 'manifests/ has no adapter manifest' });
        }

        const conformant = violations.length === 0;
        return {
            root,
            components,
            adapters,
            coreImports,
            violations,
            conformant,
            publishable: conformant,
        };
    }

    /** Fail-closed gate: throws the first violation with its FRD code. */
    async assertConformant(): Promise<PackagingReport> {
        const report = await this.inspect();
        if (!report.conformant) {
            const first = report.violations[0];
            const extra = report.violations.length - 1;
            throw new PlatformError(
                first.code,
                extra > 0 ? `${first.detail} (+${extra} more violation${extra === 1 ? '' : 's'})` : first.detail,
            );
        }
        return report;
    }

    private scanCore(coreDir: string): CoreImportHit[] {
        const hits: CoreImportHit[] = [];
        for (const file of walkFiles(coreDir)) {
            let source = '';
            try {
                source = readFileSync(file, 'utf8');
            } catch {
                continue;
            }
            const lines = source.split(/\r?\n/);
            lines.forEach((line, index) => {
                for (const match of line.matchAll(SPECIFIER_PATTERN)) {
                    if (!isHostCoupledSpecifier(match[1])) continue;
                    hits.push({ file: relative(resolve(this.root), file), line: index + 1, module: match[1] });
                }
            });
        }
        return hits;
    }

    private readAdapters(root: string, violations: PackagingViolation[]): AdapterReport[] {
        const manifestsDir = join(root, 'manifests');
        const entries = readdirSync(manifestsDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .sort((a, b) => a.name.localeCompare(b.name));

        const adapters: AdapterReport[] = [];
        for (const entry of entries) {
            const host = entry.name.slice(0, -'.json'.length);
            const manifestPath = join(manifestsDir, entry.name);
            const report: AdapterReport = {
                host,
                manifestPath: relative(root, manifestPath),
                entrypoint: null,
                version: null,
                capabilities: [],
                conformant: false,
            };
            const before = violations.length;

            if (!(HARNESS_HOSTS as readonly string[]).includes(host)) {
                violations.push({ code: 'UNSUPPORTED_HOST', detail: `${host} is not in the host catalog` });
                adapters.push(report);
                continue;
            }

            let manifest: unknown;
            try {
                manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
            } catch {
                violations.push({ code: 'MISSING_MANIFEST', detail: `${report.manifestPath} is not valid JSON` });
                adapters.push(report);
                continue;
            }
            if (!isRecord(manifest)) {
                violations.push({ code: 'MISSING_MANIFEST', detail: `${report.manifestPath} must be an object` });
                adapters.push(report);
                continue;
            }

            if (String(manifest.host ?? '') !== host) {
                violations.push({
                    code: 'MISSING_MANIFEST',
                    detail: `${report.manifestPath}: host must be "${host}"`,
                });
            }
            const version = typeof manifest.version === 'string' ? manifest.version.trim() : '';
            if (!version) {
                violations.push({ code: 'MISSING_MANIFEST', detail: `${report.manifestPath}: version is required` });
            }
            report.version = version || null;

            const capabilities = Array.isArray(manifest.capabilities)
                ? manifest.capabilities.map((capability) => String(capability)).filter(Boolean)
                : [];
            if (capabilities.length === 0) {
                violations.push({
                    code: 'MISSING_MANIFEST',
                    detail: `${report.manifestPath}: capabilities must declare at least one capability`,
                });
            }
            report.capabilities = capabilities;

            const entrypoint = typeof manifest.entrypoint === 'string' ? manifest.entrypoint.trim() : '';
            if (!entrypoint) {
                violations.push({ code: 'MISSING_MANIFEST', detail: `${report.manifestPath}: entrypoint is required` });
            } else {
                const entryFile = isAbsolute(entrypoint) ? entrypoint : resolve(root, entrypoint);
                const insideRoot = !relative(root, entryFile).startsWith('..');
                if (!insideRoot || !isFile(entryFile)) {
                    violations.push({
                        code: 'MISSING_MANIFEST',
                        detail: `${report.manifestPath}: entrypoint not found: ${entrypoint}`,
                    });
                } else {
                    report.entrypoint = relative(root, entryFile);
                }
            }

            if (!isDirectory(join(root, 'adapters', host))) {
                violations.push({
                    code: 'MISSING_MANIFEST',
                    detail: `missing component: adapters/${host}/`,
                });
            }

            if (manifest.protocolVersion !== undefined && String(manifest.protocolVersion) !== HARNESS_PROTOCOL_VERSION) {
                violations.push({
                    code: 'VERSION_MISMATCH',
                    detail: `${report.manifestPath}: protocolVersion ${String(manifest.protocolVersion)} != ${HARNESS_PROTOCOL_VERSION}`,
                });
            }
            if (manifest.coreVersion !== undefined && String(manifest.coreVersion) !== HARNESS_CORE_VERSION) {
                violations.push({
                    code: 'VERSION_MISMATCH',
                    detail: `${report.manifestPath}: coreVersion ${String(manifest.coreVersion)} != ${HARNESS_CORE_VERSION}`,
                });
            }

            report.conformant = violations.length === before;
            adapters.push(report);
        }
        return adapters;
    }
}
