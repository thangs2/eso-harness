import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { KnowledgeContractComponent } from './knowledge-contract.component.js';
import { KnowledgeOverviewComponent } from './knowledge-overview.component.js';
import { ArtifactsInboxComponent } from './artifacts-inbox.component.js';
import type { ConsumerSettingsPage } from '../pages/consumer-settings.page.js';

@Component({
    selector: 'eso-knowledge-tab',
    standalone: true,
    imports: [
        FormsModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
        MatSlideToggleModule,
        KnowledgeOverviewComponent,
        KnowledgeContractComponent,
        ArtifactsInboxComponent,
    ],
    templateUrl: './knowledge-tab.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KnowledgeTabComponent {
    readonly vm = input.required<ConsumerSettingsPage>();
}
