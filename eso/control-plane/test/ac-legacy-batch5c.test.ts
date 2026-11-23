/**
 * AC legacy batch 5c — US-32 self-upgrade approval gate + US-28/29 architecture answers.
 *
 * SCN/AC ids are pinned so RTM-LEGACY can link them directly:
 * SCN-28-1..3, SCN-29-1..3, SCN-32-1..3.
 */
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ArchQueryService, MICROSERVICE_GROUPS, type ArchAnswer } from '../src/modules/arch-query/arch-query.service.js';
import { SelfUpgradeService } from '../src/modules/self-upgrade/self-upgrade.service.js';
import type { Actor } from '../src/platform/registry/types.js';

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeRepo(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'eso-b5c-'));
    roots.push(root);
    for (const [path, content] of Object.entries(files)) {
        const absolute = join(root, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, 'utf8');
    }
    return root;
}

const operator: Actor = { kind: 'operator', label: 'operator@test' };
const agent: Actor = { kind: 'machine', label: 'agent@test' };

const MONOLITH = {
    'src/a.ts': "import { b } from './b.js';\nexport const a = () => b();\n",
    'src/b.ts': "import { a } from './a.js';\nexport const b = () => a();\n",
    'src/c.ts': "import { a } from './a.js';\nexport const c = a;\n",
    'src/leaf.ts': 'export const leaf = true;\n',
    'docs/readme.md': '# not source\n',
};

const MICROSERVICES = {
    'services/orders/cqrs.ts': 'export class PlaceOrderCommand {}\nexport class OrderQuery {}\n',
    'services/orders/events.ts': 'export const eventStore = openEventStore();\n',
    'services/tenancy/tenant.ts': "export const tenantId = 'tenant-a';\n",
    'services/billing/context.ts': "export const boundedContext = 'billing';\n",
};

const SKILL = 'agents/skills/tdd-loop/SKILL.md';
const SKILL_BEFORE = '# tdd-loop\n\nRun the failing test first.\n';
const SKILL_DIFF = [
    `--- a/${SKILL}`,
    `+++ b/${SKILL}`,
    '@@ -1,3 +1,4 @@',
    ' # tdd-loop',
    ' ',
    ' Run the failing test first.',
    '+Record the green run in evidence.',
    '',
].join('\n');

function assertCitation(answer: ArchAnswer, root: string): void {
    assert.equal(answer.status, 'answered');
    assert.ok(answer.evidence.length > 0, 'answered must carry file:line evidence');
    for (const citation of answer.evidence) {
        assert.equal(typeof citation.file, 'string');
        assert.ok(Number.isInteger(citation.line) && citation.line >= 1);
        const line = readFileSync(join(root, citation.file), 'utf8').split(/\r?\n/)[citation.line - 1];
        assert.equal(line.trim(), citation.text.trim(), `${citation.file}:${citation.line} must be the cited source line`);
    }
}

describe('AC legacy batch 5c — US-32 self-upgrade skill', () => {
    test('SCN-32-1 · AC-32-1 — proposal có diff ⇒ proposed, skill chưa đổi', () => {
        const root = makeRepo({ [SKILL]: SKILL_BEFORE });
        const service = new SelfUpgradeService(root);
        const proposal = service.propose(
            { skill: 'tdd-loop', diff: SKILL_DIFF, reason: 'capture the green run', expected_effect: 'fewer missing tests' },
            agent,
        );
        assert.equal(proposal.status, 'proposed');
        assert.equal(proposal.createdBy, 'agent@test');
        assert.equal(proposal.diff_hash.length, 64);
        assert.equal(readFileSync(join(root, SKILL), 'utf8'), SKILL_BEFORE, 'proposal must not touch the skill');
        const stored = service.get(proposal.proposal_id);
        assert.equal(stored.status, 'proposed');
        assert.equal(stored.audit[0].event, 'skill.proposed');
        assert.equal(stored.measurement, null);
    });

    test('SCN-32-2 · AC-32-2 — người duyệt duyệt ⇒ applied + đo, defect không tăng', () => {
        const root = makeRepo({ [SKILL]: SKILL_BEFORE });
        const service = new SelfUpgradeService(root);
        const proposal = service.propose(
            { skill: 'tdd-loop', diff: SKILL_DIFF, reason: 'capture the green run', expected_effect: 'fewer missing tests' },
            agent,
        );
        assert.equal(service.approve(proposal.proposal_id, operator).status, 'approved');
        assert.equal(readFileSync(join(root, SKILL), 'utf8'), SKILL_BEFORE, 'approval alone must not touch the skill');

        const applied = service.apply(proposal.proposal_id, operator, {
            before: { defect_rate: 2, gate_pass: 0.8 },
            after: { defect_rate: 2, gate_pass: 0.9 },
            window: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-20T00:00:00.000Z' },
        });
        assert.equal(applied.status, 'applied');
        assert.equal(applied.measurement?.defect_rate_not_increased, true);
        assert.equal(applied.measurement?.effective, true);
        assert.equal(applied.measurement?.measured_by, 'operator@test');
        assert.match(readFileSync(join(root, SKILL), 'utf8'), /Record the green run in evidence\./);
        assert.equal(applied.audit.some((entry) => entry.event === 'skill.measured'), true);
    });

    test('SCN-32-3 · AC-32-3 — agent tự duyệt ⇒ NEEDS_APPROVAL, không đổi', () => {
        const root = makeRepo({ [SKILL]: SKILL_BEFORE });
        const service = new SelfUpgradeService(root);
        const proposal = service.propose(
            { skill: 'tdd-loop', diff: SKILL_DIFF, reason: 'capture the green run', expected_effect: 'fewer missing tests' },
            agent,
        );
        assert.throws(
            () => service.approve(proposal.proposal_id, agent),
            (error: any) => error.code === 'NEEDS_APPROVAL',
        );
        assert.throws(
            () => service.apply(proposal.proposal_id, agent),
            (error: any) => error.code === 'NEEDS_APPROVAL',
        );
        assert.equal(readFileSync(join(root, SKILL), 'utf8'), SKILL_BEFORE);
        assert.equal(service.get(proposal.proposal_id).status, 'proposed');
    });
});

