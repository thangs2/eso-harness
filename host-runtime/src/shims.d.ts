/**
 * Minimal ambient declarations for the few Node builtins this package uses.
 *
 * The package intentionally has ZERO npm dependencies — including `@types/node` and `bun-types`.
 * TypeScript therefore gets these local declarations instead of pulling `node_modules`.
 * Only the surface actually used by `src/**` is declared here; this is not general Node typing.
 */

declare const process: {
    argv: string[];
    env: Record<string, string | undefined>;
    exitCode: number | undefined;
    pid: number;
    cwd(): string;
    exit(code?: number): never;
    platform: string;
    stdout: { write(chunk: string): boolean };
    stderr: { write(chunk: string): boolean };
    on(event: string, listener: (...args: any[]) => void): unknown;
};

interface ImportMeta {
    /** Bun sets this to true only for the process entry file. */
    readonly main?: boolean;
}

declare module 'node:child_process' {
    export interface ReadableStreamLike {
        setEncoding(encoding: string): void;
        on(event: 'data', listener: (chunk: string) => void): void;
        on(event: 'error', listener: (error: Error) => void): void;
    }

    export interface SpawnOptions {
        cwd?: string;
        env?: Record<string, string | undefined>;
        stdio?: string | string[];
    }

    export interface ChildProcessLike {
        pid?: number;
        stdout: ReadableStreamLike | null;
        stderr: ReadableStreamLike | null;
        kill(signal?: string): boolean;
        on(event: 'close', listener: (code: number | null, signal: string | null) => void): void;
        on(event: 'error', listener: (error: Error) => void): void;
    }

    export function spawn(command: string, args: string[], options?: SpawnOptions): ChildProcessLike;
}

declare module 'node:fs' {
    export interface StatsLike {
        mode: number;
        mtimeMs: number;
        isFile(): boolean;
        isDirectory(): boolean;
    }

    export function existsSync(path: string): boolean;
    export function statSync(path: string): StatsLike;
    export function readFileSync(path: string, encoding: 'utf8'): string;
    export function writeFileSync(
        path: string,
        data: string,
        options?: 'utf8' | { encoding?: 'utf8'; mode?: number },
    ): void;
    export function appendFileSync(
        path: string,
        data: string,
        options?: 'utf8' | { encoding?: 'utf8'; mode?: number },
    ): void;
    export function chmodSync(path: string, mode: number): void;
    export function renameSync(oldPath: string, newPath: string): void;
    export function readdirSync(path: string): string[];
    export function realpathSync(path: string): string;
    export function mkdtempSync(prefix: string): string;
    export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): string | undefined;
    export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module 'node:path' {
    export const sep: string;
    export function join(...parts: string[]): string;
    export function resolve(...parts: string[]): string;
    export function dirname(path: string): string;
    export function basename(path: string): string;
    export function isAbsolute(path: string): boolean;
}

declare module 'node:os' {
    export function homedir(): string;
    export function platform(): string;
    export function tmpdir(): string;
}

declare const Bun: {
    spawn(argv: string[], options?: { cwd?: string; env?: Record<string, string | undefined> }): {
        exited: Promise<number>;
    };
    write(path: string, data: string): Promise<number>;
    serve(options: {
        port?: number;
        hostname?: string;
        maxRequestBodySize?: number;
        fetch: (request: Request) => Promise<Response> | Response;
    }): {
        port: number;
        hostname: string;
        url: URL;
        stop(force?: boolean): Promise<void> | void;
    };
};

declare module 'bun:test' {
    export function describe(label: string, fn: () => void | Promise<void>): void;
    export function it(label: string, fn: () => void | Promise<void>): void;
    export const test: typeof it;
    export function beforeEach(fn: () => void | Promise<void>): void;
    export function afterEach(fn: () => void | Promise<void>): void;
    export function expect(actual: any): any;
}
