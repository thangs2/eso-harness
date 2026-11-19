import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute } from '@angular/router';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { GraphImpactResponseDto } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-architecture-page',
    standalone: true,
    imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="architecture-page">
            <header class="page-header">
                <div>
                    <p class="eyebrow">Consumer · architecture</p>
                    <h1>Impact explorer</h1>
                    <p class="subtitle">Graph impact is read-only. A missing graph or low coverage is <strong>unknown</strong>, never “no impact”.</p>
                </div>
            </header>

            <section class="impact-form">
                <mat-form-field appearance="outline"><mat-label>Target</mat-label><input matInput [ngModel]="target()" (ngModelChange)="target.set($event)" placeholder="src/foo.ts"></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Kind</mat-label><mat-select [ngModel]="kind()" (ngModelChange)="kind.set($event)"><mat-option value="module">module</mat-option><mat-option value="file">file</mat-option><mat-option value="call">call</mat-option></mat-select></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Direction</mat-label><mat-select [ngModel]="direction()" (ngModelChange)="direction.set($event)"><mat-option value="downstream">downstream</mat-option><mat-option value="upstream">upstream</mat-option></mat-select></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Depth</mat-label><input matInput type="number" min="1" max="5" [ngModel]="depth()" (ngModelChange)="depth.set($event)"></mat-form-field>
                <button mat-flat-button color="primary" type="button" [disabled]="loading()" (click)="run()">{{ loading() ? 'Querying…' : 'Run impact' }}</button>
            </section>

            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }

            @if (result(); as result) {
                <section class="impact-result" [class.impact-unknown]="result.status !== 'ready'">
                    <header>
                        <div><p class="eyebrow">{{ result.status }}</p><h2>{{ result.target }}</h2><span>{{ result.direction }} · depth {{ result.depth }} · coverage {{ result.coverage }}</span></div>
                        <span class="badge" [class.badge-warn]="result.status !== 'ready'">{{ result.reason || result.status }}</span>
                    </header>

                    @if (result.status !== 'ready') {
                        <p class="impact-warning">Không kết luận “không gãy gì”. Graph chưa build hoặc coverage thấp ⇒ unknown.</p>
                    }

                    @if (result.nodes.length === 0) {
                        <p class="muted">No nodes returned.</p>
                    } @else {
                        <table class="impact-table">
                            <thead><tr><th>Node</th><th>Kind</th><th>Path</th></tr></thead>
                            <tbody>@for (node of result.nodes; track node.node_id) { <tr><td><code>{{ node.node_key }}</code></td><td>{{ node.kind }}</td><td>{{ node.path || '—' }}</td></tr> }</tbody>
                        </table>
                    }

                    @if (result.edges.length > 0) {
                        <h3>Edges ({{ result.edges.length }}{{ result.capped ? ' · capped' : '' }})</h3>
                        <table class="impact-table">
                            <thead><tr><th>Edge</th><th>From</th><th>To</th><th>Provenance</th></tr></thead>
                            <tbody>@for (edge of result.edges; track edge.edge_id) { <tr><td>{{ edge.kind }}</td><td><code>{{ edge.from_node_id }}</code></td><td><code>{{ edge.to_node_id }}</code></td><td>{{ edge.provenance?.authority || '—' }}@if (edge.conflict) { · conflict }</td></tr> }</tbody>
                        </table>
                    }
                </section>
            }
        </main>
    `,
    styles: [`
        .architecture-page { display: grid; gap: var(--space-5); max-width: var(--container); margin: 0 auto; }
        .impact-form { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .impact-result { display: grid; gap: var(--space-4); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .impact-result header { display: flex; justify-content: space-between; gap: var(--space-3); align-items: flex-start; }
        .impact-result h2 { margin: 0; }
        .impact-result header span { color: var(--muted); font-size: var(--text-sm); }
        .impact-unknown { border-color: var(--warn-ink); background: var(--warn-bg); }
        .impact-warning { margin: 0; color: var(--warn-ink); }
        .impact-table { width: 100%; border-collapse: collapse; }
        .impact-table th { text-align: left; color: var(--muted); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .06em; padding: var(--space-2); border-bottom: 1px solid var(--line); }
        .impact-table td { padding: var(--space-2); border-bottom: 1px solid var(--line); font-size: var(--text-sm); }
    `],
})
export class ArchitecturePage implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly service = inject(ConsumerProfileService);
    readonly consumerId = this.route.snapshot.paramMap.get('id') || '';
    readonly target = signal('src/foo.ts');
    readonly kind = signal('module');
    readonly direction = signal<'downstream' | 'upstream'>('downstream');
    readonly depth = signal(2);
    readonly loading = signal(false);
    readonly error = signal('');
    readonly result = signal<GraphImpactResponseDto | null>(null);

    ngOnInit(): void { this.run(); }

    run(): void {
        if (!this.target().trim()) { this.error.set('Target is required.'); return; }
        this.loading.set(true);
        this.error.set('');
        this.service.graphImpact(this.consumerId, {
            target: this.target().trim(), kind: this.kind(), direction: this.direction(),
            depth: Number(this.depth()) || 2, fanout: 50,
        }).then((result) => this.result.set(result))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not query graph impact'))
            .finally(() => this.loading.set(false));
    }
}