describe('AC legacy batch 5c — US-28 monolith architecture', () => {
    test('SCN-28-1 · AC-28-1 — hỏi "đổi module X chạm ai" ⇒ câu trả lời + file:line', () => {
        const root = makeRepo(MONOLITH);
        const service = new ArchQueryService(root);
        const answer = service.ask({ kind: 'monolith', task: 'impact', module: 'src/a.ts' });
        assertCitation(answer, root);
        assert.deepEqual(answer.modules, ['src/b.ts', 'src/c.ts']);
        assert.match(answer.answer, /src\/b\.ts/);
        assert.ok(answer.evidence.some((citation) => citation.file === 'src/b.ts' && citation.line === 1));
    });

    test('SCN-28-2 · AC-28-2 — không đủ dữ liệu ⇒ unknown', () => {
        const root = makeRepo({ 'README.md': '# no source here\n' });
        const service = new ArchQueryService(root);
        const answer = service.ask({ kind: 'monolith', task: 'impact', module: 'src/a.ts' });
        assert.equal(answer.status, 'unknown');
        assert.equal(answer.answer, 'unknown');
        assert.deepEqual(answer.evidence, []);
        assert.match(String(answer.reason), /no source files/);
        assert.equal(answer.scannedFiles, 0);
    });

    test('SCN-28-3 · AC-28-3 — có vòng phụ thuộc ⇒ nêu module trong vòng', () => {
        const root = makeRepo(MONOLITH);
        const service = new ArchQueryService(root);
        const impact = service.ask({ kind: 'monolith', task: 'impact', module: 'a' });
        assertCitation(impact, root);
        assert.ok(impact.cycles?.length, 'cycle must be reported');
        const cycle = impact.cycles![0];
        assert.deepEqual(cycle, ['src/a.ts', 'src/b.ts']);
        assert.match(impact.answer, /Dependency cycle/);

        const cycles = service.ask({ kind: 'monolith', task: 'cycles' });
        assertCitation(cycles, root);
        assert.ok(cycles.modules?.includes('src/a.ts'));
        assert.ok(cycles.modules?.includes('src/b.ts'));
    });
});

describe('AC legacy batch 5c — US-29 microservices architecture', () => {
    test('SCN-29-1 · AC-29-1 — hỏi 4 nhóm ⇒ trả lời kèm chứng', () => {
        const root = makeRepo(MICROSERVICES);
        const service = new ArchQueryService(root);
        for (const group of MICROSERVICE_GROUPS) {
            const answer = service.ask({ kind: 'microservices', group });
            assertCitation(answer, root);
            assert.equal(answer.evidence.length > 0, true, `${group} needs evidence`);
        }
        const all = service.askAll();
        assert.deepEqual(Object.keys(all).sort(), [...MICROSERVICE_GROUPS].sort());
        assertCitation(all.cqrs, root);
        assertCitation(all['event-sourcing'], root);
        assertCitation(all['multi-tenant'], root);
        assertCitation(all['multi-domain'], root);
    });

    test('SCN-29-2 · AC-29-2 — thiếu dữ liệu ⇒ unknown', () => {
        const root = makeRepo({ 'README.md': '# empty\n' });
        const service = new ArchQueryService(root);
        for (const group of MICROSERVICE_GROUPS) {
            const answer = service.ask({ kind: 'microservices', group });
            assert.equal(answer.status, 'unknown');
            assert.deepEqual(answer.evidence, []);
            assert.match(String(answer.reason), /no .* evidence/);
        }
    });

    test('SCN-29-3 · AC-29-3 — kết luận không chứng ⇒ DOC_CONTRACT_VIOLATION', () => {
        const root = makeRepo({ 'src/x.ts': 'export const x = 1;\n' });
        const service = new ArchQueryService(root);
        const withoutEvidence = {
            question: { kind: 'microservices', group: 'cqrs' },
            status: 'answered',
            answer: 'Hệ thống dùng CQRS',
            evidence: [],
            scannedFiles: 1,
        } as unknown as ArchAnswer;
        assert.throws(
            () => service.assertContract(withoutEvidence),
            (error: any) => error.code === 'DOC_CONTRACT_VIOLATION',
        );

        const staleCitation = {
            ...withoutEvidence,
            evidence: [{ file: 'src/missing.ts', line: 1, text: 'export const x = 1;' }],
        } as ArchAnswer;
        assert.throws(
            () => service.assertContract(staleCitation),
            (error: any) => error.code === 'DOC_CONTRACT_VIOLATION',
        );
        assert.equal(existsSync(join(root, 'src/x.ts')), true);
    });
});
