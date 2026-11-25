import { ChangeDetectionStrategy, Component, Directive, OnInit, ViewEncapsulation, computed, effect, inject, signal, viewChild } from '@angular/core';
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
import { SettingsKnowledgeBase } from './settings-knowledge.base.js';
import type { QuartetProfileType } from './settings-core.base.js';
@Directive()
export abstract class SettingsTailBase extends SettingsKnowledgeBase {
    readonly switchingEnv = signal(false);
    readonly isEsoEnv = computed(() => !this.legacyHarness()?.detected && this.migrationConflictCount() === 0 && this.migrationNewCount() === 0);

    async switchToEsoEnv(): Promise<void> {
        if (this.switchingEnv()) return;
        this.switchingEnv.set(true);
        this.migrationError.set('');
        this.migrationNotice.set('');
        this.legacyError.set('');
        try {
            if (this.migrationConflictCount() > 0) {
                throw new Error('Resolve conflicts before switching to ESO environment.');
            }
            if (this.legacyHarness()?.detected) {
                await this.service.archiveLegacyHarness(this.consumerId);
                this.legacyHarness.set({ consumerId: this.consumerId, detected: false, entries: [], archivePath: null });
            }
            if (this.migrationNewCount() > 0) {
                await this.service.applyHarnessMigration(this.consumerId);
                this.migrationPreview.set(null);
            }
            const currentProfiles = this.hostProfiles();
            const updatedProfiles = currentProfiles.map((hp) => ({
                ...hp,
                memorySource: 'eso-native',
                codeGraphSource: 'eso-native',
            }));
            this.hostProfiles.set(updatedProfiles);
            this.save();
            await this.service.provision(this.consumerId);
            await Promise.all([
                this.service.getLegacyHarness(this.consumerId).then((r) => this.legacyHarness.set(r)).catch(() => {}),
                this.service.previewHarnessMigration(this.consumerId).then((p) => this.migrationPreview.set(p)).catch(() => {}),
            ]);
            this.migrationNotice.set('Successfully switched to ESO Native environment! Schema provisioned and capabilities bound to ESO Native.');
        } catch (err: unknown) {
            const errorObj = err as { detail?: string; message?: string };
            this.migrationError.set(errorObj?.detail || errorObj?.message || 'Could not switch to ESO environment');
        } finally {
            this.switchingEnv.set(false);
        }
    }

openHosts(): void {
        void this.router.navigate(['/hosts']);
    }

loadMigrationPreview(): void {
        if (this.migrationLoading()) return;
        this.migrationLoading.set(true);
        this.service.previewHarnessMigration(this.consumerId)
            .then((preview) => this.migrationPreview.set(preview))
            .catch(() => this.migrationPreview.set(null))
            .finally(() => this.migrationLoading.set(false));
    }

resolveMigrationConflict(entryId: string, strategy: 'keep-eso' | 'adopt-legacy'): void {
        if (strategy === 'adopt-legacy' && !window.confirm('Adopt legacy will overwrite the canonical file after backing it up. Continue?')) return;
        this.migrationError.set('');
        this.migrationNotice.set('');
        this.service.resolveMigrationConflict(this.consumerId, entryId, strategy)
            .then((result) => {
                this.migrationPreview.set(result.preview);
                this.migrationNotice.set(result.backupPath ? `Conflict resolved (${strategy}); canonical backup: ${result.backupPath}.` : `Conflict resolved (${strategy}).`);
            })
            .catch((err) => this.migrationError.set(err?.detail || err?.message || 'Could not resolve migration conflict'));
    }

previewHarnessMigration(): void {
        if (this.migrationLoading() || this.migrationApplying()) return;
        this.migrationLoading.set(true);
        this.migrationError.set('');
        this.migrationNotice.set('');
        this.service.previewHarnessMigration(this.consumerId)
            .then((preview) => {
                this.migrationPreview.set(preview);
                if (!preview.detected) this.migrationNotice.set('No legacy host assets found.');
                else if (!preview.entries.some((entry) => entry.status === 'new' || entry.status === 'conflict')) this.migrationNotice.set('Legacy host assets already match ESO canonical; nothing to migrate.');
            })
            .catch((err) => this.migrationError.set(err?.detail || err?.message || 'Could not preview migration'))
            .finally(() => this.migrationLoading.set(false));
    }

applyHarnessMigration(): void {
        if (this.migrationApplying()) return;
        this.migrationApplying.set(true);
        this.migrationError.set('');
        this.migrationNotice.set('');
        this.service.applyHarnessMigration(this.consumerId)
            .then((result) => {
                this.migrationNotice.set(`Migration applied: ${result.applied.length} new, ${result.skipped.length} unchanged/conflict kept. Manifest: ${result.manifestPath}.`);
                this.migrationPreview.set(null);
                this.refreshLegacyHarness();
                this.loadMigrationPreview();
            })
            .catch((err) => this.migrationError.set(err?.detail || err?.message || 'Could not apply migration'))
            .finally(() => this.migrationApplying.set(false));
    }

finishWithoutMigration(): void {
        this.finishPrompt.set(false);
        this.finishing.set(false);
        this.legacyNotice.set('Settings saved. Finish blocked: legacy harness remains. Migrate it when ready, then Finish again.');
    }

finishWithMigration(): void {
        if (this.finishing()) return;
        this.finishing.set(true);
        this.migrationError.set('');
        this.service.applyHarnessMigration(this.consumerId)
            .then(() => this.provisionAndLeave())
            .catch((err) => {
                this.migrationError.set(err?.detail || err?.message || 'Could not migrate before finish');
                this.finishing.set(false);
            });
    }

protected provisionAndLeave(): void {
        this.service.provision(this.consumerId)
            .then(() => this.router.navigate(['/consumers', this.consumerId]))
            .catch((err) => {
                this.error.set(err?.detail || err?.message || 'Could not provision consumer');
                this.finishing.set(false);
            });
    }

protected completeFinish(): void {
        Promise.all([
            this.service.getLegacyHarness(this.consumerId),
            this.service.previewHarnessMigration(this.consumerId),
        ])
            .then(([legacy, migration]) => {
                this.legacyHarness.set(legacy);
                this.migrationPreview.set(migration);
                if (migration.entries.some((entry) => entry.status === 'conflict')) {
                    this.error.set('Resolve migration conflicts before finishing.');
                    this.finishing.set(false);
                    return;
                }
                const pendingMigration = migration.entries.some((entry) => entry.status === 'new');
                if (legacy.detected || pendingMigration) {
                    this.finishPrompt.set(true);
                    this.finishing.set(false);
                    return;
                }
                this.provisionAndLeave();
            })
            .catch((err) => {
                this.error.set(err?.detail || err?.message || 'Could not inspect legacy harness before finish');
                this.finishing.set(false);
            });
    }

refreshLegacyHarness(): void {
        if (this.legacyLoading()) return;
        this.legacyLoading.set(true);
        this.legacyError.set('');
        this.service.getLegacyHarness(this.consumerId)
            .then((report) => this.legacyHarness.set(report))
            .catch((err) => this.legacyError.set(err?.detail || err?.message || 'Could not inspect legacy harness'))
            .finally(() => this.legacyLoading.set(false));
    }

archiveLegacyHarness(): void {
        if (this.legacyArchiving()) return;
        this.legacyArchiving.set(true);
        this.legacyError.set('');
        this.service.archiveLegacyHarness(this.consumerId)
            .then((result) => {
                this.legacyArchiveConfirm.set(false);
                this.legacyNotice.set(`Legacy harness archived to ${result.archivePath}.`);
                this.legacyHarness.set({ consumerId: result.consumerId, detected: false, entries: [], archivePath: null });
            })
            .catch((err) => this.legacyError.set(err?.detail || err?.message || 'Could not archive legacy harness'))
            .finally(() => this.legacyArchiving.set(false));
    }

applyProfile(fields: ConsumerProfileFields): void {
        this.name.set(fields.name);
        this.owner.set(fields.owner);
        this.locale.set(fields.locale);
        this.tags.set(fields.tags);
        this.description.set(fields.description);
    }

save(navigateAfter = false): void {
        const profile = this.current();
        if (!profile) return;
        this.saving.set(true); this.saved.set(false); this.error.set(null); this.errorCode.set('');
        if (this.jevMode() !== 'off' && !this.consent()) { this.saving.set(false); this.errorCode.set('PROFILE_JEV_NEEDS_CONSENT'); this.error.set('JEV shadow/active requires observation consent.'); return; }
        const auto = this.jevAutoThreshold().trim() === '' ? undefined : Number(this.jevAutoThreshold());
        const confirm = this.jevConfirmThreshold().trim() === '' ? undefined : Number(this.jevConfirmThreshold());
        if ((auto !== undefined && (!Number.isFinite(auto) || auto < 0 || auto > 1)) || (confirm !== undefined && (!Number.isFinite(confirm) || confirm < 0 || confirm > 1))) { this.saving.set(false); this.errorCode.set('PROFILE_JEV_THRESHOLD'); this.error.set('JEV thresholds must be between 0 and 1.'); return; }
        if (auto !== undefined && confirm !== undefined && auto < confirm) { this.saving.set(false); this.errorCode.set('PROFILE_JEV_THRESHOLD'); this.error.set('JEV auto threshold must be >= confirm threshold.'); return; }
        const previous = (profile.profile || {}) as Record<string, unknown>;
        const previousSettings = (previous.settings as Record<string, unknown> | undefined) || {};
        const nextProfile: Record<string, unknown> = {
            ...previous,
            observation: { consent: this.consent(), events: this.events() },
            integration: {
                ...((previous.integration as Record<string, unknown> | undefined) || {}),
                jev: {
                    mode: this.jevMode(),
                    consent: this.consent(),
                    ...(auto !== undefined ? { autoThreshold: auto } : {}),
                    ...(confirm !== undefined ? { confirmThreshold: confirm } : {}),
                },
            },
            settings: {
                ...previousSettings,
                general: { owner: this.owner().trim(), locale: this.locale().trim(), tags: this.tags().split(',').map((tag) => tag.trim()).filter(Boolean), description: this.description().trim() },
                harness: { stack: { version: this.activeStackVersion(), status: this.stackStatus(), layers: this.stackLayers(), versions: this.stackVersions() }, hostProfiles: this.hostProfiles(), developers: this.developers(), formationHostIds: this.formationHostIds(), plugins: this.plugins() },
                jira: { enabled: this.jiraEnabled(), projectKey: this.jiraProject().trim(), syncMode: this.jiraSyncMode() },
                knowledge: {
                    sdlc: { enabled: this.sdlcEnabled(), pipeline: this.sdlcPipeline(), crProcess: this.crProcess() },
                    artifactKinds: this.artifactKinds(),
                    representations: this.representations(),
                    docgraph: { enabled: this.docgraphIndex(), scope: this.docgraphScope().trim() },
                    governance: {
                        documentStatus: this.documentStatusRequired(),
                        preflight: this.preflightRequired(),
                        goNoGo: this.goNoGoRequired(),
                        crossCheck: this.crossCheckRequired(),
                        openRegister: this.openRegisterRequired(),
                        buildEnforcement: this.buildEnforcementRequired(),
                        pipelineContract: this.pipelineContractRequired(),
                    },
                    taskQuartet: this.quartetProfile(),
                    manifest: {
                        enabled: this.manifestEnabled(),
                        path: this.manifestPath().trim(),
                        humanHeaderKeys: this.manifestHumanHeaderKeys(),
                        aiHeaderKeys: this.manifestAiHeaderKeys(),
                        facets: this.manifestFacets(),
                        relations: this.manifestRelations(),
                        checks: this.manifestChecks(),
                    },
                    providers: { jira: { enabled: this.jiraEnabled(), projectKey: this.jiraProject().trim(), syncMode: this.jiraSyncMode() }, routing: this.providerRouting() },
                },
            },
        };
        const workerConfig: WorkerConfigDto = {
            workers: (this.workersSettings()?.snapshot() ?? this.workers()).map((worker) => ({
                id: worker.id,
                name: worker.name,
                role: worker.role,
                layer: worker.layer,
                scope: worker.scope,
                status: worker.status,
                hostBindingIds: [...worker.hostBindingIds],
                capabilities: [...worker.capabilities],
                verbs: [...worker.verbs],
                bar: [...worker.bar],
                escalation: worker.escalation,
                instructions: worker.instructions || '',
                sourceFile: worker.sourceFile,
                sourceHash: worker.sourceHash,
                sourceType: worker.sourceType,
            })),
            edges: [],
            bindings: this.hostProfiles().map((binding) => ({
                id: binding.id,
                developer: binding.userId,
                hostId: binding.hostId,
                stackVersion: binding.stackVersion,
                memorySource: binding.memorySource,
                codeGraphSource: binding.codeGraphSource,
                installState: binding.installState,
            })),
        };
        this.service.saveWorkers(profile.id, workerConfig)
            .then(() => this.service.updateSettings(profile.id, this.name().trim() || profile.name, nextProfile, profile.version || 1))
            .then(async (updated) => {
                await this.service.saveStackVersions(profile.id, this.stackVersions());
                this.current.set(updated);
                // Drop the persisted draft before re-hydrating so it cannot overwrite the saved values.
                this.clearDraft();
                this.hydrate(updated);
                this.saved.set(true);
                if (this.baselineTimer !== null) clearTimeout(this.baselineTimer);
                this.baselineTimer = setTimeout(() => {
                    this.baselineTimer = null;
                    if (this.destroyed) return;
                    this.lastSaved.set(this.currentDraft());
                    this.lastDraftBaseline.set(JSON.stringify(this.draftSnapshot()));
                    this.baselineReady.set(true);
                    this.clearDraft();
                }, 0);
                this.workerImportDirty.set(false);
                if (navigateAfter) void this.completeFinish();
                else { void this.loadMigrationPreview(); void this.refreshLegacyHarness(); }
            })
            .catch((err) => {
                const status = (err as { status?: number })?.status;
                this.errorCode.set(status === 409 ? 'PROFILE_STALE_VERSION'
                    : status === 401 || status === 403 ? 'PROFILE_DENIED'
                        : 'PROFILE_UPSTREAM_FAILED');
                this.error.set((err as { detail?: string; message?: string })?.detail || (err as Error)?.message || 'Unable to save settings');
            })
            .finally(() => this.saving.set(false));
    }

protected normalizeLayers(savedLayers: StackLayer[]): StackLayer[] {
        const defaults = defaultStackLayers();
        return defaults.map((layer) => {
            const saved = (savedLayers.find((item) => item.id === layer.id) || {}) as Partial<StackLayer> & { source?: string; provider?: string };
            const merged = { ...layer, ...saved };
            delete (merged as { source?: string }).source;
            delete (merged as { provider?: string }).provider;
            if (!Array.isArray(merged.allowedSources) || merged.allowedSources.length === 0) {
                merged.allowedSources = [...(layer.allowedSources || [])];
            }
            return merged;
        });
    }

protected hydrate(profile: ConsumerProfile): void {
        const prof = (profile.profile || {}) as any;
        const settings = (prof.settings || {}) as any;
        const harness = (settings.harness || {}) as any;
        this.name.set(profile.name || '');
        this.owner.set(settings.general?.owner || '');
        this.locale.set(settings.general?.locale || 'vi-VN');
        this.tags.set((settings.general?.tags || []).join(', '));
        this.description.set(prof.description || settings.general?.description || '');
        const jev = prof.integration?.jev ?? prof.profile?.integration?.jev ?? (profile as any).integration?.jev;
        this.jevMode.set(jev?.mode === 'shadow' || jev?.mode === 'active' ? jev.mode : 'off');
        this.jevAutoThreshold.set(jev?.autoThreshold === undefined ? '' : String(jev.autoThreshold));
        this.jevConfirmThreshold.set(jev?.confirmThreshold === undefined ? '' : String(jev.confirmThreshold));
        this.jiraEnabled.set(settings.jira?.enabled ?? false);
        const routing = settings.knowledge?.providers?.routing;
        if (routing && typeof routing === 'object') {
            this.providerRouting.set({ work: routing.work || 'md', design: routing.design || 'md', content: routing.content || 'md' });
        } else {
            this.providerRouting.set({ work: this.jiraEnabled() ? 'jira' : 'md', design: 'md', content: 'md' });
        }
        this.jiraProject.set(settings.jira?.projectKey || '');
        this.jiraSyncMode.set(settings.jira?.syncMode || 'off');
        const knowledge = settings.knowledge || {};
        this.sdlcEnabled.set(knowledge.sdlc?.enabled ?? false);
        this.sdlcPipeline.set(knowledge.sdlc?.pipeline || 'full');
        this.crProcess.set(knowledge.sdlc?.crProcess ?? false);
        this.artifactKinds.set(Array.isArray(knowledge.artifactKinds) ? knowledge.artifactKinds : ['BRD', 'PRD', 'ADR']);
        this.representations.set(Array.isArray(knowledge.representations) ? knowledge.representations : ['human', 'agent', 'machine']);
        this.docgraphIndex.set(knowledge.docgraph?.enabled ?? true);
        this.docgraphScope.set(knowledge.docgraph?.scope || 'docs/**, sdlc/**, agents/**');
        this.documentStatusRequired.set(knowledge.governance?.documentStatus ?? true);
        this.preflightRequired.set(knowledge.governance?.preflight ?? true);
        this.goNoGoRequired.set(knowledge.governance?.goNoGo ?? true);
        this.crossCheckRequired.set(knowledge.governance?.crossCheck ?? true);
        this.pipelineContractRequired.set(knowledge.governance?.pipelineContract ?? true);
        this.openRegisterRequired.set(knowledge.governance?.openRegister ?? true);
        this.buildEnforcementRequired.set(knowledge.governance?.buildEnforcement ?? true);
        const validProfiles: QuartetProfileType[] = ['standard', 'assurance', 'frontend', 'integration', 'runtime', 'extended'];
        this.quartetProfile.set(validProfiles.includes(knowledge.taskQuartet as QuartetProfileType) ? (knowledge.taskQuartet as QuartetProfileType) : 'standard');
        this.manifestEnabled.set(knowledge.manifest?.enabled ?? true);
        this.manifestPath.set(knowledge.manifest?.path || '.harness/manifest.json');
        this.manifestHumanHeaderKeys.set(Array.isArray(knowledge.manifest?.humanHeaderKeys) ? knowledge.manifest.humanHeaderKeys : this.manifestHumanHeaderOptions);
        this.manifestAiHeaderKeys.set(Array.isArray(knowledge.manifest?.aiHeaderKeys) ? knowledge.manifest.aiHeaderKeys : this.manifestAiHeaderOptions);
        this.manifestFacets.set(Array.isArray(knowledge.manifest?.facets) ? knowledge.manifest.facets : this.manifestFacetOptions);
        this.manifestRelations.set(Array.isArray(knowledge.manifest?.relations) ? knowledge.manifest.relations : this.manifestRelationOptions);
        this.manifestChecks.set(Array.isArray(knowledge.manifest?.checks) ? knowledge.manifest.checks : this.manifestCheckOptions);
        // BUG-35: no explicit consent field ⇒ OFF (was true = collect before opt-in)
        this.consent.set(prof.observation?.consent ?? false);
        this.events.set(prof.observation?.events || ['prompt.submitted', 'turn.completed', 'tool.called']);
        const remoteVersions = this.remoteStackVersions();
        const savedVersions = remoteVersions.length > 0 ? remoteVersions : (Array.isArray(harness.stack?.versions) ? harness.stack.versions : []);
        const legacyLayers = Array.isArray(harness.stack?.layers) ? harness.stack.layers : [];
        let versions: StackVersion[];
        if (savedVersions.length > 0) {
            versions = savedVersions.map((item: StackVersion) => ({
                version: Number(item.version) || 1,
                status: item.status === 'draft' || item.status === 'retired' ? item.status : 'published',
                layers: this.normalizeLayers(item.layers),
                publishedAt: item.publishedAt,
            }));
        } else {
            versions = [{ version: Number(harness.stack?.version) || 1, status: 'published', layers: this.normalizeLayers(legacyLayers) }];
        }
        this.stackVersions.set(versions);
        const requestedVersion = Number(harness.stack?.version) || versions[versions.length - 1].version;
        const active = versions.some((item) => item.version === requestedVersion) ? requestedVersion : versions[versions.length - 1].version;
        this.activeStackVersion.set(active);
        this.stackLayers.set(this.layersForVersion(active).map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
        this.newStackVersion.set(this.latestPublishedVersion());
        const savedProfiles = Array.isArray(harness.hostProfiles)
            ? (harness.hostProfiles as LegacyHostProfile[])
                .map((profile) => {
                    const { [LEGACY_HOST_PLUGIN_KEY]: legacyHostId, ...rest } = profile;
                    return { ...rest, hostId: rest.hostId || legacyHostId || '' } as HostProfile;
                })
                .filter((profile) => !profile.detected)
            : [];
        this.hostProfiles.set(savedProfiles);
        const savedDevelopers = Array.isArray(harness.developers) ? harness.developers : [];
        const developerIds = [...new Set([...savedDevelopers, ...savedProfiles.map((profile: HostProfile) => profile.userId)])];
        this.developers.set(developerIds);
        this.workers.set(defaultWorkers());
        this.workerEdges.set([]);
        this.formationHostIds.set(Array.isArray(harness.formationHostIds) ? harness.formationHostIds : []);
        const savedPlugins = Array.isArray(harness.plugins)
            ? harness.plugins.filter((plugin: PluginEntry) => plugin.type !== 'provider')
            : defaultPlugins();
        const discoveredProviders: PluginEntry[] = this.mcpProviders().map((provider) => ({
            id: provider.id,
            label: provider.label,
            type: 'provider',
            version: 'detected',
            capabilities: provider.capabilities,
            mcpSource: provider.source,
            status: 'installed',
        }));
        this.plugins.set([...savedPlugins, ...discoveredProviders]);
        this.restoreDraft();
                this.hydrated.set(true);
        if (this.baselineTimer !== null) clearTimeout(this.baselineTimer);
        this.baselineTimer = setTimeout(() => {
            this.baselineTimer = null;
            if (this.destroyed) return;
            this.lastSaved.set(this.currentDraft());
            this.lastDraftBaseline.set(JSON.stringify(this.draftSnapshot()));
            this.baselineReady.set(true);
        }, 500);
        void this.loadDefaultFlow(profile.id);
        void this.loadRuleFiles(profile.id);
        void this.loadFlowSummaries(profile.id);
        this.service.getConsumerPlugins(profile.id).then((plugins) => this.consumerPlugins.set(plugins)).catch(() => this.consumerPlugins.set([]));
        this.service.getProviderRecords(profile.id).then((records) => this.knowledgeProviderRecords.set(records)).catch(() => this.knowledgeProviderRecords.set([]));
        void this.loadKnowledgeIndex(profile.id);
    }

private draftTimer: ReturnType<typeof setTimeout> | null = null;
    private baselineTimer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;

    /** BUG-43: no pending timer may write a signal/draft after the page is gone. */
    ngOnDestroy(): void {
        this.destroyed = true;
        if (this.draftTimer !== null) { clearTimeout(this.draftTimer); this.draftTimer = null; }
        if (this.baselineTimer !== null) { clearTimeout(this.baselineTimer); this.baselineTimer = null; }
    }

/** Snapshot of the last hydrated/saved form, so only real edits are persisted as a draft. */
private readonly lastDraftBaseline = signal<string | null>(null);

/**
 * BUG-42: the draft was only ever read, so a 401/refresh dropped everything typed.
 * Persist the restorable form state on change, debounced, and only after hydration.
 */
private readonly draftWriter = effect(() => {
        const serialized = JSON.stringify(this.draftSnapshot());
        if (!this.hydrated() || !this.baselineReady() || this.saving()) return;
        if (this.lastDraftBaseline() === null || serialized === this.lastDraftBaseline()) return;
        if (this.draftTimer !== null) clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => {
            this.draftTimer = null;
            try { localStorage.setItem(this.draftKey(), serialized); } catch { /* storage unavailable */ }
        }, 400);
    });

protected draftKey(): string {
        return `eso.consumer-settings.${this.consumerId}`;
    }

protected draftSnapshot(): Record<string, unknown> {
        return {
            name: this.name(), owner: this.owner(), locale: this.locale(), tags: this.tags(), description: this.description(),
            stackVersions: this.stackVersions(), activeStackVersion: this.activeStackVersion(), newStackVersion: this.newStackVersion(),
            developers: this.developers(),
            jiraEnabled: this.jiraEnabled(), jiraProject: this.jiraProject(), jiraSyncMode: this.jiraSyncMode(),
            sdlcEnabled: this.sdlcEnabled(), sdlcPipeline: this.sdlcPipeline(), crProcess: this.crProcess(),
            artifactKinds: this.artifactKinds(), representations: this.representations(),
            docgraphIndex: this.docgraphIndex(), docgraphScope: this.docgraphScope(),
            documentStatusRequired: this.documentStatusRequired(), preflightRequired: this.preflightRequired(),
            goNoGoRequired: this.goNoGoRequired(), crossCheckRequired: this.crossCheckRequired(),
            pipelineContractRequired: this.pipelineContractRequired(), openRegisterRequired: this.openRegisterRequired(),
            buildEnforcementRequired: this.buildEnforcementRequired(), quartetProfile: this.quartetProfile(),
            manifestEnabled: this.manifestEnabled(), manifestPath: this.manifestPath(),
            manifestHumanHeaderKeys: this.manifestHumanHeaderKeys(), manifestAiHeaderKeys: this.manifestAiHeaderKeys(),
            manifestFacets: this.manifestFacets(), manifestRelations: this.manifestRelations(), manifestChecks: this.manifestChecks(),
            consent: this.consent(), events: this.events(),
        };
    }

protected clearDraft(): void {
        if (this.draftTimer !== null) {
            clearTimeout(this.draftTimer);
            this.draftTimer = null;
        }
        try { localStorage.removeItem(this.draftKey()); } catch { /* storage unavailable */ }
    }

protected restoreDraft(): void {
        try {
            const raw = localStorage.getItem(this.draftKey());
            if (!raw) return;
            const draft = JSON.parse(raw) as Record<string, any>;
            if (typeof draft.name === 'string') this.name.set(draft.name);
            if (typeof draft.owner === 'string') this.owner.set(draft.owner);
            if (typeof draft.locale === 'string') this.locale.set(draft.locale);
            if (typeof draft.tags === 'string') this.tags.set(draft.tags);
            if (typeof draft.description === 'string') this.description.set(draft.description);
            if (Array.isArray(draft.stackVersions) && draft.stackVersions.length) {
                const versions: StackVersion[] = draft.stackVersions.map((item: StackVersion) => ({
                    version: Number(item.version) || 1,
                    status: item.status === 'draft' || item.status === 'retired' ? item.status : 'published',
                    layers: this.normalizeLayers(item.layers),
                    publishedAt: item.publishedAt,
                }));
                this.stackVersions.set(versions);
                const active = versions.some((item) => item.version === draft.activeStackVersion) ? Number(draft.activeStackVersion) : versions[versions.length - 1].version;
                this.activeStackVersion.set(active);
                this.stackLayers.set(this.layersForVersion(active).map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
                this.newStackVersion.set(this.latestPublishedVersion());
            } else if (Array.isArray(draft.stackLayers) && draft.stackLayers.length) {
                const layers = this.normalizeLayers(draft.stackLayers);
                this.stackVersions.set([{ version: 1, status: 'published', layers }]);
                this.activeStackVersion.set(1);
                this.stackLayers.set(layers.map((layer) => ({ ...layer, allowedSources: layer.allowedSources ? [...layer.allowedSources] : undefined })));
                this.newStackVersion.set(1);
            }
            if (typeof draft.newStackVersion === 'number') this.newStackVersion.set(draft.newStackVersion);
            // Host profiles and formation IDs are server-owned deployment data, not form drafts.
            // Restoring them from localStorage kept stale hp-* IDs alive after provisioning and
            // made every worker lose its binding via pruneWorkerBindings().
            if (Array.isArray(draft.developers)) {
                const developerIds = new Set<string>([...this.developers(), ...draft.developers]);
                for (const profile of this.hostProfiles()) developerIds.add(profile.userId);
                this.developers.set([...developerIds]);
            }
            if (typeof draft.jiraEnabled === 'boolean') this.jiraEnabled.set(draft.jiraEnabled);
            if (typeof draft.jiraProject === 'string') this.jiraProject.set(draft.jiraProject);
            if (typeof draft.jiraSyncMode === 'string') this.jiraSyncMode.set(draft.jiraSyncMode);
            if (typeof draft.sdlcEnabled === 'boolean') this.sdlcEnabled.set(draft.sdlcEnabled);
            if (typeof draft.sdlcPipeline === 'string') this.sdlcPipeline.set(draft.sdlcPipeline);
            if (typeof draft.crProcess === 'boolean') this.crProcess.set(draft.crProcess);
            if (Array.isArray(draft.artifactKinds)) this.artifactKinds.set(draft.artifactKinds);
            if (Array.isArray(draft.representations)) this.representations.set(draft.representations);
            if (typeof draft.docgraphIndex === 'boolean') this.docgraphIndex.set(draft.docgraphIndex);
            if (typeof draft.docgraphScope === 'string') this.docgraphScope.set(draft.docgraphScope);
            if (typeof draft.documentStatusRequired === 'boolean') this.documentStatusRequired.set(draft.documentStatusRequired);
            if (typeof draft.preflightRequired === 'boolean') this.preflightRequired.set(draft.preflightRequired);
            if (typeof draft.goNoGoRequired === 'boolean') this.goNoGoRequired.set(draft.goNoGoRequired);
            if (typeof draft.crossCheckRequired === 'boolean') this.crossCheckRequired.set(draft.crossCheckRequired);
            if (typeof draft.pipelineContractRequired === 'boolean') this.pipelineContractRequired.set(draft.pipelineContractRequired);
            if (typeof draft.openRegisterRequired === 'boolean') this.openRegisterRequired.set(draft.openRegisterRequired);
            if (typeof draft.buildEnforcementRequired === 'boolean') this.buildEnforcementRequired.set(draft.buildEnforcementRequired);
            const validProfiles: QuartetProfileType[] = ['standard', 'assurance', 'frontend', 'integration', 'runtime', 'extended'];
            if (validProfiles.includes(draft.quartetProfile as QuartetProfileType)) this.quartetProfile.set(draft.quartetProfile as QuartetProfileType);
            if (typeof draft.manifestEnabled === 'boolean') this.manifestEnabled.set(draft.manifestEnabled);
            if (typeof draft.manifestPath === 'string') this.manifestPath.set(draft.manifestPath);
            if (Array.isArray(draft.manifestHumanHeaderKeys)) this.manifestHumanHeaderKeys.set(draft.manifestHumanHeaderKeys);
            if (Array.isArray(draft.manifestAiHeaderKeys)) this.manifestAiHeaderKeys.set(draft.manifestAiHeaderKeys);
            if (Array.isArray(draft.manifestFacets)) this.manifestFacets.set(draft.manifestFacets);
            if (Array.isArray(draft.manifestRelations)) this.manifestRelations.set(draft.manifestRelations);
            if (Array.isArray(draft.manifestChecks)) this.manifestChecks.set(draft.manifestChecks);
            if (typeof draft.consent === 'boolean') this.consent.set(draft.consent);
            if (Array.isArray(draft.events)) this.events.set(draft.events);
        } catch {
            // Ignore malformed drafts.
        }
    }
}
