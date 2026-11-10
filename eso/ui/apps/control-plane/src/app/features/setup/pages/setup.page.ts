import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';

@Component({
    selector: 'eso-setup-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="setup-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Control Plane · Phase 1</p>
                    <h1>Khởi tạo repo harness</h1>
                    <p class="subtitle">Một canonical state trong repo; host chỉ là projection, sync sau.</p>
                </div>
            </header>

            <nav class="setup-steps" aria-label="Các bước khởi tạo">
                @for (s of steps; track s.n) {
                    <button type="button" class="setup-step" [class.active]="step() === s.n" [class.done]="step() > s.n" [disabled]="s.n > furthest()" (click)="step.set(s.n)">
                        <span class="step-no">{{ s.n }}</span><span>{{ s.label }}</span>
                    </button>
                }
            </nav>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }

            <section class="panel setup-panel">
                @switch (step()) {
                    @case (1) {
                        <h2>1 · Repo</h2>
                        <p class="section-hint">ESO tạo canonical state tại root: <code>AGENTS.md</code>, <code>agents/</code>, <code>.harness/</code>. Không chọn host ở đây.</p>
                        <mat-form-field appearance="outline" class="setup-field">
                            <mat-label>Root repo</mat-label>
                            <input matInput [ngModel]="root()" (ngModelChange)="root.set($event)" placeholder="/Users/.../repo-A">
                        </mat-form-field>
                        <div class="canonical-box">
                            <strong>Layout sẽ tạo</strong>
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
                        <p class="section-hint">Bốn field tối thiểu; root đã khai ở bước 1.</p>
                        <div class="form-grid setup-form">
                            <mat-form-field appearance="outline"><mat-label>Consumer id</mat-label><input matInput [ngModel]="consumerId()" (ngModelChange)="consumerId.set($event)" placeholder="repo-a"></mat-form-field>
                            <mat-form-field appearance="outline"><mat-label>Tên consumer</mat-label><input matInput [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="Repo A"></mat-form-field>
                            <mat-form-field appearance="outline"><mat-label>SDLC root</mat-label><input matInput [ngModel]="sdlcRoot()" (ngModelChange)="sdlcRoot.set($event)" placeholder="sdlc"></mat-form-field>
                        </div>
                    }

                    @case (3) {
                        <h2>3 · Observation</h2>
                        <p class="section-hint">ESO chỉ ghi event được bật; không ghi secret.</p>
                        <mat-slide-toggle [ngModel]="consent()" (ngModelChange)="consent.set($event)">Cho phép ESO ghi request/turn từ host</mat-slide-toggle>
                        <div class="event-grid">
                            @for (event of eventKinds; track event.id) {
                                <label class="event-row">
                                    <input type="checkbox" [checked]="events().includes(event.id)" (change)="toggleEvent(event.id)" />
                                    <span><strong>{{ event.label }}</strong><small>{{ event.description }}</small></span>
                                </label>
                            }
                        </div>
                    }

                    @case (4) {
                        <h2>4 · Preview & apply</h2>
                        <p class="section-hint">Chưa ghi file trước khi bấm tạo. Không có field host/source.</p>
                        <div class="setup-summary">
                            <div><span>Root</span><strong>{{ root() }}</strong></div>
                            <div><span>Consumer</span><strong>{{ consumerId() }}</strong></div>
                            <div><span>SDLC root</span><strong>{{ sdlcRoot() }}</strong></div>
                            <div><span>Observation</span><strong>{{ consent() ? events().length + ' event' : 'tắt' }}</strong></div>
                        </div>
                        <button mat-flat-button color="primary" class="setup-submit" [disabled]="saving()" (click)="apply()">{{ saving() ? 'Đang tạo…' : 'Tạo consumer + canonical harness' }}</button>
                    }
                }
            </section>

            <footer class="setup-actions">
                <button mat-stroked-button type="button" [disabled]="step() === 1" (click)="back()">Quay lại</button>
                @if (step() < 4) { <button mat-flat-button color="primary" type="button" (click)="next()">Tiếp</button> }
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
        .event-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: var(--space-5); }
        .event-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .event-row span { display: grid; gap: 2px; }
        .event-row small { color: var(--muted); }
        .setup-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: var(--space-4); }
        .setup-summary div { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .setup-summary span { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .setup-summary strong { overflow-wrap: anywhere; }
        .setup-actions { display: flex; justify-content: space-between; gap: 12px; }
        .setup-submit { margin-top: var(--space-5); }
        @media (max-width: 900px) {
            .setup-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .setup-form, .event-grid, .setup-summary { grid-template-columns: 1fr; }
        }
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
        { id: 'prompt.submitted', label: 'Prompt request', description: 'Request người dùng gửi vào host.' },
        { id: 'turn.completed', label: 'Turn result', description: 'Kết quả turn + trạng thái.' },
        { id: 'tool.called', label: 'Tool call', description: 'Tool/MCP đã gọi và kết quả.' },
        { id: 'file.changed', label: 'File change', description: 'File bị sửa trong turn.' },
    ];

    readonly step = signal(1);
    readonly furthest = signal(1);
    readonly root = signal('');
    readonly consumerId = signal('');
    readonly name = signal('');
    readonly sdlcRoot = signal('sdlc');
    readonly consent = signal(true);
    readonly events = signal<string[]>(['prompt.submitted', 'turn.completed', 'tool.called']);
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);

    toggleEvent(id: string): void {
        this.events.set(this.events().includes(id) ? this.events().filter((event) => event !== id) : [...this.events(), id]);
    }

    back(): void {
        this.error.set(null);
        this.step.set(Math.max(1, this.step() - 1));
    }

    next(): void {
        const error = this.validate();
        if (error) { this.error.set(error); return; }
        this.error.set(null);
        const next = Math.min(4, this.step() + 1);
        this.step.set(next);
        this.furthest.set(Math.max(this.furthest(), next));
    }

    validate(): string | null {
        if (this.step() === 1 && !this.root().trim()) return 'Root repo là bắt buộc.';
        if (this.step() === 2) {
            if (!/^[a-z][a-z0-9-]{1,31}$/.test(this.consumerId())) return 'Consumer id phải là slug thường (2–32 ký tự).';
            if (!this.name().trim()) return 'Tên consumer là bắt buộc.';
            if (!this.sdlcRoot().trim()) return 'SDLC root là bắt buộc.';
        }
        return null;
    }

    apply(): void {
        if (this.validate()) return;
        this.saving.set(true);
        this.error.set(null);
        this.service
            .createSetup({
                id: this.consumerId().trim(),
                name: this.name().trim(),
                root: this.root().trim(),
                sdlcRoot: this.sdlcRoot().trim(),
                profile: {
                    canonical: { agents: 'agents', harness: '.harness' },
                    observation: { consent: this.consent(), events: this.events() },
                },
            })
            .then((result) => this.router.navigate(['/consumers', result.id], { queryParams: { created: '1' } }))
            .catch((error) => this.error.set(error?.detail || error?.message || 'Không tạo được consumer'))
            .finally(() => this.saving.set(false));
    }
}
