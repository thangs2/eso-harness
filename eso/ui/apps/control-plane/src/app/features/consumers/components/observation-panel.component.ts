import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { JevDecisionDto, ObservationDto } from '../../../../../../../libs/api-client/types.js';

type JevMode = 'off' | 'shadow' | 'active';
type EventKind = { id: string; label: string; description: string };

@Component({
    selector: 'eso-observation-panel',
    standalone: true,
    imports: [MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule],
    templateUrl: './observation-panel.component.html',
    styleUrl: './observation-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObservationPanelComponent {
    private readonly service = inject(ConsumerProfileService);

    readonly consumerId = input.required<string>();
    readonly consent = input(false);
    readonly events = input<string[]>([]);
    readonly jevMode = input<JevMode>('off');
    readonly jevAutoThreshold = input('');
    readonly jevConfirmThreshold = input('');
    readonly jevConfidence = input('0.9');

    readonly consentChange = output<boolean>();
    readonly eventsChange = output<string[]>();
    readonly jevModeChange = output<JevMode>();
    readonly jevAutoThresholdChange = output<string>();
    readonly jevConfirmThresholdChange = output<string>();
    readonly jevConfidenceChange = output<string>();

    /** BUG-41: the server returns the latest N rows only; the UI must say so instead of implying "all". */
    readonly observationLimit = 100;
    readonly observations = signal<ObservationDto[]>([]);
    readonly observationsLoading = signal(false);
    readonly observationsError = signal<string | null>(null);
    readonly observationTraceCount = computed(() => new Set(this.observations().map((item) => item.traceId).filter(Boolean)).size);
    readonly observationHostCount = computed(() => new Set(this.observations().map((item) => item.hostId).filter(Boolean)).size);
    readonly observationWorkerCount = computed(() => new Set(this.observations().map((item) => item.workerId).filter(Boolean)).size);
    readonly lastObservationAt = computed(() => this.observations().map((item) => item.at).filter(Boolean).sort().at(-1)?.slice(0, 19).replace('T', ' ') || '');

    readonly jevDecision = signal<JevDecisionDto | null>(null);
    readonly jevDecisionLoading = signal(false);
    readonly jevDecisionError = signal('');
    private loaded = false;

    readonly eventKinds: EventKind[] = [
        { id: 'prompt.submitted', label: 'Prompt request', description: 'Request sent by the user to the host.' },
        { id: 'turn.completed', label: 'Turn result', description: 'Turn result and status.' },
        { id: 'tool.called', label: 'Tool call', description: 'Tool/MCP call and result.' },
        { id: 'file.changed', label: 'File change', description: 'File changed during the turn.' },
    ];

    constructor() {
        effect(() => {
            const consumerId = this.consumerId();
            if (consumerId) this.loadObservations(false);
        });
    }

    toggleEvent(id: string): void {
        const current = this.events();
        this.eventsChange.emit(current.includes(id) ? current.filter((event) => event !== id) : [...current, id]);
    }

    refreshObservations(): void {
        this.loadObservations(true);
    }

    evaluateJev(): void {
        const confidence = Number(this.jevConfidence());
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
            this.jevDecisionError.set('Confidence must be between 0 and 1.');
            return;
        }
        this.jevDecisionLoading.set(true);
        this.jevDecisionError.set('');
        this.service.decideJev(this.consumerId(), confidence)
            .then((decision) => this.jevDecision.set(decision))
            .catch((error) => this.jevDecisionError.set(this.message(error, 'Could not evaluate JEV decision')))
            .finally(() => this.jevDecisionLoading.set(false));
    }

    evidenceText(evidence: unknown): string {
        try { return JSON.stringify(this.redactEvidence(evidence ?? null), null, 2); } catch { return String(evidence); }
    }

    /**
     * BUG-36: same redaction convention as the request detail/evidence surfaces — prompt-bearing keys become `[redacted]`,
     * walked recursively because host evidence can nest its payload.
     */
    private redactEvidence(value: unknown): unknown {
        if (Array.isArray(value)) return value.map((item) => this.redactEvidence(item));
        if (value && typeof value === 'object') {
            const redacted: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
                redacted[key] = ['userQuery', 'prompt', 'requestBody'].includes(key) ? '[redacted]' : this.redactEvidence(item);
            }
            return redacted;
        }
        return value;
    }

    private loadObservations(force: boolean): void {
        if (this.observationsLoading()) return;
        if (this.loaded && !force) return;
        this.observationsLoading.set(true);
        this.observationsError.set(null);
        this.service.getObservations(this.consumerId(), this.observationLimit)
            .then((items) => {
                this.observations.set([...items].sort((left, right) => this.observationTime(right) - this.observationTime(left)));
                this.loaded = true;
            })
            .catch((error) => this.observationsError.set(this.message(error, 'Could not load observations')))
            .finally(() => this.observationsLoading.set(false));
    }

    private observationTime(observation: ObservationDto): number {
        const time = new Date(observation.at || observation.receivedAt).getTime();
        return Number.isFinite(time) ? time : 0;
    }

    private message(error: unknown, fallback: string): string {
        if (error && typeof error === 'object') {
            const detail = (error as { detail?: unknown }).detail;
            const message = (error as { message?: unknown }).message;
            if (typeof detail === 'string' && detail) return detail;
            if (typeof message === 'string' && message) return message;
        }
        return fallback;
    }
}
