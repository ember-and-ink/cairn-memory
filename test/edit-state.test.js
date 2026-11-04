import { describe, expect, it } from 'vitest';
import {
    CHARACTER_FIELDS, MAX_CHARACTERS, MAX_NAME_CHARS, TEXT_FIELDS, applyCharacterEdit, applySceneEdit, validState,
} from '../src/memory/state-schema.js';
import { pendingStateJob } from '../src/memory/state.js';
import { WTRACKERS } from '../src/interop/wtracker.js';
import { readState } from '../src/store/chat-store.js';
import {
    characterForm, characterInputs, sceneForm, sceneInputs, stateRefusalMessage,
} from '../src/ui/edit-popup.js';
import { deferred } from './mocks/llm.js';
import { makeChat, makeMessage, receiveMessage, sendMessage } from './mocks/sillytavern.js';
import { queueHarness } from './helpers/summarizer.js';
import { putState } from './helpers/state.js';
import { mulberry32 } from './helpers/random.js';
import { stubToastr } from './helpers/toastr.js';

/**
 * Editing the newest world state by hand (docs/decisions.md D-0100): two static popups,
 * a name-list cast, and the same refusals as a summary edit plus the state job's own.
 */

/** Synthetic, the shape of test/fixtures/store-v2.js. */
const PIER = Object.freeze({
    location: 'The ferry terminal, waiting room',
    weather: 'Drizzle',
    characters: {
        Wren: { hair: 'Loose, damp from the rain', outfit: 'Wool coat, boots' },
        Aster: { outfit: 'Oilskin coat' },
    },
});

const scene = (overrides = {}) => ({ location: PIER.location, weather: PIER.weather, people: ['Wren', 'Aster'], ...overrides });

describe('the scene editor\'s boxes', () => {
    it('keeps the cast it was opened on, unchanged', () => {
        expect(applySceneEdit(PIER, scene())).toEqual({ ok: true, value: PIER });
    });

    it('keeps the fields of a name it already knows, drops anyone in no box, and adds a newcomer with none', () => {
        const { value } = applySceneEdit(PIER, scene({ people: ['', 'Aster', 'Brannock'] }));

        expect(value.characters).toEqual({ Aster: { outfit: 'Oilskin coat' }, Brannock: {} });
    });

    it('stores the cast in box order', () => {
        const { value } = applySceneEdit(PIER, scene({ people: ['Aster', '', '', 'Wren'] }));

        expect(Object.keys(value.characters)).toEqual(['Aster', 'Wren']);
    });

    it('takes a respelling that only changes case, keeping the fields', () => {
        const { value } = applySceneEdit(PIER, scene({ people: ['  WREN ', 'Aster'] }));

        expect(value.characters).toEqual({ WREN: PIER.characters.Wren, Aster: PIER.characters.Aster });
    });

    it('treats any other rename as one leaving and one arriving', () => {
        const { value } = applySceneEdit(PIER, scene({ people: ['Wrenna', 'Aster'] }));

        expect(value.characters).toEqual({ Wrenna: {}, Aster: PIER.characters.Aster });
    });

    it('counts a repeated name once, the first box winning', () => {
        const { value } = applySceneEdit(PIER, scene({ people: ['Wren', 'wren', 'Aster'] }));

        expect(Object.keys(value.characters)).toEqual(['Wren', 'Aster']);
    });

    it('unsets a blank or placeholder field rather than storing it', () => {
        const { value } = applySceneEdit(PIER, scene({ location: '   ', weather: 'Unknown' }));

        expect(value).toEqual({ characters: PIER.characters });
    });

    it('leaves the cast out when every box is empty', () => {
        const { value } = applySceneEdit(PIER, scene({ people: ['', '', '', '', ''] }));

        expect(value).toEqual({ location: PIER.location, weather: PIER.weather });
        expect(validState(value)).toBe(true);
    });

    it('collapses a newline typed into a box', () => {
        const { value } = applySceneEdit(PIER, scene({ location: 'The pier\nat night' }));

        expect(value.location).toBe('The pier at night');
    });

    it('refuses a name the schema would refuse, naming it', () => {
        expect(applySceneEdit(PIER, scene({ people: ['Wren', '42'] }))).toEqual({ ok: false, reason: 'bad-name', name: '42' });
        expect(applySceneEdit(PIER, scene({ people: ['__proto__'] }))).toMatchObject({ ok: false, reason: 'bad-name' });
        expect(applySceneEdit(PIER, scene({ people: ['x'.repeat(MAX_NAME_CHARS + 1)] }))).toMatchObject({ ok: false, reason: 'bad-name' });
    });

    it('refuses a value past its cap, which the box\'s own limit should already prevent', () => {
        expect(applySceneEdit(PIER, scene({ weather: 'x'.repeat(TEXT_FIELDS.weather + 1) }))).toEqual({ ok: false, reason: 'too-long' });
    });

    it('never produces a state the schema rejects, whatever is typed within the limits', () => {
        const random = mulberry32(100);
        const pick = (choices) => choices[Math.floor(random() * choices.length)];
        const text = (cap) => pick(['', '  ', 'Unspecified', 'n/a', 'Wren', 'x'.repeat(cap), ' padded\nvalue ', 'Rain']);
        const names = ['', 'Wren', 'wren', 'Aster', 'Brannock', 'Ilse', ' Mara ', 'Wren', 'ASTER', 'x'.repeat(MAX_NAME_CHARS)];

        for (let i = 0; i < 500; i++) {
            const form = {
                location: text(TEXT_FIELDS.location),
                weather: text(TEXT_FIELDS.weather),
                people: Array.from({ length: MAX_CHARACTERS }, () => pick(names)),
            };
            const result = applySceneEdit(PIER, form);
            expect(result.ok, JSON.stringify(form)).toBe(true);
            expect(validState(result.value), JSON.stringify(form)).toBe(true);
        }
    });
});

