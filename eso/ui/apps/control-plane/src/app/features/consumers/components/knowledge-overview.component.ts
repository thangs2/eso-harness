import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { KnowledgeCheckDto, KnowledgeEmbeddingStatusDto, KnowledgeSufficiencyDto, KnowledgeSummaryDto } from '../../../../../../../libs/api-client/types.js';

export type KnowledgeSection = 'overview' | 'sources' | 'contract' | 'index' | 'manifest' | 'artifacts';
export type KnowledgeProviderRouting = Record<'work' | 'design' | 'content', string>;

@Component({
    selector: 'eso-knowledge-overview',
    standalone: true,
    imports: [MatButtonModule],
    templateUrl: './knowledge-overview.component.html',
    styleUrl: './knowledge-overview.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KnowledgeOverviewComponent {
    readonly summary = input<KnowledgeSummaryDto | null>(null);
    readonly embeddingStatus = input<KnowledgeEmbeddingStatusDto | null>(null);
    readonly check = input<KnowledgeCheckDto | null>(null);
    readonly sufficiency = input<KnowledgeSufficiencyDto | null>(null);
    readonly section = input.required<KnowledgeSection>();
    readonly checking = input(false);
    readonly indexing = input(false);
    readonly providerRouteSummary = input('');
    readonly sdlcEnabled = input(false);
    readonly governanceCount = input(0);
    readonly manifestEnabled = input(true);
    readonly providerRouting = input.required<KnowledgeProviderRouting>();

    readonly runCheck = output<void>();
    readonly indexNow = output<void>();
    readonly sectionChange = output<KnowledgeSection>();
    readonly openPlugins = output<void>();

    readonly tabs: Array<{ id: KnowledgeSection; label: string; hint: string }> = [
        { id: 'overview', label: 'Overview', hint: 'Sources & health' },
        { id: 'sources', label: 'Sources', hint: 'Files & providers' },
        { id: 'contract', label: 'Contract', hint: 'SDLC & governance' },
        { id: 'index', label: 'Index & health', hint: 'Documents & findings' },
        { id: 'manifest', label: 'Manifest', hint: 'Machine contract' },
        { id: 'artifacts', label: 'Artifacts', hint: 'Inbox & projections' },
    ];
}
