import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import type { HostRuntimeDto, WorkerExecutionMode, WorkerPlacementDto, WorkerPlacementFallback, WorkerModelTier } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-worker-deployment',
    standalone: true,
    imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatSelectModule],
    templateUrl: './worker-deployment.component.html',
    styleUrl: './worker-deployment.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkerDeploymentComponent {
    private readonly fb = inject(NonNullableFormBuilder);

    readonly placement = input.required<WorkerPlacementDto>();
    readonly runtimes = input<HostRuntimeDto[]>([]);
    readonly legacyKeys = input<string[]>([]);
    readonly saving = input(false);
    readonly notice = input('');
    readonly error = input('');
    readonly dirty = input(false);
    readonly placementChange = output<WorkerPlacementDto>();
    readonly save = output<void>();
    readonly reset = output<void>();
    readonly modeError = signal('');

    readonly form = this.fb.group({
        modes: this.fb.group({
            A: this.fb.control(true),
            B: this.fb.control(true),
        }),
        tier: this.fb.control<WorkerModelTier>('balanced'),
        fallback: this.fb.control<WorkerPlacementFallback>('block'),
        allowed: this.fb.record<boolean>({}),
        models: this.fb.record<string>({}),
        agents: this.fb.record<string>({}),
    });

    constructor() {
        effect(() => {
            const runtimes = this.runtimes();
            const placement = this.placement();
            this.ensureRuntimeControls(runtimes);
            this.form.patchValue({
                modes: {
                    A: placement.modes?.includes('A') ?? true,
                    B: placement.modes?.includes('B') ?? true,
                },
                tier: placement.modelTier,
                fallback: placement.fallback,
                allowed: Object.fromEntries(runtimes.map((runtime) => [runtime.runtimeKey, placement.allowedHosts.includes(runtime.runtimeKey)])),
                models: Object.fromEntries(runtimes.map((runtime) => [runtime.runtimeKey, placement.models?.[runtime.runtimeKey] || ''])),
                agents: Object.fromEntries(runtimes.map((runtime) => [runtime.runtimeKey, placement.nativeAgent?.[runtime.runtimeKey] || ''])),
            }, { emitEvent: false });
        });

        this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.commit());
    }

    selectedModeCount(): number {
        return Number(this.form.controls.modes.controls.A.value) + Number(this.form.controls.modes.controls.B.value);
    }

    allowedRuntimeCount(): number {
        return this.runtimes().filter((runtime) => this.form.controls.allowed.controls[runtime.runtimeKey]?.value).length;
    }

    allowedControl(runtimeKey: string): FormControl<boolean> { return this.form.controls.allowed.controls[runtimeKey]; }
    modelControl(runtimeKey: string): FormControl<string> { return this.form.controls.models.controls[runtimeKey]; }
    agentControl(runtimeKey: string): FormControl<string> { return this.form.controls.agents.controls[runtimeKey]; }

    modelsFor(runtimeKey: string): string[] {
        return [...(this.runtimes().find((runtime) => runtime.runtimeKey === runtimeKey)?.models || [])].filter(Boolean).sort((left, right) => left.localeCompare(right));
    }

    private ensureRuntimeControls(runtimes: HostRuntimeDto[]): void {
        const keys = new Set(runtimes.map((runtime) => runtime.runtimeKey));
        for (const key of keys) {
            if (!this.form.controls.allowed.controls[key]) {
                this.form.controls.allowed.addControl(key, this.fb.control(false), { emitEvent: false });
                this.form.controls.models.addControl(key, this.fb.control(''), { emitEvent: false });
                this.form.controls.agents.addControl(key, this.fb.control(''), { emitEvent: false });
            }
        }
    }

    private commit(): void {
        const value = this.form.getRawValue();
        if (!value.modes.A && !value.modes.B) {
            this.modeError.set('Select at least one execution mode.');
            this.form.controls.modes.controls.A.setValue(true, { emitEvent: false });
            return;
        }
        this.modeError.set('');
        const runtimes = this.runtimes();
        const base = this.placement();
        const allowedHosts = runtimes.filter((runtime) => value.allowed[runtime.runtimeKey]).map((runtime) => runtime.runtimeKey);
        const modes: WorkerExecutionMode[] = (['A', 'B'] as const).filter((mode) => value.modes[mode]);
        const models: Record<string, string> = {};
        const nativeAgent: Record<string, string> = {};
        for (const runtime of runtimes) {
            const model = String(value.models[runtime.runtimeKey] || '').trim();
            const agent = String(value.agents[runtime.runtimeKey] || '').trim();
            if (model) models[runtime.runtimeKey] = model;
            if (agent) nativeAgent[runtime.runtimeKey] = agent;
        }
        this.placementChange.emit({
            ...base,
            allowedHosts,
            models,
            nativeAgent,
            modes,
            modelTier: value.tier,
            fallback: value.fallback,
        });
    }
}
