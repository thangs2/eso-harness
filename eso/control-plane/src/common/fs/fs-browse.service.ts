import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface FsDirectoryEntry {
    name: string;
    path: string;
}

export interface FsBrowseResult {
    path: string;
    parent: string | null;
    directories: FsDirectoryEntry[];
}

/**
 * Local control plane filesystem browser.
 *
 * The control plane runs on the operator host (not in a container), so this service can see the
 * same paths as the browser's operator. It exposes directories only and confines every request to
 * ESO_FS_ROOT (default: the host user's home directory).
 */
@Injectable()
export class FsBrowseService {
    private readonly configuredRoot: string;

    constructor() {
        this.configuredRoot = resolve(process.env.ESO_FS_ROOT || homedir());
    }

    async list(input?: string): Promise<FsBrowseResult> {
        const root = await this.realDirectory(this.configuredRoot);
        const requested = input && input.trim() ? input.trim() : root;
        if (!isAbsolute(requested)) {
            throw new ForbiddenException({
                type: 'https://eso.dev/errors/bad-request',
                title: 'Bad Request',
                status: 400,
                code: 'INVALID_PATH',
                detail: 'Path must be absolute',
            });
        }

        const target = await this.realDirectory(requested);
        const rel = relative(root, target);
        if (rel === '..' || rel.startsWith(`..${sep}`)) {
            throw new ForbiddenException({
                type: 'https://eso.dev/errors/forbidden',
                title: 'Forbidden',
                status: 403,
                code: 'PATH_OUTSIDE_ROOT',
                detail: `Path is outside ESO_FS_ROOT (${root})`,
            });
        }

        const dirents = await readdir(target, { withFileTypes: true });
        const directories: FsDirectoryEntry[] = dirents
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({ name: entry.name, path: resolve(target, entry.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return {
            path: target,
            parent: target === root ? null : dirname(target),
            directories,
        };
    }

    private async realDirectory(path: string): Promise<string> {
        try {
            const real = await realpath(path);
            const info = await stat(real);
            if (!info.isDirectory()) throw new Error('not a directory');
            return real;
        } catch {
            throw new NotFoundException({
                type: 'https://eso.dev/errors/not-found',
                title: 'Not Found',
                status: 404,
                code: 'ROOT_NOT_FOUND',
                detail: `Directory does not exist: ${path}`,
            });
        }
    }
}
