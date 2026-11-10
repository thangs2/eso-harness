import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';

interface HostOption {
    id: string;
    name: string;
    surface: string;
    description: string;
    future: boolean;
}

interface SourceOption {
    id: 'market' | 'eso-native' | 'host-native';
    name: string;
    description: string;
    disabled: boolean;
    reason?: string;
}

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
                    <h1>Khởi tạo profile consumer</h1>
                    <p class="subtitle">Chọn host trước, rồi chọn harness source mà host đó cung cấp được.</p>
                </div>
            </header>

            <nav class="setup-steps" aria-label="Các bước khởi tạo">
                @for (s of steps; track s.n) {
                    <button
                        type="button"
                        class="setup-step"
                        [class.active]="step() === s.n"
                        [class.done]="step() > s.n"
                        [disabled]="s.n > furthest()"
                        (click)="step.set(s.n)"
                    >
                        <span class="step-no">{{ s.n }}</span>
                        <span>{{ s.label }}</span>
                    </button>
                }
            </nav>

            @if (error(); as message) {
                <p class="form-error" role="alert">{{ message }}</p>
            }

            <section class="panel setup-panel">
                @switch (step()) {
                    @case (1) {
                        <h2>1 · Host</h2>
                        <p class="section-hint">Host quyết định hook/plugin/API nào ESO dùng. Host future bị khoá.</p>
                        <div class="choice-grid">
                            @for (host of hosts; track host.id) {
                                <button
                                    type="button"
                                    class="choice-card"
                                    [class.selected]="hostId() === host.id"
                                    [disabled]="host.future"
                                    (click)="selectHost(host)"
                                >
                                    <span class="choice-head">
                                        <strong>{{ host.name }}</strong>
                                        <span class="badge" [class.muted]="host.future">{{ host.future ? 'future' : 'available' }}</span>
                                    </span>
                                    <span class="choice-desc">{{ host.description }}</span>
                                    <span class="choice-meta">{{ host.surface }}</span>
                                </button>
                            }
                        </div>
                    }

                    @case (2) {
                        <h2>2 · Harness source</h2>
                        <p class="section-hint">Chỉ chọn source mà host hiện tại cung cấp. Source chưa build bị khoá.</p>
                        <div class="choice-grid">
                            @for (source of sources(); track source.id) {
                                <button
                                    type="button"
                                    class="choice-card"
                                    [class.selected]="sourceId() === source.id"
                                    [disabled]="source.disabled"
                                    (click)="selectSource(source)"
                                >
                                    <span class="choice-head">
                                        <strong>{{ source.name }}</strong>
                                        <span class="badge" [class.muted]="source.disabled">{{ source.disabled ? 'blocked' : 'available' }}</span>
                                    </span>
                                    <span class="choice-desc">{{ source.description }}</span>
                                    @if (source.reason) { <span class="choice-meta">{{ source.reason }}</span> }
                                </button>
                            }
                        </div>
                    }

                    @case (3) {
                        <h2>3 · Consumer</h2>
                        <p class="section-hint">Bốn field tối thiểu; root phải là thư mục tồn tại trên máy control plane.</p>
                        <div class="form-grid setup-form">
                            <mat-form-field appearance="outline">
                                <mat-label>Consumer id</mat-label>
                                <input matInput [ngModel]="consumerId()" (ngModelChange)="consumerId.set($event)" placeholder="baplatform">
                            </mat-form-field>
                            <mat-form-field appearance="outline">
                                <mat-label>Tên consumer</mat-label>
                                <input matInput [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="BA Platform">
                            </mat-form-field>
                            <mat-form-field appearance="outline">
                                <mat-label>Root repo</mat-label>
                                <input matInput [ngModel]="root()" (ngModelChange)="root.set($event)" placeholder="/Users/.../repo">
                            </mat-form-field>
                            <mat-form-field appearance="outline">
                                <mat-label>SDLC root</mat-label>
                                <input matInput [ngModel]="sdlcRoot()" (ngModelChange)="sdlcRoot.set($event)" placeholder="sdlc">
                            </mat-form-field>
                        </div>
                    }

                    @case (4) {
                        <h2>4 · Observation</h2>
                        <p class="section-hint">ESO chỉ ghi những event được bật; không ghi secret.</p>
                        <mat-slide-toggle [ngModel]="consent()" (ngModelChange)="consent.set($event)">
                            Cho phép ESO ghi request/turn từ host
                        </mat-slide-toggle>
                        <div class="event-grid">
                            @for (event of eventKinds; track event.id) {
                                <label class="event-row">
                                    <input type="checkbox" [checked]="events().includes(event.id)" (change)="toggleEvent(event.id)" />
                                    <span><strong>{{ event.label }}</strong><small>{{ event.description }}</small></span>
                                </label>
                            }
                        </div>
                    }

                    @case (5) {
                        <h2>5 · Preview</h2>
                        <p class="section-hint">Chưa ghi file. Kiểm lại trước khi apply.</p>
                        <div class="setup-summary">
                            <div><span>Host</span><strong>{{ selectedHost()?.name }}</strong></div>
                            <div><span>Harness source</span><strong>{{ selectedSource()?.name }}</strong></div>
                            <div><span>Consumer</span><strong>{{ consumerId() || '—' }}</strong></div>
                            <div><span>Root</span><strong>{{ root() || '—' }}</strong></div>
                            <div><span>SDLC root</span><strong>{{ sdlcRoot() || '—' }}</strong></div>
                            <div><span>Observation</span><strong>{{ consent() ? events().length + ' event' : 'tắt' }}</strong></div>
                        </div>
                        @if (warnings().length) {
                            <ul class="warn-list">
                                @for (warning of warnings(); track warning) { <li>{{ warning }}</li> }
                            </ul>
                        }
                    }

                    @case (6) {
                        <h2>6 · Apply</h2>
                        <p class="section-hint">Tạo consumer + materialize <code>.harness/config.json</code>. Không có tier/recipe.</p>
                        <div class="setup-summary">
                            <div><span>Host</span><strong>{{ selectedHost()?.name }}</strong></div>
                            <div><span>Source</span><strong>{{ selectedSource()?.name }}</strong></div>
                            <div><span>Consumer</span><strong>{{ consumerId() }}</strong></div>
                        </div>
                        <button mat-flat-button color="primary" class="setup-submit" [disabled]="saving()" (click)="apply()">
                            {{ saving() ? 'Đang tạo…' : 'Tạo consumer' }}
                        </button>
                    }
                }
            </section>

            <footer class="setup-actions">
                <button mat-stroked-button type="button" [disabled]="step() === 1" (click)="back()">Quay lại</button>
                @if (step() < 6) {
                    <button mat-flat-button color="primary" type="button" (click)="next()">Tiếp</button>
                }
            </footer>
        </div>
    `,
    styles: [`
        .setup-page { display: grid; gap: var(--space-5); }
        .setup-steps { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 2px; border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; }
        .setup-step { display: flex; align-items: center; gap: 8px; padding: 12px; border: 0; border-right: 1px solid var(--line); background: transparent; color: var(--muted); font: inherit; text-align: left; cursor: pointer; }
        .setup-step:last-child { border-right: 0; }
        .setup-step.active { background: var(--brand); color: var(--brand-ink); }
        .setup-step.done { color: var(--ink); }
        .setup-step:disabled { cursor: not-allowed; opacity: .45; }
        .step-no { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: 1px solid currentColor; font-size: 12px; font-weight: 700; flex: none; }
        .setup-steps { grid-template-columns: repeat(6, minmax(0, 1fr)); }
        .setup-panel { min-height: 340px; }
        .setup-panel h2 { margin-top: 0; }
        .section-hint { color: var(--muted); margin-top: -4px; }
        .choice-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
        .choice-card { display: grid; gap: 8px; text-align: left; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); color: var(--ink); font: inherit; cursor: pointer; }
        .choice-card:hover:not(:disabled) { border-color: var(--brand); }
        .choice-card.selected { border-color: var(--brand); box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 35%, transparent); }
        .choice-card:disabled { opacity: .5; cursor: not-allowed; }
        .choice-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .choice-desc { color: var(--muted); font-size: var(--text-sm); line-height: 1.5; }
        .choice-meta { color: var(--muted); font-size: var(--text-xs); }
        .badge { border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
        .badge.muted { color: var(--muted); }
        .setup-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .setup-form mat-form-field { width: 100%; }
        .event-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: var(--space-5); }
        .event-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .event-row span { display: grid; gap: 2px; }
        .event-row small { color: var(--muted); }
        .setup-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: var(--space-4); }
        .setup-summary div { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
        .setup-summary span { color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; }
        .setup-summary strong { overflow-wrap: anywhere; }
        .setup-actions { display: flex; justify-content: space-between; gap: 12px; }
        .setup-submit { margin-top: var(--space-5); }
        @media (max-width: 900px) {
            .setup-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .choice-grid, .setup-summary { grid-template-columns: 1fr; }
            .setup-form, .event-grid { grid-template-columns: 1fr; }
        }
    `],
})
export class SetupPage {
    private readonly service = inject(ConsumerProfileService);
    private readonly router = inject(Router);

    readonly steps = [
        { n: 1, label: 'Host' },
        { n: 2, label: 'Source' },
        { n: 3, label: 'Consumer' },
        { n: 4, label: 'Observe' },
        { n: 5, label: 'Preview' },
        { n: 6, label: 'Apply' },
    ];

    readonly hosts: HostOption[] = [
        { id: 'cursor', name: 'Cursor', surface: 'IDE · hooks/MCP/plugins', description: 'Agent trong IDE; hooks + MCP + subagents.', future: false },
        { id: 'antigravity', name: 'Antigravity', surface: 'IDE · plugin/SDK', description: 'Plugin bundle skills/MCP/agents/rules/hooks.', future: false },
        { id: 'claude', name: 'Claude Code', surface: 'CLI · hooks/SDK', description: 'Agent CLI/headless; hooks + SDK + MCP.', future: false },
        { id: 'dsh', name: 'DSH', surface: 'plugin runtime · Web/CLI', description: 'Everything-is-a-plugin; host-native mạnh nhất.', future: false },
        { id: 'paseo', name: 'Paseo', surface: 'orchestrator · daemon', description: 'Quản nhiều agent/worktree; chưa mở.', future: true },
        { id: 'orca', name: 'Orca', surface: 'orchestrator · desktop/remote', description: 'Quản fleet agent; chưa mở.', future: true },
        { id: 'codex', name: 'Codex', surface: 'CLI · future', description: 'Defer theo D-90; chưa đo.', future: true },
    ];

    readonly eventKinds = [
        { id: 'prompt.submitted', label: 'Prompt request', description: 'Request người dùng gửi vào host.' },
        { id: 'turn.completed', label: 'Turn result', description: 'Kết quả turn + trạng thái.' },
        { id: 'tool.called', label: 'Tool call', description: 'Tool/MCP đã gọi và kết quả.' },
        { id: 'file.changed', label: 'File change', description: 'File bị sửa trong turn.' },
    ];

    readonly step = signal(1);
    readonly furthest = signal(1);
    readonly hostId = signal('cursor');
    readonly sourceId = signal<'market' | 'eso-native' | 'host-native'>('host-native');
    readonly consumerId = signal('');
    readonly name = signal('');
    readonly root = signal('');
    readonly sdlcRoot = signal('sdlc');
    readonly consent = signal(true);
    readonly events = signal<string[]>(['prompt.submitted', 'turn.completed', 'tool.called']);
    readonly saving = signal(false);
    readonly error = signal<string | null>(null);
    readonly created = signal(false);

    readonly selectedHost = computed(() => this.hosts.find((host) => host.id === this.hostId()));
    readonly sources = computed<SourceOption[]>(() => [
        { id: 'market', name: 'market', description: 'Dùng MCP có sẵn: agentmemory · codegraph · docgraph · graphify.', disabled: false },
        { id: 'eso-native', name: 'eso-native', description: 'ESO tự viết memory + code graph + docs graph.', disabled: true, reason: 'chưa build — apply bị chặn' },
        { id: 'host-native', name: 'host-native', description: 'Dùng session/skills/memory do host cung cấp.', disabled: false },
    ]);
    readonly selectedSource = computed(() => this.sources().find((source) => source.id === this.sourceId()));
    readonly warnings = computed(() => {
        const result: string[] = [];
        if (!this.consent()) result.push('Observation đang tắt: ESO sẽ không nhận prompt/turn từ host.');
        if (this.selectedSource()?.disabled) result.push('Source này chưa build hoặc không tương thích host.');
        return result;
    });

    selectHost(host: HostOption): void {
        if (host.future) return;
        this.hostId.set(host.id);
        if (this.sourceId() === 'eso-native') this.sourceId.set('host-native');
    }

    selectSource(source: SourceOption): void {
        if (source.disabled) {
            this.error.set(source.reason || 'Source không khả dụng');
            return;
        }
        this.error.set(null);
        this.sourceId.set(source.id);
    }

    toggleEvent(id: string): void {
        this.events.set(this.events().includes(id) ? this.events().filter((event) => event !== id) : [...this.events(), id]);
    }

    back(): void {
        this.error.set(null);
        this.step.set(Math.max(1, this.step() - 1));
    }

    next(): void {
        const error = this.validate();
        if (error) {
            this.error.set(error);
            return;
        }
        this.error.set(null);
        const next = Math.min(6, this.step() + 1);
        this.step.set(next);
        this.furthest.set(Math.max(this.furthest(), next));
    }

    validate(): string | null {
        if (this.step() === 1 && !this.selectedHost()) return 'Chọn một host.';
        if (this.step() === 2 && !this.selectedSource()) return 'Chọn một harness source.';
        if (this.step() === 2 && this.selectedSource()?.disabled) return 'Source này chưa khả dụng.';
        if (this.step() === 3) {
            if (!/^[a-z][a-z0-9-]{1,31}$/.test(this.consumerId())) return 'Consumer id phải là slug thường (2–32 ký tự).';
            if (!this.name().trim()) return 'Tên consumer là bắt buộc.';
            if (!this.root().trim()) return 'Root repo là bắt buộc.';
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
                    host: this.hostId(),
                    source: this.sourceId(),
                    observation: { consent: this.consent(), events: this.events() },
                },
            })
            .then((result) => {
                this.created.set(true);
                this.router.navigate(['/consumers', result.id], { queryParams: { created: '1' } });
            })
            .catch((error) => this.error.set(error?.detail || error?.message || 'Không tạo được consumer'))
            .finally(() => this.saving.set(false));
    }
}
