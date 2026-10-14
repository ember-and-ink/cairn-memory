import { describe, expect, it } from 'vitest';
import { describeReply, readJsonReply, repairJson } from '../src/memory/model-reply.js';
import { badStateOutputs } from './mocks/llm.js';

/** Where a failed reply broke, for the call log (docs/decisions.md D-0094). */

describe('describeReply', () => {
    it('points at an unescaped quote inside a value', () => {
        const reply = '{"canon":[{"fact":"Aster said "never" and meant it.","from":[2]}]}';
        const detail = describeReply(reply);

        expect(detail.at).toBe(reply.indexOf('never'));
        expect(detail.error).toMatch(/JSON/);
        expect(detail.near).toContain('said "never"');
    });

    it('points at the end of a reply that was cut off, past any preamble', () => {
        const reply = 'Here are the records:\n```json\n{"records":[{"n":1,"what":"Wren crossed';
        const detail = describeReply(reply);

        expect(detail.at).toBe(reply.length);
        expect(detail.tail).toBe(reply.slice(-80));
    });

    it('reads the line and column form some engines report', () => {
        const reply = '{\n"records": [\n{"n": 1 "what": "x"}\n]}';
        const at = reply.indexOf('"what"');
        const original = JSON.parse;
        JSON.parse = () => { throw new SyntaxError('JSON.parse: expected \',\' at line 3 column 9 of the JSON data'); };
        try {
            expect(describeReply(reply).at).toBe(at);
        } finally {
            JSON.parse = original;
        }
    });

    it('has no error when the JSON parsed and only its shape was wrong', () => {
        expect(describeReply('{"records":5}')).toMatchObject({ error: null, at: null, near: '{"records":5}' });
    });

    it('says so when there is no JSON at all, and keeps the opening', () => {
        expect(describeReply('I cannot help with that.')).toMatchObject({ error: 'no JSON', at: null, near: 'I cannot help with that.' });
    });

    it('describes a reply whose thinking never closed from the raw text', () => {
        expect(describeReply('<think>the rows are').tail).toBe('<think>the rows are');
    });
});

/** The first half of every JSON parser: the index, canon and state strategies all start here. */
describe('readJsonReply', () => {
    const RECORD = Object.freeze({ location: 'The ferry terminal, outer pier' });

    it.each(['fenced', 'preambleAndSignOff', 'leakedReasoning', 'orphanThinkClose'])('finds the JSON in a %s reply', (shape) => {
        expect(readJsonReply(badStateOutputs[shape](RECORD))).toEqual({ ok: true, value: RECORD });
    });

    it('hands back any JSON value: its shape is the parser\'s business', () => {
        expect(readJsonReply('[1, 2]')).toEqual({ ok: true, value: [1, 2] });
    });

    it('names why there is nothing to read', () => {
        expect(readJsonReply(badStateOutputs.unterminatedReasoning())).toEqual({ ok: false, reason: 'truncated' });
        expect(readJsonReply(badStateOutputs.truncated({ ...RECORD, weather: 'Drizzle, cold' }))).toEqual({ ok: false, reason: 'truncated' });
        expect(readJsonReply(badStateOutputs.refusal())).toEqual({ ok: false, reason: 'refusal' });
        expect(readJsonReply(badStateOutputs.prose())).toEqual({ ok: false, reason: 'format' });
        expect(readJsonReply(badStateOutputs.empty())).toEqual({ ok: false, reason: 'empty' });
        expect(readJsonReply(undefined)).toEqual({ ok: false, reason: 'empty' });
    });
});

/** The slips a finished reply makes, mended; and the cut-offs that must stay rejected (D-0095). */
describe('repairJson', () => {
    it('closes the one bracket a finished reply left open', () => {
        expect(repairJson('{"characters":{"Wren":{"hair":"Tied back"}}')).toBe('{"characters":{"Wren":{"hair":"Tied back"}}}');
    });

    it('closes an array the model skipped on its way to the outer brace', () => {
        expect(repairJson('{"canon":[\n{"fact":"x","from":[1]}\n}')).toBe('{"canon":[\n{"fact":"x","from":[1]}\n]}');
    });

    it('reads full-width punctuation between values, and keeps it inside them', () => {
        expect(repairJson('{"a"："Wren，Aster"，"b":1}')).toBe('{"a":"Wren，Aster","b":1}');
    });

    it('mends nothing in a reply that was cut off', () => {
        expect(repairJson('{"records":[{"n":1,"what":"Wren crossed')).toBeNull();
        expect(repairJson('{"records":[{"n":1},')).toBeNull();
        expect(repairJson('{"records":[{"n":1}')).toBeNull();
    });

    it('mends nothing in JSON that needs no mending, or a closer that matches nothing', () => {
        expect(repairJson('{"a":[1]}')).toBeNull();
        expect(repairJson('[Current scene]')).toBeNull();
        expect(repairJson('{"a":1]}')).toBeNull();
    });

    it('steps over escaped quotes inside a string', () => {
        expect(repairJson('{"a":{"b":"say \\"no\\"}"}')).toBe('{"a":{"b":"say \\"no\\"}"}}');
    });
});

describe('readJsonReply on a mended reply', () => {
    it('calls a wrong closer malformed, not cut off, when it cannot be mended', () => {
        expect(readJsonReply('{"a":[[{"b":1}}')).toEqual({ ok: false, reason: 'format' });
    });

    it('never takes an inner object for the reply when the outer one is mended', () => {
        expect(readJsonReply('{"records":[{"n":1}，{"n":2}]}')).toEqual({ ok: true, value: { records: [{ n: 1 }, { n: 2 }] } });
    });
});
