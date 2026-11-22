import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { WorkerEntry, WorkerLayer } from './worker.types.js';

type WorkerStatus = WorkerEntry['status'];

@Component({
    selector: 'eso-worker-identity',
    standalone: true,
    imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
    templateUrl: './worker-identity.component.html',
    styleUrl: './worker-identity.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkerIdentityComponent {
    private readonly fb = inject(NonNullableFormBuilder);
    readonly worker = input.required<WorkerEntry>();
    readonly workerChange = output<WorkerEntry>();

    readonly roles = ['scout', 'plan', 'build', 'fixbug', 'verify', 'audit', 'qc'];
    readonly statuses: WorkerStatus[] = ['declared', 'active', 'paused', 'retired'];

    readonly form = this.fb.group({
        name: this.fb.control('', Validators.required),
        role: this.fb.control('', Validators.required),
        layer: this.fb.control<WorkerLayer>('peer'),
        status: this.fb.control<WorkerStatus>('declared'),
        instructions: this.fb.control(''),
    });

    constructor() {
        effect(() => {
            const worker = this.worker();
            this.form.patchValue({
                name: worker.name,
                role: worker.role,
                layer: worker.layer,
                status: worker.status,
                instructions: worker.instructions || '',
            }, { emitEvent: false });
        });
        this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
            this.workerChange.emit({ ...this.worker(), ...value });
        });
    }

    activate(): void {
        this.form.controls.status.setValue('active');
    }
}