describe('the character editor', () => {
    it('replaces hair and outfit, keeping everyone else and their order', () => {
        const { value } = applyCharacterEdit(PIER, 'Wren', { hair: 'Tied back', outfit: 'Grey jumper' });

        expect(value.characters).toEqual({ Wren: { hair: 'Tied back', outfit: 'Grey jumper' }, Aster: PIER.characters.Aster });
        expect(Object.keys(value.characters)).toEqual(['Wren', 'Aster']);
        expect(value.location).toBe(PIER.location);
        expect(validState(value)).toBe(true);
    });

    it('unsets a blank or placeholder field', () => {
        const { value } = applyCharacterEdit(PIER, 'Wren', { hair: '', outfit: 'Not described' });

        expect(value.characters.Wren).toEqual({});
        expect(validState(value)).toBe(true);
    });

    it('refuses someone no longer present', () => {
        expect(applyCharacterEdit(PIER, 'Brannock', { hair: 'Short' })).toEqual({ ok: false, reason: 'gone' });
        expect(applyCharacterEdit({ location: 'Pier' }, 'Wren', { hair: 'Short' })).toEqual({ ok: false, reason: 'gone' });
    });

    it('refuses a value past its cap', () => {
        expect(applyCharacterEdit(PIER, 'Wren', { outfit: 'x'.repeat(CHARACTER_FIELDS.outfit + 1) })).toEqual({ ok: false, reason: 'too-long' });
    });
});

describe('the popups\' inputs', () => {
    it('fills the scene popup with the state, one box per place in the cast, each capped', () => {
        const inputs = sceneInputs(PIER);

        expect(inputs.map((input) => input.label)).toEqual(['Location', 'Weather', 'Present 1', 'Present 2', 'Present 3', 'Present 4', 'Present 5']);
        expect(inputs.map((input) => input.defaultState)).toEqual([PIER.location, PIER.weather, 'Wren', 'Aster', '', '', '']);
        expect(inputs.map((input) => input.cap)).toEqual([TEXT_FIELDS.location, TEXT_FIELDS.weather, ...Array(MAX_CHARACTERS).fill(MAX_NAME_CHARS)]);
        expect(inputs.map((input) => input.type)).toEqual(['textarea', 'text', 'text', 'text', 'text', 'text', 'text']);
        expect(new Set(inputs.map((input) => input.id)).size).toBe(inputs.length);
    });

    it('reads the scene popup\'s answers back as the editor takes them', () => {
        const results = new Map(sceneInputs(PIER).map((input) => [input.id, input.defaultState]));

        expect(applySceneEdit(PIER, sceneForm(results))).toEqual({ ok: true, value: PIER });
    });

    it('fills the character popup with hair and outfit, and reads them back', () => {
        const inputs = characterInputs(PIER.characters.Aster);

        expect(inputs.map((input) => [input.label, input.defaultState, input.cap]))
            .toEqual([['Hair', '', CHARACTER_FIELDS.hair], ['Outfit', 'Oilskin coat', CHARACTER_FIELDS.outfit]]);
        const results = new Map(inputs.map((input) => [input.id, input.defaultState]));
        expect(characterForm(results)).toEqual({ hair: '', outfit: 'Oilskin coat' });
    });

    it('says nothing for an unchanged save, and why for anything else', () => {
        expect(stateRefusalMessage(5, 'unchanged')).toBeNull();
        expect(stateRefusalMessage(5, 'writing')).toBe('Cairn didn\'t save the world state on message #5: Cairn is updating the world state.');
    });
});

const CLOCK = Date.parse('2026-11-04T12:00:00.000Z');

/** Six short messages, too short to summarise, with states on 3 and 5. */
function harness({ responses = [], ...options } = {}) {
    const chat = makeChat(6);
    putState(chat, 3, PIER, { read: 4 });
    putState(chat, 5, PIER, { changed: ['location'] });
    const calls = [];
    const parts = queueHarness({
        chat,
        responses,
        clock: () => CLOCK,
        memory: () => ({ writing: false }),
        onCall: (entry) => calls.push(entry),
        ...options,
    });
    return { ...parts, calls };
}

stubToastr();

