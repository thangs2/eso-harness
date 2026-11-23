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
import { SettingsCoreBase } from './settings-core.base.js';
export abstract class SettingsStackBase extends SettingsCoreBase {
layersForVersion(version: number): StackLayer[] {
        return this.stackVersions().find((item) => item.version === version)?.layers || defaultStackLayers();
    }

stackStatus(): StackVersionStatus {
        return this.stackVersions().find((item) => item.version === this.activeStackVersion())?.status || 'draft';
    }

isStackEditable(): boolean {
        return this.stackStatus() === 'draft';
    }

publishedStackVersions(): StackVersion[] {
        return this.stackVersions().filter((item) => item.status === 'published').sort((a, b) => b.version - a.version);
    }

latestPublishedVersion(): number {
        return this.publishedStackVersions()[0]?.version || this.activeStackVersion();
    }

switchStackVersion(version: number): void {
        const target = this.stackVersions().find((item) => item.version === version);
        if (!target || target.version === this.activeStackVersion()) return;
        this.persistActiveLayers();
        this.activeStackVersion.set(target.version);
        this.stackLayers.set(target.layers.map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
    }

createStackVersion(): void {
        this.persistActiveLayers();
        const next = Math.max(...this.stackVersions().map((item) => item.version), 0) + 1;
        const draft: StackVersion = { version: next, status: 'draft', layers: this.stackLayers().map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })) };
        this.stackVersions.update((versions) => [...versions, draft]);
        this.activeStackVersion.set(next);
    }

publishStack(): void {
        if (!this.isStackEditable()) return;
        this.persistActiveLayers();
        this.stackVersions.update((versions) => versions.map((item) => item.version === this.activeStackVersion() ? { ...item, status: 'published' as const, publishedAt: new Date().toISOString(), layers: this.stackLayers().map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })) } : item));
    }

canDeleteStackVersion(): boolean {
        return this.stackStatus() !== 'published'
            && this.stackVersions().length > 1
            && !this.hostProfiles().some((profile) => profile.stackVersion === this.activeStackVersion());
    }

askDeleteStackVersion(): void {
        if (this.canDeleteStackVersion()) this.deleteVersionConfirm.set(true);
    }

cancelDeleteStackVersion(): void {
        this.deleteVersionConfirm.set(false);
    }

deleteStackVersion(): void {
        if (!this.canDeleteStackVersion()) return;
        const deleted = this.activeStackVersion();
        const remaining = this.stackVersions().filter((item) => item.version !== deleted);
        this.stackVersions.set(remaining);
        const published = remaining.filter((item) => item.status === 'published').sort((a, b) => b.version - a.version);
        const fallback = published[0] || remaining[remaining.length - 1];
        this.activeStackVersion.set(fallback.version);
        this.stackLayers.set(this.layersForVersion(fallback.version).map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
        this.deleteVersionConfirm.set(false);
    }

canReopenStack(): boolean {
        return this.stackStatus() === 'published' && !this.hostProfiles().some((profile) => profile.stackVersion === this.activeStackVersion());
    }

reopenStackVersion(): void {
        if (!this.canReopenStack()) return;
        this.stackVersions.update((versions) => versions.map((item) => item.version === this.activeStackVersion() ? { ...item, status: 'draft' as const } : item));
    }

retireStackVersion(): void {
        if (this.stackStatus() !== 'published') return;
        this.persistActiveLayers();
        this.stackVersions.update((versions) => versions.map((item) => item.version === this.activeStackVersion() ? { ...item, status: 'retired' as const } : item));
    }

openBulkUpgrade(): void {
        this.bulkUpgradeOpen.set(true);
        this.bulkUpgradeTarget.set(this.latestPublishedVersion());
    }

closeBulkUpgrade(): void {
        this.bulkUpgradeOpen.set(false);
        this.bulkUpgradeTarget.set(null);
    }

affectedBindings(): number {
        const target = this.bulkUpgradeTarget();
        return target ? this.hostProfiles().filter((profile) => profile.stackVersion !== target).length : 0;
    }

applyBulkUpgrade(): void {
        const target = this.bulkUpgradeTarget();
        if (!target) return;
        // BUG-28: touch exactly the rows that were counted as affected (no wider rewrite).
        this.hostProfiles.update((profiles) => profiles.map((profile) => profile.stackVersion === target ? profile : { ...profile, stackVersion: target }));
        this.closeBulkUpgrade();
    }

protected persistActiveLayers(): void {
        const version = this.activeStackVersion();
        this.stackVersions.update((versions) => versions.map((item) => item.version === version ? { ...item, layers: this.stackLayers().map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })) } : item));
    }

