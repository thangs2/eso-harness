import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface McpProvider {
    id: string;
    label: string;
    capabilities: string[];
    source: string;
    status: 'configured';
}

export interface McpDiscoveryResult {
    consumerId: string;
    root: string;
    sources: string[];
    providers: McpProvider[];
    warnings: string[];
}

const CANDIDATES = [
    { path: '.cursor/mcp.json', source: '.cursor/mcp.json' },
    { path: '.agents/mcp_config.json', source: '.agents/mcp_config.json' },
    { path: 'mcp.json', source: 'mcp.json' },
    { path: 'mcp_config.json', source: 'mcp_config.json' },
    { path: '.mcp.json', source: '.mcp.json' },
];

/**
 * Reads MCP configuration that already exists in the consumer repository.
 * It never invents providers and never writes MCP configuration.
 */
export class McpDiscoveryService {
    discover(consumerId: string, root: string): McpDiscoveryResult {
        const sources: string[] = [];
        const warnings: string[] = [];
        const byId = new Map<string, McpProvider>();

        for (const candidate of CANDIDATES) {
            const file = join(root, candidate.path);
            if (!existsSync(file)) continue;

            let parsed: unknown;
            try {
                parsed = JSON.parse(readFileSync(file, 'utf8'));
            } catch (error) {
                warnings.push(`${candidate.source}: ${(error as Error).message}`);
                continue;
            }

            const servers = this.serversOf(parsed);
            if (!servers) {
                warnings.push(`${candidate.source}: no mcpServers map`);
                continue;
            }

            sources.push(candidate.source);
            for (const [id, config] of Object.entries(servers)) {
                const capabilities = this.classify(id, config);
                if (capabilities.length === 0) continue;
                const existing = byId.get(id);
                if (existing) {
                    existing.capabilities = [...new Set([...existing.capabilities, ...capabilities])];
                    existing.source = `${existing.source}, ${candidate.source}`;
                } else {
                    byId.set(id, {
                        id,
                        label: id,
                        capabilities,
                        source: candidate.source,
                        status: 'configured',
                    });
                }
            }
        }

        return {
            consumerId,
            root,
            sources,
            providers: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
            warnings,
        };
    }

    private serversOf(value: unknown): Record<string, unknown> | null {
        if (!value || typeof value !== 'object') return null;
        const record = value as Record<string, unknown>;
        const servers = record.mcpServers ?? record.servers;
        return servers && typeof servers === 'object' ? (servers as Record<string, unknown>) : null;
    }

    private classify(id: string, config: unknown): string[] {
        const text = `${id} ${JSON.stringify(config ?? {})}`.toLowerCase();
        const capabilities = new Set<string>();
        if (text.includes('memory')) capabilities.add('memory');
        if (text.includes('codegraph') || text.includes('code-graph') || text.includes('code_graph')) capabilities.add('code-graph');
        if (text.includes('docgraph') || text.includes('document')) capabilities.add('document-graph');
        if (text.includes('graphify') || text.includes('topology')) capabilities.add('topology');
        return [...capabilities];
    }
}
