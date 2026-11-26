import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, ViewEncapsulation, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { ConsumerArtifactDto, HostProjectionArtifactDto } from '../pages/consumer-settings.models.js';

@Component({
    selector: 'eso-artifacts-inbox',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatSelectModule,
    ],
    templateUrl: './artifacts-inbox.component.html',
    styleUrl: './artifacts-inbox.component.scss',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArtifactsInboxComponent {
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);

    readonly artifacts = input<ConsumerArtifactDto[]>([]);
    readonly hostProjections = input<HostProjectionArtifactDto[]>([]);
    readonly loading = input(false);
    readonly filterOrigin = input<string>('all');
    readonly filterKtState = input<string>('all');

    readonly promote = output<string>();
    readonly filterOriginChange = output<string>();
    readonly filterKtStateChange = output<string>();
    readonly syncProjections = output<void>();

    @ViewChild('guideDialog') private guideDialog?: ElementRef<HTMLDialogElement>;

    readonly searchQuery = signal('');

    openGuide(): void {
        this.guideDialog?.nativeElement.showModal();
    }

    closeGuide(): void {
        this.guideDialog?.nativeElement.close();
    }

    onBackdrop(event: MouseEvent): void {
        if (event.target === this.guideDialog?.nativeElement) {
            this.closeGuide();
        }
    }

    navigateToSection(section: string): void {
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tab: 'knowledge', section },
            queryParamsHandling: 'merge',
        });
    }

    navigateToTab(tab: string): void {
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { tab, section: null },
            queryParamsHandling: 'merge',
        });
    }

    readonly filteredArtifacts = computed(() => {
        const query = this.searchQuery().toLowerCase().trim();
        const origin = this.filterOrigin();
        const state = this.filterKtState();

        return this.artifacts().filter((artifact) => {
            if (origin !== 'all' && artifact.origin !== origin) return false;
            if (state !== 'all' && artifact.ktState !== state) return false;
            if (query) {
                const matchTitle = artifact.title.toLowerCase().includes(query);
                const matchId = artifact.id.toLowerCase().includes(query);
                const matchBody = (artifact.body || '').toLowerCase().includes(query);
                return matchTitle || matchId || matchBody;
            }
            return true;
        });
    });

    onPromote(id: string): void {
        this.promote.emit(id);
    }
}
