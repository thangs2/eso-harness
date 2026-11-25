import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';

export interface GovernanceItem {
    id: string;
    topic: string;
    title: string;
    hint: string;
    checked: () => boolean;
    emitChange: (val: boolean) => void;
}

@Component({
    selector: 'eso-contract-governance',
    standalone: true,
    imports: [MatCheckboxModule],
    templateUrl: './contract-governance.component.html',
    styleUrl: './contract-governance.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractGovernanceComponent {
    readonly sdlcEnabled = input.required<boolean>();
    readonly selectedTopic = input.required<string>();
    readonly documentStatusRequired = input.required<boolean>();
    readonly openRegisterRequired = input.required<boolean>();
    readonly crossCheckRequired = input.required<boolean>();
    readonly buildEnforcementRequired = input.required<boolean>();
    readonly preflightRequired = input.required<boolean>();
    readonly goNoGoRequired = input.required<boolean>();
    readonly pipelineContractRequired = input.required<boolean>();

    readonly documentStatusChange = output<boolean>();
    readonly openRegisterChange = output<boolean>();
    readonly crossCheckChange = output<boolean>();
    readonly buildEnforcementChange = output<boolean>();
    readonly preflightChange = output<boolean>();
    readonly goNoGoChange = output<boolean>();
    readonly pipelineContractChange = output<boolean>();
    readonly topicSelect = output<string>();

    isTopicActive(topic: string): boolean {
        return this.selectedTopic() === topic;
    }
}
