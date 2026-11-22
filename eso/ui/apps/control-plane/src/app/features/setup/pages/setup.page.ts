import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';

@Component({
    selector: 'eso-setup-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, MatCheckboxModule, MatSelectModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="setup-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Control Plane · Phase 1</p>
                    <h1>Initialize harness repo</h1>
                    <p class="subtitle">One canonical state in the repo; the host is only a projection, synced later.</p>
                </div>
            </header>

            <nav class="setup-steps" aria-label="Setup steps">
                @for (s of steps; track s.n) {
                    <button type="button" class="setup-step" [class.active]="step() === s.n" [class.done]="step() > s.n" [disabled]="s.n > furthest()" (click)="step.set(s.n)">
                        <span class="step-no">{{ s.n }}</span><span>{{ s.label }}</span>
                    </button>
                }
            </nav>

            @if (error(); as message) { <p class="form-error" role="alert">@if (errorCode()) { <strong>{{ errorCode() }}</strong> — }{{ message }}</p> }

            <section class="panel setup-panel">
                @switch (step()) {
                    @case (1) {
                        <h2>1 · Repo</h2>
                        <p class="section-hint">ESO creates canonical state at root: <code>AGENTS.md</code>, <code>agents/</code>, <code>.harness/</code>. Do not choose a host here.</p>
                        <div class="root-field-row">
                            <input #rootFolderInput type="file" webkitdirectory directory multiple hidden (change)="onRootFolder($event)">
                            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="setup-field">
                                <mat-label>Root repo</mat-label>
                                <input matInput [ngModel]="root()" (ngModelChange)="root.set($event)" placeholder="/Users/.../repo-A">
                            </mat-form-field>
                            <button mat-flat-button color="primary" type="button" class="browse-button" [disabled]="rootResolving()" (click)="rootFolderInput.click()">{{ rootResolving() ? 'Resolving…' : 'Choose folder' }}</button>
                        </div>
                        @if (rootError()) { <p class="form-error" role="alert">@if (rootErrorCode()) { <strong>{{ rootErrorCode() }}</strong> — }{{ rootError() }}</p> }
                        <div class="canonical-box">
                            <strong>Layout to create</strong>
                            <pre>repo-A/
├── AGENTS.md
├── agents/          # rules · skills · hooks · mcp
└── .harness/
    ├── config.json  # generated from DB
    └── manifest.json</pre>
                        </div>
                    }

                    @case (2) {
                        <h2>2 · Consumer</h2>
                        <p class="section-hint">Four minimum fields; root was declared in step 1.</p>
                        <div class="form-grid setup-form">
                            <mat-form-field appearance="outline"><mat-label>Consumer id</mat-label><input matInput [ngModel]="consumerId()" (ngModelChange)="consumerId.set($event)" placeholder="repo-a"></mat-form-field>
                            <mat-form-field appearance="outline"><mat-label>Consumer name</mat-label><input matInput [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="Repo A"></mat-form-field>
                            <mat-form-field appearance="outline"><mat-label>SDLC root</mat-label><input matInput [ngModel]="sdlcRoot()" (ngModelChange)="sdlcRoot.set($event)" placeholder="sdlc"></mat-form-field>
                        </div>
                    }

                    @case (3) {
                        <h2>3 · Observation</h2>
                        <p class="section-hint">Select the event types ESO may record. No secrets, prompt bodies, or file content.</p>

                        <div class="observation-card">
                            <div class="observation-header">
                                <div>
                                    <strong>Enable observation</strong>
                                    <small>When off, ESO receives no events from the host.</small>
                                </div>
                                <mat-slide-toggle [ngModel]="consent()" (ngModelChange)="consent.set($event)" aria-label="Enable observation">
                                    {{ consent() ? 'On' : 'Off' }}
                                </mat-slide-toggle>
                            </div>

                            <div class="observation-toolbar">
                                <span class="observation-count">{{ events().length }}/{{ eventKinds.length }} events selected</span>
                                <div class="observation-actions">
                                    <button mat-stroked-button type="button" [disabled]="!consent()" (click)="selectAllEvents()">Select all</button>
                                    <button mat-stroked-button type="button" [disabled]="!consent() || events().length === 0" (click)="clearEvents()">Clear</button>
                                </div>
                            </div>

                            <div class="event-grid" [class.event-grid-disabled]="!consent()">
                                @for (event of eventKinds; track event.id) {
                                    <mat-checkbox
                                        class="event-option"
                                        [checked]="events().includes(event.id)"
                                        [disabled]="!consent()"
                                        (change)="toggleEvent(event.id)"
                                    >
                                        <span class="event-copy">
                                            <strong>{{ event.label }}</strong>
                                            <small>{{ event.description }}</small>
                                        </span>
                                    </mat-checkbox>
                                }
                            </div>
                        </div>

                        <div class="observation-card jev-card">
                            <div class="observation-header">
                                <div>
                                    <strong>JEV integration</strong>
                                    <small>Optional decision facade. ESO stores config only; JEV engine/evidence consent is required before shadow/active.</small>
                                </div>
                            </div>
                            <mat-form-field appearance="outline" class="setup-field" subscriptSizing="dynamic">
                                <mat-label>JEV mode</mat-label>
                                <mat-select [ngModel]="jevMode()" (ngModelChange)="jevMode.set($event)">
                                    <mat-option value="off">Off</mat-option>
                                    <mat-option value="shadow">Shadow — evaluate only</mat-option>
                                    <mat-option value="active">Active — decide within band</mat-option>
                                </mat-select>
                            </mat-form-field>
                            @if (jevMode() !== 'off' && !consent()) {
                                <p class="form-error" role="alert"><strong>SETUP_JEV_NEEDS_CONSENT</strong> — JEV shadow/active requires observation consent.</p>
                            }
                        </div>
                    }

                    @case (4) {
                        <h2>4 · Preview & apply</h2>
                        <p class="section-hint">No files are written before creation. No host/source fields.</p>
                        <div class="setup-summary">
                            <div><span>Root</span><strong>{{ root() }}</strong></div>
                            <div><span>Consumer</span><strong>{{ consumerId() }}</strong></div>
                            <div><span>SDLC root</span><strong>{{ sdlcRoot() }}</strong></div>
                            <div><span>Observation</span><strong>{{ consent() ? events().length + ' event' : 'off' }}</strong></div>
                            <div><span>JEV</span><strong>{{ jevMode() }}</strong></div>
                        </div>
                        <button mat-flat-button color="primary" class="setup-submit" [disabled]="saving()" (click)="apply()">{{ saving() ? 'Creating…' : 'Create consumer + canonical harness' }}</button>
                    }
                }
            </section>

            <footer class="setup-actions">
                <button mat-stroked-button type="button" [disabled]="step() === 1" (click)="back()">Back</button>
                @if (step() < 4) { <button mat-flat-button color="primary" type="button" (click)="next()">Next</button> }
            </footer>
        </div>
    `,
    styles: [`
        .setup-page { display: grid; gap: var(--space-5); }
        .setup-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; }
        .setup-step { display: flex; align-items: center; gap: 8px; padding: 12px; border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
        .setup-step:last-child { border-right: 0; }
        .setup-step.active { background: var(--brand); color: var(--brand-ink); }
        .setup-step.done { color: var(--ink); }
        .setup-step:disabled { cursor: not-allowed; opacity: .45; }
        .step-no { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid currentColor; font-size: 12px; font-weight: 700; flex: none; }
        .setup-panel { min-height: 340px; }
        .setup-panel h2 { margin-top: 0; }
        .section-hint { color: var(--muted); margin-top: -4px; }
        .setup-field { width: min(620px, 100%); }
        .canonical-box { margin-top: var(--space-4); padding: 16px; border: 1px solid var(--line); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface) 92%, var(--brand)); }
        .canonical-box pre { margin: 8px 0 0; white-space: pre-wrap; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
        .setup-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .setup-form mat-form-field { width: 100%; }
        .jev-card { margin-top: var(--space-3); }
        .observation-card { margin-top: var(--space-5); border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; }
        .observation-header { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 16px; background: color-mix(in srgb, var(--surface) 92%, var(--brand)); border-bottom: 1px solid var(--line); }
        .observation-header > div { display: grid; gap: 4px; }
        .observation-header small { color: var(--muted); }
        .observation-toolbar { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); }
        .observation-count { color: var(--muted); font-size: var(--text-sm); }
        .observation-actions { display: flex; gap: 8px; }
        .event-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; }
        .event-grid-disabled { opacity: .55; }
        .event-option { display: flex; align-items: flex-start; padding: 14px 16px; border-bottom: 1px solid var(--line); }
        .event-option:nth-child(odd) { border-right: 1px solid var(--line); }
        .event-copy { display: grid; gap: 2px; white-space: normal; }
        .event-copy small { color: var(--muted); }
        .setup-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: var(--space-4); }
        .setup-summary div { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .setup-summary span { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .setup-summary strong { overflow-wrap: anywhere; }
        .setup-actions { display: flex; justify-content: flex-end; gap: 12px; }
        .setup-submit { display: block; margin-top: var(--space-5); margin-left: auto; }
        .root-field-row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
        .root-field-row .setup-field { flex: 1 1 420px; }
        .browse-button { margin-top: 4px; }
    `],
})
export class SetupPage {
    private readonly service = inject(ConsumerProfileService);
    private readonly router = inject(Router);

    readonly steps = [
        { n: 1, label: 'Repo' },
        { n: 2, label: 'Consumer' },
        { n: 3, label: 'Observe' },
        { n: 4, label: 'Preview' },
    ];
    readonly eventKinds = [
        { id: 'prompt.submitted', label: 'Prompt request', description: 'Request sent by the user to the host.' },
        { id: 'turn.completed', label: 'Turn result', description: 'Turn result and status.' },
        { id: 'tool.called', label: 'Tool call', description: 'Tool/MCP call and result.' },
        { id: 'file.changed', label: 'File change', description: 'File changed during the turn.' },
    ];

    readonly step = signal(1);
    readonly furthest = signal(1);
    readonly root = signal('');
    readonly consumerId = signal('');
    readonly name = signal('');
    readonly sdlcRoot = signal('sdlc');
    readonly consent = signal(true);
    readonly events = signal<string[]>(['prompt.submitted', 'turn.completed', 'tool.called']);
    readonly jevMode = signal<'off' | 'shadow' | 'active'>('off');
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);
    readonly errorCode = signal('');
    readonly rootResolving = signal(false);
    readonly rootError = signal<string | null>(null);
    readonly rootErrorCode = signal('');

    toggleEvent(id: string): void {
        this.events.set(this.events().includes(id) ? this.events().filter((event) => event !== id) : [...this.events(), id]);
    }

    selectAllEvents(): void {
        this.events.set(this.eventKinds.map((event) => event.id));
    }

    clearEvents(): void {
        this.events.set([]);
    }

    back(): void {
        this.error.set(null);
        this.errorCode.set('');
        this.step.set(Math.max(1, this.step() - 1));
    }

    next(): void {
        const error = this.validate();
        if (error) { this.errorCode.set(error.code); this.error.set(error.message); return; }
        this.error.set(null);
        this.errorCode.set('');
        const next = Math.min(4, this.step() + 1);
        this.step.set(next);
        this.furthest.set(Math.max(this.furthest(), next));
    }

    validate(): { code: string; message: string } | null {
        if (this.step() === 1 && !this.root().trim()) return { code: 'SETUP_ROOT_REQUIRED', message: 'Root repo is required.' };
        if (this.step() === 3 && this.jevMode() !== 'off' && !this.consent()) return { code: 'SETUP_JEV_NEEDS_CONSENT', message: 'JEV shadow/active requires observation consent.' };
        if (this.step() === 2) {
            if (!/^[a-z][a-z0-9-]{1,31}$/.test(this.consumerId())) return { code: 'SETUP_ID_INVALID', message: 'Consumer id must be a lowercase slug (2–32 characters).' };
            if (!this.name().trim()) return { code: 'SETUP_NAME_REQUIRED', message: 'Consumer name is required.' };
            if (!this.sdlcRoot().trim()) return { code: 'SETUP_SDLC_ROOT_REQUIRED', message: 'SDLC root is required.' };
        }
        return null;
    }

    onRootFolder(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        const name = relative.split('/')[0];
        if (!name) return;
        this.rootResolving.set(true);
        this.rootError.set(null);
        this.service.resolveDirectory(name)
            .then((result) => {
                if (result.matches.length === 1) {
                    this.root.set(result.matches[0]);
                    return;
                }
                if (result.matches.length === 0) {
                    this.rootErrorCode.set('SETUP_ROOT_UNRESOLVED');
                    this.rootError.set(`Folder "${name}" is not inside the control-plane filesystem root.`);
                    return;
                }
                this.rootErrorCode.set('SETUP_ROOT_AMBIGUOUS');
                this.rootError.set(`Multiple folders named "${name}". Choose a more specific repository folder.`);
            })
            .catch((err) => {
                this.rootErrorCode.set('SETUP_UPSTREAM_FAILED');
                this.rootError.set(err?.detail || err?.message || 'Could not resolve selected folder');
            })
            .finally(() => this.rootResolving.set(false));
    }

    apply(): void {
        const invalid = this.validate();
        if (invalid) { this.errorCode.set(invalid.code); this.error.set(invalid.message); return; }
        this.saving.set(true);
        this.error.set(null);
        this.errorCode.set('');
        this.service
            .createSetup({
                id: this.consumerId().trim(),
                name: this.name().trim(),
                root: this.root().trim(),
                sdlcRoot: this.sdlcRoot().trim(),
                profile: {
                    canonical: { agents: 'agents', harness: '.harness' },
                    observation: { consent: this.consent(), events: this.events() },
                    integration: { jev: { mode: this.jevMode(), consent: this.consent() } },
                },
            })
            .then((result) => this.router.navigate(['/consumers', result.id], { queryParams: { created: '1' } }))
            .catch((error) => {
                const status = (error as { status?: number })?.status;
                this.errorCode.set(status === 401 || status === 403 ? 'SETUP_DENIED' : 'SETUP_UPSTREAM_FAILED');
                this.error.set((error as { detail?: string; message?: string })?.detail || (error as Error)?.message || 'Unable to create consumer');
            })
            .finally(() => this.saving.set(false));
    }
}
