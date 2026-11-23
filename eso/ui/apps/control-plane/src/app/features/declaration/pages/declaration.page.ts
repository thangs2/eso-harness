import { Component, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CONTROL_PLANE_API_CLIENT } from '../../../../core/tokens.js';
import { StateFrameComponent } from '../../../shared/state-frame/state-frame.component.js';
import type { DeclarationPreview } from '../models/declaration.model.js';

/**
 * Routed Component: S3 Config (SKILL.md §5)
 * Requirements:
 * - Save button MUST stay disabled until a preview exists.
 * - Stale hash 409 handled by prompt to reload preview, NEVER blind retry.
 * - Presets MUST NOT overwrite values the user edited.
 */
@Component({
    selector: 'eso-declaration-page',
    standalone: true,
    imports: [StateFrameComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="s3-page-container">
            <header class="page-header">
                <h1>System configuration (S3 Config)</h1>
            </header>

            <eso-state-frame [state]="isSaving() ? 'ST2_LOADING' : 'READY'">
                <div class="config-actions">
                    <button type="button" class="btn-preview" (click)="generatePreview()">Preview</button>
                    <button
                        type="button"
                        class="btn-save"
                        [disabled]="!canSave()"
                        (click)="saveConfiguration()"
                    >
                        Save configuration
                    </button>
                </div>

                @if (preview()) {
                    <section class="preview-panel" aria-label="Configuration preview">
                        <h2>Preview changes (Hash: {{ preview()?.hash }})</h2>
                        <p class="impact">{{ preview()?.impactSummary || 'No impact warnings' }}</p>
                    </section>
                }

                @if (error()) {
                    <p class="form-error" role="alert">{{ error() }}</p>
                }

                @if (conflictError()) {
                    <div class="conflict-alert" role="alert">
                        <p>Version conflict (409): the configuration was changed by another session. Reload the preview.</p>
                        <button type="button" (click)="generatePreview()">Reload preview</button>
                    </div>
                }
            </eso-state-frame>
        </div>
    `,
})
export class DeclarationPage {
    private readonly api = inject(CONTROL_PLANE_API_CLIENT, { optional: true });
    private readonly route = inject(ActivatedRoute);
    private readonly consumerId = this.route.snapshot.queryParamMap.get('consumer') || 'fineso';

    readonly preview = signal<DeclarationPreview | null>(null);
    readonly isSaving = signal<boolean>(false);
    readonly conflictError = signal<boolean>(false);
    readonly error = signal<string>('');

    readonly hasPreview = computed(() => this.preview() !== null);
    readonly canSave = computed(() => this.hasPreview() && !this.isSaving());

    async generatePreview(): Promise<void> {
        this.conflictError.set(false);
        this.error.set('');
        if (!this.api) { this.error.set('API client unavailable'); return; }
        try {
            const preview = await this.api.previewConfig(this.consumerId);
            this.preview.set(preview);
        } catch (error) {
            this.error.set((error as Error)?.message || 'Unable to preview configuration');
        }
    }

    async saveConfiguration(): Promise<void> {
        const current = this.preview();
        if (!this.canSave() || !current || !this.api) return;
        this.isSaving.set(true);
        this.error.set('');
        try {
            const saved = await this.api.saveConfig(this.consumerId, {}, current.hash);
            this.preview.set({ ...current, hash: saved.hash });
        } catch (error) {
            const message = (error as Error)?.message || 'Unable to save configuration';
            if (message.includes('CONFIG_STALE_HASH')) {
                this.conflictError.set(true);
                this.preview.set(null);
            } else {
                this.error.set(message);
            }
        } finally {
            this.isSaving.set(false);
        }
    }
}
