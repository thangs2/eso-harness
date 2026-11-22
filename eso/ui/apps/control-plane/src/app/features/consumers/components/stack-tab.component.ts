import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { ConsumerSettingsPage } from '../pages/consumer-settings.page.js';

@Component({
    selector: 'eso-stack-tab',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule],
    templateUrl: './stack-tab.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StackTabComponent {
    readonly vm = input.required<ConsumerSettingsPage>();
}
