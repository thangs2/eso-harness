#!/usr/bin/env node
/**
 * Score a V2 reviewer-study round.
 *
 *   node scripts/score-v2-review.mjs --answers answers.json --truth /tmp/v2-review/_manifest.json
 *
 * `--truth` accepts the pack's `_manifest.json`, a recorded-turn JSONL, or a JSON array / object
 * with `turns`. The truth for a turn is its recorded verdict; `sufficient` maps to pass and every
 * other evidence level maps to fail.
 *
 * Output: one JSON object on stdout.
 * Exit codes: 0 = ratio >= 0.8, 1 = below target, 2 = malformed answers/truth.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PASS_LEVEL, UsageError, normalizeVerdict } from './export-v2-review-pack.mjs';

export const TARGET_RATIO = 0.8;

const HELP = `Usage: node scripts/score-v2-review.mjs --answers <json> --truth <manifest|jsonl>

  --answers <json>  [{turn_id, answer:'pass'|'fail', why}] or {answers:[...]}
  --truth <file>    pack _manifest.json, recorded-turn JSONL, or JSON array of turns

Exit: 0 = correct ratio >= ${TARGET_RATIO}; 1 = below target; 2 = malformed input.
`;

function readJsonFile(file, label) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (error) {
        throw new UsageError(`cannot read ${label} ${file}: ${error.message}`);
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new UsageError(`${label} ${file} is not valid JSON: ${error.message}`);
    }
}

function parseTurnDocument(file, label) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (error) {
        throw new UsageError(`cannot read ${label} ${file}: ${error.message}`);
    }
    const trimmed = text.trim();
    if (!trimmed) throw new UsageError(`${label} ${file} is empty`);

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return { entries: parsed, source: 'records' };
            if (parsed && Array.isArray(parsed.turns)) {
                return { entries: parsed.turns, source: typeof parsed.source === 'string' ? parsed.source : 'records' };
            }
            throw new UsageError(`${label} ${file} must be an array of turns or an object with "turns"`);
        } catch (error) {
            if (error instanceof UsageError) throw error;
            if (!trimmed.includes('\n')) throw new UsageError(`${label} ${file} is not valid JSON: ${error.message}`);
        }
    }

    const entries = [];
    trimmed.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        try {
            entries.push(JSON.parse(line));
        } catch (error) {
            throw new UsageError(`${label} ${file} line ${index + 1} is not valid JSON: ${error.message}`);
        }
    });
    return { entries, source: 'records' };
}

function truthDerivable(entry) {
    return (
        typeof entry.pass === 'boolean' ||
        entry.verdict != null ||
        typeof entry.level === 'string' ||
        typeof entry.outcome === 'string'
    );
}

/** Load truth as `[{turn_id, pass, level, basis}]`, rejecting duplicate or empty ids. */
export function loadTruth(file) {
    const { entries, source } = parseTurnDocument(file, '--truth');
    if (entries.length === 0) throw new UsageError(`--truth ${file} has no turns`);
    const turns = [];
    const seen = new Set();
    entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new UsageError(`--truth ${file} turn ${index + 1} is not an object`);
        }
        if (typeof entry.turn_id !== 'string' || !entry.turn_id.trim()) {
            throw new UsageError(`--truth ${file} turn ${index + 1} is missing "turn_id"`);
        }
        if (seen.has(entry.turn_id)) throw new UsageError(`--truth ${file} has duplicate turn_id "${entry.turn_id}"`);
        seen.add(entry.turn_id);
        if (!truthDerivable(entry)) {
            throw new UsageError(`--truth ${file} turn "${entry.turn_id}" has no derivable verdict`);
        }
        const verdict = normalizeVerdict(entry);
        turns.push({ turn_id: entry.turn_id, pass: verdict.pass, level: verdict.level, basis: verdict.basis });
    });
    return { turns, source, file };
}

