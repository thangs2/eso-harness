import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

type EventKind = { id: string; label: string; description: string };

/**
 * Consent + event scope only. This is a config surface: observation rows and JEV policy live
 * elsewhere (Observatory for evidence, Stack tab for JEV). See UI-PAGE-SETTINGS-OBSERVATION.
 */
@Component({
    selector: 'eso-observation-panel',
    standalone: true,
    imports: [RouterLink, MatButtonModule, MatCheckboxModule, MatSlideToggleModule],
    templateUrl: './observation-panel.component.html',
    styleUrl: './observation-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ObservationPanelComponent {
    readonly consumerId = input.required<string>();
    readonly consent = input(false);
    readonly events = input<string[]>([]);

    readonly consentChange = output<boolean>();
    readonly eventsChange = output<string[]>();

    readonly eventKinds: EventKind[] = [
        { id: 'prompt.submitted', label: 'Prompt request', description: 'Request sent by the user to the host.' },
        { id: 'turn.completed', label: 'Turn result', description: 'Turn result and status.' },
        { id: 'tool.called', label: 'Tool call', description: 'Tool/MCP call and result.' },
        { id: 'file.changed', label: 'File change', description: 'File changed during the turn.' },
    ];

    toggleEvent(id: string): void {
        const current = this.events();
        this.eventsChange.emit(current.includes(id) ? current.filter((event) => event !== id) : [...current, id]);
    }
}