describe('saving an edited world state', () => {
    it('writes the newest state in place, marks it edited, and makes no memory call', async () => {
        const { context, service, summarizer } = harness();
        summarizer.start();
        await summarizer.idle();
        const before = readState(context.chat, 5).state;
        const { value } = applySceneEdit(PIER, scene({ weather: 'Fog', people: ['Wren'] }));

        expect(await summarizer.editState(5, value, before.at)).toEqual({ written: true });

        const after = readState(context.chat, 5);
        expect(after.status).toBe('valid');
        expect(after.state).toMatchObject({
            value, edited: true, read: before.read, hash: before.hash, prompt: before.prompt,
            at: '2026-11-04T12:00:00.000Z', changed: ['weather', 'characters.left'],
        });
        expect(context.saved.chat).toBe(1);
        expect(service.calls).toHaveLength(0);
    });

    it('logs the kinds that changed and never the values', async () => {
        const { calls, context, summarizer } = harness();
        summarizer.start();
        const { at } = readState(context.chat, 5).state;

        await summarizer.editState(5, applyCharacterEdit(PIER, 'Wren', { hair: 'Tied back with ribbon' }).value, at);

        const edit = calls.find((entry) => entry.kind === 'edit');
        expect(edit).toMatchObject({ job: 'state', message: 5, changed: ['characters.hair', 'characters.outfit'] });
        expect(JSON.stringify(edit)).not.toContain('ribbon');
    });

    it('writes and logs nothing for an unchanged state', async () => {
        const { calls, context, summarizer } = harness();
        summarizer.start();
        const { at } = readState(context.chat, 5).state;

        expect(await summarizer.editState(5, structuredClone(PIER), at)).toEqual({ written: false, reason: 'unchanged' });
        expect(calls.filter((entry) => entry.kind === 'edit')).toHaveLength(0);
        expect(context.saved.chat).toBe(0);
    });

    it('offers only the newest state', () => {
        const { summarizer } = harness();
        summarizer.start();

        expect(summarizer.stateEditable(3)).toEqual({ ok: false, reason: 'not-newest' });
        expect(summarizer.stateEditable(5)).toMatchObject({ ok: true, state: { value: PIER } });
    });

    it('refuses a save when the state changed while the popup was open', async () => {
        const { context, summarizer } = harness();
        summarizer.start();

        expect(await summarizer.editState(5, { location: 'Elsewhere' }, 'an older at')).toEqual({ written: false, reason: 'changed' });
        expect(readState(context.chat, 5).state.value).toEqual(PIER);
    });

    it('refuses a value the schema rejects', async () => {
        const { context, summarizer } = harness();
        summarizer.start();
        const { at } = readState(context.chat, 5).state;

        expect(await summarizer.editState(5, { mood: 'Tense' }, at)).toEqual({ written: false, reason: 'invalid' });
    });

    it('refuses while a state request is out, since it would land on top of the edit', async () => {
        const answer = deferred();
        const { context, summarizer } = harness({ responses: [answer.promise] });
        summarizer.start();
        await summarizer.idle();
        const { at } = readState(context.chat, 5).state;

        await sendMessage(context, makeMessage({ name: 'Wren', isUser: true, mes: 'Wren says something.' }));
        await receiveMessage(context, makeMessage({ mes: 'Aster answers.' }));

        expect(summarizer.stateEditable(5)).toEqual({ ok: false, reason: 'writing' });
        expect(await summarizer.editState(5, { location: 'Elsewhere' }, at)).toEqual({ written: false, reason: 'writing' });
        answer.resolve(JSON.stringify(PIER));
        await summarizer.idle();
        expect(summarizer.stateEditable(7)).toMatchObject({ ok: true });
    });

    it('refuses while a rebuild is asked for', () => {
        const { summarizer } = harness({ start: false });
        summarizer.start();

        expect(summarizer.restate(5)).toEqual({ queued: true });
        expect(summarizer.stateEditable(5)).toEqual({ ok: false, reason: 'writing' });
    });

    it('refuses where no state goes in the prompt: switched off, or a WTracker keeps its own', () => {
        const off = harness({ defaults: { worldState: false } });
        off.summarizer.start();
        const tracked = harness({ context: { extensions: [WTRACKERS[0].extension] } });
        tracked.summarizer.start();

        expect(off.summarizer.stateEditable(5)).toEqual({ ok: false, reason: 'off' });
        expect(tracked.summarizer.stateEditable(5)).toEqual({ ok: false, reason: 'wtracker-loaded' });
    });

    it('is what the next update builds on', async () => {
        const { context, summarizer } = harness();
        summarizer.start();
        await summarizer.idle();
        const { at } = readState(context.chat, 5).state;
        const { value } = applySceneEdit(PIER, scene({ people: ['Wren', 'Aster', 'Brannock'] }));
        await summarizer.editState(5, value, at);
        summarizer.stop();

        context.chat.push(makeMessage({ name: 'Wren', isUser: true, mes: 'Wren says something.' }));

        expect(pendingStateJob(context.chat).state).toEqual(value);
    });
});
