import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface PipelineStageItem {
    id: string;
    label: string;
    role: string;
    gate: string;
    artifact: string;
}

export interface PipelineGroupItem {
    id: string;
    title: string;
    stages: PipelineStageItem[];
}

export interface CrossCheckGroupItem {
    label: string;
    ids: string;
}

export interface KnowledgeDetailItem {
    eyebrow: string;
    title: string;
    description: string;
    items: Array<{ label: string; value: string }>;
}

@Component({
    selector: 'eso-contract-detail',
    standalone: true,
    imports: [],
    templateUrl: './contract-detail.component.html',
    styleUrl: './contract-detail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractDetailComponent {
    readonly selectedTopic = input.required<string>();
    readonly detail = input<KnowledgeDetailItem | null>(null);
    readonly trace = input<Array<{ label: string; value: string }>>([]);
    readonly pipelineGroups = input<PipelineGroupItem[]>([]);
    readonly crossCheckGroups = input<CrossCheckGroupItem[]>([]);
    readonly dorConditions = input<string[]>([]);
    readonly dodConditions = input<string[]>([]);

    readonly openDiagram = output<'main' | 'cr' | 'intent'>();
}
