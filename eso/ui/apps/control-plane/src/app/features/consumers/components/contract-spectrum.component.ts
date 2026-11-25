import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { QuartetProfileType } from '../pages/settings-core.base.js';

export interface SpectrumTestItem {
    id: string;
    note: string;
    tool: string;
    included: boolean;
}

@Component({
    selector: 'eso-contract-spectrum',
    standalone: true,
    imports: [FormsModule, MatFormFieldModule, MatSelectModule],
    templateUrl: './contract-spectrum.component.html',
    styleUrl: './contract-spectrum.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractSpectrumComponent {
    readonly profile = input.required<QuartetProfileType>();
    readonly types = input.required<SpectrumTestItem[]>();
    readonly active = input(false);

    readonly profileChange = output<QuartetProfileType>();
    readonly selectTopic = output<void>();
}
