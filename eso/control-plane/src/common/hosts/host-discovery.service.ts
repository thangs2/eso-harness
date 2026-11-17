import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectedHost {
    hostId: string;
    label: string;
    markers: string[];
}

export interface HostDiscoveryResult {
    consumerId: string;
    root: string;
    detected: DetectedHost[];
}

const HOST_MARKERS = [
    { hostId: 'cursor', label: 'Cursor', paths: ['.cursor'] },
    { hostId: 'agy', label: 'Antigravity', paths: ['.agents'] },
    { hostId: 'claude', label: 'Claude', paths: ['.claude', 'CLAUDE.md'] },
    { hostId: 'dsh', label: 'DSH', paths: ['AGENTS.local.md'] },
    { hostId: 'codex', label: 'Codex', paths: ['.codex'] },
    { hostId: 'paseo', label: 'Paseo', paths: ['.paseo'] },
    { hostId: 'orca', label: 'Orca', paths: ['.orca'] },
];

export class HostDiscoveryService {
    discover(consumerId: string, root: string): HostDiscoveryResult {
        const detected: DetectedHost[] = [];
        for (const host of HOST_MARKERS) {
            const markers = host.paths.filter((path) => existsSync(join(root, path)));
            if (markers.length > 0) {
                detected.push({ hostId: host.hostId, label: host.label, markers });
            }
        }
        return { consumerId, root, detected };
    }
}
