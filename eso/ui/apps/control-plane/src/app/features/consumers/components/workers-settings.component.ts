import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { HostRuntimeDto, WorkerImportPreviewDto, WorkerImportRecordDto, WorkerPlacementDto, WorkerModelTier, WorkerPlacementFallback, WorkerPolicyResultDto, WorkerSourceStatusDto, WorkerExecutionMode } from '../../../../../../../libs/api-client/types.js';
import type { WorkerEntry, WorkerHostProfile, WorkerInspectorTab } from './worker.types.js';
import { WORKER_ORDER, WORKER_ROLES, WORKER_STATUSES } from './worker.types.js';
import { WorkerListComponent } from './worker-list.component.js';
import { WorkerDeploymentComponent } from './worker-deployment.component.js';
import { WorkerPolicyComponent } from './worker-policy.component.js';
import { WorkerIdentityComponent } from './worker-identity.component.js';

@Component({
    selector: 'eso-workers-settings',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatMenuModule, WorkerListComponent, WorkerDeploymentComponent, WorkerPolicyComponent, WorkerIdentityComponent],
    templateUrl: './workers-settings.component.html',
    styleUrl: './workers-settings.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkersSettingsComponent {
    private readonly service = inject(ConsumerProfileService);
    private readonly router = inject(Router);

    readonly consumerId = input.required<string>();
    readonly hostProfiles = input<WorkerHostProfile[]>([]);
    readonly hostRuntimes = input<HostRuntimeDto[]>([]);
    readonly workersChange = output<WorkerEntry[]>();

    readonly workers = signal<WorkerEntry[]>([]);
    readonly workerPlacements = signal<Record<string, WorkerPlacementDto>>({});
    readonly placementDrafts = signal<Record<string, WorkerPlacementDto>>({});
    readonly selectedWorkerId = signal('');
    readonly workerInspectorTab = signal<WorkerInspectorTab>('deployment');
    readonly placementSaving = signal(false);
    readonly placementNotice = signal('');
    readonly placementError = signal('');
    readonly dirty = signal(false);
    readonly loading = signal(true);
    readonly workerSyncing = signal(false);
    readonly workerImporting = signal(false);
    readonly workerSourceStatus = signal<WorkerSourceStatusDto>({ source: 0, projections: 0, drift: [] });
    readonly workerImports = signal<WorkerImportRecordDto[]>([]);
    readonly workerImportPreview = signal<WorkerImportPreviewDto | null>(null);
    readonly importSelectedHashes = signal<string[]>([]);
    readonly importActions = signal<Record<string, 'import' | 'replace' | 'copy' | 'skip'>>({});
    readonly workerImportDirty = signal(false);
    readonly error = signal('');
                                                            readonly orderedWorkers = computed(() => {
        const rank = (worker: WorkerEntry): number => {
            const index = WORKER_ORDER.indexOf(worker.id);
            return index >= 0 ? index : WORKER_ORDER.length + 1;
        };
        return [...this.workers()].sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name));
    });
    readonly selectedWorker = computed(() => this.orderedWorkers().find((worker) => worker.id === this.selectedWorkerId()) || this.orderedWorkers()[0] || null);
                    readonly workerSummaries = computed(() => Object.fromEntries(this.workers().map((worker) => [worker.id, this.placementSummary(worker.id)])));

    constructor() {
        effect(() => {
            const consumerId = this.consumerId();
            if (consumerId) this.loadAll(consumerId);
        });
        effect(() => {
            const profiles = this.hostProfiles();
            if (profiles.length === 0) return;
            const valid = new Set(profiles.filter((profile) => !profile.detected).map((profile) => profile.id));
            this.workers.update((workers) => workers.map((worker) => ({
                ...worker,
                hostBindingIds: worker.hostBindingIds.filter((id) => valid.has(id)),
            })));
        });
        effect(() => {
            this.workersChange.emit(this.workers().map((worker) => ({ ...worker })));
        });
    }

    private loadAll(consumerId: string): void {
        this.service.getWorkers(consumerId).then((config) => {
            this.workers.set((config.workers || []).map((worker) => this.normalizeWorker(worker)));
            if (this.selectedWorkerId() === '') this.selectedWorkerId.set(this.orderedWorkers()[0]?.id || '');
        }).catch((error) => this.error.set(error?.detail || error?.message || 'Could not load workers')).finally(() => this.loading.set(false));
        this.service.getWorkerPlacement(consumerId).then((items) => this.applyWorkerPlacements(items)).catch(() => this.applyWorkerPlacements([]));
        this.loadWorkerSourceStatus(consumerId);
        this.service.getWorkerImports(consumerId).then((imports) => this.workerImports.set(imports)).catch(() => this.workerImports.set([]));
    }

    private normalizeWorker(worker: Partial<WorkerEntry> & { id: string }): WorkerEntry {
        return {
            id: worker.id,
            name: worker.name || worker.id,
            role: worker.role || 'scout',
            layer: worker.layer === 'gate' ? 'gate' : 'peer',
            hostBindingIds: Array.isArray(worker.hostBindingIds) ? worker.hostBindingIds.filter(Boolean) : [],
            scope: worker.scope || '',
            status: worker.status || 'declared',
            capabilities: Array.isArray(worker.capabilities) ? worker.capabilities : [],
            verbs: Array.isArray(worker.verbs) ? worker.verbs : ['read'],
            bar: Array.isArray(worker.bar) ? worker.bar : [],
            escalation: worker.escalation || 'stop+notify',
            instructions: worker.instructions || '',
            sourceFile: worker.sourceFile,
            sourceHash: worker.sourceHash,
            sourceType: worker.sourceType,
        };
    }

    private emitWorkers(): void {
        this.dirty.set(true);
        this.workersChange.emit(this.workers().map((worker) => ({ ...worker })));
    }

    snapshot(): WorkerEntry[] {
        return this.workers().map((worker) => ({ ...worker }));
    }

    markSaved(): void {
        this.dirty.set(false);
    }

    validationErrors(): string[] {
        return this.workerValidationErrors();
    }

    replaceWorker(worker: WorkerEntry): void {
        this.workers.update((workers) => workers.map((item) => item.id === worker.id ? worker : item));
        this.emitWorkers();
    }

    selectWorker(id: string): void {
        this.selectedWorkerId.set(id);
        this.workerInspectorTab.set('deployment');
        this.placementNotice.set('');
        this.placementError.set('');
    }

    setWorkerInspectorTab(tab: WorkerInspectorTab): void {
        this.workerInspectorTab.set(tab);
    }

                addWorker(): void {
        const id = `worker-new-${Date.now()}`;
        const worker: WorkerEntry = {
            id, name: 'New worker', role: 'scout', layer: 'peer', hostBindingIds: [], scope: '/tmp/slp/new/',
            status: 'declared', capabilities: [], verbs: ['read'], bar: [], escalation: 'stop+notify', instructions: '',
        };
        this.workers.update((workers) => [...workers, worker]);
        this.selectedWorkerId.set(id);
        this.workerInspectorTab.set('identity');
        this.emitWorkers();
    }

    removeWorker(id: string): void {
        this.workers.update((workers) => workers.filter((worker) => worker.id !== id));
        if (this.selectedWorkerId() === id) this.selectedWorkerId.set(this.orderedWorkers()[0]?.id || '');
        this.emitWorkers();
    }

                                                    workerValidationErrors(): string[] {
        const worker = this.selectedWorker();
        if (!worker) return [];
        const errors: string[] = [];
        if (!worker.name.trim()) errors.push('Name is required.');
        if (!worker.role.trim()) errors.push('Role is required.');
        if (worker.status === 'active' && worker.hostBindingIds.length === 0) errors.push('Active worker needs at least one host binding.');
        return errors;
    }

    legacyPlacementKeys(workerId: string): string[] {
        return this.placementDraftFor(workerId).allowedHosts.filter((id) => !id.includes(':'));
    }

    placementDraftFor(workerId: string): WorkerPlacementDto {
        return this.placementDrafts()[workerId] || this.workerPlacements()[workerId] || this.defaultPlacement(workerId);
    }

    private defaultPlacement(workerId: string): WorkerPlacementDto {
        return { workerId, allowedHosts: [], modelTier: 'balanced', model: '', models: {}, modes: ['A', 'B'], nativeAgent: {}, fallback: 'block' };
    }

    applyPlacement(workerId: string, placement: WorkerPlacementDto): void {
        this.patchPlacementDraft(workerId, placement);
        const hostIds = new Set(placement.allowedHosts.map((key) => key.split(':')[0]));
        const hostBindingIds = this.hostProfiles().filter((profile) => !profile.detected && hostIds.has(profile.hostId)).map((profile) => profile.id);
        const worker = this.workers().find((item) => item.id === workerId);
        if (!worker || JSON.stringify(worker.hostBindingIds) === JSON.stringify(hostBindingIds)) return;
        this.workers.update((workers) => workers.map((item) => item.id === workerId ? { ...item, hostBindingIds } : item));
        this.emitWorkers();
    }

    private applyWorkerPlacements(items: WorkerPlacementDto[]): void {
        const saved: Record<string, WorkerPlacementDto> = {};
        for (const item of items || []) if (item?.workerId) saved[item.workerId] = this.normalizePlacement(item);
        this.workerPlacements.set(saved);
        const drafts: Record<string, WorkerPlacementDto> = {};
        for (const worker of this.workers()) drafts[worker.id] = saved[worker.id] || this.defaultPlacement(worker.id);
        this.placementDrafts.set(drafts);
    }

    private normalizePlacement(placement: WorkerPlacementDto): WorkerPlacementDto {
        const tiers: WorkerModelTier[] = ['fast', 'balanced', 'reasoning'];
        const fallbacks: WorkerPlacementFallback[] = ['block', 'next-host', 'next-tier'];
        return {
            workerId: placement.workerId,
            allowedHosts: Array.isArray(placement.allowedHosts) ? placement.allowedHosts.filter(Boolean) : [],
            modelTier: tiers.includes(placement.modelTier) ? placement.modelTier : 'balanced',
            model: typeof placement.model === 'string' ? placement.model.trim() : '',
            modes: Array.isArray(placement.modes) && placement.modes.length > 0
                ? placement.modes.filter((mode): mode is WorkerExecutionMode => mode === 'A' || mode === 'B')
                : ['A', 'B'],
            models: placement.models && typeof placement.models === 'object'
                ? Object.fromEntries(Object.entries(placement.models).filter(([, value]) => typeof value === 'string').map(([key, value]) => [key, String(value).trim()]))
                : {},
            nativeAgent: placement.nativeAgent && typeof placement.nativeAgent === 'object' ? { ...placement.nativeAgent } : {},
            fallback: fallbacks.includes(placement.fallback) ? placement.fallback : 'block',
        };
    }

    placementDirty(workerId: string): boolean {
        return JSON.stringify(this.placementDraftFor(workerId)) !== JSON.stringify(this.workerPlacements()[workerId] || this.defaultPlacement(workerId));
    }

    placementSummary(workerId: string): string {
        const placement = this.workerPlacements()[workerId];
        if (!placement) return 'No placement';
        const model = Object.values(placement.models || {})[0] || placement.model || placement.modelTier;
        return placement.allowedHosts.length === 0 ? `Not placed · ${model}` : `${placement.allowedHosts.length} runtime${placement.allowedHosts.length === 1 ? '' : 's'} · ${model}`;
    }

    patchPlacementDraft(workerId: string, patch: Partial<WorkerPlacementDto>): void {
        this.placementDrafts.update((drafts) => ({ ...drafts, [workerId]: { ...this.placementDraftFor(workerId), ...patch, workerId } }));
        this.placementNotice.set('');
        this.placementError.set('');
    }

                                resetPlacement(workerId: string): void {
        this.placementDrafts.update((drafts) => {
            const next = { ...drafts };
            delete next[workerId];
            return next;
        });
        this.placementNotice.set('');
        this.placementError.set('');
    }

    savePlacement(workerId: string): void {
        if (this.placementSaving()) return;
        const placement = { ...this.placementDraftFor(workerId), workerId };
        this.placementSaving.set(true);
        this.placementNotice.set('');
        this.placementError.set('');
        this.service.saveWorkerPlacement(this.consumerId(), workerId, placement).then((saved) => {
            this.workerPlacements.update((placements) => ({ ...placements, [workerId]: this.normalizePlacement({ ...placement, ...saved, workerId }) }));
            this.placementDrafts.update((drafts) => {
                const next = { ...drafts };
                delete next[workerId];
                return next;
            });
            this.placementNotice.set('Host placement saved.');
        }).catch((error) => this.placementError.set(error?.detail || error?.message || 'Could not save host placement')).finally(() => this.placementSaving.set(false));
    }

    private loadWorkerSourceStatus(consumerId: string): void {
        this.service.getWorkerSourceStatus(consumerId).then((status) => this.workerSourceStatus.set(status)).catch(() => this.workerSourceStatus.set({ source: 0, projections: 0, drift: [] }));
    }

    syncWorkerSources(): void {
        this.workerSyncing.set(true);
        this.service.syncWorkerSources(this.consumerId()).then((status) => this.workerSourceStatus.set(status)).catch((error) => this.error.set(error?.detail || error?.message || 'Worker sync failed')).finally(() => this.workerSyncing.set(false));
    }

    promoteProjection(file: string): void {
        this.service.promoteWorkerProjection(this.consumerId(), file.replace(/\.md$/, '')).then(() => this.loadWorkerSourceStatus(this.consumerId())).catch((error) => this.error.set(error?.detail || error?.message || 'Promote failed'));
    }

    private errorMessage(error: unknown, fallback: string): string {
        if (error && typeof error === 'object') {
            const detail = (error as { detail?: unknown }).detail;
            const message = (error as { message?: unknown }).message;
            if (typeof detail === 'string' && detail) return detail;
            if (typeof message === 'string' && message) return message;
        }
        return fallback;
    }

    async onWorkerFiles(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length === 0) return;
        this.workerImporting.set(true);
        try {
            const payload = await Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() })));
            const preview = await this.service.previewWorkerImport(this.consumerId(), payload);
            this.workerImportPreview.set(preview);
            this.importSelectedHashes.set(preview.candidates.filter((candidate) => !candidate.conflict).map((candidate) => candidate.sourceHash));
            this.importActions.set(Object.fromEntries(preview.candidates.map((candidate) => [candidate.sourceHash, candidate.conflict ? 'skip' as const : 'import' as const])));
        } catch (error) {
            this.error.set(this.errorMessage(error, 'Import preview failed'));
        } finally {
            this.workerImporting.set(false);
        }
    }

    toggleImport(hash: string, checked: boolean): void {
        this.importSelectedHashes.update((hashes) => checked ? [...new Set([...hashes, hash])] : hashes.filter((item) => item !== hash));
    }

    importAction(hash: string): 'import' | 'replace' | 'copy' | 'skip' {
        return this.importActions()[hash] || 'import';
    }

    setImportAction(hash: string, action: 'import' | 'replace' | 'copy' | 'skip'): void {
        this.importActions.update((actions) => ({ ...actions, [hash]: action }));
    }

    importableCount(): number {
        return this.importSelectedHashes().length;
    }

    importWorkers(): void {
        const preview = this.workerImportPreview();
        if (!preview) return;
        const selected = new Set(this.importSelectedHashes());
        const next = [...this.workers()];
        for (const candidate of preview.candidates) {
            if (!selected.has(candidate.sourceHash)) continue;
            const action = this.importAction(candidate.sourceHash);
            if (action === 'skip' || !candidate.worker?.id) continue;
            const index = next.findIndex((worker) => worker.id === candidate.worker.id);
            let target = this.normalizeWorker({ ...candidate.worker });
            if (action === 'replace' && index >= 0) next[index] = target;
            else if (action === 'copy') next.push({ ...target, id: `${target.id}-copy-${Date.now()}`, name: `${target.name} copy` });
            else if (index < 0) next.push(target);
            else next[index] = target;
        }
        this.workers.set(next);
        this.workerImportPreview.set(null);
        this.importSelectedHashes.set([]);
        this.workerImportDirty.set(true);
        this.emitWorkers();
    }

    closeImportPreview(): void {
        this.workerImportPreview.set(null);
        this.importSelectedHashes.set([]);
    }

                openHosts(): void {
        this.router.navigate(['/hosts']);
    }

    openFlows(): void {
        this.router.navigate(['/consumers', this.consumerId(), 'flows']);
    }

        }