activeHosts(): HostDto[] { return this.hosts().filter((host) => host.runtimes.some((runtime) => runtime.health !== 'offline')); }

hostTypeLabel(type: string): string { return HOST_TYPE_LABELS[type] || type; }

hostAvailable(hostId: string): boolean { return this.hostRuntimes().some((host) => host.hostId === hostId && host.health !== 'offline'); }

hostHealth(hostId: string): string { return this.hostRuntimes().find((host) => host.hostId === hostId)?.health || 'unregistered'; }

hostTypeFor(hostId: string): string {
        const hostType = this.hosts().find((host) => host.hostId === hostId)?.hostType;
        if (hostType) return hostType;
        const runtimeId = this.hostRuntimes().find((host) => host.hostId === hostId)?.runtimeId || hostId;
        const value = String(runtimeId || hostId).toLowerCase();
        if (value.includes('cursor')) return 'cursor';
        if (value.includes('agy') || value.includes('antigravity')) return 'agy';
        if (value.includes('dsh')) return 'dsh';
        if (value.includes('claude')) return 'claude';
        return hostId;
    }

enabledLayerCount(): number { return this.stackLayers().filter((layer) => layer.enabled).length; }

agentLayers(): StackLayer[] { return this.stackLayers().filter((layer) => ['multiAgent', 'rules', 'skills', 'hooks'].includes(layer.id)); }

knowledgeLayers(): StackLayer[] { return this.stackLayers().filter((layer) => ['memory', 'codeGraph', 'documentGraph', 'topology'].includes(layer.id)); }

isLayerEnabled(layerId: LayerId, version = this.activeStackVersion()): boolean {
        return this.layersForVersion(version).find((item) => item.id === layerId)?.enabled ?? false;
    }

isResolutionLayerEnabled(layerId: LayerId, version = this.newStackVersion()): boolean {
        return this.isLayerEnabled(layerId, version);
    }

sourceOptionsFor(layerId: LayerId, version = this.newStackVersion()): string[] {
        if (!this.isResolutionLayerEnabled(layerId, version)) return [];
        const layer = this.layersForVersion(version).find((item) => item.id === layerId);
        return layer?.allowedSources?.length ? layer.allowedSources : this.policySources;
    }

toggleAllowedSource(layerId: LayerId, source: string, checked: boolean): void {
        if (!this.isStackEditable()) return;
        this.stackLayers.update((layers) => layers.map((layer) => {
            if (layer.id !== layerId) return layer;
            const current = layer.allowedSources || [];
            const next = checked ? [...new Set([...current, source])] : current.filter((item) => item !== source);
            return { ...layer, allowedSources: next };
        }));
        this.persistActiveLayers();
    }

marketProviders(layerId: 'memory' | 'codeGraph'): PluginEntry[] {
        const capability = layerId === 'memory' ? 'memory' : 'code-graph';
        return this.plugins().filter((plugin) => plugin.type === 'provider' && plugin.capabilities.includes(capability));
    }

hostLabel(pluginId: string): string {
        const host = this.hostRuntimes().find((item) => item.hostId === pluginId);
        if (host) return `${host.hostId} · ${this.hostTypeFor(host.hostId)}`;
        return this.plugins().find((plugin) => plugin.id === pluginId)?.label || pluginId;
    }

workerRoleCount(): number {
        return new Set(this.workers().map((worker) => worker.role)).size;
    }

workerHostCoverage(): number {
        return new Set(this.workers().flatMap((worker) => worker.hostBindingIds)).size;
    }

workerPlacementCount(): number {
        return this.workers().reduce((sum, worker) => sum + worker.hostBindingIds.length, 0);
    }

protected loadFlowSummaries(id: string): void {
        this.service.getFlows(id)
            .then((flows) => this.flowSummaries.set(flows))
            .catch(() => this.flowSummaries.set([]));
    }

