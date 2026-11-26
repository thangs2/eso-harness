import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
    selector: 'eso-boundaries-hero',
    standalone: true,
    imports: [MatButtonModule],
    templateUrl: './boundaries-hero.component.html',
    styleUrl: './boundaries-hero.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoundariesHeroComponent {
    readonly policyCount = input.required<number>();
    readonly grantCount = input.required<number>();
    readonly enforcement = input.required<'audit' | 'enforce'>();
    readonly invariantsCount = input<number>(0);
    readonly secretsCount = input<number>(0);
    readonly saving = input<boolean>(false);
    readonly loading = input<boolean>(false);
    readonly dirty = input<boolean>(false);

    readonly save = output<void>();
}
