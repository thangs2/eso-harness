import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectedHost {
    hostPluginId: string;
    label: string;
    markers: string[];
}

export interface HostDiscoveryResult {
    consumerId: string;
    root: string;
    detected: DetectedHost[];
}

const HOST_MARKERS = [
    { hostPluginId: 'cursor', label: 'Cursor', paths: ['.cursor'] },
    { hostPluginId: 'agy', label: 'Antigravity', paths: ['.agents'] },
    { hostPluginId: 'claude', label: 'Claude', paths: ['.claude', 'CLAUDE.md'] },
    { hostPluginId: 'dsh', label: 'DSH', paths: ['AGENTS.local.md'] },
    { hostPluginId: 'codex', label: 'Codex', paths: ['.codex'] },
    { hostPluginId: 'paseo', label: 'Paseo', paths: ['.paseo'] },
    { hostPluginId: 'orca', label: 'Orca', paths: ['.orca'] },
];

export class HostDiscoveryService {
    discover(consumerId: string, root: string): HostDiscoveryResult {
        const detected: DetectedHost[] = [];
        for (const host of HOST_MARKERS) {
            const markers = host.paths.filter((path) => existsSync(join(root, path)));
            if (markers.length > 0) {
                detected.push({ hostPluginId: host.hostPluginId, label: host.label, markers });
            }
        }
        return { consumerId, root, detected };
    }
}
