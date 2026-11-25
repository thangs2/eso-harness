import { ChangeDetectionStrategy, Component, OnInit, ViewEncapsulation, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import { WorkersSettingsComponent } from '../components/workers-settings.component.js';
import { WorkerOverviewComponent } from '../components/worker-overview.component.js';
import { KnowledgeOverviewComponent } from '../components/knowledge-overview.component.js';
import { BoundariesPanelComponent } from '../components/boundaries-panel.component.js';
import { ObservationPanelComponent } from '../components/observation-panel.component.js';
import { ProfilePanelComponent } from '../components/profile-panel.component.js';
import { StackTabComponent } from '../components/stack-tab.component.js';
import { HostsTabComponent } from '../components/hosts-tab.component.js';
import { KnowledgeTabComponent } from '../components/knowledge-tab.component.js';
import type { ConsumerProfileFields } from '../components/profile-panel.component.js';
import {
    HOST_TYPE_LABELS,
    LEGACY_HOST_PLUGIN_KEY,
    defaultPlugins,
    defaultStackLayers,
    defaultWorkerPolicy,
    defaultWorkers,
    splitList,
} from './consumer-settings.models.js';
import type { HostProfile, LayerId, LegacyHostProfile, PluginEntry, StackLayer, StackVersion, StackVersionStatus, WorkerEdge, WorkerEntry } from './consumer-settings.models.js';
import type { ConsumerProfile, HostDto, KnowledgeSummaryDto, KnowledgeDocDto, KnowledgeFindingDto, KnowledgeDocDetailDto, KnowledgeCheckDto, KnowledgeRetrievalDto, KnowledgeEmbeddingStatusDto, McpProviderDto, WorkerConfigDto, EvidenceRequirementDto, FlowSummaryDto, FlowDefinitionDto, HostRuntimeDto, LegacyHarnessReportDto, HarnessMigrationPreviewDto } from '../../../../../../../libs/api-client/types.js';

/**
 * Only remaining occurrence of the pre-P0.3 host-binding key: settings saved by an older UI.
 * They are migrated to `hostId` once on load; everything new reads and writes `hostId` only.
 * The API, host discovery, and worker bindings all use `hostId`.
 */
import { SettingsStackBase } from './settings-stack.base.js';
export abstract class SettingsHostsBase extends SettingsStackBase {
closeRuleImport(): void {
        this.ruleImportPreview.set(null);
        this.ruleSelectedHashes.set([]);
        this.ruleImportActions.set({});
    }

updateLayer(id: LayerId, field: 'enabled' | 'required' | 'allowedSources', value: unknown): void {
        if (!this.isStackEditable()) return;
        this.stackLayers.update((layers) => layers.map((layer) => (layer.id === id ? { ...layer, [field]: value } : layer)));
        this.persistActiveLayers();
    }

managedProfilesFor(userId: string): HostProfile[] {
        return this.hostProfiles().filter((profile) => profile.userId === userId && !profile.detected);
    }

hostProfileCount(userId: string): string {
        const count = this.managedProfilesFor(userId).length;
        return `${count} host binding${count === 1 ? '' : 's'}`;
    }

toggleProfile(profileId: string): void {
        this.expandedProfile.set(this.expandedProfile() === profileId ? null : profileId);
    }

effectiveLayers(profile: HostProfile): Array<{ id: string; label: string; value: string; scope: string }> {
        const stack = this.layersForVersion(profile.stackVersion);
        const layer = (id: LayerId) => stack.find((item) => item.id === id);
        const memory = !this.isResolutionLayerEnabled('memory', profile.stackVersion) ? 'Disabled by Stack' : (profile.memoryProvider ? `${profile.memorySource} · ${profile.memoryProvider}` : profile.memorySource);
        const codeGraph = !this.isResolutionLayerEnabled('codeGraph', profile.stackVersion) ? 'Disabled by Stack' : (profile.codeGraphProvider ? `${profile.codeGraphSource} · ${profile.codeGraphProvider}` : profile.codeGraphSource);
        return [
            { id: 'multiAgent', label: 'Multi-agent', value: `${this.workers().length} workers · ${this.workerRoleCount()} roles`, scope: 'stack' },
            { id: 'rules', label: 'Rules', value: (layer('rules')?.files ?? 0) + ' files', scope: 'stack' },
            { id: 'skills', label: 'Skills', value: (layer('skills')?.files ?? 0) + ' files', scope: 'stack' },
            { id: 'hooks', label: 'Hooks', value: (layer('hooks')?.files ?? 0) + ' files', scope: 'stack' },
            { id: 'memory', label: 'Memory', value: memory, scope: this.isResolutionLayerEnabled('memory', profile.stackVersion) ? 'resolved' : 'disabled' },
            { id: 'codeGraph', label: 'Code graph', value: codeGraph, scope: this.isResolutionLayerEnabled('codeGraph', profile.stackVersion) ? 'resolved' : 'disabled' },
            { id: 'documentGraph', label: 'Document graph', value: 'ESO-only · Postgres', scope: 'stack' },
            { id: 'topology', label: 'Topology', value: 'Deferred', scope: 'stack' },
            { id: 'material', label: 'Material', value: 'rules · skills · hooks', scope: 'stack' },
        ];
    }

unmanagedHosts(): Array<{ hostId: string; label: string; markers: string[] }> {
        return this.detectedHosts().filter((host) => !this.hostProfiles().some((profile) => profile.hostId === host.hostId));
    }

manageDetectedHost(hostId: string): void {
        if (!this.hostAvailable(hostId)) { this.error.set('No active host runtime. Register it in Hosts first.'); this.openHosts(); return; }
        const userId = this.developers()[0] || 'operator';
        this.developers.update((developers) => (developers.includes(userId) ? developers : [...developers, userId]));
        if (this.hostProfiles().some((profile) => profile.userId === userId && profile.hostId === hostId)) return;
        const resolution = this.hostResolution(hostId);
        this.hostProfiles.update((profiles) => [...profiles, {
            id: `hp-${Date.now()}`, userId, hostId, stackVersion: this.newStackVersion(),
            flowId: this.newFlowId() || undefined, flowVersion: this.newFlowId() ? this.newFlowVersion() : undefined,
            ...resolution,
            mcpConfigSource: this.mcpSourceForHost(hostId), installState: 'pending', detected: false,
        }]);
    }

startNewBinding(): void {
        if (this.activeHosts().length === 0) { this.error.set('Register an active host runtime in Hosts first.'); return; }
        this.editingProfile.set(null);
        this.addingHostFor.set('__new');
        this.bindingDeveloper.set('');
        this.newStackVersion.set(this.latestPublishedVersion());
        this.newFlowId.set('');
        this.newFlowVersion.set(1);
        this.useHostDefaults();
    }

startAddHost(userId: string): void {
        if (this.activeHosts().length === 0) { this.error.set('Register an active host runtime in Hosts first.'); return; }
        this.editingProfile.set(null);
        this.addingHostFor.set(userId);
        this.bindingDeveloper.set(userId);
        this.newStackVersion.set(this.latestPublishedVersion());
        this.newFlowId.set('');
        this.newFlowVersion.set(1);
        this.useHostDefaults();
    }

changeHost(hostId: string): void {
        this.newHostId.set(hostId);
        this.useHostDefaults();
    }

useHostDefaults(): void {
        const resolution = this.hostResolution(this.newHostId(), this.newStackVersion());
        this.newMemorySource.set(resolution.memorySource);
        this.newMemoryProvider.set(resolution.memoryProvider || '');
        this.newCodeGraphSource.set(resolution.codeGraphSource);
        this.newCodeGraphProvider.set(resolution.codeGraphProvider || '');
    }

agentCapabilities(): Array<{ id: string; label: string; value: string }> {
        return this.inheritedCapabilities().filter((item) => ['multiAgent', 'rules', 'skills', 'hooks'].includes(item.id));
    }

graphCapabilities(): Array<{ id: string; label: string; value: string }> {
        return this.inheritedCapabilities().filter((item) => ['documentGraph', 'topology'].includes(item.id));
    }

inheritedCapabilities(): Array<{ id: string; label: string; value: string }> {
        const layers = this.layersForVersion(this.newStackVersion());
        const layer = (id: LayerId) => layers.find((item) => item.id === id);
        return [
            { id: 'multiAgent', label: 'Multi-agent / SLP', value: `${this.workers().length} workers · ${this.workerRoleCount()} roles` },
            { id: 'rules', label: 'Rules / law', value: `${layer('rules')?.files ?? 0} files` },
            { id: 'skills', label: 'Skills', value: `${layer('skills')?.files ?? 0} files` },
            { id: 'hooks', label: 'Hooks', value: `${layer('hooks')?.files ?? 0} files` },
            { id: 'documentGraph', label: 'Document graph', value: 'ESO-only · Postgres · graph schema' },
            { id: 'topology', label: 'Topology', value: 'Deferred' },
            { id: 'material', label: 'Material', value: 'rules · skills · hooks' },
        ];
    }

startEditHost(profile: HostProfile): void {
        this.editingProfile.set(profile.id);
        this.addingHostFor.set(profile.userId);
        this.bindingDeveloper.set(profile.userId);
        this.newHostId.set(profile.hostId);
        this.newStackVersion.set(profile.stackVersion);
        this.newFlowId.set(profile.flowId || '');
        this.newFlowVersion.set(profile.flowVersion || 1);
        this.newMemorySource.set(profile.memorySource);
        this.newMemoryProvider.set(profile.memoryProvider || '');
        this.newCodeGraphSource.set(profile.codeGraphSource);
        this.newCodeGraphProvider.set(profile.codeGraphProvider || '');
    }

saveHostBinding(): void {
        if (!this.hostAvailable(this.newHostId())) { this.error.set('Selected host is not registered or offline.'); return; }
        const editing = this.editingProfile();
        const developer = this.bindingDeveloper().trim();
        if (!developer) return;
        if (!this.developers().includes(developer)) {
            this.developers.update((developers) => [...developers, developer]);
        }
        if (editing) {
            this.hostProfiles.update((profiles) => profiles.map((profile) => profile.id === editing ? {
                ...profile,
                stackVersion: this.newStackVersion(),
                flowId: this.newFlowId() || undefined,
                flowVersion: this.newFlowId() ? this.newFlowVersion() : undefined,
                memorySource: this.newMemorySource(),
                memoryProvider: this.newMemorySource() === 'market' ? this.newMemoryProvider() : undefined,
                codeGraphSource: this.newCodeGraphSource(),
                codeGraphProvider: this.newCodeGraphSource() === 'market' ? this.newCodeGraphProvider() : undefined,
                mcpConfigSource: this.mcpSourceForHost(profile.hostId),
            } : profile));
            this.cancelAddHost();
            return;
        }
        this.addHostToDeveloper(developer);
    }

protected hostResolution(hostId: string, stackVersion = this.newStackVersion()): { memorySource: string; memoryProvider?: string; codeGraphSource: string; codeGraphProvider?: string } {
        const layers = this.layersForVersion(stackVersion);
        const policy = (id: LayerId) => layers.find((layer) => layer.id === id);
        const resolve = (id: LayerId, hostNative: boolean): { source: string; provider?: string } => {
            const layer = policy(id);
            if (!layer?.enabled) return { source: 'none' };
            const allowed = layer.allowedSources?.length ? layer.allowedSources : this.policySources;
            const preferred = hostNative ? 'host-native' : 'eso-native';
            const source = allowed.includes(preferred) ? preferred : (allowed[0] || 'eso-native');
            const provider = source === 'market' ? this.marketProviders(id === 'memory' ? 'memory' : 'codeGraph')[0]?.id : undefined;
            return { source, provider };
        };
        const memory = resolve('memory', this.hostTypeFor(hostId) === 'dsh');
        const codeGraph = resolve('codeGraph', false);
        return {
            memorySource: memory.source,
            memoryProvider: memory.provider,
            codeGraphSource: codeGraph.source,
            codeGraphProvider: codeGraph.provider,
        };
    }

cancelAddHost(): void {
        this.addingHostFor.set(null);
        this.editingProfile.set(null);
    }

askRemoveDeveloper(userId: string): void {
        this.removingDeveloper.set(userId);
    }

cancelRemoveDeveloper(): void {
        this.removingDeveloper.set(null);
    }

removeDeveloper(userId: string): void {
        this.developers.update((developers) => developers.filter((developer) => developer !== userId));
        this.hostProfiles.update((profiles) => profiles.filter((profile) => profile.userId !== userId));
        if (this.addingHostFor() === userId) this.addingHostFor.set(null);
        this.removingDeveloper.set(null);
    }

hostSourcesSummary(profile: HostProfile): string {
        const memory = this.isResolutionLayerEnabled('memory', profile.stackVersion) ? `Memory ${profile.memorySource}` : 'Memory disabled';
        const code = this.isResolutionLayerEnabled('codeGraph', profile.stackVersion) ? `Code ${profile.codeGraphSource}` : 'Code disabled';
        return `${memory} · ${code}`;
    }

resolutionSummary(profile: HostProfile): string {
        if (!this.isResolutionLayerEnabled('memory', profile.stackVersion) && !this.isResolutionLayerEnabled('codeGraph', profile.stackVersion)) return 'disabled';
        const parts: string[] = [];
        if (profile.memoryProvider) parts.push('memory: ' + profile.memoryProvider);
        if (profile.codeGraphProvider) parts.push('code: ' + profile.codeGraphProvider);
        if (profile.memorySource === 'market' && !profile.memoryProvider) parts.push('memory: missing provider');
        if (profile.codeGraphSource === 'market' && !profile.codeGraphProvider) parts.push('code: missing provider');
        return parts.length ? parts.join(' · ') : 'auto';
    }

mcpSourceForHost(hostId: string): string {
        const hostType = this.hostTypeFor(hostId);
        const sources: Record<string, string> = {
            cursor: '.cursor/mcp.json',
            agy: '.agents/mcp_config.json',
            claude: '.claude/settings.json',
            dsh: 'plugin config',
            paseo: 'plugin config',
            orca: 'plugin config',
        };
        return sources[hostType] || sources[hostId] || 'host config';
    }

addHostToDeveloper(userId: string): void {
        const hostId = this.newHostId();
        if (!hostId) return;
        if (!this.hostAvailable(hostId)) { this.error.set('Selected host is not registered or offline.'); return; }
        const exists = this.hostProfiles().some((profile) => profile.userId === userId && profile.hostId === hostId);
        if (exists) return;
        this.hostProfiles.update((profiles) => [...profiles, {
            id: `hp-${Date.now()}`, userId, hostId, stackVersion: this.newStackVersion(),
            memorySource: this.newMemorySource(),
            memoryProvider: this.newMemorySource() === 'market' ? this.newMemoryProvider() : undefined,
            codeGraphSource: this.newCodeGraphSource(),
            codeGraphProvider: this.newCodeGraphSource() === 'market' ? this.newCodeGraphProvider() : undefined,
            mcpConfigSource: this.mcpSourceForHost(hostId),
            installState: 'pending', detected: false,
        }]);
        this.addingHostFor.set(null);
    }

removeHostProfile(id: string): void {
        this.hostProfiles.update((profiles) => profiles.filter((profile) => profile.id !== id));
        this.formationHostIds.update((ids) => ids.filter((item) => item !== id));
        this.workers.update((workers) => workers.map((worker) => ({
            ...worker,
            hostBindingIds: worker.hostBindingIds.filter((item) => item !== id),
        })));
        if (this.editingProfile() === id) this.cancelAddHost();
    }

nextTab(): void {
        const index = this.tabs.findIndex((tab) => tab.id === this.activeTab());
        if (index >= 0 && index < this.tabs.length - 1) this.selectTab(this.tabs[index + 1].id);
    }

finish(): void {
        this.finishing.set(true);
        this.save(true);
    }

selectTab(id: string): void {
        this.activeTab.set(id);
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tab: id, section: id === 'knowledge' ? this.knowledgeSection() : null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }

openConsumerPlugins(): void {
        void this.router.navigate(['/consumers', this.consumerId, 'plugins']);
    }

setProviderRoute(area: 'work' | 'design' | 'content', provider: string): void {
        this.providerRouting.update((routing) => ({ ...routing, [area]: provider }));
        if (area === 'work') this.jiraEnabled.set(provider === 'jira');
    }

providerStatus(providerId: string): string {
        const plugin = this.consumerPlugins().find((item) => item.id === providerId);
        return plugin?.health || (plugin?.enabled ? 'enabled' : 'not configured');
    }

openFlows(): void {
        void this.router.navigate(['/consumers', this.consumerId, 'flows']);
    }

switchConsumer(id: string): void {
        if (!id || id === this.consumerId) return;
        const tab = this.activeTab();
        void this.router.navigate(['/consumers', id, 'settings'], { queryParams: tab === 'profile' ? {} : { tab } });
    }
}
