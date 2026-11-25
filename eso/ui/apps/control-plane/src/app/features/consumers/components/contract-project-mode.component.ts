import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

export interface PipelineOption {
    id: string;
    label: string;
}

@Component({
    selector: 'eso-contract-project-mode',
    standalone: true,
    imports: [FormsModule, MatCheckboxModule, MatFormFieldModule, MatSelectModule, MatSlideToggleModule],
    templateUrl: './contract-project-mode.component.html',
    styleUrl: './contract-project-mode.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractProjectModeComponent {
    readonly sdlcEnabled = input.required<boolean>();
    readonly pipeline = input.required<string>();
    readonly pipelineOptions = input.required<PipelineOption[]>();
    readonly pipelineHint = input.required<string>();
    readonly crProcess = input.required<boolean>();
    readonly active = input(false);

    readonly sdlcChange = output<boolean>();
    readonly pipelineChange = output<string>();
    readonly crProcessChange = output<boolean>();
    readonly selectTopic = output<void>();
}
