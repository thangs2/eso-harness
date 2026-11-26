import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { BoundaryGrantDto } from '../../../../../../../libs/api-client/types.js';

export type GrantFormGroup = FormGroup<{
    target: FormControl<string>;
    kind: FormControl<'read' | 'write'>;
    mode: FormControl<'once' | 'always'>;
    ttlMinutes: FormControl<number>;
}>;

@Component({
    selector: 'eso-boundaries-grants',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
    ],
    templateUrl: './boundaries-grants.component.html',
    styleUrl: './boundaries-grants.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoundariesGrantsComponent {
    readonly grants = input.required<readonly BoundaryGrantDto[]>();
    readonly grantForm = input.required<GrantFormGroup>();
    readonly grantSaving = input.required<boolean>();
    readonly grantCount = input.required<number>();
    readonly grantTtlMaxMinutes = input.required<number>();

    readonly create = output<void>();
    readonly revoke = output<string>();

    setTtlPreset(minutes: number): void {
        this.grantForm().controls.ttlMinutes.setValue(minutes);
        this.grantForm().controls.ttlMinutes.markAsDirty();
    }
}
