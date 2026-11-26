import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

@Component({
    selector: 'eso-boundaries-enforcement',
    standalone: true,
    imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule],
    templateUrl: './boundaries-enforcement.component.html',
    styleUrl: './boundaries-enforcement.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoundariesEnforcementComponent {
    readonly formGroup = input.required<FormGroup<{ enforcement: FormControl<'audit' | 'enforce'> }>>();
    readonly addPolicy = output<void>();
}
