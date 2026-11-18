/**
 * Small deterministic property-test harness.
 *
 * No runtime dependency: a seeded PRNG reproduces every case. A failure reports the
 * seed + iteration; rerun with `PROPERTY_SEED` to replay the same case.
 */
import { it } from 'bun:test';

export interface Rng {
    next(): number;
    int(min: number, max: number): number;
    bool(): boolean;
    pick<T>(items: readonly T[]): T;
    string(length: number, alphabet?: string): string;
}

export interface PropertyOptions {
    /** Number of generated cases; default 100. */
    runs?: number;
    /** Base seed; default from PROPERTY_SEED or 0x5eed. */
    seed?: number;
}

export function rng(seed: number): Rng {
    let state = (seed >>> 0) || 1;
    const next = (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int(min: number, max: number): number {
            if (max < min) throw new Error('rng.int: max must be >= min');
            return min + Math.floor(next() * (max - min + 1));
        },
        bool(): boolean {
            return next() < 0.5;
        },
        pick<T>(items: readonly T[]): T {
            if (!items.length) throw new Error('rng.pick: empty list');
            return items[Math.floor(next() * items.length)]!;
        },
        string(length: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
            let out = '';
            for (let index = 0; index < Math.max(0, length); index += 1) out += alphabet[Math.floor(next() * alphabet.length)];
            return out;
        },
    };
}

function stableCase(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Run one property over generated cases. The predicate may be async.
 * On failure the thrown error includes seed, iteration and the generated case.
 */
export function property<T>(
    name: string,
    generate: (rng: Rng) => T,
    check: (value: T) => void | Promise<void>,
    options: PropertyOptions = {},
): void {
    it(name, async () => {
        const runs = options.runs ?? 100;
        const baseSeed = options.seed ?? Number(process.env.PROPERTY_SEED ?? 0x5eed);
        for (let iteration = 0; iteration < runs; iteration += 1) {
            const seed = (baseSeed + iteration) >>> 0;
            const generator = rng(seed);
            const value = generate(generator);
            try {
                await check(value);
            } catch (error) {
                throw new Error(
                    `property failed: ${name}\nseed=${seed} iteration=${iteration}\ncase=${stableCase(value)}\n` +
                        (error instanceof Error ? error.stack || error.message : String(error)),
                );
            }
        }
    });
}
