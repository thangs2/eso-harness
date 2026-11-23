import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { BoundaryGrantDto, BoundaryPathType, BoundaryReadMode, BoundaryViewDto, BoundaryWriteMode, FolderPolicyDto } from '../../../../../../../libs/api-client/types.js';

type PolicyForm = FormGroup<{
    id: FormControl<string>;
    path: FormControl<string>;
    pathType: FormControl<BoundaryPathType>;
    read: FormControl<BoundaryReadMode>;
    write: FormControl<BoundaryWriteMode>;
    index: FormControl<boolean>;
    priority: FormControl<number>;
    reason: FormControl<string>;
}>;

@Component({
    selector: 'eso-boundaries-panel',
    standalone: true,
    imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
    templateUrl: './boundaries-panel.component.html',
    styleUrl: './boundaries-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoundariesPanelComponent {
    private readonly service = inject(ConsumerProfileService);
    private readonly fb = inject(NonNullableFormBuilder);

    readonly consumerId = input.required<string>();

    readonly loading = signal(true);
    readonly saving = signal(false);
    readonly grantSaving = signal(false);
    readonly error = signal('');
    readonly notice = signal('');
    readonly grants = signal<BoundaryGrantDto[]>([]);
    readonly policyForm = this.fb.array<PolicyForm>([]);
    readonly enforcementForm = this.fb.group({
        enforcement: this.fb.control<'audit' | 'enforce'>('audit'),
    });
    readonly grantForm = this.fb.group({
        target: this.fb.control('', Validators.required),
        kind: this.fb.control<'read' | 'write'>('write'),
        mode: this.fb.control<'once' | 'always'>('once'),
        ttlMinutes: this.fb.control(15),
    });
    readonly policyCount = signal(0);
    readonly grantCount = signal(0);

    constructor() {
        effect(() => {
            const consumerId = this.consumerId();
            if (consumerId) this.load(consumerId);
        });
        // BUG-17: write grants cannot be `always` (server answers INVALID_STATE). Make the
        // impossibility visible in the UI instead of silently rewriting the chosen mode.
        this.grantForm.controls.kind.valueChanges.pipe(takeUntilDestroyed()).subscribe((kind) => {
            if (kind === 'write' && this.grantForm.controls.mode.value === 'always') {
                this.grantForm.controls.mode.setValue('once');
            }
        });
        // BUG-18: `always` grants never expire, so the TTL field is irrelevant there.
        this.grantForm.controls.mode.valueChanges.pipe(takeUntilDestroyed()).subscribe((mode) => {
            const ttl = this.grantForm.controls.ttlMinutes;
            if (mode === 'always') ttl.disable({ emitEvent: false });
            else ttl.enable({ emitEvent: false });
        });
    }

    /** Server caps grant TTL at 8h for write grants and 90d for read grants. */
    grantTtlMaxMinutes(): number {
        return this.grantForm.controls.kind.value === 'write' ? 8 * 60 : 90 * 24 * 60;
    }

    addPolicy(): void {
        this.policyForm.push(this.policyGroup({
            id: `policy-${Date.now()}`,
            path: '',
            pathType: 'glob',
            read: 'deny',
            write: 'deny',
            index: false,
            priority: 50,
        }));
        this.policyCount.set(this.policyForm.length);
    }

    removePolicy(index: number): void {
        this.policyForm.removeAt(index);
        this.policyCount.set(this.policyForm.length);
    }

    save(): void {
        if (this.saving()) return;
        this.saving.set(true);
        this.error.set('');
        this.notice.set('');
        const policies = this.policyForm.getRawValue().map((policy) => ({
            id: policy.id,
            path: policy.path.trim(),
            pathType: policy.pathType,
            read: policy.read,
            write: policy.write,
            index: policy.index,
            priority: Number(policy.priority) || 50,
            ...(policy.reason ? { reason: policy.reason } : {}),
        } satisfies FolderPolicyDto));
        this.service.saveBoundaries(this.consumerId(), policies, this.enforcementForm.controls.enforcement.value)
            .then((view) => { this.apply(view); this.notice.set('Boundaries saved.'); })
            .catch((error) => this.error.set(this.message(error, 'Could not save boundaries')))
            .finally(() => this.saving.set(false));
    }

    createGrant(): void {
        if (this.grantSaving()) return;
        const value = this.grantForm.getRawValue();
        const target = value.target.trim();
        if (!target) return;
        this.error.set('');
        if (value.kind === 'write' && value.mode === 'always') {
            this.error.set('Write grants are single-use; pick the read kind for an always grant.');
            return;
        }
        const ttlMinutes = Number(value.ttlMinutes);
        const maxTtlMinutes = this.grantTtlMaxMinutes();
        if (value.mode === 'once' && (!Number.isFinite(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > maxTtlMinutes)) {
            this.error.set(`Grant expiry must be between 1 and ${maxTtlMinutes} minutes.`);
            return;
        }
        this.grantSaving.set(true);
        this.service.createBoundaryGrant(this.consumerId(), {
            kind: value.kind,
            targetPrefix: target,
            mode: value.mode,
            // Server ignores TTL for `always`, but rejects a non-positive number outright.
            ...(value.mode === 'once' ? { ttlMs: Math.round(ttlMinutes * 60_000) } : {}),
        }).then(() => {
            this.grantForm.controls.target.setValue('');
            this.load(this.consumerId());
        }).catch((error) => this.error.set(this.message(error, 'Could not create grant')))
            .finally(() => this.grantSaving.set(false));
    }

    revoke(grantId: string): void {
        this.service.revokeBoundaryGrant(this.consumerId(), grantId)
            .then(() => this.load(this.consumerId()))
            .catch((error) => this.error.set(this.message(error, 'Could not revoke grant')));
    }

    private load(consumerId: string): void {
        this.loading.set(true);
        this.service.getBoundaries(consumerId)
            .then((view) => this.apply(view))
            .catch((error) => this.error.set(this.message(error, 'Could not load boundaries')))
            .finally(() => this.loading.set(false));
    }

    private apply(view: BoundaryViewDto): void {
        this.enforcementForm.controls.enforcement.setValue(view.enforcement);
        this.policyForm.clear();
        for (const policy of view.policies) this.policyForm.push(this.policyGroup(policy));
        this.grants.set(view.grants);
        this.policyCount.set(this.policyForm.length);
        this.grantCount.set(view.grants.length);
        this.policyForm.markAsPristine();
        this.enforcementForm.markAsPristine();
    }

    private policyGroup(policy: FolderPolicyDto): PolicyForm {
        return this.fb.group({
            id: this.fb.control(policy.id),
            path: this.fb.control(policy.path, Validators.required),
            pathType: this.fb.control(policy.pathType),
            read: this.fb.control(policy.read),
            write: this.fb.control(policy.write),
            index: this.fb.control(policy.index),
            priority: this.fb.control(policy.priority ?? 50),
            reason: this.fb.control(policy.reason ?? ''),
        });
    }

    private message(error: unknown, fallback: string): string {
        if (error && typeof error === 'object') {
            const detail = (error as { detail?: unknown }).detail;
            const message = (error as { message?: unknown }).message;
            if (typeof detail === 'string' && detail) return detail;
            if (typeof message === 'string' && message) return message;
        }
        return fallback;
    }
}
