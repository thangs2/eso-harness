export type PathType = 'file' | 'directory' | 'glob';
export type ReadMode = 'allow' | 'deny';
export type WriteMode = 'allow' | 'bypass' | 'gated' | 'warn' | 'deny';

export interface FolderPolicy {
    id: string;
    path: string;
    pathType: PathType;
    read: ReadMode;
    write: WriteMode;
    index: boolean;
    priority: number;
    reason?: string;
}

export const DEFAULT_POLICIES: readonly FolderPolicy[] = [
    { id: 'default-sdlc', path: 'SDLC/**', pathType: 'glob', read: 'allow', write: 'bypass', index: true, priority: 100 },
    { id: 'default-sdlc-lower', path: 'sdlc/**', pathType: 'glob', read: 'allow', write: 'bypass', index: true, priority: 100 },
    { id: 'default-scripts', path: 'scripts/**', pathType: 'glob', read: 'allow', write: 'bypass', index: false, priority: 90 },
    { id: 'default-deploy', path: 'deploy/**', pathType: 'glob', read: 'allow', write: 'bypass', index: false, priority: 90 },
    { id: 'default-agents', path: 'agents/**', pathType: 'glob', read: 'allow', write: 'bypass', index: true, priority: 90 },
    { id: 'default-hooks', path: 'agents/hooks/**', pathType: 'glob', read: 'allow', write: 'gated', index: false, priority: 110 },
    { id: 'default-cursor', path: '.cursor/**', pathType: 'glob', read: 'allow', write: 'bypass', index: false, priority: 80 },
    { id: 'default-agents-tree', path: '.agents/**', pathType: 'glob', read: 'allow', write: 'bypass', index: false, priority: 80 },
    { id: 'default-agents-md', path: 'AGENTS.md', pathType: 'file', read: 'allow', write: 'gated', index: true, priority: 120 },
    { id: 'default-root-md', path: '*.md', pathType: 'glob', read: 'allow', write: 'bypass', index: true, priority: 60 },
    { id: 'default-markdown', path: '**/*.md', pathType: 'glob', read: 'allow', write: 'bypass', index: true, priority: 60 },
    { id: 'default-root-mdc', path: '*.mdc', pathType: 'glob', read: 'allow', write: 'bypass', index: true, priority: 60 },
    { id: 'default-mdc', path: '**/*.mdc', pathType: 'glob', read: 'allow', write: 'bypass', index: true, priority: 60 },
    { id: 'default-harness-runtime', path: '.harness/runtime/**', pathType: 'glob', read: 'allow', write: 'bypass', index: false, priority: 90 },
    { id: 'default-harness-config', path: '.harness/config.json', pathType: 'file', read: 'allow', write: 'deny', index: false, priority: 130 },
    { id: 'default-harness-manifest', path: '.harness/manifest.json', pathType: 'file', read: 'allow', write: 'deny', index: false, priority: 130 },
    { id: 'default-data-lake', path: 'data-lake/**', pathType: 'glob', read: 'allow', write: 'gated', index: false, priority: 100 },
    { id: 'default-git', path: '.git/**', pathType: 'glob', read: 'allow', write: 'deny', index: false, priority: 200 },
    { id: 'default-secrets', path: '.env*', pathType: 'glob', read: 'deny', write: 'deny', index: false, priority: 200 },
    { id: 'default-credentials', path: '**/credentials*', pathType: 'glob', read: 'deny', write: 'deny', index: false, priority: 200 },
    { id: 'default-pem', path: '**/*.pem', pathType: 'glob', read: 'deny', write: 'deny', index: false, priority: 200 },
    { id: 'default-node-modules', path: 'node_modules/**', pathType: 'glob', read: 'allow', write: 'deny', index: false, priority: 150 },
    { id: 'default-dist', path: 'dist/**', pathType: 'glob', read: 'allow', write: 'deny', index: false, priority: 150 },
    { id: 'default-outside', path: '**', pathType: 'glob', read: 'deny', write: 'deny', index: false, priority: -1 },
];
