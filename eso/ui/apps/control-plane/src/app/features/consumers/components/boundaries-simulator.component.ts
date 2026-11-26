import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface SimulationResultDto {
    verdict: 'ALLOWED' | 'GATED' | 'BLOCKED';
    badgeLabel: string;
    matchedPolicyIndex: number | null;
    matchedPolicyId: string | null;
    matchedPattern: string | null;
    explanation: string;
}

export interface PresetPathOption {
    label: string;
    path: string;
    action: 'read' | 'write';
    category: string;
}

@Component({
    selector: 'eso-boundaries-simulator',
    standalone: true,
    imports: [MatFormFieldModule, MatInputModule],
    templateUrl: './boundaries-simulator.component.html',
    styleUrl: './boundaries-simulator.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoundariesSimulatorComponent {
    readonly simPath = input.required<string>();
    readonly simAction = input.required<'read' | 'write'>();
    readonly simulationResult = input.required<SimulationResultDto>();

    readonly pathChange = output<string>();
    readonly actionChange = output<'read' | 'write'>();

    readonly presets: readonly PresetPathOption[] = [
        { label: 'data-lake/** (write)', path: 'data-lake/raw/trades.parquet', action: 'write', category: 'data-lake' },
        { label: '.env* (read)', path: '.env.production', action: 'read', category: 'secrets' },
        { label: 'agents/hooks/** (write)', path: 'agents/hooks/custom-gate.mjs', action: 'write', category: 'invariants' },
        { label: 'sdlc/** (write)', path: 'sdlc/01.spec.md', action: 'write', category: 'workspace' },
        { label: '/outside/repo (read)', path: '/etc/hosts', action: 'read', category: 'invariants' },
    ];

    applyPreset(preset: PresetPathOption): void {
        this.pathChange.emit(preset.path);
        this.actionChange.emit(preset.action);
    }
}
