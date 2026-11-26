import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_POLICIES } from '../eso/control-plane/src/modules/boundaries/boundary-defaults.ts';

/**
 * Pure simulation evaluator matching SDLC 34 and boundaries-panel component logic.
 */
function globToRegex(pattern) {
    let out = '^';
    const norm = pattern.replace(/\\/g, '/');
    for (let i = 0; i < norm.length; i += 1) {
        const ch = norm[i];
        if (ch === '*' && norm[i + 1] === '*') {
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

function matchPolicy(pattern, pathType, rel) {
    const normPattern = pattern.replace(/\\/g, '/');
    if (!normPattern) return false;
    if (pathType === 'file') return rel === normPattern;
    if (pathType === 'directory') {
        const dirClean = normPattern.replace(/\/+$/, '');
        return rel === dirClean || rel.startsWith(`${dirClean}/`);
    }
    return globToRegex(normPattern).test(rel);
}

function specificity(pattern, pathType) {
    const base = pathType === 'file' ? 10000 : pathType === 'directory' ? 5000 : 0;
    const literalLen = pattern.replace(/[*?]/g, '').length;
    const nonDoubleStarBonus = pattern.includes('**') ? 0 : 100;
    return base + literalLen + nonDoubleStarBonus;
}

function findMatchingGrant(grants = [], target, kind, now = Date.now()) {
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

function simulatePolicy({ path, action, policies = DEFAULT_POLICIES, grants = [], now = Date.now() }) {
    const rawPath = String(path || '').trim();
    if (!rawPath) {
        return { verdict: 'BLOCKED', badgeLabel: 'BLOCKED (Deny)', reason: 'empty_path' };
    }

    const rel = rawPath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const isOutsideRoot = rawPath.startsWith('/') || rawPath.startsWith('..') || rel.startsWith('..') || rel.includes('/../');

    // 4. Outside root: Path outside workspace root defaults to DENIED unless active external grant exists
    if (isOutsideRoot) {
        const hasExternalGrant = findMatchingGrant(grants, rawPath, action, now);
        if (hasExternalGrant) {
            return {
                verdict: 'ALLOWED',
                badgeLabel: 'ALLOWED (Bypass)',
                external: true,
                grant: hasExternalGrant,
                reason: 'external_grant',
            };
        }
        return {
            verdict: 'BLOCKED',
            badgeLabel: 'BLOCKED (Deny)',
            external: true,
            reason: 'outside_root_denied',
        };
    }

    // Match candidates
    const matches = [];
    policies.forEach((policy, idx) => {
        const pType = policy.pathType || 'glob';
        if (matchPolicy(policy.path, pType, rel)) {
            matches.push({
                policy,
                index: idx + 1,
                specScore: specificity(policy.path, pType),
            });
        }
    });

    if (matches.length === 0) {
        return {
            verdict: 'BLOCKED',
            badgeLabel: 'BLOCKED (Deny)',
            reason: 'no_policy_matched',
        };
    }

    // 1 & 2. Precedence: highest specificity first. If tied, DENY wins over allow. Then priority.
    const modeScore = (p) => {
        const m = action === 'read' ? p.read : p.write;
        if (m === 'deny') return 4;
        if (m === 'gated') return 3;
        if (m === 'warn') return 2;
        return 1; // allow or bypass
    };

    matches.sort((a, b) => {
        if (b.specScore !== a.specScore) {
            return b.specScore - a.specScore;
        }
        const diff = modeScore(b.policy) - modeScore(a.policy);
        if (diff !== 0) return diff;
        return (b.policy.priority || 0) - (a.policy.priority || 0);
    });

    const best = matches[0];
    const matchedPolicy = best.policy;
    const matchedIndex = best.index;
    const hasGrant = findMatchingGrant(grants, rel, action, now);

    if (action === 'read') {
        const readMode = matchedPolicy.read || 'deny';
        if (readMode === 'allow') {
            return {
                verdict: 'ALLOWED',
                badgeLabel: 'ALLOWED (Bypass)',
                matchedPolicy,
                matchedIndex,
            };
        }
        if (hasGrant) {
            return {
                verdict: 'ALLOWED',
                badgeLabel: 'ALLOWED (Bypass)',
                matchedPolicy,
                matchedIndex,
                grant: hasGrant,
            };
        }
        return {
            verdict: 'BLOCKED',
            badgeLabel: 'BLOCKED (Deny)',
            matchedPolicy,
            matchedIndex,
            reason: 'read_denied',
        };
    }

    // Write action
    const writeMode = matchedPolicy.write || 'deny';
    if (writeMode === 'deny') {
        return {
            verdict: 'BLOCKED',
            badgeLabel: 'BLOCKED (Deny)',
            matchedPolicy,
            matchedIndex,
            reason: 'write_denied',
        };
    }

    if (writeMode === 'bypass' || writeMode === 'allow') {
        return {
            verdict: 'ALLOWED',
            badgeLabel: 'ALLOWED (Bypass)',
            matchedPolicy,
            matchedIndex,
        };
    }

    if (writeMode === 'warn') {
        return {
            verdict: 'ALLOWED',
            badgeLabel: 'ALLOWED (Bypass)',
            matchedPolicy,
            matchedIndex,
            warn: true,
        };
    }

    if (writeMode === 'gated') {
        if (hasGrant) {
            return {
                verdict: 'ALLOWED',
                badgeLabel: 'ALLOWED (Bypass)',
                matchedPolicy,
                matchedIndex,
                grant: hasGrant,
            };
        }
        return {
            verdict: 'BLOCKED',
            badgeLabel: 'GATED (Requires Write Grant)',
            matchedPolicy,
            matchedIndex,
            reason: 'write_gated_no_grant',
        };
    }

    return {
        verdict: 'BLOCKED',
        badgeLabel: 'BLOCKED (Deny)',
        matchedPolicy,
        matchedIndex,
        reason: 'unrecognized_write_mode',
    };
}

// =========================================================================
// QC Test Suite: Boundaries & Policy Simulation
// =========================================================================

test('QC-BOUNDARIES-01: Evaluates path policy precedence (exact file > exact dir > glob longest prefix > recursive glob)', () => {
    const tieredPolicies = [
        { id: 'pol-rec', path: '**', pathType: 'glob', read: 'allow', write: 'bypass', priority: 10 },
        { id: 'pol-glob-short', path: 'src/**', pathType: 'glob', read: 'allow', write: 'bypass', priority: 20 },
        { id: 'pol-glob-long', path: 'src/modules/billing/**', pathType: 'glob', read: 'allow', write: 'bypass', priority: 30 },
        { id: 'pol-dir', path: 'src/modules/billing/reports', pathType: 'directory', read: 'allow', write: 'warn', priority: 40 },
        { id: 'pol-file', path: 'src/modules/billing/reports/audit.log', pathType: 'file', read: 'deny', write: 'deny', priority: 50 },
    ];

    // 1. Exact file vs directory vs glob: exact file must win
    const fileTarget = simulatePolicy({
        path: 'src/modules/billing/reports/audit.log',
        action: 'write',
        policies: tieredPolicies,
    });
    assert.equal(fileTarget.matchedPolicy.id, 'pol-file');
    assert.equal(fileTarget.verdict, 'BLOCKED');

    // 2. Exact directory vs glob: exact directory must win over glob longest prefix
    const dirTarget = simulatePolicy({
        path: 'src/modules/billing/reports/other.csv',
        action: 'write',
        policies: tieredPolicies,
    });
    assert.equal(dirTarget.matchedPolicy.id, 'pol-dir');
    assert.equal(dirTarget.matchedPolicy.pathType, 'directory');

    // 3. Glob longest prefix vs recursive glob: longer prefix wins
    const globLongTarget = simulatePolicy({
        path: 'src/modules/billing/invoices/inv-001.pdf',
        action: 'write',
        policies: tieredPolicies,
    });
    assert.equal(globLongTarget.matchedPolicy.id, 'pol-glob-long');

    // 4. Short glob vs root recursive glob: short glob wins over **
    const globShortTarget = simulatePolicy({
        path: 'src/index.ts',
        action: 'write',
        policies: tieredPolicies,
    });
    assert.equal(globShortTarget.matchedPolicy.id, 'pol-glob-short');

    // 5. Default policies precedence: AGENTS.md (file, gated) wins over *.md and **/*.md (bypass)
    const agentsMd = simulatePolicy({
        path: 'AGENTS.md',
        action: 'write',
        policies: DEFAULT_POLICIES,
    });
    assert.equal(agentsMd.matchedPolicy.id, 'default-agents-md');
    assert.equal(agentsMd.matchedPolicy.write, 'gated');
    assert.equal(agentsMd.badgeLabel, 'GATED (Requires Write Grant)');
});

test('QC-BOUNDARIES-02: Deny precedence — Deny always wins over allow when policies conflict or tie', () => {
    const conflictingPolicies = [
        { id: 'allow-rule', path: 'scripts/deploy/*.sh', pathType: 'glob', read: 'allow', write: 'bypass', priority: 50 },
        { id: 'deny-rule', path: 'scripts/deploy/*.sh', pathType: 'glob', read: 'deny', write: 'deny', priority: 50 },
    ];

    // Write action: deny wins over bypass/allow
    const writeSim = simulatePolicy({
        path: 'scripts/deploy/release.sh',
        action: 'write',
        policies: conflictingPolicies,
    });
    assert.equal(writeSim.verdict, 'BLOCKED');
    assert.equal(writeSim.matchedPolicy.id, 'deny-rule');

    // Read action: deny wins over allow
    const readSim = simulatePolicy({
        path: 'scripts/deploy/release.sh',
        action: 'read',
        policies: conflictingPolicies,
    });
    assert.equal(readSim.verdict, 'BLOCKED');
    assert.equal(readSim.matchedPolicy.id, 'deny-rule');

    // Even if allow has higher priority but specificity ties, deny wins
    const tieWithPriority = [
        { id: 'allow-high', path: 'data/**', pathType: 'glob', read: 'allow', write: 'bypass', priority: 99 },
        { id: 'deny-normal', path: 'data/**', pathType: 'glob', read: 'deny', write: 'deny', priority: 50 },
    ];
    const tieSim = simulatePolicy({
        path: 'data/sensitive.csv',
        action: 'write',
        policies: tieWithPriority,
    });
    assert.equal(tieSim.verdict, 'BLOCKED');
    assert.equal(tieSim.matchedPolicy.id, 'deny-normal');
});

test('QC-BOUNDARIES-03: Write gated — Requires active matching grant with valid TTL; returns BLOCKED if missing or expired', () => {
    const now = Date.now();

    // 1. Gated path without any grant -> BLOCKED / GATED
    const noGrant = simulatePolicy({
        path: 'data-lake/raw/trades.parquet',
        action: 'write',
        policies: DEFAULT_POLICIES,
        grants: [],
        now,
    });
    assert.equal(noGrant.verdict, 'BLOCKED');
    assert.equal(noGrant.badgeLabel, 'GATED (Requires Write Grant)');

    // 2. Gated path with expired grant -> BLOCKED / GATED
    const expiredGrant = {
        grantId: 'grant-expired',
        kind: 'write',
        targetPrefix: 'data-lake/**',
        expiresAt: new Date(now - 60_000).toISOString(),
    };
    const withExpired = simulatePolicy({
        path: 'data-lake/raw/trades.parquet',
        action: 'write',
        policies: DEFAULT_POLICIES,
        grants: [expiredGrant],
        now,
    });
    assert.equal(withExpired.verdict, 'BLOCKED');
    assert.equal(withExpired.badgeLabel, 'GATED (Requires Write Grant)');

    // 3. Gated path with revoked grant -> BLOCKED / GATED
    const revokedGrant = {
        grantId: 'grant-revoked',
        kind: 'write',
        targetPrefix: 'data-lake/**',
        expiresAt: new Date(now + 600_000).toISOString(),
        revokedAt: new Date(now - 10_000).toISOString(),
    };
    const withRevoked = simulatePolicy({
        path: 'data-lake/raw/trades.parquet',
        action: 'write',
        policies: DEFAULT_POLICIES,
        grants: [revokedGrant],
        now,
    });
    assert.equal(withRevoked.verdict, 'BLOCKED');

    // 4. Gated path with mismatched action (read grant for write request) -> BLOCKED
    const readOnlyGrant = {
        grantId: 'grant-read',
        kind: 'read',
        targetPrefix: 'data-lake/**',
        expiresAt: new Date(now + 600_000).toISOString(),
    };
    const withWrongKind = simulatePolicy({
        path: 'data-lake/raw/trades.parquet',
        action: 'write',
        policies: DEFAULT_POLICIES,
        grants: [readOnlyGrant],
        now,
    });
    assert.equal(withWrongKind.verdict, 'BLOCKED');

    // 5. Gated path with valid active write grant -> ALLOWED
    const validGrant = {
        grantId: 'grant-valid-1',
        kind: 'write',
        targetPrefix: 'data-lake/**',
        expiresAt: new Date(now + 900_000).toISOString(),
    };
    const withValid = simulatePolicy({
        path: 'data-lake/raw/trades.parquet',
        action: 'write',
        policies: DEFAULT_POLICIES,
        grants: [validGrant],
        now,
    });
    assert.equal(withValid.verdict, 'ALLOWED');
    assert.equal(withValid.badgeLabel, 'ALLOWED (Bypass)');
    assert.equal(withValid.grant.grantId, 'grant-valid-1');
});

test('QC-BOUNDARIES-04: Outside root — Path outside workspace root defaults to DENIED', () => {
    const outsideTargets = [
        '../parent-dir/file.txt',
        '../../etc/shadow',
        '/etc/passwd',
        '/var/run/secrets',
        'sub/../../outside.txt',
    ];

    for (const target of outsideTargets) {
        const readResult = simulatePolicy({ path: target, action: 'read', policies: DEFAULT_POLICIES });
        assert.equal(readResult.verdict, 'BLOCKED', `Outside read for ${target} must be BLOCKED`);
        assert.equal(readResult.badgeLabel, 'BLOCKED (Deny)');

        const writeResult = simulatePolicy({ path: target, action: 'write', policies: DEFAULT_POLICIES });
        assert.equal(writeResult.verdict, 'BLOCKED', `Outside write for ${target} must be BLOCKED`);
        assert.equal(writeResult.badgeLabel, 'BLOCKED (Deny)');
    }

    // Permitted only if an explicit external grant exists
    const externalGrant = {
        grantId: 'grant-ext-1',
        kind: 'read',
        targetPrefix: '/var/shared-data/feed.csv',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    const withExtGrant = simulatePolicy({
        path: '/var/shared-data/feed.csv',
        action: 'read',
        policies: DEFAULT_POLICIES,
        grants: [externalGrant],
    });
    assert.equal(withExtGrant.verdict, 'ALLOWED');
    assert.equal(withExtGrant.external, true);
});

test('QC-BOUNDARIES-05: Sensitive invariants — .env*, .git/**, credentials*, .harness/config.json are strictly denied', () => {
    // 1. Secrets: .env* must be denied for both read and write
    const envTargets = ['.env', '.env.local', '.env.production', '.env.staging'];
    for (const target of envTargets) {
        const readSim = simulatePolicy({ path: target, action: 'read', policies: DEFAULT_POLICIES });
        assert.equal(readSim.verdict, 'BLOCKED', `Read of ${target} must be denied`);
        assert.equal(readSim.matchedPolicy.read, 'deny');

        const writeSim = simulatePolicy({ path: target, action: 'write', policies: DEFAULT_POLICIES });
        assert.equal(writeSim.verdict, 'BLOCKED', `Write of ${target} must be denied`);
        assert.equal(writeSim.matchedPolicy.write, 'deny');
    }

    // 2. Sensitive invariants: credentials* denied for read and write
    const credTargets = ['credentials.json', 'config/credentials.xml', 'auth/credentials-prod.key'];
    for (const target of credTargets) {
        const readSim = simulatePolicy({ path: target, action: 'read', policies: DEFAULT_POLICIES });
        assert.equal(readSim.verdict, 'BLOCKED');
        assert.equal(readSim.matchedPolicy.read, 'deny');

        const writeSim = simulatePolicy({ path: target, action: 'write', policies: DEFAULT_POLICIES });
        assert.equal(writeSim.verdict, 'BLOCKED');
        assert.equal(writeSim.matchedPolicy.write, 'deny');
    }

    // 3. Git repo integrity: .git/** must be denied for write
    const gitTargets = ['.git/config', '.git/HEAD', '.git/hooks/pre-push', '.git/objects/pack/test'];
    for (const target of gitTargets) {
        const writeSim = simulatePolicy({ path: target, action: 'write', policies: DEFAULT_POLICIES });
        assert.equal(writeSim.verdict, 'BLOCKED', `Write to git metadata ${target} must be denied`);
        assert.equal(writeSim.matchedPolicy.write, 'deny');
    }

    // 4. Control plane config: .harness/config.json strictly denied for write
    const configSim = simulatePolicy({ path: '.harness/config.json', action: 'write', policies: DEFAULT_POLICIES });
    assert.equal(configSim.verdict, 'BLOCKED');
    assert.equal(configSim.matchedPolicy.id, 'default-harness-config');
    assert.equal(configSim.matchedPolicy.write, 'deny');

    // 5. Manifest integrity: .harness/manifest.json strictly denied for write
    const manifestSim = simulatePolicy({ path: '.harness/manifest.json', action: 'write', policies: DEFAULT_POLICIES });
    assert.equal(manifestSim.verdict, 'BLOCKED');
    assert.equal(manifestSim.matchedPolicy.id, 'default-harness-manifest');
    assert.equal(manifestSim.matchedPolicy.write, 'deny');
});

test('QC-BOUNDARIES-06: UI Boundaries Component conforms to simulation, filter pills & golden standards', () => {
    const ts = readFileSync('eso/ui/apps/control-plane/src/app/features/consumers/components/boundaries-panel.component.ts', 'utf8');
    const html = readFileSync('eso/ui/apps/control-plane/src/app/features/consumers/components/boundaries-panel.component.html', 'utf8');
    const scss = readFileSync('eso/ui/apps/control-plane/src/app/features/consumers/components/boundaries-panel.component.scss', 'utf8');

    // Filter pills verification
    assert.match(ts, /PolicyCategory\s*=\s*'all'\s*\|\s*'invariants'\s*\|\s*'secrets'\s*\|\s*'data-lake'\s*\|\s*'workspace'/);
    assert.match(ts, /🛡️/);
    assert.match(ts, /🔒/);
    assert.match(ts, /📊/);
    assert.match(ts, /📂/);
    assert.match(html, /class="category-pills"/);
    assert.match(html, /class="cat-pill"/);

    // Dry-run simulation card verification
    assert.match(html, /Policy Simulation &amp; Dry-Run Tester/);
    assert.match(html, /class="tester-card"/);
    assert.match(html, /class="tester-verdict-box"/);
    assert.match(html, /class="verdict-badge"/);

    // Realtime evaluation semantics in component
    assert.match(ts, /specificity\(pattern/);
    assert.match(ts, /10000/);
    assert.match(ts, /5000/);
    assert.match(ts, /findMatchingGrant/);
    assert.match(ts, /ALLOWED \(Bypass\)/);
    assert.match(ts, /GATED \(Requires Write Grant\)/);
    assert.match(ts, /BLOCKED \(Deny\)/);

    // Outside root check in component
    assert.match(ts, /isOutsideRoot/);
    assert.match(ts, /Path outside workspace root defaults to DENIED/);

    // SCSS visual styles verification
    assert.match(scss, /\.tester-card/);
    assert.match(scss, /\.category-pills/);
    assert.match(scss, /\.verdict-badge/);
    assert.match(scss, /\.highlighted-rule/);
});
