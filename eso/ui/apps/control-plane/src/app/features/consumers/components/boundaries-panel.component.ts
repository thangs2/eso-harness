import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConsumerProfileService } from '../../../core/consumers/consumer-profile.service.js';
import type { BoundaryGrantDto, BoundaryPathType, BoundaryReadMode, BoundaryViewDto, BoundaryWriteMode, FolderPolicyDto } from '../../../../../../../libs/api-client/types.js';

// Child components
import { BoundariesHeroComponent } from './boundaries-hero.component.js';
import { BoundariesEnforcementComponent } from './boundaries-enforcement.component.js';
import { BoundariesSimulatorComponent, type SimulationResultDto } from './boundaries-simulator.component.js';
import { BoundariesPolicyListComponent, type PolicyCategoryOption, type PolicyFormGroup } from './boundaries-policy-list.component.js';
import { BoundariesGrantsComponent } from './boundaries-grants.component.js';

export type PolicyCategory = 'all' | 'invariants' | 'secrets' | 'data-lake' | 'workspace';
export type { PolicyCategoryOption, PolicyFormGroup };

export type SimulationResult = SimulationResultDto;

@Component({
    selector: 'eso-boundaries-panel',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        BoundariesHeroComponent,
        BoundariesEnforcementComponent,
        BoundariesSimulatorComponent,
        BoundariesPolicyListComponent,
        BoundariesGrantsComponent,
    ],
    templateUrl: './boundaries-panel.component.html',
    styleUrl: './boundaries-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoundariesPanelComponent {
    private readonly service = inject(ConsumerProfileService);
    private readonly fb = inject(NonNullableFormBuilder);
    private readonly destroyRef = inject(DestroyRef);

    readonly consumerId = input.required<string>();

    readonly loading = signal(true);
    readonly saving = signal(false);
    readonly grantSaving = signal(false);
    readonly error = signal('');
    readonly notice = signal('');
    readonly grants = signal<BoundaryGrantDto[]>([]);
    readonly policyForm = this.fb.array<PolicyFormGroup>([]);
    readonly enforcementForm = this.fb.group({
        enforcement: this.fb.control<'audit' | 'enforce'>('audit'),
    });
    readonly grantForm = this.fb.group({
        target: this.fb.control('', Validators.required),
        kind: this.fb.control<'read' | 'write'>('write'),
        mode: this.fb.control<'once' | 'always'>('once'),
        ttlMinutes: this.fb.control(15),
    });
    readonly policyCount = signal(0);
    readonly grantCount = signal(0);

    // Policy Categories Filter
    readonly categories: readonly PolicyCategoryOption[] = [
        { id: 'all', label: 'All', icon: '' },
        { id: 'invariants', label: 'Invariants', icon: '🛡️' },
        { id: 'secrets', label: 'Secrets', icon: '🔒' },
        { id: 'data-lake', label: 'Data Lake', icon: '📊' },
        { id: 'workspace', label: 'Workspace', icon: '📂' },
    ];
    readonly selectedCategory = signal<PolicyCategory>('all');

    // Policy Simulation & Dry-Run Tester
    readonly simPath = signal('data-lake/raw/trades.parquet');
    readonly simAction = signal<'read' | 'write'>('write');
    // Signal bumped whenever policies change so simulation can re-evaluate
    readonly policyVersion = signal(0);

    readonly isDirty = computed(() => {
        this.policyVersion();
        return this.policyForm.dirty || this.enforcementForm.dirty;
    });

    readonly simulationResult = computed<SimulationResultDto>(() => {
        // Dependency tracking
        this.policyVersion();
        const path = this.simPath().trim();
        const action = this.simAction();
        const activeGrants = this.grants();

        if (!path) {
            return {
                verdict: 'BLOCKED',
                badgeLabel: 'BLOCKED (Deny)',
                matchedPolicyIndex: null,
                matchedPolicyId: null,
                matchedPattern: null,
                explanation: 'Please provide a target path to evaluate.',
            };
        }

        const controls = this.policyForm.controls;
        if (controls.length === 0) {
            return {
                verdict: 'BLOCKED',
                badgeLabel: 'BLOCKED (Deny)',
                matchedPolicyIndex: null,
                matchedPolicyId: null,
                matchedPattern: null,
                explanation: 'No policies installed. Default deny outside repo root applies.',
            };
        }

        // Clean relative path without leading slash
        const rel = path.replace(/^[/\\]+/, '').replace(/\\/g, '/');
        const isOutsideRoot = path.startsWith('/') || path.startsWith('..') || rel.startsWith('..') || rel.includes('/../');

        // Check if outside root
        if (isOutsideRoot) {
            const extGrant = this.findMatchingGrant(activeGrants, path, action);
            if (extGrant) {
                return {
                    verdict: 'ALLOWED',
                    badgeLabel: 'ALLOWED (Bypass)',
                    matchedPolicyIndex: null,
                    matchedPolicyId: null,
                    matchedPattern: extGrant.targetPrefix,
                    explanation: `Path outside root is permitted via active external grant "${extGrant.targetPrefix}".`,
                };
            }
            return {
                verdict: 'BLOCKED',
                badgeLabel: 'BLOCKED (Deny)',
                matchedPolicyIndex: null,
                matchedPolicyId: null,
                matchedPattern: null,
                explanation: 'Path outside workspace root defaults to DENIED unless granted.',
            };
        }

        // Match candidates
        const matches: Array<{
            policy: PolicyFormGroup;
            index: number;
            specScore: number;
        }> = [];

        controls.forEach((ctrl, idx) => {
            const p = ctrl.controls.path.value.trim();
            const pType = ctrl.controls.pathType.value;
            if (this.matchPolicy(p, pType, rel)) {
                matches.push({
                    policy: ctrl,
                    index: idx + 1,
                    specScore: this.specificity(p, pType),
                });
            }
        });

        if (matches.length === 0) {
            return {
                verdict: 'BLOCKED',
                badgeLabel: 'BLOCKED (Deny)',
                matchedPolicyIndex: null,
                matchedPolicyId: null,
                matchedPattern: null,
                explanation: 'No matching boundary policy found. Default policy denies access.',
            };
        }

        // Specificity-first resolution: highest specScore wins
        matches.sort((a, b) => b.specScore - a.specScore);
        const winner = matches[0];
        const matchedIndex = winner.index;
        const matchedPolicy = winner.policy;
        const matchedPattern = matchedPolicy.controls.path.value;
        const matchedId = matchedPolicy.controls.id.value;
        const readMode = matchedPolicy.controls.read.value;
        const writeMode = matchedPolicy.controls.write.value;

        // Check grants
        const hasGrant = this.findMatchingGrant(activeGrants, rel, action);

        if (action === 'read') {
            if (readMode === 'allow') {
                return {
                    verdict: 'ALLOWED',
                    badgeLabel: 'ALLOWED (Bypass)',
                    matchedPolicyIndex: matchedIndex,
                    matchedPolicyId: matchedId,
                    matchedPattern,
                    explanation: `Matched rule #${matchedIndex} (${matchedPattern}): Read policy is "allow". Direct read permitted.`,
                };
            } else {
                return {
                    verdict: 'BLOCKED',
                    badgeLabel: 'BLOCKED (Deny)',
                    matchedPolicyIndex: matchedIndex,
                    matchedPolicyId: matchedId,
                    matchedPattern,
                    explanation: `Matched rule #${matchedIndex} (${matchedPattern}): Read policy is "deny". Access is blocked.`,
                };
            }
        } else {
            // Write action
            if (writeMode === 'deny') {
                return {
                    verdict: 'BLOCKED',
                    badgeLabel: 'BLOCKED (Deny)',
                    matchedPolicyIndex: matchedIndex,
                    matchedPolicyId: matchedId,
                    matchedPattern,
                    explanation: `Matched rule #${matchedIndex} (${matchedPattern}): Write policy is "deny". Deny wins over allow.`,
                };
            }

            if (writeMode === 'bypass' || writeMode === 'allow') {
                return {
                    verdict: 'ALLOWED',
                    badgeLabel: 'ALLOWED (Bypass)',
                    matchedPolicyIndex: matchedIndex,
                    matchedPolicyId: matchedId,
                    matchedPattern,
                    explanation: `Matched rule #${matchedIndex} (${matchedPattern}): Write mode "${writeMode}" allows direct access without grant.`,
                };
            }

            if (writeMode === 'warn') {
                return {
                    verdict: 'ALLOWED',
                    badgeLabel: 'ALLOWED (Bypass)',
                    matchedPolicyIndex: matchedIndex,
                    matchedPolicyId: matchedId,
                    matchedPattern,
                    explanation: `Matched rule #${matchedIndex} (${matchedPattern}): Write mode is "warn" (audit warning emitted, write proceeds).`,
                };
            }

            if (writeMode === 'gated') {
                if (hasGrant) {
                    return {
                        verdict: 'ALLOWED',
                        badgeLabel: 'ALLOWED (Bypass)',
                        matchedPolicyIndex: matchedIndex,
                        matchedPolicyId: matchedId,
                        matchedPattern,
                        explanation: `Matched rule #${matchedIndex} (${matchedPattern}) is gated, satisfied by active write grant "${hasGrant.targetPrefix}".`,
                    };
                }
                return {
                    verdict: 'GATED',
                    badgeLabel: 'GATED (Requires Write Grant)',
                    matchedPolicyIndex: matchedIndex,
                    matchedPolicyId: matchedId,
                    matchedPattern,
                    explanation: `Matched rule #${matchedIndex} (${matchedPattern}): Write policy is "gated". Requires an active write grant.`,
                };
            }

            return {
                verdict: 'BLOCKED',
                badgeLabel: 'BLOCKED (Deny)',
                matchedPolicyIndex: matchedIndex,
                matchedPolicyId: matchedId,
                matchedPattern,
                explanation: `Matched rule #${matchedIndex} (${matchedPattern}): Unrecognized write mode "${writeMode}". Defaulting to deny.`,
            };
        }
    });

    constructor() {
        effect(() => {
            const consumerId = this.consumerId();
            if (consumerId) this.load(consumerId);
        });
        // BUG-17: write grants cannot be `always` (server answers INVALID_STATE). Make the
        // impossibility visible in the UI instead of silently rewriting the chosen mode.
        this.grantForm.controls.kind.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((kind) => {
            if (kind === 'write' && this.grantForm.controls.mode.value === 'always') {
                this.grantForm.controls.mode.setValue('once');
            }
        });
        // BUG-18: `always` grants never expire, so the TTL field is irrelevant there.
        this.grantForm.controls.mode.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((mode) => {
            const ttl = this.grantForm.controls.ttlMinutes;
            if (mode === 'always') ttl.disable({ emitEvent: false });
            else ttl.enable({ emitEvent: false });
        });
    }

    /** Server caps grant TTL at 8h for write grants and 90d for read grants. */
    grantTtlMaxMinutes(): number {
        return this.grantForm.controls.kind.value === 'write' ? 8 * 60 : 90 * 24 * 60;
    }

    setCategory(cat: PolicyCategory): void {
        this.selectedCategory.set(cat);
    }

    setSimAction(action: 'read' | 'write'): void {
        this.simAction.set(action);
    }

    setSimPath(path: string): void {
        this.simPath.set(path);
    }

    getCategoryForPolicy(path: string, id: string): PolicyCategory {
        const p = path.toLowerCase();
        const i = id.toLowerCase();
        if (p.includes('.env') || p.includes('credentials') || p.includes('.pem') || p.includes('secret') || i.includes('secret') || i.includes('credentials') || i.includes('pem')) {
            return 'secrets';
        }
        if (p.includes('data-lake') || i.includes('data-lake')) {
            return 'data-lake';
        }
        if (p.startsWith('.git') || p.includes('config.json') || p.includes('manifest.json') || p === 'agents.md' || p === 'agents/hooks/**' || p.includes('agents/hooks') || i.includes('invariants') || i.includes('harness-config') || i.includes('harness-manifest') || i.includes('agents-md') || i.includes('hooks') || i.includes('git')) {
            return 'invariants';
        }
        return 'workspace';
    }

    isPolicyVisible(policy: PolicyFormGroup): boolean {
        const cat = this.selectedCategory();
        if (cat === 'all') return true;
        const path = policy.controls.path.value || '';
        const id = policy.controls.id.value || '';
        return this.getCategoryForPolicy(path, id) === cat;
    }

    categoryCount(cat: PolicyCategory): number {
        if (cat === 'all') return this.policyForm.length;
        let count = 0;
        for (const ctrl of this.policyForm.controls) {
            const path = ctrl.controls.path.value || '';
            const id = ctrl.controls.id.value || '';
            if (this.getCategoryForPolicy(path, id) === cat) count++;
        }
        return count;
    }

    addPolicy(): void {
        this.policyForm.push(this.policyGroup({
            id: `policy-${Date.now()}`,
            path: '',
            pathType: 'glob',
            read: 'deny',
            write: 'deny',
            index: false,
            priority: 50,
        }));
        this.policyCount.set(this.policyForm.length);
        this.policyVersion.update((v) => v + 1);
        this.policyForm.markAsDirty();
    }

    removePolicy(index: number): void {
        this.policyForm.removeAt(index);
        this.policyCount.set(this.policyForm.length);
        this.policyVersion.update((v) => v + 1);
        this.policyForm.markAsDirty();
    }

    save(): void {
        if (this.saving()) return;
        this.saving.set(true);
        this.error.set('');
        this.notice.set('');
        const policies = this.policyForm.getRawValue().map((policy) => ({
            id: policy.id,
            path: policy.path.trim(),
            pathType: policy.pathType,
            read: policy.read,
            write: policy.write,
            index: policy.index,
            priority: Number(policy.priority) || 50,
            ...(policy.reason ? { reason: policy.reason } : {}),
        } satisfies FolderPolicyDto));
        this.service.saveBoundaries(this.consumerId(), policies, this.enforcementForm.controls.enforcement.value)
            .then((view) => { this.apply(view); this.notice.set('Boundaries saved.'); })
            .catch((error) => this.error.set(this.message(error, 'Could not save boundaries')))
            .finally(() => this.saving.set(false));
    }

    createGrant(): void {
        if (this.grantSaving()) return;
        const value = this.grantForm.getRawValue();
        const target = value.target.trim();
        if (!target) return;
        this.error.set('');
        if (value.kind === 'write' && value.mode === 'always') {
            this.error.set('Write grants cannot be permanent (always). Select "once" or choose "read" kind.');
            return;
        }
        this.grantSaving.set(true);
        const payload: { targetPrefix: string; kind: 'read' | 'write'; mode: 'once' | 'always'; ttlMinutes?: number } = {
            targetPrefix: target,
            kind: value.kind,
            mode: value.mode,
            ...(value.mode === 'once' && value.ttlMinutes ? { ttlMinutes: Number(value.ttlMinutes) } : {}),
        };
        this.service.createBoundaryGrant(this.consumerId(), payload).then(() => {
            this.grantForm.controls.target.setValue('');
            this.load(this.consumerId());
        }).catch((error) => this.error.set(this.message(error, 'Could not create grant')))
            .finally(() => this.grantSaving.set(false));
    }

    revoke(grantId: string): void {
        this.service.revokeBoundaryGrant(this.consumerId(), grantId)
            .then(() => this.load(this.consumerId()))
            .catch((error) => this.error.set(this.message(error, 'Could not revoke grant')));
    }

    private load(consumerId: string): void {
        this.loading.set(true);
        this.service.getBoundaries(consumerId)
            .then((view) => this.apply(view))
            .catch((error) => this.error.set(this.message(error, 'Could not load boundaries')))
            .finally(() => this.loading.set(false));
    }

    private apply(view: BoundaryViewDto): void {
        this.enforcementForm.controls.enforcement.setValue(view.enforcement);
        this.policyForm.clear();
        for (const policy of view.policies) this.policyForm.push(this.policyGroup(policy));
        this.grants.set(view.grants);
        this.policyCount.set(this.policyForm.length);
        this.grantCount.set(view.grants.length);
        this.policyVersion.update((v) => v + 1);
        this.policyForm.markAsPristine();
        this.enforcementForm.markAsPristine();
    }

    private policyGroup(policy: FolderPolicyDto): PolicyFormGroup {
        const group: PolicyFormGroup = this.fb.group({
            id: this.fb.control(policy.id),
            path: this.fb.control(policy.path, Validators.required),
            pathType: this.fb.control(policy.pathType),
            read: this.fb.control(policy.read),
            write: this.fb.control(policy.write),
            index: this.fb.control(policy.index),
            priority: this.fb.control(policy.priority ?? 50),
            reason: this.fb.control(policy.reason ?? ''),
        });
        group.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
            this.policyVersion.update((v) => v + 1);
        });
        return group;
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

    // Helper evaluation methods for simulation
    private matchPolicy(pattern: string, pathType: BoundaryPathType, rel: string): boolean {
        const normPattern = pattern.replace(/\\/g, '/');
        if (!normPattern) return false;
        if (pathType === 'file') {
            return rel === normPattern;
        }
        if (pathType === 'directory') {
            const dirClean = normPattern.replace(/\/+$/, '');
            return rel === dirClean || rel.startsWith(`${dirClean}/`);
        }
        // glob
        return this.globToRegex(normPattern).test(rel);
    }

    private globToRegex(pattern: string): RegExp {
        let out = '^';
        for (let i = 0; i < pattern.length; i += 1) {
            const ch = pattern[i];
            if (ch === '*' && pattern[i + 1] === '*') {
                out += '.*';
                i += 1;
            } else if (ch === '*') {
                out += '[^/]*';
            } else if (ch === '?') {
                out += '[^/]';
            } else {
                out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            }
        }
        return new RegExp(`${out}$`);
    }

    private specificity(pattern: string, pathType: BoundaryPathType): number {
        const base = pathType === 'file' ? 10000 : pathType === 'directory' ? 5000 : 0;
        const literalLen = pattern.replace(/[*?]/g, '').length;
        const nonDoubleStarBonus = pattern.includes('**') ? 0 : 100;
        return base + literalLen + nonDoubleStarBonus;
    }

    private findMatchingGrant(grants: BoundaryGrantDto[], target: string, kind: 'read' | 'write'): BoundaryGrantDto | undefined {
        const now = Date.now();
        return grants.find((grant) => {
            if (grant.kind !== kind) return false;
            if (grant.revokedAt) return false;
            if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) return false;
            const normTarget = target.replace(/\\/g, '/');
            const rawPrefix = (grant.targetPrefix || '').replace(/\\/g, '/');
            const cleanPrefix = rawPrefix.replace(/\/\*\*$/, '').replace(/\/+$/, '');
            return normTarget === rawPrefix || normTarget === cleanPrefix || normTarget.startsWith(`${cleanPrefix}/`);
        });
    }
}
