import { ChangeDetectionStrategy, Component, Directive, OnInit, Signal, ViewEncapsulation, computed, effect, inject, signal, viewChild } from '@angular/core';
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

@Directive()
export abstract class SettingsCoreBase {
    protected abstract readonly workersSettings: Signal<WorkersSettingsComponent | undefined>;
    protected abstract stackStatus(): StackVersionStatus;
    protected abstract normalizeLayers(savedLayers: StackLayer[]): StackLayer[];
    protected abstract hydrate(profile: ConsumerProfile): void;
    protected abstract refreshLegacyHarness(): void;
    protected abstract loadMigrationPreview(): void;
    protected abstract openHosts(): void;
    protected abstract save(navigateAfter?: boolean): void;

readonly vm = this;

protected readonly service = inject(ConsumerProfileService);

readonly route = inject(ActivatedRoute);

protected readonly router = inject(Router);

readonly loading = signal(true);

readonly saving = signal(false);

readonly saved = signal(false);

readonly currentDraft = computed(() => JSON.stringify({
        name: this.name(), owner: this.owner(), locale: this.locale(), tags: this.tags(), description: this.description(),
        consent: this.consent(), events: this.events(), jevMode: this.jevMode(), jevAuto: this.jevAutoThreshold(), jevConfirm: this.jevConfirmThreshold(),
        stack: { version: this.activeStackVersion(), status: this.stackStatus(), layers: this.stackLayers(), versions: this.stackVersions() },
        hosts: { profiles: this.hostProfiles(), developers: this.developers(), detected: this.formationHostIds(), plugins: this.plugins() },
    }));

readonly lastSaved = signal<string | null>(null);

readonly baselineReady = signal(false);

readonly dirty = computed(() => this.baselineReady() && this.lastSaved() !== null && this.currentDraft() !== this.lastSaved());

readonly error = signal<string | null>(null);
readonly errorCode = signal('');

protected readonly current = signal<ConsumerProfile | null>(null);

readonly activeTab = signal('profile');

readonly lastTab = 'observation';

readonly tabs = [
        { id: 'profile', n: 1, label: 'Profile', hint: 'Identity & metadata' },
        { id: 'stack', n: 2, label: 'Stack', hint: 'Policy & versions' },
        { id: 'hosts', n: 3, label: 'Host Bindings', hint: 'Developer × host runtime' },
        { id: 'workers', n: 4, label: 'Agent Workers', hint: 'Agent identities & roles' },
        { id: 'knowledge', n: 5, label: 'Knowledge', hint: 'Knowledge & Artifact Governance' },
        { id: 'boundaries', n: 6, label: 'Boundaries', hint: 'Read / write / index policy' },
        { id: 'observation', n: 7, label: 'Observatory', hint: 'Evidence & JEV' },
    ];

readonly consumerId = this.route.snapshot.paramMap.get('id') || 'unknown';

readonly consumers = signal<{ id: string; name?: string }[]>([]);

protected readonly hydrated = signal(false);

readonly name = signal('');

readonly owner = signal('');

readonly locale = signal('vi-VN');

readonly tags = signal('');

readonly description = signal('');

readonly jevMode = signal<'off' | 'shadow' | 'active'>('off');

readonly jevConfidence = signal('0.9');

readonly legacyHarness = signal<LegacyHarnessReportDto | null>(null);

readonly legacyLoading = signal(false);

readonly legacyArchiving = signal(false);

readonly legacyArchiveConfirm = signal(false);

readonly legacyNotice = signal('');

readonly legacyError = signal('');

readonly migrationPreview = signal<HarnessMigrationPreviewDto | null>(null);

readonly migrationLoading = signal(false);

readonly migrationApplying = signal(false);

readonly migrationNotice = signal('');

readonly migrationError = signal('');

readonly migrationActionable = computed(() => {
        const preview = this.migrationPreview();
        return Boolean(preview && preview.entries.some((entry) => entry.status === 'new' || entry.status === 'conflict'));
    });

readonly migrationNewCount = computed(() => (this.migrationPreview()?.entries || []).filter((entry) => entry.status === 'new').length);

readonly migrationConflictCount = computed(() => (this.migrationPreview()?.entries || []).filter((entry) => entry.status === 'conflict').length);

readonly migrationConflicts = computed(() => (this.migrationPreview()?.entries || []).filter((entry) => entry.status === 'conflict'));

readonly finishPrompt = signal(false);

readonly finishing = signal(false);

readonly jevAutoThreshold = signal('');

readonly jevConfirmThreshold = signal('');

readonly stackLayers = signal<StackLayer[]>(defaultStackLayers());

readonly stackVersions = signal<StackVersion[]>([{ version: 1, status: 'published', layers: defaultStackLayers() }]);

readonly activeStackVersion = signal(1);

readonly newStackVersion = signal(1);

readonly flowSummaries = signal<FlowSummaryDto[]>([]);

readonly newFlowId = signal('');

readonly newFlowVersion = signal(1);

readonly remoteStackVersions = signal<StackVersion[]>([]);

readonly hostProfiles = signal<HostProfile[]>([]);

readonly plugins = signal<PluginEntry[]>(defaultPlugins());

readonly mcpProviders = signal<McpProviderDto[]>([]);

readonly mcpSources = signal<string[]>([]);

readonly mcpWarnings = signal<string[]>([]);

readonly detectedHosts = signal<Array<{ hostId: string; label: string; markers: string[] }>>([]);

readonly developers = signal<string[]>([]);

readonly workers = signal<WorkerEntry[]>(defaultWorkers());


readonly gateCount = computed(() => this.workers().filter((worker) => worker.layer === 'gate').length);

readonly peerCount = computed(() => this.workers().filter((worker) => worker.layer === 'peer').length);

readonly workerDirty = computed(() => this.workersSettings()?.dirty() ?? false);

readonly hostRuntimes = signal<HostRuntimeDto[]>([]);

readonly hosts = signal<HostDto[]>([]);

readonly workerEdges = signal<WorkerEdge[]>([]);

readonly defaultFlow = signal<FlowDefinitionDto | null>(null);

readonly workerImportDirty = signal(false);

readonly ruleFiles = signal<any[]>([]);

readonly materialCounts = signal<{ skills: number; hooks: number; subagents: number; rules: number }>({ skills: 0, hooks: 0, subagents: 0, rules: 0 });

readonly ruleImporting = signal(false);

readonly ruleImportPreview = signal<any | null>(null);

readonly ruleSelectedHashes = signal<string[]>([]);

readonly ruleImportActions = signal<Record<string, 'skip' | 'replace' | 'copy'>>({});

readonly formationHostIds = signal<string[]>([]);

readonly bindingDeveloper = signal('');

readonly addingHostFor = signal<string | null>(null);

readonly removingDeveloper = signal<string | null>(null);

readonly expandedProfile = signal<string | null>(null);

readonly editingProfile = signal<string | null>(null);

readonly bulkUpgradeOpen = signal(false);

readonly bulkUpgradeTarget = signal<number | null>(null);

readonly deleteVersionConfirm = signal(false);

readonly newHostId = signal('cursor');

readonly newMemorySource = signal('eso-native');

readonly newMemoryProvider = signal('');

readonly newCodeGraphSource = signal('eso-native');

readonly newCodeGraphProvider = signal('');

readonly jiraEnabled = signal(false);

readonly providerRouting = signal<Record<'work' | 'design' | 'content', string>>({ work: 'md', design: 'md', content: 'md' });

readonly consumerPlugins = signal<any[]>([]);

readonly knowledgeProviderRecords = signal<any[]>([]);

readonly jiraProject = signal('');

readonly jiraSyncMode = signal('off');

readonly sdlcEnabled = signal(false);

readonly sdlcPipeline = signal('full');

readonly crProcess = signal(false);

readonly artifactKinds = signal<string[]>(['BRD', 'PRD', 'ADR']);

readonly representations = signal<string[]>(['human', 'agent', 'machine']);

readonly docgraphIndex = signal(true);

readonly docgraphScope = signal('docs/**, sdlc/**, agents/**');

readonly documentStatusRequired = signal(true);

readonly preflightRequired = signal(true);

readonly goNoGoRequired = signal(true);

readonly crossCheckRequired = signal(true);

readonly pipelineContractRequired = signal(true);

readonly openRegisterRequired = signal(true);

readonly buildEnforcementRequired = signal(true);

readonly quartetProfile = signal<'standard' | 'extended'>('standard');

readonly knowledgeSummary = signal<KnowledgeSummaryDto | null>(null);

readonly knowledgeDocs = signal<KnowledgeDocDto[]>([]);

readonly knowledgeFindings = signal<KnowledgeFindingDto[]>([]);

readonly knowledgeDocDetail = signal<KnowledgeDocDetailDto | null>(null);

readonly knowledgeCheck = signal<KnowledgeCheckDto | null>(null);

readonly knowledgeRetrieval = signal<KnowledgeRetrievalDto | null>(null);

readonly knowledgeEmbeddingStatus = signal<KnowledgeEmbeddingStatusDto | null>(null);

readonly knowledgeEmbedding = signal(false);

readonly knowledgeChecking = signal(false);

readonly knowledgeQuery = signal('');

readonly knowledgeIndexing = signal(false);

readonly manifestEnabled = signal(true);

readonly manifestPath = signal('.harness/manifest.json');

readonly manifestHumanHeaderKeys = signal<string[]>(['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'source_of_truth', 'phase']);

readonly manifestAiHeaderKeys = signal<string[]>(['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'human_sot', 'refs']);

readonly manifestFacets = signal<string[]>(['kind', 'origin', 'custodian', 'liveness', 'kt-state', 'owner', 'representation']);

readonly manifestRelations = signal<string[]>(['derived_from', 'source_of_truth', 'human_sot', 'blocks', 'owns_kinds', 'references']);

readonly manifestChecks = signal<string[]>(['links resolve', 'header shape', 'derived ⊆ source', 'no orphan document', 'kind has owner']);

readonly selectedKnowledgeTopic = signal('pipeline');

readonly knowledgeSection = signal<'overview' | 'sources' | 'contract' | 'index' | 'manifest'>('overview');

readonly openDiagram = signal<'main' | 'cr' | 'intent' | 'workers' | null>(null);

readonly consent = signal(true);

readonly events = signal<string[]>(['prompt.submitted', 'turn.completed', 'tool.called']);

readonly policySources = ['host-native', 'eso-native', 'market'];

readonly artifactKindOptions = ['BRD', 'PRD', 'FRD', 'SRS', 'ADR', 'Spec', 'Runbook', 'Manifest', 'WBS', 'WBS dictionary', 'Atomic WBS', 'Decision', 'Open register'];

readonly representationOptions = ['human', 'agent', 'machine'];

readonly manifestFacetOptions = ['kind', 'origin', 'custodian', 'liveness', 'kt-state', 'owner', 'representation'];

readonly manifestRelationOptions = ['derived_from', 'source_of_truth', 'human_sot', 'blocks', 'owns_kinds', 'references'];

readonly manifestHumanHeaderOptions = ['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'source_of_truth', 'phase'];

readonly manifestAiHeaderOptions = ['id', 'type', 'status', 'owner', 'sot_doc_version', 'representation', 'human_sot', 'refs'];

readonly manifestCheckOptions = ['links resolve', 'header shape', 'derived ⊆ source', 'no orphan document', 'kind has owner'];

readonly dorConditions = [
        '4 relations declared: subtasks · relates · blocks · blockedBy',
        'Packet §9 = READY',
        'Work package has all 7 fields',
        'AC cited from the source of truth',
        'One verify line: how QC proves the AC',
        'Named dependencies',
    ];

readonly dodConditions = [
        'SCN run and evidence recorded',
        'DoD evidence complete',
        'Human signs Done',
        'Agent is forbidden to sign Done',
    ];

readonly pipelineOptions = [
        { id: 'full', label: 'Full pipeline' },
        { id: 'ba-dev', label: 'BA → DEV' },
        { id: 'dev-qc', label: 'DEV → QC' },
        { id: 'qc', label: 'QC only' },
    ];

ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('id')!;
        const requestedTab = this.route.snapshot.queryParamMap.get('tab');
        if (requestedTab === 'plugins') {
            void this.router.navigate(['/consumers', id, 'plugins'], { replaceUrl: true });
            return;
        }
        const tab = requestedTab === 'jira' ? 'knowledge' : requestedTab;
        if (tab && this.tabs.some((item) => item.id === tab)) this.activeTab.set(tab);
        this.route.queryParamMap.subscribe((params) => {
            const next = params.get('tab');
            if (next && this.tabs.some((item) => item.id === next)) this.activeTab.set(next);
        });
        const requestedSection = this.route.snapshot.queryParamMap.get('section');
        if (tab === 'knowledge' && ['overview', 'sources', 'contract', 'index', 'manifest'].includes(requestedSection || '')) {
            this.knowledgeSection.set(requestedSection as 'overview' | 'sources' | 'contract' | 'index' | 'manifest');
        }
        this.service.list().then((result) => this.consumers.set((result.items ?? []).map((item) => ({ id: item.id, name: item.name })))).catch(() => this.consumers.set([]));
        Promise.all([
            this.service.get(id),
            this.service.getMcp(id).catch(() => ({ consumerId: id, root: '', sources: [], providers: [], warnings: [] })),
            this.service.getDetectedHosts(id).catch(() => ({ consumerId: id, root: '', detected: [] })),
            this.service.getStackVersions(id).catch(() => ({ consumerId: id, versions: [] })),
            this.service.getHostRuntimes().catch(() => [] as HostRuntimeDto[]),
            this.service.getHosts().catch(() => [] as HostDto[]),
        ])
            .then(([profile, mcp, detectedHosts, versions, hostRuntimes, hosts]) => {
                this.mcpProviders.set(mcp.providers);
                this.mcpSources.set(mcp.sources);
                this.mcpWarnings.set(mcp.warnings);
                this.detectedHosts.set(detectedHosts.detected);
                this.hostRuntimes.set(hostRuntimes);
                this.hosts.set(hosts);
                const activeHosts = hosts.filter((host) => host.runtimes.some((runtime) => runtime.health !== 'offline'));
                if (!activeHosts.some((host) => host.hostId === this.newHostId()) && activeHosts.length > 0) {
                    this.newHostId.set(activeHosts[0].hostId);
                }
                this.remoteStackVersions.set(versions.versions.map((item: any) => ({
                    version: Number(item.version) || 1,
                    status: item.status,
                    layers: this.normalizeLayers(item.layers as StackLayer[]),
                    publishedAt: item.publishedAt ?? undefined,
                })));
                this.current.set(profile);
                this.hydrate(profile);
                void this.refreshLegacyHarness();
                void this.loadMigrationPreview();
            })
            .catch((err) => {
                const status = (err as { status?: number })?.status;
                this.errorCode.set(status === 401 || status === 403 ? 'PROFILE_DENIED' : 'PROFILE_UPSTREAM_FAILED');
                this.error.set((err as { detail?: string; message?: string })?.detail || (err as Error)?.message || 'Unable to load consumer');
            })
            .finally(() => this.loading.set(false));
    }
}
