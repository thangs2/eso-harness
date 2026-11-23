/**
 * AC-50 — scope guard: chặn ghi ngoài allowed_files TRƯỚC khi ghi.
 * AC-50-1..5 pin hành vi của modules/scope/domain/scope.ts.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFileWriteScope, executeFileWrite, transitionTaskStatus } from '../src/modules/scope/domain/scope.js';

const codeOf = (fn: () => unknown): string => {
    try { fn(); } catch (error) { return String((error as { code?: string }).code ?? (error as Error).message); }
    return 'NO_ERROR';
};

describe('AC-50 — scope guard', () => {
    test('AC-50-1 · path trong allowed_files ⇒ cho ghi, write gọi 1 lần', () => {
        const writes: Array<{ path: string; content: string }> = [];
        const result = executeFileWrite({
            allowedFiles: ['src/**'],
            targetPath: 'src/a.ts',
            content: 'x',
            writeFileFn: (path: string, content: string) => writes.push({ path, content }),
        });
        assert.equal(result.success, true);
        assert.equal(writes.length, 1);
        assert.equal(writes[0].path, 'src/a.ts');
    });

    test('AC-50-1 · glob một sao không khớp nhiều tầng', () => {
        const verdict = checkFileWriteScope({ allowedFiles: ['src/*.ts'], targetPath: 'src/deep/a.ts' });
        assert.equal(verdict.allowed, false);
        assert.equal(verdict.error, 'BLOCKED_SCOPE');
    });

    test('AC-50-2 · path ngoài ⇒ BLOCKED_SCOPE, không ghi, có refusal log', () => {
        let writeCalls = 0;
        const refusals: unknown[] = [];
        const code = codeOf(() => executeFileWrite({
            allowedFiles: ['src/**'],
            targetPath: 'docs/a.md',
            content: 'x',
            writeFileFn: () => { writeCalls += 1; },
            logRefusalFn: (record: unknown) => refusals.push(record),
        }));
        assert.equal(code, 'BLOCKED_SCOPE');
        assert.equal(writeCalls, 0);
        assert.equal(refusals.length, 1);
    });

    test('AC-50-3 · allowed_files rỗng ⇒ EMPTY_SCOPE', () => {
        const verdict = checkFileWriteScope({ allowedFiles: [], targetPath: 'src/a.ts' });
        assert.equal(verdict.allowed, false);
        assert.equal(verdict.error, 'EMPTY_SCOPE');
    });

    test('AC-50-4 · thư mục đích không tồn tại ⇒ DANGLING_SCOPE', () => {
        const verdict = checkFileWriteScope({
            allowedFiles: ['src/**'],
            targetPath: 'src/gone/a.ts',
            dirExists: () => false,
        });
        assert.equal(verdict.allowed, false);
        assert.equal(verdict.error, 'DANGLING_SCOPE');
    });

    test('AC-50-5 · agent set Done ⇒ DONE_FORBIDDEN; human thì cho phép', () => {
        assert.equal(codeOf(() => transitionTaskStatus({ currentStatus: 'in-progress', newStatus: 'Done', actorRole: 'agent' })), 'DONE_FORBIDDEN');
        const human = transitionTaskStatus({ currentStatus: 'in-progress', newStatus: 'Done', actorRole: 'human' });
        assert.equal(human.success, true);
    });
});
