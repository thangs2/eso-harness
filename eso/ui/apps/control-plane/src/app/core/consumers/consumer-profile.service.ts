import { Injectable, inject } from '@angular/core';
import { CONTROL_PLANE_API_CLIENT } from '../tokens.js';
import type { ConsumerListResponse, ConsumerPlan, ConsumerProfile, FsBrowseResponse, HostDiscoveryDto, McpDiscoveryDto, SetupConsumerPayload, StackVersionsDto } from '../../../../../../libs/api-client/types.js';

@Injectable({ providedIn: 'root' })
export class ConsumerProfileService {
    private readonly client = inject(CONTROL_PLANE_API_CLIENT, { optional: true });

    list(): Promise<ConsumerListResponse> {
        if (!this.client) return Promise.resolve({ items: [] });
        return this.client.listConsumers();
    }

    get(project: string): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumer(project);
    }

    plan(profile: ConsumerProfile): Promise<ConsumerPlan> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.planConsumer(profile);
    }

    getStackVersions(id: string): Promise<StackVersionsDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerStackVersions(id);
    }

    saveStackVersions(id: string, versions: unknown[]): Promise<StackVersionsDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.saveConsumerStackVersions(id, versions);
    }

    getHosts(id: string): Promise<HostDiscoveryDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerHosts(id);
    }

    getMcp(id: string): Promise<McpDiscoveryDto> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.getConsumerMcp(id);
    }

    listDirectories(path?: string): Promise<FsBrowseResponse> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.browseDirectories(path);
    }

    createSetup(payload: SetupConsumerPayload): Promise<{ id: string }> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.createConsumerSetup(payload);
    }

    create(profile: ConsumerProfile): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.createConsumer(profile);
    }

    updateSettings(
        id: string,
        name: string,
        profile: Record<string, unknown>,
        expectedVersion: number
    ): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.updateConsumerProfile(id, { name, profile, expected_version: expectedVersion });
    }

    update(project: string, profile: ConsumerProfile): Promise<ConsumerProfile> {
        if (!this.client) throw new Error('API client is not configured');
        return this.client.updateConsumer(project, profile);
    }
}
