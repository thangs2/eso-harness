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
import { SettingsHostsBase } from './settings-hosts.base.js';
export abstract class SettingsKnowledgeBase extends SettingsHostsBase {
/** BUG-15: `/knowledge/docs` returns at most this many rows (server clamps to 50). */
readonly knowledgeDocsLimit = 50;

/** BUG-16: findings counters are hidden at zero instead of printing a contradictory `0`. */
readonly knowledgeFindingsCount = computed(() => this.knowledgeSummary()?.findings || 0);

back(): void { const id = this.route.snapshot.paramMap.get('id'); this.router.navigate(['/consumers', id]); }

pipelineGroups(): Array<{ id: string; title: string; stages: Array<{ id: string; label: string; gate: string }> }> {
        return [
            { id: 'A', title: 'Requirements', stages: [
                { id: 'S1', label: 'Pain / vision', gate: 'G1' },
                { id: 'S2', label: 'BRD', gate: 'G2' },
                { id: 'S3', label: 'PRD', gate: 'G3' },
                { id: 'S4', label: 'FRD', gate: 'G4' },
                { id: 'S5', label: 'SRS', gate: 'G5' },
            ] },
            { id: 'B', title: 'Criteria', stages: [
                { id: 'S6', label: 'US / AC', gate: 'G6' },
                { id: 'S7', label: 'Planes B/C/D + UI', gate: 'G7' },
            ] },
            { id: 'C', title: 'Breakdown', stages: [
                { id: 'S8', label: 'WBS', gate: 'G8' },
                { id: 'S9', label: 'BIP / FIP', gate: 'G9' },
                { id: 'S10', label: 'SCN', gate: 'G10' },
            ] },
            { id: 'D', title: 'Delivery', stages: [
                { id: 'S11', label: 'Code', gate: 'G11' },
                { id: 'S12', label: 'Run SCN', gate: 'G12' },
                { id: 'S13', label: 'DoD', gate: 'G13' },
                { id: 'S14', label: 'Done', gate: '—' },
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
            case 'ba-dev': return 'Requirements → implementation';
            case 'dev-qc': return 'Implementation → verification';
            case 'qc': return 'Verification only';
            default: return '14 stages · 13 gates';
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

showKnowledgeSection(section: 'overview' | 'sources' | 'contract' | 'index' | 'manifest'): void {
        this.knowledgeSection.set(section);
        if (section === 'contract') this.selectedKnowledgeTopic.set('pipeline');
        if (section === 'manifest') this.selectedKnowledgeTopic.set('agent-manifests');
        if (section === 'sources') this.selectedKnowledgeTopic.set('knowledge-base');
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
                    eyebrow: 'Governance · cross-check',
                    title: 'Cross-check catalogue',
                    description: 'A status claim is invalid unless the catalogue passes. The current source title says 29; the table contains 47 checks — that discrepancy must be reconciled.',
                    items: [
                        { label: 'Catalogue', value: 'X1…X42 · 47 checks' },
                        { label: 'Links', value: 'X1 · X28 · X40' },
                        { label: 'Trace & shape', value: 'X3 · X4 · X7 · X8a · X11–X20' },
                        { label: 'Delivery', value: 'X8 · X22 · X33–X39 · X42' },
                        { label: 'UI', value: 'X14 prototype · X15 reachable flow' },
                        { label: 'Rule', value: 'Missing check = no status claim.' },
                    ],
                };
            case 'preflight':
                return {
                    eyebrow: 'Governance · preflight',
                    title: 'Preflight before a slice',
                    description: 'Checks one slice before implementation. It is narrower than Go/No-Go, which covers the whole increment.',
                    items: [
                        { label: 'Scope', value: 'one slice / one work package' },
                        { label: 'Reads', value: 'document status · BIP/FIP · SCN · marks' },
                        { label: 'Pass', value: 'all required slots OK or P with an open id' },
                        { label: 'Fail', value: 'no work proceeds; gap must be named' },
                    ],
                };
            case 'go-no-go':
                return {
                    eyebrow: 'Governance · go / no-go',
                    title: 'Go / No-Go for an increment',
                    description: 'Dashboard over the whole increment. It answers what blocks the epic — not what blocks one slice.',
                    items: [
                        { label: 'Scope', value: 'increment / epic' },
                        { label: 'Requires', value: 'register exists + X checks run with a date' },
                        { label: 'Marks', value: 'OK · P with open_id · OUT with reason · — blocks' },
                        { label: 'Docs Ready', value: 'REQ ∩ US/AC ∩ SCN ∩ IF ∩ DATA' },
                        { label: 'Packets', value: 'BIP for be · FIP for fe · mixed needs both' },
                    ],
                };
            case 'pipeline-contract':
                return {
                    eyebrow: 'Governance · pipeline contract',
                    title: 'Pipeline contract',
                    description: 'The contract makes each stage consume the previous stage by reference. Gates are document conditions, not task-tool statuses.',
                    items: [
                        { label: 'Stages', value: 'S1 Requirements → S14 Done' },
                        { label: 'Gates', value: 'G1…G13' },
                        { label: 'Authority', value: 'REQ → US/AC → WBS → BIP/FIP → SCN → code' },
                        { label: 'Change', value: 'CR reopens the affected earlier stage; it never reverses authority' },
                        { label: 'Done', value: 'human signs; agent never signs Done' },
                    ],
                };
            case 'quartet':
                return {
                    eyebrow: 'Task management · quartet',
                    title: 'Task quartet',
                    description: 'Decomposition of a task into test-first work. It is a work structure, not a provider feature.',
                    items: [
                        { label: 'Standard', value: 'tdd-unit · tdd-impl · tdd-coverage · tdd-qc' },
                        { label: 'Extended', value: 'add tdd-load · tdd-stress for runtime slices' },
                        { label: 'BA', value: 'OUT when acceptance criteria are already clear' },
                        { label: 'Provider', value: 'Jira · repo · another task tool — optional' },
                        { label: 'Rule', value: 'Quartet does not depend on task provider.' },
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
                    description: 'Fourteen stages and thirteen gates. Apply the full pipeline or a subset; CR reopens the affected stage.',
                    items: [
                        { label: 'Intent', value: 'P1–P8 → mission/vision → goals → BRD/PRD → FRD/SRS → US/AC' },
                        { label: 'Stages', value: 'S1…S14 · 14 stages' },
                        { label: 'Phase folders', value: '12.phases/phase-1…n · global vs phase' },
                        { label: 'A · requirements', value: 'S1 pain/vision · S2 BRD · S3 PRD · S4 FRD · S5 SRS' },
                        { label: 'B · criteria', value: 'S6 US/AC · S7 planes B/C/D + UI' },
                        { label: 'C · breakdown', value: 'S8 WBS · S9 BIP/FIP · S10 SCN' },
                        { label: 'D · delivery', value: 'S11 code · S12 run SCN · S13 DoD · S14 Done' },
                        { label: 'Gates', value: 'G1…G13 · document conditions, not task status' },
                        { label: 'Preconditions', value: 'P0.1 SDLC root · P0.3 document status · P0.6 gate instruments' },
                        { label: 'CR', value: 'reopens S6 / S7 / S8 / S11; authority never reverses' },
                        { label: 'Done', value: 'human signs; agent is forbidden' },
                    ],
                };
        }
    }

quartetTypes(): Array<{ id: string; label: string; note: string; included: boolean }> {
        const extended = this.quartetProfile() === 'extended';
        return [
            { id: 'tdd-unit', label: 'unit', note: 'test first', included: true },
            { id: 'tdd-impl', label: 'impl', note: 'DEV', included: true },
            { id: 'tdd-coverage', label: 'coverage', note: 'gate', included: true },
            { id: 'tdd-qc', label: 'qc', note: 'SCN + evidence', included: true },
            { id: 'tdd-load', label: 'load', note: 'extended', included: extended },
            { id: 'tdd-stress', label: 'stress', note: 'extended', included: extended },
            { id: 'tdd-ba', label: 'ba', note: 'OUT when AC clear', included: false },
        ];
    }

toggleArtifactKind(kind: string): void {
        this.artifactKinds.update((kinds) => kinds.includes(kind) ? kinds.filter((item) => item !== kind) : [...kinds, kind]);
    }

toggleRepresentation(representation: string): void {
        this.representations.update((items) => items.includes(representation) ? items.filter((item) => item !== representation) : [...items, representation]);
    }

protected loadKnowledgeIndex(id: string): void {
        this.service.getKnowledge(id)
            .then((summary) => this.knowledgeSummary.set(summary))
            .catch(() => this.knowledgeSummary.set(null));
        this.loadKnowledgeDetails(id);
    }

loadKnowledgeDetails(id: string): void {
        this.service.getKnowledgeDocs(id, this.knowledgeQuery())
            .then((docs) => this.knowledgeDocs.set(docs))
            .catch(() => this.knowledgeDocs.set([]));
        this.service.getKnowledgeFindings(id)
            .then((findings) => this.knowledgeFindings.set(findings))
            .catch(() => this.knowledgeFindings.set([]));
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
            .then((result) => this.knowledgeCheck.set(result))
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
