import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute } from '@angular/router';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { LearningProposalDto } from '../../../../../../../libs/api-client/types.js';

@Component({
    selector: 'eso-learning-page',
    standalone: true,
    imports: [MatButtonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <main class="learning-page">
            <header class="page-header">
                <div><p class="eyebrow">Consumer · learning</p><h1>Learning proposals</h1><p class="subtitle">Proposal only applies after human approve. Apply creates a version; revert is a new version, never delete.</p></div>
                <button mat-stroked-button type="button" (click)="load()">Refresh</button>
            </header>
            @if (error(); as message) { <p class="form-error" role="alert">{{ message }}</p> }
            @if (proposals().length === 0) {
                <p class="muted">No learning proposal yet.</p>
            } @else {
                <section class="proposal-list">
                    @for (proposal of proposals(); track proposal.proposal_id) {
                        <article class="proposal-row">
                            <div class="proposal-copy">
                                <code>{{ proposal.risk_kind }}</code>
                                <strong>{{ proposal.expected_effect }}</strong>
                                <span>{{ proposal.evidence.length }} evidence · version {{ proposal.version }} · {{ proposal.createdBy || 'system' }}</span>
                            </div>
                            <span class="badge" [class.badge-warn]="proposal.status === 'proposed'">{{ proposal.status }}</span>
                            <div class="proposal-actions">
                                @if (proposal.status === 'proposed') {
                                    <button mat-flat-button color="primary" type="button" (click)="act(proposal, 'approve')">Approve</button>
                                    <button mat-stroked-button type="button" (click)="act(proposal, 'reject')">Reject</button>
                                }
                                @if (proposal.status === 'approved') { <button mat-flat-button color="primary" type="button" (click)="act(proposal, 'apply')">Apply</button> }
                                @if (proposal.status === 'applied') { <button mat-stroked-button type="button" (click)="act(proposal, 'revert')">Revert</button> }
                            </div>
                        </article>
                    }
                </section>
            }
        </main>
    `,
    styles: [`
        .learning-page { display: grid; gap: var(--space-5); max-width: var(--container); margin: 0 auto; }
        .proposal-list { display: grid; gap: var(--space-3); }
        .proposal-row { display: flex; gap: var(--space-3); align-items: center; justify-content: space-between; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
        .proposal-copy { display: grid; gap: 2px; min-width: 0; }
        .proposal-copy span { color: var(--muted); font-size: var(--text-xs); }
        .proposal-actions { display: flex; gap: var(--space-2); }
        @media (max-width: 700px) { .proposal-row { flex-direction: column; align-items: stretch; } }
    `],
})
export class LearningPage implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly service = inject(ConsumerProfileService);
    readonly consumerId = this.route.snapshot.paramMap.get('id') || '';
    readonly proposals = signal<LearningProposalDto[]>([]);
    readonly error = signal('');

    ngOnInit(): void { this.load(); }

    load(): void {
        this.service.learningProposals(this.consumerId)
            .then((result) => this.proposals.set(result.proposals))
            .catch((err) => this.error.set(err?.detail || err?.message || 'Could not load proposals'));
    }

    act(proposal: LearningProposalDto, action: 'approve' | 'reject' | 'apply' | 'revert'): void {
        if ((action === 'revert' || action === 'apply') && !window.confirm(`${action} proposal ${proposal.proposal_id}?`)) return;
        this.error.set('');
        this.service.learningAction(this.consumerId, proposal.proposal_id, action)
            .then(() => this.load())
            .catch((err) => this.error.set(err?.detail || err?.message || `Could not ${action} proposal`));
    }
}
