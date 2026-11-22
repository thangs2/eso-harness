import { ChangeDetectionStrategy, Component, ViewEncapsulation, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { WorkersSettingsComponent } from '../components/workers-settings.component.js';
import { WorkerOverviewComponent } from '../components/worker-overview.component.js';
import { BoundariesPanelComponent } from '../components/boundaries-panel.component.js';
import { ObservationPanelComponent } from '../components/observation-panel.component.js';
import { ProfilePanelComponent } from '../components/profile-panel.component.js';
import { StackTabComponent } from '../components/stack-tab.component.js';
import { HostsTabComponent } from '../components/hosts-tab.component.js';
import { KnowledgeTabComponent } from '../components/knowledge-tab.component.js';
import { SettingsTailBase } from './settings-tail.base.js';

@Component({
    selector: 'eso-consumer-settings-page',
    standalone: true,
    imports: [WorkersSettingsComponent, WorkerOverviewComponent, BoundariesPanelComponent, ObservationPanelComponent, ProfilePanelComponent, StackTabComponent, HostsTabComponent, KnowledgeTabComponent, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
    templateUrl: './consumer-settings.page.html',
    styleUrl: './consumer-settings.page.scss',
})
export class ConsumerSettingsPage extends SettingsTailBase {
    readonly vm = this;
    readonly workersSettings = viewChild(WorkersSettingsComponent);
}
