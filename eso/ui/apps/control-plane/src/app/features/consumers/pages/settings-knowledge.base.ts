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
import { ReconciliationService } from '../services/reconciliation.service.js';
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
import type { HostProfile, LayerId, LegacyHostProfile, PluginEntry, StackLayer, StackVersion, StackVersionStatus, WorkerEdge, WorkerEntry, ConsumerArtifactDto, HostProjectionArtifactDto } from './consumer-settings.models.js';
import type { ConsumerProfile, HostDto, KnowledgeSummaryDto, KnowledgeDocDto, KnowledgeFindingDto, KnowledgeDocDetailDto, KnowledgeCheckDto, KnowledgeRetrievalDto, KnowledgeEmbeddingStatusDto, McpProviderDto, WorkerConfigDto, EvidenceRequirementDto, FlowSummaryDto, FlowDefinitionDto, HostRuntimeDto, LegacyHarnessReportDto, HarnessMigrationPreviewDto } from '../../../../../../../libs/api-client/types.js';

/**
 * Only remaining occurrence of the pre-P0.3 host-binding key: settings saved by an older UI.
 * They are migrated to `hostId` once on load; everything new reads and writes `hostId` only.
 * The API, host discovery, and worker bindings all use `hostId`.
 */
import { SettingsHostsBase } from './settings-hosts.base.js';
export abstract class SettingsKnowledgeBase extends SettingsHostsBase {
protected readonly reconciliationService = inject(ReconciliationService);
/** BUG-15: `/knowledge/docs` returns at most this many rows (server clamps to 50). */
readonly knowledgeDocsLimit = 50;

/** BUG-16: findings counters are hidden at zero instead of printing a contradictory `0`. */
readonly knowledgeFindingsCount = computed(() => this.knowledgeSummary()?.findings || 0);

back(): void { const id = this.route.snapshot.paramMap.get('id'); this.router.navigate(['/consumers', id]); }

pipelineGroups(): Array<{ id: string; title: string; stages: Array<{ id: string; label: string; role: string; gate: string; artifact: string }> }> {
        return [
            { id: 'A', title: 'Requirements (PO · BA)', stages: [
                { id: 'S1', label: 'Pain & Vision', role: 'PO', gate: 'G1', artifact: '04.inception/01.vision' },
                { id: 'S2', label: 'Goals & Objectives', role: 'PO (PM)', gate: 'G2', artifact: '04.inception/03.objectives' },
                { id: 'S3', label: 'BRD (Business Req)', role: 'BA', gate: 'G3', artifact: '05.requirements/01.specification/02.brd' },
                { id: 'S4', label: 'PRD (Product Req)', role: 'PO', gate: 'G4', artifact: '05.requirements/01.specification/01.prd' },
                { id: 'S5', label: 'FRD (Functional Req)', role: 'BA', gate: 'G5', artifact: '05.requirements/01.specification/03.frd' },
                { id: 'S6', label: 'SRS (System Req)', role: 'BA', gate: 'G6', artifact: '05.requirements/01.specification/04.srs' },
                { id: 'S7', label: 'US & AC (User Stories)', role: 'BA', gate: 'G7', artifact: '06.analysis/01.us & 02.ac' },
            ] },
            { id: 'B', title: 'Technical Design (TECH)', stages: [
                { id: 'S8', label: 'API Contracts', role: 'TECH', gate: 'G8', artifact: '07.design/02.api' },
                { id: 'S9', label: 'Data Schema', role: 'TECH', gate: 'G9', artifact: '07.design/03.data' },
                { id: 'S10', label: 'Architecture C4 & NFR', role: 'TECH', gate: 'G10', artifact: '07.design/01.architecture' },
            ] },
            { id: 'C', title: 'Breakdown & Test Spec (PM · TECH · QC)', stages: [
                { id: 'S11', label: 'WBS & Work Packages', role: 'PM', gate: 'G11', artifact: '08.work-breakdown/01.wbs' },
                { id: 'S12', label: 'BIP / FIP Packets', role: 'TECH', gate: 'G12', artifact: '08.work-breakdown/02.packets' },
                { id: 'S13', label: 'SCN Matrix & RTM', role: 'QC', gate: 'G13', artifact: '06.analysis/03.scn & 04.rtm' },
            ] },
            { id: 'D', title: 'Delivery & Acceptance (DEV · QC · PM · HUMAN)', stages: [
                { id: 'S14', label: 'Code & Unit TDD', role: 'DEV', gate: 'G14', artifact: 'packages/* / apps/*' },
                { id: 'S15', label: 'Run SCN & Test Evidence', role: 'QC', gate: 'G15', artifact: '09.test-plan/02.test-runs' },
                { id: 'S16', label: 'DoD & Acceptance Review', role: 'QC & PM', gate: 'G16', artifact: '12.phases/*/06.acceptance' },
                { id: 'S17', label: 'Human Sign-off (Done)', role: 'HUMAN', gate: '—', artifact: '12.phases/*/07.closure' },
            ] },
        ];
    }

crossCheckGroups(): Array<{ label: string; ids: string }> {
        return [
            { label: 'Links & provenance', ids: 'X1 · X28 · X40' },
            { label: 'Shape & identity', ids: 'X2 · X6 · X7 · X21 · X25 · X26 · X32' },
            { label: 'Traceability', ids: 'X3 · X3b · X4 · X11–X20 · X30 · X31 · X41' },
            { label: 'Packets & delivery', ids: 'X8 · X8a · X22 · X33–X39 · X42' },
            { label: 'Records & metrics', ids: 'X23 · X24 · X27 · X35 · X37' },
            { label: 'Engineering', ids: 'X5 · X9 · X9b · X10' },
            { label: 'UI', ids: 'X14 · X15' },
        ];
    }

taskHierarchy(): Array<{ model: string; detail: string }> {
        return [
            { model: 'Epic / Feature → Story → Subtask', detail: 'subtask types: fe · be · qa · qc · pm' },
            { model: 'Epic / Feature → Task → Subtask', detail: 'task decomposition for implementation work' },
            { model: 'Epic → Bug', detail: 'defect track; no quartet required' },
        ];
    }

manifestFacetCount(): number { return this.manifestFacets().length; }

manifestRelationCount(): number { return this.manifestRelations().length; }

manifestCheckCount(): number { return this.manifestChecks().length; }

manifestSharedKeys(): number {
        const ai = new Set(this.manifestAiHeaderKeys());
        return this.manifestHumanHeaderKeys().filter((key) => ai.has(key)).length;
    }

manifestPreview(): string {
        return JSON.stringify({
            enabled: this.manifestEnabled(),
            path: this.manifestPath(),
            human_header: this.manifestHumanHeaderKeys(),
            ai_header: this.manifestAiHeaderKeys(),
            facets: this.manifestFacets(),
            relations: this.manifestRelations(),
            checks: this.manifestChecks(),
        }, null, 2);
    }

toggleManifestHumanHeader(key: string): void {
        this.manifestHumanHeaderKeys.update((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
    }

toggleManifestAiHeader(key: string): void {
        this.manifestAiHeaderKeys.update((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
    }

toggleManifestFacet(facet: string): void {
        this.manifestFacets.update((items) => items.includes(facet) ? items.filter((item) => item !== facet) : [...items, facet]);
    }

toggleManifestRelation(relation: string): void {
        this.manifestRelations.update((items) => items.includes(relation) ? items.filter((item) => item !== relation) : [...items, relation]);
    }

toggleManifestCheck(check: string): void {
        this.manifestChecks.update((items) => items.includes(check) ? items.filter((item) => item !== check) : [...items, check]);
    }

artifactModelRows(): Array<{ label: string; value: string }> {
        return [
            { label: 'Facets', value: 'kind · origin · custodian · liveness · kt-state · owner' },
            { label: 'Relations', value: 'derived_from · owns-kinds · blocks' },
            { label: 'Authority', value: 'derived if derived_from; source if human or approved; else derived' },
            { label: 'Tiers', value: 'standard · template · instance · ledger · render' },
            { label: 'Owner rule', value: 'if missing/wrong, who is asked — not who writes' },
        ];
    }

knowledgeTrace(): Array<{ label: string; value: string }> {
        switch (this.selectedKnowledgeTopic()) {
            case 'pipeline':
            case 'preflight':
            case 'go-no-go':
            case 'pipeline-contract':
            case 'build-enforcement':
                return [
                    { label: 'Pain', value: 'P4 — decision before build' },
                    { label: 'Goal', value: 'G-K — verdict before write' },
                    { label: 'Objective', value: 'No objective registered — gap to close' },
                    { label: 'BRD', value: 'BR-10 · BR-11 · BR-12' },
                    { label: 'PRD', value: 'F-09 · F-10 · F-11' },
                ];
            case 'document-status':
            case 'cross-check':
                return [
                    { label: 'Pain', value: 'P7 — knowledge sufficiency' },
                    { label: 'Goal', value: 'G-G artifacts · G-H sufficiency · G-Q HUMAN/AI' },
                    { label: 'Objective', value: 'No dedicated objective yet — gap to close' },
                    { label: 'BRD', value: 'BR-14 · BR-15 · BR-16 · BR-17' },
                    { label: 'PRD', value: 'F-14 · F-15 · F-27' },
                ];
            case 'quartet':
                return [
                    { label: 'Pain', value: 'No direct product pain registered' },
                    { label: 'Goal', value: 'No direct goal; task taxonomy is provider-facing' },
                    { label: 'Objective', value: 'Not registered' },
                    { label: 'BRD', value: 'BR-05 · BR-15' },
                    { label: 'PRD', value: 'F-33 provider sync' },
                ];
            case 'agent-manifests':
                return [
                    { label: 'Pain', value: 'P7 — artifact sufficiency · P8 HUMAN/AI docs' },
                    { label: 'Goal', value: 'G-G visible artifacts · G-H content · G-Q HUMAN/AI' },
                    { label: 'Objective', value: 'No dedicated objective yet — gap to close' },
                    { label: 'BRD', value: 'BR-14 · BR-16 · BR-17' },
                    { label: 'PRD', value: 'F-14 · F-15 · F-27' },
                ];
            case 'knowledge-base':
                return [
                    { label: 'Pain', value: 'P7 — artifact sufficiency' },
                    { label: 'Goal', value: 'G-G visible · G-H content · G-I transfer · G-N freshness' },
                    { label: 'Objective', value: 'No dedicated objective yet — gap to close' },
                    { label: 'BRD', value: 'BR-14 · BR-16 · BR-17 · BR-18' },
                    { label: 'PRD', value: 'F-14 · F-15 · F-17 · F-27' },
                ];
            case 'docgraph':
                return [
                    { label: 'Pain', value: 'P2 architecture · P7 knowledge' },
                    { label: 'Goal', value: 'G-B1/G-B2 · G-H' },
                    { label: 'Objective', value: 'No dedicated objective yet — gap to close' },
                    { label: 'BRD', value: 'BR-17 · BR-18' },
                    { label: 'PRD', value: 'F-20 · F-21' },
                ];
            case 'providers':
                return [
                    { label: 'Pain', value: 'P1 host portability · P7 knowledge' },
                    { label: 'Goal', value: 'G-C additive · G-G ownership' },
                    { label: 'Objective', value: 'O-8 stack/host · provider binding pending' },
                    { label: 'BRD', value: 'BR-18 · BR-31' },
                    { label: 'PRD', value: 'F-22 · F-33' },
                ];
            default:
                return [];
        }
    }

diagramSrc(): string {
        if (this.openDiagram() === 'cr') return 'assets/diagrams/02.cr-pipeline.png';
        if (this.openDiagram() === 'intent') return 'assets/diagrams/03.intent-pipeline.png';
        if (this.openDiagram() === 'workers') return 'assets/diagrams/that-tinh-tran-diagram.svg';
        return 'assets/diagrams/01.main-pipeline.png';
    }

diagramTitle(): string {
        if (this.openDiagram() === 'cr') return 'CR pipeline';
        if (this.openDiagram() === 'intent') return 'Intent pipeline';
        if (this.openDiagram() === 'workers') return 'Seven-Star Formation';
        return 'Main SDLC pipeline';
    }

pipelineHint(): string {
        switch (this.sdlcPipeline()) {
            case 'req-tech': return 'PO/BA requirements → TECH design (S1–S10)';
            case 'build-qc': return 'PM breakdown → DEV code → QC SCN (S11–S16)';
            case 'ba-dev': return 'PO/BA requirements → TECH design (S1–S10)';
            case 'dev-qc': return 'PM breakdown → DEV code → QC SCN (S11–S16)';
            case 'qc': return 'Verification & acceptance only';
            default: return '17 stages · 16 gates · 3 checkpoints';
        }
    }

referenceSummary(): Array<{ id: string; label: string; count: number; lastSyncedAt: string | null }> {
        const groups = new Map<string, any[]>();
        for (const record of this.knowledgeProviderRecords()) {
            const list = groups.get(record.provider_id) || [];
            list.push(record);
            groups.set(record.provider_id, list);
        }
        return [...groups.entries()].map(([id, records]) => {
            const plugin = this.consumerPlugins().find((item) => item.id === id);
            const dates = records.map((record) => record.synced_at).filter(Boolean).sort();
            return {
                id,
                label: plugin?.label || id,
                count: records.length,
                lastSyncedAt: dates.length ? new Date(dates[dates.length - 1]).toLocaleString() : null,
            };
        });
    }

providerRouteSummary(): string {
        const routing = this.providerRouting();
        const selected = [routing.work, routing.design, routing.content].filter((value) => value !== 'md');
        return selected.length === 0 ? 'Files (.md)' : selected.join(' · ');
    }

governanceEnabledCount(): number {
        return [this.documentStatusRequired(), this.openRegisterRequired(), this.crossCheckRequired(), this.buildEnforcementRequired(), this.preflightRequired(), this.goNoGoRequired(), this.pipelineContractRequired()].filter(Boolean).length;
    }

showKnowledgeSection(section: 'overview' | 'sources' | 'contract' | 'index' | 'manifest' | 'artifacts'): void {
        this.knowledgeSection.set(section);
        if (section === 'contract') this.selectedKnowledgeTopic.set('pipeline');
        if (section === 'manifest') this.selectedKnowledgeTopic.set('agent-manifests');
        if (section === 'sources') this.selectedKnowledgeTopic.set('knowledge-base');
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { section },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }

selectKnowledgeTopic(topic: string): void {
        this.selectedKnowledgeTopic.set(topic);
    }

knowledgeDetail(): { eyebrow: string; title: string; description: string; items: Array<{ label: string; value: string }> } {
        switch (this.selectedKnowledgeTopic()) {
            case 'document-status':
                return {
                    eyebrow: 'Governance · document status',
                    title: 'Document status register',
                    description: 'The register is a precondition, not a report. Without it, "documented" is an opinion.',
                    items: [
                        { label: 'Levels', value: 'exists · conforms · connected' },
                        { label: 'Lifecycle', value: 'raw → proposed → approved → retired' },
                        { label: 'Marks', value: 'OK · P (gap named) · OUT (reason) · — (nothing)' },
                        { label: 'Why', value: 'Every downstream gate reads the register.' },
                    ],
                };
            case 'open-register':
                return {
                    eyebrow: 'Governance · open register',
                    title: 'OPEN register',
                    description: 'The single place for questions that are not decided. A missing register means unknowns become opinions.',
                    items: [
                        { label: 'Contains', value: 'open id · question · owner · what unblocks · decision link' },
                        { label: 'Rule', value: 'No OPEN item without an owner and a decision path.' },
                        { label: 'Close', value: 'A decision closes it; the decision must cite the open id.' },
                        { label: 'Status', value: 'OPEN · DECIDED · DROPPED (reason)' },
                    ],
                };
            case 'build-enforcement':
                return {
                    eyebrow: 'Governance · build enforcement',
                    title: 'Build enforcement',
                    description: 'A standard without enforcement is advice. E1–E10 make the gates bite before code.',
                    items: [
                        { label: 'E-series', value: 'E1…E10: packet, test-first, gate machine, verify, audit, human Done' },
                        { label: 'Ready', value: 'Only READY packets build; READY-SPLIT/DRAFT/OPEN do not.' },
                        { label: 'Fail', value: 'Build stops with a named OPEN id and owner.' },
                        { label: 'Evidence', value: 'Independent verify + audit; agent never signs Done.' },
                    ],
                };
            case 'cross-check':
                return {
                    eyebrow: 'Governance · cross-check (CHK1)',
                    title: 'Cross-check catalogue',
                    description: 'Quantitative verification checks across the pipeline: CHK1 (Requirements after S7), G13/CHK3 (AC↔SCN after S13), and CHK2 (Increment before S14).',
                    items: [
                        { label: 'Catalogue', value: 'X1…X42 · 47 quantitative checks' },
                        { label: 'CHK1 (Req)', value: 'X1, X2, X4–X7, X16–X20 (Vision, Obj, BRD, PRD, FRD, SRS, US/AC)' },
                        { label: 'CHK3 (Slice)', value: 'X3 (1:1 AC ↔ SCN) + 8/8 pre-code stages 0–7' },
                        { label: 'CHK2 (Incr)', value: 'X8/X8a (packet), X9 (API↔Data), X10 (revision), X21/X22/X34–X36' },
                        { label: 'Trace & shape', value: 'X3 · X4 · X7 · X8a · X11–X20' },
                        { label: 'Delivery', value: 'X8 · X22 · X33–X39 · X42' },
                        { label: 'UI & paths', value: 'X14 prototype · X15 reachable flow · X28 paths' },
                        { label: 'Rule', value: 'Missing check = no status claim.' },
                    ],
                };
            case 'preflight':
                return {
                    eyebrow: 'Governance · preflight (CHK3)',
                    title: 'Preflight before slice (CHK3)',
                    description: 'Pre-flight DoR per slice after S13. Verifies all 8 pre-code stages (0–7), 1:1 AC ↔ SCN mapping (X3), and implementation packet §9 = READY before code.',
                    items: [
                        { label: 'Scope', value: 'One atomic work package / slice (S11 WBS leaf)' },
                        { label: 'Pre-flight DoR', value: 'All 8 pre-code stages (0–7) marked OK or P with open id' },
                        { label: 'Check X3', value: '1:1 bidirectional mapping: Acceptance Criteria ↔ SCN' },
                        { label: 'Packet', value: 'BIP (BE) / FIP (FE) §9 = READY; DRAFT/OPEN blocks build' },
                        { label: 'Pass / Fail', value: 'Pass → proceed to S14; Fail → remains Backlog + needs-dor' },
                    ],
                };
            case 'go-no-go':
                return {
                    eyebrow: 'Governance · go / no-go (CHK2)',
                    title: 'Go / No-Go increment dashboard (CHK2)',
                    description: 'Dashboard over the entire increment before S14 code. Ensures Docs Ready criteria and cross-checks are satisfied before starting epic execution.',
                    items: [
                        { label: 'Scope', value: 'Entire increment / epic' },
                        { label: 'Docs Ready', value: 'REQ ∩ US/AC ∩ SCN ∩ IF ∩ DATA + BIP/FIP' },
                        { label: 'Cross-checks', value: 'X8, X8a, X9, X10, X21, X22, X34–X36 verified' },
                        { label: 'Marks', value: 'OK · P with open_id · OUT with reason · — blocks' },
                        { label: 'Gate', value: 'All slices must pass CHK3 + epic passes CHK2 before DEV build' },
                    ],
                };
            case 'pipeline-contract':
                return {
                    eyebrow: 'Governance · pipeline contract',
                    title: 'Pipeline contract gates',
                    description: 'The contract makes each stage consume the previous stage by reference. Gates are document conditions, not task-tool statuses.',
                    items: [
                        { label: 'Stages', value: 'S1 Pain/Vision → S17 Done (17 sequential stages)' },
                        { label: 'Gates', value: 'G1…G16 · CHK1 (Req) · CHK3 (DoR) · CHK2 (Go/No-Go)' },
                        { label: 'Authority', value: 'REQ → US/AC → Contracts/Schema → WBS → BIP/FIP → SCN → code' },
                        { label: 'Change', value: 'CR reopens S7 / S8 / S12 / S14; authority never reverses' },
                        { label: 'Done', value: 'Human signs; agent is strictly forbidden' },
                    ],
                };
            case 'quartet':
                return {
                    eyebrow: 'Task management · delivery spectrum',
                    title: 'Delivery test spectrum (S14–S15)',
                    description: 'Decomposition of an atomic Work Package (S11) and READY Packet §9 (S12) into test-first delivery subtasks. Tiered test profiles prevent test fatigue.',
                    items: [
                        { label: 'Core Quartet', value: 'tdd-unit (RED) → tdd-impl (GREEN) → tdd-coverage (≥80%) → tdd-qc (SCN evidence)' },
                        { label: 'High Assurance', value: 'tdd-property (fast-check / Hypothesis) + tdd-mutation (Stryker Mutator)' },
                        { label: 'Frontend UI', value: 'tdd-visual (Playwright pixel diff) + tdd-a11y (axe-core WCAG 2.1)' },
                        { label: 'Integration', value: 'tdd-contract (Pact / Prism OpenAPI) + tdd-security (RBAC / Fuzzing)' },
                        { label: 'Runtime System', value: 'tdd-load + tdd-stress (k6) + tdd-chaos (Toxiproxy fault injection)' },
                        { label: 'Profiles', value: 'Standard · High Assurance · Frontend UI · Integration · Runtime Engine · Full Spectrum' },
                        { label: 'Input', value: '1 atomic WBS leaf (S11) + 1 READY BIP/FIP packet §9 (S12)' },
                        { label: 'BA role', value: 'OUT in SDLC project mode (BA already finalized in S3–S7)' },
                        { label: 'Rule', value: 'Packet declares test profile; DEV implements only declared test kinds' },
                    ],
                };
            case 'agent-manifests':
                return {
                    eyebrow: 'Knowledge · agent manifest',
                    title: 'Agent manifest standard',
                    description: 'A machine-readable map of this consumer\'s documents: identity, header shape, facets, relations, paths, and checks. The agent reads the manifest instead of crawling the tree.',
                    items: [
                        { label: 'Identity', value: 'consumer · root · manifest_version' },
                        { label: 'Documents', value: 'path · id · kind · status · owner · representation' },
                        { label: 'Kinds', value: 'HUMAN 8 keys · AI 8 keys · required sections · owner' },
                        { label: 'Relations', value: 'derived_from · source_of_truth · human_sot · blocks · owns_kinds · references' },
                        { label: 'Paths', value: 'relative locators, never identity' },
                        { label: 'Checks', value: 'links resolve · header shape · derived ⊆ source · no orphan · owner exists' },
                        { label: 'Study reference', value: 'sdlc/01.agent-manifests is an eso-harness sample, not testeso data' },
                    ],
                };
            case 'knowledge-base':
                return {
                    eyebrow: 'Knowledge · base',
                    title: 'Knowledge base',
                    description: 'Artifacts held for the consumer, classified by kind and representation.',
                    items: [
                        { label: 'Facets', value: 'kind · origin · custodian · liveness · kt-state · owner' },
                        { label: 'Add', value: 'representation: human / agent / machine' },
                        { label: 'WBS', value: 'WBS tree · WBS dictionary · atomic work package' },
                        { label: 'Rule', value: '100% rule; leaf owns AC; no orphan work' },
                        { label: 'No copy', value: 'derived ⊆ source' },
                    ],
                };
            case 'docgraph':
                return {
                    eyebrow: 'Knowledge · document graph',
                    title: 'Document graph',
                    description: 'A derived index of relationships. It never owns document content.',
                    items: [
                        { label: 'Indexes', value: 'docs · sdlc · agents · external refs' },
                        { label: 'Owns', value: 'edges + provenance, not content' },
                        { label: 'Scope', value: 'docs/**, sdlc/**, agents/**' },
                        { label: 'Excludes', value: 'generated files and provider copies by default' },
                    ],
                };
            case 'providers':
                return {
                    eyebrow: 'Knowledge · providers',
                    title: 'Optional providers',
                    description: 'Jira, Notion, Confluence, Figma are sources of truth only for the kinds they declare.',
                    items: [
                        { label: 'Jira', value: 'task · story · bug' },
                        { label: 'Notion / Confluence', value: 'knowledge · documents' },
                        { label: 'Figma', value: 'design · artifacts' },
                        { label: 'Rule', value: 'one SoT per kind; sync one-way; no two-way' },
                    ],
                };
            default:
                return {
                    eyebrow: 'Project mode · pipeline',
                    title: 'SDLC pipeline',
                    description: 'Seventeen stages, sixteen gates, and three inspection checkpoints (CHK1 · CHK3 · CHK2). Strictly sequential role handoffs (PO → BA → TECH → PM → QC → DEV → QC/PM → HUMAN). CR reopens affected stages.',
                    items: [
                        { label: 'Intent trace', value: 'P1–P8 → Vision (S1) → Goals/Obj (S2) → BRD (S3) → PRD (S4) → FRD/SRS (S5-6) → US/AC (S7)' },
                        { label: 'Stages', value: 'S1…S17 · 17 sequential stages · strict handoff' },
                        { label: 'Checkpoints', value: 'CHK1 (Req cross-checks) → CHK3 (Pre-flight DoR) → CHK2 (Go/No-Go increment)' },
                        { label: 'Roles', value: 'PO (S1-2, S4) · BA (S3, S5-7) · TECH (S8-10, S12) · PM (S11) · QC (S13, S15, S16) · DEV (S14) · HUMAN (S17)' },
                        { label: 'A · requirements', value: 'S1 Vision (PO) → S2 Goals (PO/PM) → S3 BRD (BA) → S4 PRD (PO) → S5 FRD (BA) → S6 SRS (BA) → S7 US/AC (BA) [CHK1]' },
                        { label: 'B · technical', value: 'S8 API Contracts (TECH) → S9 Data Schema (TECH) → S10 C4 & NFR (TECH)' },
                        { label: 'C · breakdown', value: 'S11 WBS (PM) → S12 BIP/FIP (TECH) → S13 SCN matrix (QC) [CHK3 + CHK2]' },
                        { label: 'D · delivery', value: 'S14 Code TDD (DEV) → S15 Run SCN (QC) → S16 DoD (QC/PM) → S17 Done (HUMAN)' },
                        { label: 'Gates', value: 'G1…G16 · document conditions, not task status' },
                        { label: 'DoR (CHK3)', value: '8/8 pre-code stages (0–7) + X3 1:1 AC↔SCN + Work packet §9 READY' },
                        { label: 'Go/No-Go (CHK2)', value: 'Docs Ready: REQ ∩ US/AC ∩ SCN ∩ IF ∩ DATA + BIP/FIP' },
                        { label: 'DoD (S16)', value: 'D-116: E2E scenario + JSON evidence + 6 tests + smoke pass' },
                        { label: 'CR process', value: 'Reopens S7 / S8 / S12 / S14; authority never reverses' },
                        { label: 'Done (S17)', value: 'Human signs; agent is strictly forbidden' },
                    ],
                };
        }
    }

quartetTypes(): Array<{ id: string; label: string; note: string; tool: string; included: boolean }> {
        const profile = this.quartetProfile();
        const isExtended = profile === 'extended';
        return [
            // Core Delivery Quartet (Always active for all code work)
            { id: 'tdd-unit', label: 'unit', note: 'unit test first', tool: 'Vitest / Jest / Pytest', included: true },
            { id: 'tdd-impl', label: 'impl', note: 'DEV implementation', tool: 'TypeScript / Go / Python', included: true },
            { id: 'tdd-coverage', label: 'coverage', note: 'gate threshold ≥80%', tool: 'c8 / Istanbul', included: true },
            { id: 'tdd-qc', label: 'qc', note: 'SCN matrix verification', tool: 'evidence.json', included: true },

            // High Assurance & Math Invariants
            { id: 'tdd-property', label: 'property', note: 'invariants & generative fuzzing', tool: 'fast-check / Hypothesis', included: profile === 'assurance' || isExtended },
            { id: 'tdd-mutation', label: 'mutation', note: 'test suite quality / kill mutants', tool: 'Stryker Mutator / Mutmut', included: profile === 'assurance' || isExtended },

            // Frontend & UI Experience
            { id: 'tdd-visual', label: 'visual', note: 'visual regression / pixel diff', tool: 'Playwright / Percy', included: profile === 'frontend' || isExtended },
            { id: 'tdd-a11y', label: 'a11y', note: 'accessibility WCAG 2.1 checks', tool: 'axe-core / Lighthouse', included: profile === 'frontend' || isExtended },

            // Integration & API Security
            { id: 'tdd-contract', label: 'contract', note: 'consumer-driven API contracts', tool: 'Pact / Prism OpenAPI', included: profile === 'integration' || isExtended },
            { id: 'tdd-security', label: 'security', note: 'RBAC boundary & auth fuzzing', tool: 'OWASP ZAP / Semgrep', included: profile === 'integration' || isExtended },

            // Runtime Engine & Resilience
            { id: 'tdd-load', label: 'load', note: 'throughput & latency SLA', tool: 'k6 / Artillery', included: profile === 'runtime' || isExtended },
            { id: 'tdd-stress', label: 'stress', note: 'breaking point & capacity', tool: 'k6 stress scenario', included: profile === 'runtime' || isExtended },
            { id: 'tdd-chaos', label: 'chaos', note: 'fault injection & network cut', tool: 'Toxiproxy / Testcontainers', included: profile === 'runtime' || isExtended },

            // Legacy / Fallback
            { id: 'tdd-ba', label: 'ba', note: 'OUT in SDLC (finalized S3–S7)', tool: 'N/A', included: false },
        ];
    }

toggleArtifactKind(kind: string): void {
        this.artifactKinds.update((kinds) => kinds.includes(kind) ? kinds.filter((item) => item !== kind) : [...kinds, kind]);
    }

toggleRepresentation(representation: string): void {
        this.representations.update((items) => items.includes(representation) ? items.filter((item) => item !== representation) : [...items, representation]);
    }


    readonly consumerArtifacts = signal<ConsumerArtifactDto[]>([]);
    readonly artifactsLoading = signal(false);
    readonly artifactFilterOrigin = signal<string>('all');
    readonly artifactFilterKtState = signal<string>('all');
    readonly projectionSyncTimestamp = signal<string>(new Date().toISOString());

    readonly hostProjections = computed<HostProjectionArtifactDto[]>(() => {
        const syncTime = this.projectionSyncTimestamp();
        return [
            {
                target: 'Antigravity (.agents/)',
                path: '.agents/',
                description: 'Rules, skills, subagents, and MCP configurations projected for Antigravity host.',
                status: 'generated',
                fileCount: 24,
                lastGeneratedAt: syncTime,
            },
            {
                target: 'Cursor (.cursor/)',
                path: '.cursor/',
                description: 'Cursor rules, skills, subagents, and hooks generated from canonical source.',
                status: 'generated',
                fileCount: 18,
                lastGeneratedAt: syncTime,
            },
            {
                target: 'DSH & Local (AGENTS.local.md)',
                path: 'AGENTS.local.md',
                description: 'Single-source markdown mirror for tools and DSH sessions that do not read directory trees.',
                status: 'synced',
                fileCount: 1,
                lastGeneratedAt: syncTime,
            },
        ];
    });

    syncHostProjections(): void {
        this.projectionSyncTimestamp.set(new Date().toISOString());
        this.loadConsumerArtifacts(this.consumerId);
    }

    loadConsumerArtifacts(consumerId: string): void {
        this.artifactsLoading.set(true);
        this.service.listArtifacts(consumerId, {
            origin: this.artifactFilterOrigin(),
            ktState: this.artifactFilterKtState(),
        })
            .then((items) => {
                const list = Array.isArray(items) ? items : [];
                this.consumerArtifacts.set(list as ConsumerArtifactDto[]);
            })
            .catch(() => {
                this.consumerArtifacts.set([]);
            })
            .finally(() => {
                this.artifactsLoading.set(false);
            });
    }

    promoteArtifact(artifactId: string): void {
        const profile = this.current();
        if (!profile) return;
        this.artifactsLoading.set(true);

        // Find artifact before promotion to retrieve associated gapId
        const target = this.consumerArtifacts().find((a) => a.id === artifactId);
        const gapId = (target?.metadata as any)?.gapId;

        this.service.promoteArtifact(profile.id, artifactId)
            .then((promoted) => {
                this.saved.set(true);
                const resolvedGapId = gapId || ((promoted as any)?.metadata as any)?.gapId;
                if (resolvedGapId) {
                    this.reconciliationService.markGapResolved(resolvedGapId, profile.id);
                }
                this.loadConsumerArtifacts(profile.id);
            })
            .catch((err) => {
                this.error.set(err?.message || 'Failed to promote artifact');
            })
            .finally(() => {
                this.artifactsLoading.set(false);
            });
    }

    protected loadKnowledgeIndex(id: string): void {
        this.service.getKnowledge(id)
            .then((summary) => this.knowledgeSummary.set(summary))
            .catch(() => this.knowledgeSummary.set(null));
        this.loadKnowledgeDetails(id);
        this.loadConsumerArtifacts(id);
    }

loadKnowledgeDetails(id: string): void {
        this.service.getKnowledgeDocs(id, this.knowledgeQuery())
            .then((docs) => this.knowledgeDocs.set(docs))
            .catch(() => this.knowledgeDocs.set([]));
        this.service.getKnowledgeFindings(id)
            .then((findings) => this.knowledgeFindings.set(findings))
            .catch(() => this.knowledgeFindings.set([]));
        this.service.getKnowledgeSufficiency(id)
            .then((sufficiency) => this.knowledgeSufficiency.set(sufficiency))
            .catch(() => this.knowledgeSufficiency.set(null));
        this.service.getKnowledgeEmbeddings(id)
            .then((status) => this.knowledgeEmbeddingStatus.set(status))
            .catch(() => this.knowledgeEmbeddingStatus.set(null));
    }

selectKnowledgeDoc(doc: KnowledgeDocDto): void {
        const profile = this.current();
        if (!profile) return;
        this.service.getKnowledgeDoc(profile.id, doc.doc_id)
            .then((detail) => this.knowledgeDocDetail.set(detail))
            .catch(() => this.knowledgeDocDetail.set(null));
    }

searchKnowledge(): void {
        const profile = this.current();
        if (!profile) return;
        const query = this.knowledgeQuery().trim();
        if (!query) {
            this.knowledgeRetrieval.set(null);
            this.loadKnowledgeDetails(profile.id);
            return;
        }
        this.service.retrieveKnowledge(profile.id, query)
            .then((result) => this.knowledgeRetrieval.set(result))
            .catch(() => this.knowledgeRetrieval.set(null));
    }

embedKnowledge(): void {
        const profile = this.current();
        if (!profile || this.knowledgeEmbedding()) return;
        this.knowledgeEmbedding.set(true);
        this.service.embedKnowledge(profile.id)
            .then(() => this.loadKnowledgeDetails(profile.id))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Embedding failed'))
            .finally(() => this.knowledgeEmbedding.set(false));
    }

runKnowledgeCheck(): void {
        const profile = this.current();
        if (!profile || this.knowledgeChecking()) return;
        this.knowledgeChecking.set(true);
        this.service.checkKnowledge(profile.id)
            .then((result) => {
                this.knowledgeCheck.set(result);
                this.service.getKnowledgeSufficiency(profile.id)
                    .then((sufficiency) => this.knowledgeSufficiency.set(sufficiency))
                    .catch(() => this.knowledgeSufficiency.set(null));
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Knowledge check failed'))
            .finally(() => this.knowledgeChecking.set(false));
    }

indexKnowledge(): void {
        const profile = this.current();
        if (!profile || this.knowledgeIndexing()) return;
        this.knowledgeIndexing.set(true);
        this.error.set(null);
        this.service.indexKnowledge(profile.id)
            .then((summary) => {
                this.knowledgeSummary.set(summary);
                this.loadKnowledgeDetails(profile.id);
                this.saved.set(true);
            })
            .catch((err) => this.error.set(err?.detail || err?.message || 'Knowledge index failed'))
            .finally(() => this.knowledgeIndexing.set(false));
    }
}
