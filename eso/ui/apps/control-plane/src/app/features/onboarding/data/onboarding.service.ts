import { Injectable, Optional, Inject } from '@angular/core';
import { CONTROL_PLANE_API_CLIENT } from '../../../core/tokens.js';
import type { ConsumerOption, ProvisioningPreview, ProvisioningSuccess } from '../models/onboarding.model.js';
import type { ConsumerSummary } from '../../../../../../../libs/api-client/types.js';
import type { ControlPlaneApiClient } from '../../../../../../../libs/api-client/client.js';

@Injectable({
    providedIn: 'root',
})
export class OnboardingService {
    private readonly apiClient: ControlPlaneApiClient | null;

    constructor(@Optional() @Inject(CONTROL_PLANE_API_CLIENT) client?: ControlPlaneApiClient | null) {
        this.apiClient = client ?? null;
    }

    async loadReadyConsumers(): Promise<ConsumerOption[]> {
        if (!this.apiClient) {
            return [];
        }

        const res = await this.apiClient.listConsumers();
        const items = res.items || [];

        return items
            .filter((c: ConsumerSummary) => c.status === 'ready')
            .map((c: ConsumerSummary) => ({
                id: c.id,
                name: c.name || c.id,
                root: c.root || '',
                status: c.status,
            }));
    }

    derivePreview(consumer: ConsumerOption): ProvisioningPreview {
        return {
            consumerId: consumer.id,
            name: consumer.name,
            root: consumer.root,
            schemaName: `c_${consumer.id}`,
            materialBundle: [
                'AGENTS.md',
                'agents/',
                '.harness/config.json',
                '.harness/manifest.json',
            ],
        };
    }

    async provision(consumerId: string): Promise<ProvisioningSuccess> {
        if (!this.apiClient) {
            throw new Error('API client is not configured');
        }

        // Step 1: Provision schema + material + setup state
        const provRes = await this.apiClient.provisionConsumer(consumerId);

        // Step 2: Read back real setup state (no fake done)
        const setupRes = await this.apiClient.getConsumerSetup(consumerId);

        return {
            consumerId,
            status: provRes.status,
            schema: provRes.schema,
            ready: setupRes.setup.ready,
            updatedAt: setupRes.setup.updatedAt || provRes.setup.updated_at,
        };
    }
}
