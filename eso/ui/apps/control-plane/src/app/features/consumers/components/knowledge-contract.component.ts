import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ConsumerSettingsPage } from '../pages/consumer-settings.page.js';
import { ContractDetailComponent } from './contract-detail.component.js';
import { ContractDiagramLightboxComponent } from './contract-diagram-lightbox.component.js';
import { ContractGovernanceComponent } from './contract-governance.component.js';
import { ContractProjectModeComponent } from './contract-project-mode.component.js';
import { ContractSpectrumComponent } from './contract-spectrum.component.js';

@Component({
    selector: 'eso-knowledge-contract',
    standalone: true,
    imports: [
        ContractProjectModeComponent,
        ContractGovernanceComponent,
        ContractSpectrumComponent,
        ContractDetailComponent,
        ContractDiagramLightboxComponent,
    ],
    templateUrl: './knowledge-contract.component.html',
    styleUrl: './knowledge-contract.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KnowledgeContractComponent {
    readonly vm = input.required<ConsumerSettingsPage>();
}