/** Load and validate answers. Any contract violation is malformed (exit 2). */
export function loadAnswers(file) {
    const parsed = readJsonFile(file, '--answers');
    const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.answers) ? parsed.answers : null;
    if (!list) throw new UsageError(`--answers ${file} must be an array or an object with "answers" array`);
    if (list.length === 0) throw new UsageError(`--answers ${file} has no answers`);

    const answers = [];
    const seen = new Set();
    list.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new UsageError(`answers[${index}] is not an object`);
        }
        if (typeof entry.turn_id !== 'string' || !entry.turn_id.trim()) {
            throw new UsageError(`answers[${index}] is missing a non-empty "turn_id"`);
        }
        if (seen.has(entry.turn_id)) throw new UsageError(`answers has duplicate turn_id "${entry.turn_id}"`);
        seen.add(entry.turn_id);
        const answer = typeof entry.answer === 'string' ? entry.answer.trim().toLowerCase() : '';
        if (answer !== 'pass' && answer !== 'fail') {
            throw new UsageError(`answers[${index}] (${entry.turn_id}) must have answer "pass" or "fail"`);
        }
        if (typeof entry.why !== 'string' || !entry.why.trim()) {
            throw new UsageError(`answers[${index}] (${entry.turn_id}) must include a non-empty "why"`);
        }
        answers.push({ turn_id: entry.turn_id, answer, why: entry.why.trim() });
    });
    return answers;
}

export function scoreAnswers(answers, truth) {
    const truthById = new Map(truth.turns.map((turn) => [turn.turn_id, turn]));
    const known = new Set(truthById.keys());
    const unknown = answers.map((entry) => entry.turn_id).filter((turnId) => !known.has(turnId));
    if (unknown.length > 0) {
        throw new UsageError(`answers reference turns not present in truth: ${unknown.join(', ')}`);
    }

    const answerById = new Map(answers.map((entry) => [entry.turn_id, entry]));
    const missing = truth.turns.filter((turn) => !answerById.has(turn.turn_id)).map((turn) => turn.turn_id);
    const wrong = [];
    let correct = 0;
    for (const turn of truth.turns) {
        const given = answerById.get(turn.turn_id);
        if (!given) continue;
        const expected = turn.pass ? 'pass' : 'fail';
        if (given.answer === expected) correct += 1;
        else wrong.push({ turn_id: turn.turn_id, expected, answer: given.answer });
    }

    const total = truth.turns.length;
    const ratio = Math.round((correct / total) * 10000) / 10000;
    return {
        correct,
        correct_without_raw_log: true,
        correct_without_raw_log_note:
            'always true by construction: the scorer reads only answers JSON and the truth manifest/records, never raw logs or transcripts',
        ratio,
        threshold: TARGET_RATIO,
        pass: ratio >= TARGET_RATIO,
        truth_count: total,
        answered: answers.length,
        missing,
        wrong,
        source: truth.source,
        source_label:
            truth.source === 'fixture'
                ? 'FIXTURE — synthetic dry-run, not a measurement'
                : 'recorded turns — evidence surfaces only',
        measurement: truth.source !== 'fixture',
        truth_file: truth.file,
        truth_levels: truth.turns.reduce((acc, turn) => {
            acc[turn.level] = (acc[turn.level] ?? 0) + 1;
            return acc;
        }, {}),
        pass_level: PASS_LEVEL,
    };
}

export function main(argv = process.argv.slice(2)) {
    try {
        let answersFile = null;
        let truthFile = null;
        for (let index = 0; index < argv.length; index += 1) {
            const arg = argv[index];
            const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
            const value = () => {
                if (inline != null) return inline;
                const next = argv[index + 1];
                if (next == null || next.startsWith('--')) throw new UsageError(`${flag} needs a value`);
                index += 1;
                return next;
            };
            if (flag === '--answers') answersFile = value();
            else if (flag === '--truth') truthFile = value();
            else if (flag === '--help' || flag === '-h') {
                process.stdout.write(HELP);
                return 0;
            } else throw new UsageError(`unknown argument ${arg}`);
        }
        if (!answersFile || !truthFile) throw new UsageError('both --answers and --truth are required');

        const answers = loadAnswers(answersFile);
        const truth = loadTruth(truthFile);
        const result = scoreAnswers(answers, truth);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result.pass ? 0 : 1;
    } catch (error) {
        if (error instanceof UsageError) {
            process.stderr.write(`[v2-review-score] ${error.message}\n\n${HELP}`);
            return 2;
        }
        process.stderr.write(`[v2-review-score] ${error.stack || error.message}\n`);
        return 2;
    }
}

const invokedDirectly =
    process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main();