flowVersionOptions(): number[] {
        const flow = this.flowSummaries().find((item) => item.id === this.newFlowId());
        return flow?.publishedVersions?.length ? flow.publishedVersions : (flow ? [flow.version] : []);
    }

changeFlow(id: string): void {
        this.newFlowId.set(id);
        this.newFlowVersion.set(this.flowVersionOptions().at(-1) || 1);
    }

protected loadDefaultFlow(id: string): void {
        this.service.getDefaultFlow(id)
            .then((flow) => {
                this.defaultFlow.set(flow);
                this.workerEdges.set(flow?.edges.map((edge) => ({ from: edge.from, to: edge.to, on: edge.on })) || []);
            })
            .catch(() => {
                this.defaultFlow.set(null);
                this.workerEdges.set([]);
            });
    }

protected loadRuleFiles(id: string): void {
        Promise.all([this.service.getRules(id), this.service.getMaterialSummary(id)])
            .then(([rules, material]) => {
                this.ruleFiles.set(rules);
                this.materialCounts.set(material);
                this.stackLayers.update((layers) => layers.map((layer) => layer.id === 'rules' ? { ...layer, files: rules.length } : layer));
            })
            .catch(() => {
                this.ruleFiles.set([]);
                this.materialCounts.set({ skills: 0, hooks: 0, subagents: 0, rules: 0 });
            });
    }

ruleMdcCount(): number {
        return this.ruleFiles().filter((rule) => String(rule.sourceFile || '').toLowerCase().endsWith('.mdc')).length;
    }

ruleMdCount(): number {
        return this.ruleFiles().length - this.ruleMdcCount();
    }

onRuleFiles(event: Event): void {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length === 0) return;
        this.ruleImporting.set(true);
        Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() })))
            .then((payload) => this.service.previewRuleImport(this.consumerId, payload))
            .then((preview) => {
                this.ruleImportPreview.set(preview);
                this.ruleSelectedHashes.set(preview.candidates.map((candidate: any) => candidate.sourceHash));
                this.ruleImportActions.set(Object.fromEntries(preview.candidates.map((candidate: any) => [candidate.sourceHash, candidate.conflict ? 'skip' : 'replace'])));
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Rule import preview failed'))
            .finally(() => this.ruleImporting.set(false));
    }

ruleAction(hash: string): 'skip' | 'replace' | 'copy' {
        return this.ruleImportActions()[hash] || 'skip';
    }

setRuleAction(hash: string, action: 'skip' | 'replace' | 'copy'): void {
        this.ruleImportActions.update((actions) => ({ ...actions, [hash]: action }));
    }

toggleRuleImport(hash: string, checked: boolean): void {
        this.ruleSelectedHashes.update((hashes) => checked ? [...new Set([...hashes, hash])] : hashes.filter((item) => item !== hash));
    }

importableRuleCount(): number {
        const preview = this.ruleImportPreview();
        if (!preview) return 0;
        const selected = new Set(this.ruleSelectedHashes());
        return preview.candidates.filter((candidate: any) => selected.has(candidate.sourceHash) && this.ruleAction(candidate.sourceHash) !== 'skip').length;
    }

applyRuleImport(): void {
        const preview = this.ruleImportPreview();
        if (!preview) return;
        const selected = new Set(this.ruleSelectedHashes());
        const candidates = preview.candidates
            .filter((candidate: any) => selected.has(candidate.sourceHash) && this.ruleAction(candidate.sourceHash) !== 'skip')
            .map((candidate: any) => ({ ...candidate, action: this.ruleAction(candidate.sourceHash) }));
        if (candidates.length === 0) return;
        this.service.applyRuleImport(this.consumerId, candidates)
            .then(() => this.loadRuleFiles(this.consumerId))
            .then(() => {
                this.ruleImportPreview.set(null);
                this.ruleSelectedHashes.set([]);
                this.ruleImportActions.set({});
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Rule import failed'));
    }

deleteRule(rule: any): void {
        if (!window.confirm(`Remove ${rule.id} from agents/rules?`)) return;
        this.service.deleteRule(this.consumerId, rule.id)
            .then(() => this.loadRuleFiles(this.consumerId))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Rule delete failed'));
    }
}
