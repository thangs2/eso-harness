import { ChangeDetectionStrategy, Component, HostListener, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
    selector: 'eso-contract-diagram-lightbox',
    standalone: true,
    imports: [MatButtonModule],
    templateUrl: './contract-diagram-lightbox.component.html',
    styleUrl: './contract-diagram-lightbox.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractDiagramLightboxComponent {
    readonly title = input.required<string>();
    readonly src = input.required<string>();

    readonly close = output<void>();

    @HostListener('document:keydown.escape')
    onEscape(): void {
        this.close.emit();
    }
}
