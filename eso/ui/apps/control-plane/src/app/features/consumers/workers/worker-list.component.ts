import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { WorkerEntry } from './worker.types.js';

@Component({
    selector: 'eso-worker-list',
    standalone: true,
    imports: [FormsModule, MatFormFieldModule, MatInputModule],
    templateUrl: './worker-list.component.html',
    styleUrl: './worker-list.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkerListComponent {
    readonly workers = input.required<WorkerEntry[]>();
    readonly selectedId = input('');
    readonly summaries = input<Record<string, string>>({});
    readonly selectWorker = output<string>();

    readonly search = signal('');
    readonly filtered = computed(() => {
        const query = this.search().trim().toLowerCase();
        const workers = this.workers();
        if (!query) return workers;
        return workers.filter((worker) => `${worker.name} ${worker.role} ${worker.id}`.toLowerCase().includes(query));
    });
}
