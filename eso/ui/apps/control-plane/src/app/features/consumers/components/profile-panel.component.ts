import { ChangeDetectionStrategy, Component, effect, inject, input, output } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface ConsumerProfileFields {
    name: string;
    owner: string;
    locale: string;
    tags: string;
    description: string;
}

@Component({
    selector: 'eso-profile-panel',
    standalone: true,
    imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule],
    templateUrl: './profile-panel.component.html',
    styleUrl: './profile-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePanelComponent {
    private readonly fb = inject(NonNullableFormBuilder);
    readonly value = input<ConsumerProfileFields>({ name: '', owner: '', locale: '', tags: '', description: '' });
    readonly valueChange = output<ConsumerProfileFields>();

    readonly form = this.fb.group({
        name: this.fb.control(''),
        owner: this.fb.control(''),
        locale: this.fb.control(''),
        tags: this.fb.control(''),
        description: this.fb.control(''),
    });

    constructor() {
        effect(() => {
            this.form.patchValue(this.value(), { emitEvent: false });
        });
        this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.valueChange.emit(this.form.getRawValue()));
    }
}
