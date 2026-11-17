import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeJevProfile } from '../src/modules/consumers/registration/registration.service.js';

function profileError(fn: () => unknown, pattern: RegExp): void {
    assert.throws(fn, (error: any) => error?.code === 'PROFILE_INVALID' && pattern.test(String(error?.detail || '')));
}

describe('JEV register/integration config', () => {
    test('defaults to no JEV when absent', () => {
        const profile = normalizeJevProfile({ observation: { consent: true } });
        assert.equal(profile.integration, undefined);
    });

    test('normalizes shadow JEV with thresholds', () => {
        const profile = normalizeJevProfile({
            observation: { consent: true },
            integration: { jev: { mode: 'shadow', autoThreshold: 0.8, confirmThreshold: 0.5 } },
        });
        assert.deepEqual(profile.integration, {
            jev: { mode: 'shadow', consent: true, autoThreshold: 0.8, confirmThreshold: 0.5 },
        });
    });

    test('migrates legacy jevMode into integration.jev', () => {
        const profile = normalizeJevProfile({
            observation: { consent: true },
            integration: { jevMode: 'active', consent: true },
        });
        assert.deepEqual(profile.integration, { consent: true, jev: { mode: 'active', consent: true } });
    });

    test('rejects unknown mode', () => {
        profileError(() => normalizeJevProfile({
            observation: { consent: true },
            integration: { jev: { mode: 'on' } },
        }), /JEV mode/);
    });

    test('rejects shadow/active without observation consent', () => {
        profileError(() => normalizeJevProfile({
            observation: { consent: false },
            integration: { jev: { mode: 'active' } },
        }), /observation consent/);
    });

    test('rejects auto threshold below confirm threshold', () => {
        profileError(() => normalizeJevProfile({
            observation: { consent: true },
            integration: { jev: { mode: 'shadow', autoThreshold: 0.4, confirmThreshold: 0.7 } },
        }), /autoThreshold/);
    });

    test('rejects out-of-range thresholds', () => {
        profileError(() => normalizeJevProfile({
            observation: { consent: true },
            integration: { jev: { mode: 'shadow', autoThreshold: 1.2 } },
        }), /between 0 and 1/);
    });
});
