import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { EvidenceRequirementDto, WorkerPolicyResultDto } from '../../../../../../../libs/api-client/types.js';
import type { WorkerEntry } from './worker.types.js';

type EvidenceKind = 'test' | 'verify' | 'audit' | 'audit-critical' | 'scenario';

@Component({
    selector: 'eso-worker-policy',
    standalone: true,
    imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
    templateUrl: './worker-policy.component.html',
    styleUrl: './worker-policy.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkerPolicyComponent {
    private readonly service = inject(ConsumerProfileService);
    private readonly fb = inject(NonNullableFormBuilder);

    readonly worker = input.required<WorkerEntry>();
    readonly consumerId = input.required<string>();
    readonly workerChange = output<WorkerEntry>();
    readonly scopeError = new FormControl('');
    readonly capabilityError = new FormControl('');

    readonly form = this.fb.group({
        scopes: this.fb.array<FormControl<string>>([]),
        scopeInput: this.fb.control(''),
        capabilities: this.fb.array<FormControl<string>>([]),
        capabilityInput: this.fb.control(''),
        verbs: this.fb.control<string[]>([]),
        evidence: this.fb.array<FormControl<EvidenceRequirementDto>>([]),
        evidenceKind: this.fb.control<EvidenceKind>('test'),
        evidenceValue: this.fb.control('85'),
        escalation: this.fb.control('stop+notify'),
    });

    readonly checkForm = this.fb.group({
        verb: this.fb.control('read'),
        path: this.fb.control(''),
    });

    readonly showCheck = new FormControl(false, { nonNullable: true });
    readonly checking = new FormControl(false, { nonNullable: true });
    readonly checkResult = new FormControl<WorkerPolicyResultDto | null>(null);
    readonly checkError = new FormControl('');

    readonly validationErrors = computed(() => {
        const errors: string[] = [];
        for (const control of this.form.controls.scopes.controls) {
            if (!this.scopeIsValid(control.value)) errors.push(`Invalid scope "${control.value}"`);
        }
        for (const control of this.form.controls.capabilities.controls) {
            if (!/^[a-z][a-z0-9-]{0,31}$/.test(control.value)) errors.push(`Invalid capability "${control.value}"`);
        }
        if (this.form.controls.verbs.value.length === 0) errors.push('Add at least one allowed action.');
        return errors;
    });

    constructor() {
        effect(() => {
            const worker = this.worker();
            this.form.patchValue({ verbs: [...worker.verbs], escalation: worker.escalation }, { emitEvent: false });
            this.syncArray(this.form.controls.scopes, worker.scope.split(',').map((scope) => scope.trim()).filter(Boolean));
            this.syncArray(this.form.controls.capabilities, [...worker.capabilities]);
            this.syncEvidence(worker.bar);
        });
        this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.emitWorker());
    }

    private syncArray(array: ReturnType<typeof this.fb.array<FormControl<string>>>, values: string[]): void {
        if (JSON.stringify(array.getRawValue()) === JSON.stringify(values)) return;
        array.clear({ emitEvent: false });
        for (const value of values) array.push(this.fb.control(value), { emitEvent: false });
    }

    private syncEvidence(values: EvidenceRequirementDto[]): void {
        if (JSON.stringify(this.form.controls.evidence.getRawValue()) === JSON.stringify(values)) return;
        this.form.controls.evidence.clear({ emitEvent: false });
        for (const value of values) this.form.controls.evidence.push(this.fb.control(value), { emitEvent: false });
    }

    private emitWorker(): void {
        const value = this.form.getRawValue();
        this.workerChange.emit({
            ...this.worker(),
            scope: value.scopes.join(', '),
            capabilities: value.capabilities,
            verbs: value.verbs,
            bar: value.evidence,
            escalation: value.escalation,
        });
    }

    scopeIsValid(scope: string): boolean {
        return scope.startsWith('/') || scope.startsWith('agents/') || scope.startsWith('tools/') || scope.startsWith('scripts/') || scope.includes('*');
    }

    addScope(): void {
        const value = this.form.controls.scopeInput.value.trim();
        if (!value || !this.scopeIsValid(value)) { this.scopeError.setValue('Use an absolute path, repository path, or glob.'); return; }
        if (this.form.controls.scopes.getRawValue().includes(value)) { this.scopeError.setValue('Scope already present.'); return; }
        this.form.controls.scopes.push(this.fb.control(value));
        this.form.controls.scopeInput.setValue('');
        this.scopeError.setValue('');
    }

    removeScope(index: number): void { this.form.controls.scopes.removeAt(index); }

    addCapability(): void {
        const value = this.form.controls.capabilityInput.value.trim().toLowerCase();
        if (!value || !/^[a-z][a-z0-9-]*$/.test(value)) { this.capabilityError.setValue('Lowercase slug only.'); return; }
        if (this.form.controls.capabilities.getRawValue().includes(value)) return;
        this.form.controls.capabilities.push(this.fb.control(value));
        this.form.controls.capabilityInput.setValue('');
        this.capabilityError.setValue('');
    }

    removeCapability(index: number): void { this.form.controls.capabilities.removeAt(index); }
    suggestion(value: string): void { this.form.controls.capabilityInput.setValue(value); this.addCapability(); }

    addEvidence(): void {
        const kind = this.form.controls.evidenceKind.value;
        const raw = this.form.controls.evidenceValue.value;
        if (kind === 'audit' && !Number.isFinite(Number(raw))) return;
        const requirement: EvidenceRequirementDto = kind === 'audit'
            ? { kind: 'audit', metric: 'rubric', op: '>=', value: Number(raw) }
            : kind === 'audit-critical' ? { kind: 'audit', metric: 'critical', op: '==', value: 0 }
                : kind === 'verify' ? { kind: 'verify', metric: 'status', op: '==', value: raw || 'PASS' }
                    : kind === 'scenario' ? { kind: 'scenario', metric: 'executed', op: 'truthy', value: true }
                        : { kind: 'test', metric: 'status', op: '==', value: 'PASS' };
        this.form.controls.evidence.push(this.fb.control(requirement));
    }

    removeEvidence(index: number): void { this.form.controls.evidence.removeAt(index); }

    evidenceLabel(requirement: EvidenceRequirementDto): string {
        if (requirement.kind === 'audit' && requirement.metric === 'critical') return 'audit critical = 0';
        if (requirement.kind === 'audit') return `audit rubric ≥ ${requirement.value ?? 85}`;
        if (requirement.kind === 'verify') return `verify = ${requirement.value ?? 'PASS'}`;
        if (requirement.kind === 'scenario') return 'scenario executed';
        return `test = ${requirement.value ?? 'PASS'}`;
    }

    toggleCheck(): void {
        this.showCheck.setValue(!this.showCheck.value);
        this.checkResult.setValue(null);
        this.checkError.setValue('');
    }

    runCheck(): void {
        this.checking.setValue(true);
        this.checkError.setValue('');
        this.checkResult.setValue(null);
        this.service.checkWorker(this.consumerId(), this.worker().id, {
            verb: this.checkForm.controls.verb.value,
            path: this.checkForm.controls.path.value || undefined,
            evidence: [{ kind: 'test', value: 'PASS' }],
        }).then((result) => this.checkResult.setValue(result))
            .catch((error) => this.checkError.setValue(this.errorMessage(error, 'Policy check failed')))
            .finally(() => this.checking.setValue(false));
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
}
