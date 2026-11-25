import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { FlowDefinitionDto } from '../../../../../../../libs/api-client/types.js';
import { PromptModeMatrixComponent } from './prompt-mode-matrix.component.js';

@Component({
    selector: 'eso-worker-overview',
    standalone: true,
    imports: [MatButtonModule, PromptModeMatrixComponent],
    templateUrl: './worker-overview.component.html',
    styleUrl: './worker-overview.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkerOverviewComponent {
    readonly workerCount = input.required<number>();
    readonly gateCount = input.required<number>();
    readonly peerCount = input.required<number>();
    readonly placementCount = input.required<number>();
    readonly hostCoverage = input.required<number>();
    readonly flow = input<FlowDefinitionDto | null>(null);

    readonly openFlows = output<void>();
    readonly openDiagram = output<void>();
}
