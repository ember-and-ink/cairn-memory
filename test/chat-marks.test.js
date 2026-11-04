import { describe, expect, it } from 'vitest';
import {
    EDIT_HTML, STATE_WRITING_HTML, markMessages, renderMark, renderStateBody, renderStateTitle, stateMarks, stateWriting,
} from '../src/ui/chat-marks.js';
import { QVINK_EXTENSION, qvinkDisplaying } from '../src/interop/qvink.js';
import { STATE_HEADER, renderState } from '../src/memory/state-schema.js';
import { editState, writeState } from '../src/store/chat-store.js';
import { createSummarizer } from '../src/pipeline/summarizer.js';
import { MAX_ATTEMPTS } from '../src/pipeline/tally.js';
import { cairnStore, cairnSummary, makeMixedChat } from './mocks/cairn.js';
import { badOutputs, createRequestService, deferred } from './mocks/llm.js';
import { createContext, makeChat, startActive } from './mocks/sillytavern.js';
import { MEMORY } from './helpers/summarizer.js';
import { stubToastr } from './helpers/toastr.js';

/** A finished reply the parser accepts; `cairnSummary` is cut mid-sentence to a length. */
const finished = (index) => `Wren and Aster settled matter ${index} before the tide turned, and agreed to wait for the ferry.`;

/** Plain data, as the summarizer reports it: nothing waiting, nothing out. */
const idle = (overrides = {}) => ({ gate: 'ready', inFlight: null, failed: [], ...overrides });

const states = (marks) => Object.fromEntries([...marks].map(([index, mark]) => [index, mark.state]));

/** Qvink summarised 0-9 and Cairn 10-11, so 12 waits and 13 is the last message. */
const chat = () => makeMixedChat({ length: 14, qvinkThrough: 9, cairnThrough: 11 });

describe('what each message shows', () => {
    it('shows Cairn\'s own summaries and leaves qvink\'s to qvink', () => {
        const marks = markMessages(chat(), null);

        expect(states(marks)).toEqual({ 10: 'written', 11: 'written' });
        expect(marks.get(10).text).toBe(cairnSummary(10));
    });

    it('shows qvink\'s summaries, labelled as qvink\'s, when asked to', () => {
        const marks = markMessages(chat(), null, { showQvink: true });

        expect(marks.get(3)).toMatchObject({ state: 'qvink', excluded: false });
        expect(marks.get(3).text).toBe(chat()[3].extra.qvink_memory.memory);
        expect(marks.get(10).state).toBe('written');
        expect(renderMark(marks.get(3))).toContain('Qvink:</span>');
    });

    it('marks a qvink summary the block leaves out, unless it is remembered', () => {
        const excluded = chat();
        excluded[3].extra.qvink_memory.exclude = true;
        excluded[4].extra.qvink_memory.exclude = true;
        excluded[4].extra.qvink_memory.remember = true;
        const marks = markMessages(excluded, null, { showQvink: true });

        expect(marks.get(3).excluded).toBe(true);
        expect(renderMark(marks.get(3))).toContain('Qvink (excluded):');
        expect(marks.get(4).excluded).toBe(false);
    });

    it('shows neither summary on a message whose Cairn summary went stale, as the block reads neither', () => {
        const edited = makeMixedChat({ length: 14, qvinkThrough: 9, cairnThrough: 11 });
        edited[5].extra.cairn = cairnStore(edited[5], cairnSummary(5));
        edited[5].mes += ' An afterthought.';

        expect(markMessages(edited, null, { showQvink: true }).has(5)).toBe(false);
    });

    it('marks the waiting messages, but never the last one', () => {
        expect(states(markMessages(chat(), idle()))).toEqual({ 10: 'written', 11: 'written', 12: 'waiting' });
    });

    it('says nothing is waiting while the gate is closed, because nothing is coming', () => {
        expect(states(markMessages(chat(), idle({ gate: 'qvink-summarising' })))).toEqual({ 10: 'written', 11: 'written' });
    });

    it('marks the message a request is out for', () => {
        expect(markMessages(chat(), idle({ inFlight: 12 })).get(12)).toEqual({ state: 'writing' });
    });

    it('tells a failure it will retry apart from one it has given up on', () => {
        const status = idle({ failed: [{ index: 12, attempts: 1, reason: 'truncated' }] });
        const givenUp = idle({ failed: [{ index: 12, attempts: MAX_ATTEMPTS, reason: 'refusal' }] });

        expect(markMessages(chat(), status).get(12)).toEqual({ state: 'failed', attempts: 1, reason: 'truncated' });
        expect(markMessages(chat(), givenUp).get(12)).toMatchObject({ state: 'given-up' });
    });

    it('drops an edited message\'s summary and shows it waiting again', () => {
        const edited = chat();
        edited[11].mes += ' An afterthought.';

        expect(states(markMessages(edited, idle()))).toEqual({ 10: 'written', 11: 'waiting', 12: 'waiting' });
    });
});

describe('whether qvink draws its own', () => {
    const running = (settings) => {
        const context = createContext({ chat: [], extensions: [QVINK_EXTENSION] });
        if (settings) context.extensionSettings.qvink_memory = settings;
        return context;
    };

    it('follows its display switch while it runs, and assumes its default, on', () => {
        // its index.js:160, read through `?? default_settings[key]` (:655).
        expect(qvinkDisplaying(running({ display_memories: true }))).toBe(true);
        expect(qvinkDisplaying(running({ display_memories: false }))).toBe(false);
        expect(qvinkDisplaying(running({}))).toBe(true);
    });

    it('draws nothing when it isn\'t running, whatever its settings say', () => {
        const disabled = running({ display_memories: true });
        disabled.extensionSettings.disabledExtensions.push(QVINK_EXTENSION);

        expect(qvinkDisplaying(disabled)).toBe(false);
        expect(qvinkDisplaying(createContext({ chat: [] }))).toBe(false);
    });
});

describe('the world state on each message', () => {
    const PIER = { location: 'The ferry terminal, waiting room', characters: { Wren: { outfit: 'Wool coat, boots' } } };
    const DECK = { location: 'The ferry, upper deck', characters: { Wren: { outfit: 'Wool coat, boots' } } };

    function played() {
        const played = makeChat(6);
        expect(writeState(played, 3, { value: PIER, read: 4, changed: ['location'], prompt: 'h:1', at: 'T' })).toBe(true);
        expect(writeState(played, 5, { value: DECK, read: 2, changed: ['location'], prompt: 'h:1', at: 'T' })).toBe(true);
        return played;
    }

    it('shows every message that carries a state, rendered as the prompt carries it', () => {
        const chat = played();
        const marks = stateMarks(chat);

        expect([...marks.keys()]).toEqual([3, 5]);
        expect(marks.get(5).lines.map((line) => line.text).join('\n')).toBe(renderState(DECK));
        expect(marks.get(5).lines.map((line) => line.text).join('\n'))
            .toBe(`${STATE_HEADER}\nLocation: The ferry, upper deck\nWeather: Not described\nPresent:\nWren — hair: Not described; outfit: Wool coat, boots`);
    });

    it('leaves out a state the reader wouldn\'t use: stale, out of schema, or empty', () => {
        const stale = played();
        stale[4].mes += ' Reworded.';
        const broken = played();
        broken[3].extra.cairn.state.value = { mood: 'Tense' };
        const empty = makeChat(4);
        writeState(empty, 3, { value: {}, read: 2, changed: [], prompt: 'h:1', at: 'T' });

        expect([...stateMarks(stale).keys()]).toEqual([3]);
        expect([...stateMarks(broken).keys()]).toEqual([5]);
        expect(stateMarks(empty).size).toBe(0);
    });

    it('makes only the newest state editable, and says which were edited (D-0100)', () => {
        const chat = played();
        expect(editState(chat, 3, { value: { ...PIER, weather: 'Fog' }, changed: ['weather'], at: 'T2' }).written).toBe(true);
        const marks = stateMarks(chat);

        expect(marks.get(3)).toMatchObject({ editable: false, edited: true });
        expect(marks.get(5)).toMatchObject({ editable: true, edited: false });
    });

    it('puts the pencil and (edited) after "World state" only where they apply', () => {
        expect(renderStateTitle({ editable: false, edited: false })).toBe('World state');
        expect(renderStateTitle({ editable: false, edited: true })).toBe('World state (edited)');
        const newest = renderStateTitle({ editable: true, edited: true });
        expect(newest).toMatch(/^World state&nbsp;<i class="cairn-state-edit [^>]*><\/i> \(edited\)$/);
    });

    it('puts a pencil after each character on the newest state, numbered by place, and escapes the text', () => {
        const value = { location: 'Pier <b>', characters: { Wren: {}, 'A<x>': { hair: 'Short' } } };
        const chat = makeChat(2);
        writeState(chat, 1, { value, read: 2, changed: [], prompt: 'h:1', at: 'T' });
        const mark = { lines: stateMarks(chat).get(1).lines };

        const editable = renderStateBody({ ...mark, editable: true });
        expect(editable).toContain('Location: Pier &lt;b&gt;');
        expect(editable).not.toContain('<b>');
        expect(editable.match(/data-character="(\d)"/g)).toEqual(['data-character="0"', 'data-character="1"']);
        expect(editable).toContain('title="Edit A&lt;x&gt;"');
        expect(renderStateBody({ ...mark, editable: false })).not.toContain('<i');
    });
});

describe('how a mark reads', () => {
    it('escapes summary text rather than rendering it', () => {
        const html = renderMark({ state: 'written', text: 'Aster wrote <img src=x onerror=alert(1)> & left.' });

        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; left.');
        expect(html).not.toContain('<img');
    });

    it('ends Cairn\'s own summary with the pencil, joined to the last word', () => {
        const html = renderMark({ state: 'written', text: 'Fog arrived.' });

        expect(html.endsWith(`Fog arrived.&nbsp;${EDIT_HTML}`)).toBe(true);
        expect(html).not.toContain('(edited)');
    });

    it('says an edited summary was edited, after the pencil', () => {
        expect(renderMark({ state: 'written', text: 'Fog arrived.', edited: true }).endsWith(`${EDIT_HTML} (edited)`)).toBe(true);
    });

    it('has no pencil on anything else: there is nothing of Cairn\'s to edit (D-0099)', () => {
        const others = [
            { state: 'qvink', text: 'Q.' }, { state: 'writing' }, { state: 'waiting' },
            { state: 'failed', reason: 'empty', attempts: 1 }, { state: 'given-up', reason: 'empty', attempts: 3 },
        ];
        for (const mark of others) expect(renderMark(mark)).not.toContain('scene-edit');
    });

    it('carries the edited mark from the store', () => {
        const chat = makeMixedChat({ length: 14, qvinkThrough: 9, cairnThrough: 11 });
        chat[11].extra.cairn.scene.edited = true;
        const marks = markMessages(chat, null);

        expect(marks.get(11).edited).toBe(true);
        expect(marks.get(10).edited).toBe(false);
    });

    it('names the failure, and what happens next', () => {
        expect(renderMark({ state: 'failed', reason: 'truncated', attempts: 1 })).toContain('(truncated)');
        expect(renderMark({ state: 'given-up', reason: 'refusal', attempts: 3 })).toContain('after 3 failures');
        expect(renderMark({ state: 'writing' })).toContain('fa-spin');
    });
});

/** The marks against a real summarizer run, so the status they read has the real shape. */
describe('following a summarizer run', () => {
    stubToastr();

    function run(responses) {
        const context = createContext({
            chat: makeMixedChat({ length: 14, qvinkThrough: 9, cairnThrough: 9 }),
            profiles: [MEMORY],
            requestService: createRequestService({ responses }),
        });
        const seen = [];
        const summarizer = createSummarizer(() => context, {
            settings: () => ({ memoryProfileId: MEMORY.id, worldState: false }),
            onUpdate: () => seen.push(states(markMessages(context.chat, summarizer.status))),
        });
        startActive(summarizer, context);
        return { context, summarizer, seen };
    }

    it('shows the one being written, the ones behind it waiting, and each as it lands', async () => {
        const answer = deferred();
        const { context, summarizer, seen } = run([answer.promise, finished(11), finished(12)]);

        summarizer.start();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(states(markMessages(context.chat, summarizer.status))).toEqual({ 10: 'writing', 11: 'waiting', 12: 'waiting' });

        answer.resolve(finished(10));
        await summarizer.idle();
        // The panel is told after each write, so its last redraw shows every summary.
        expect(seen.at(-1)).toEqual({ 10: 'written', 11: 'written', 12: 'written' });
        expect(seen).toContainEqual({ 10: 'written', 11: 'writing', 12: 'waiting' });
    });

    it('shows a failure with its reason until the retry', async () => {
        const { context, summarizer } = run([badOutputs.truncated(finished(10))]);

        summarizer.start();
        await summarizer.idle();

        expect(markMessages(context.chat, summarizer.status).get(10)).toEqual({ state: 'failed', attempts: 1, reason: 'truncated' });
        context.chat[10].extra.cairn = cairnStore(context.chat[10], finished(10));
        expect(markMessages(context.chat, summarizer.status).get(10).state).toBe('written');
    });
});

/** A spinner while a world state is written, by the queue or the rebuild button (D-0089). */
describe('while a world state is being written', () => {
    const DECK = { location: 'The ferry, upper deck', characters: { Wren: { outfit: 'Wool coat, boots' } } };

    stubToastr();

    it('names the message whose state request is out, and nothing otherwise', () => {
        expect(stateWriting({ state: { inFlight: 5 } })).toBe(5);
        expect(stateWriting({ state: { inFlight: null } })).toBeNull();
        expect(stateWriting(null)).toBeNull();
        expect(STATE_WRITING_HTML).toContain('fa-spin');
        expect(STATE_WRITING_HTML).toContain('world state');
    });

    function run(responses, chatOf = () => makeChat(6)) {
        const context = createContext({ chat: chatOf(), profiles: [MEMORY], requestService: createRequestService({ responses }) });
        const seen = [];
        const summarizer = createSummarizer(() => context, {
            settings: () => ({ memoryProfileId: MEMORY.id }),
            memory: () => ({ writing: false }),
            onUpdate: () => seen.push(stateWriting(summarizer.status)),
        });
        return { context, summarizer, seen };
    }

    it('shows on the newest message while the queue brings the state up to date after a reply', async () => {
        const answer = deferred();
        const { context, summarizer, seen } = run([answer.promise]);
        startActive(summarizer, context);
        summarizer.start();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(stateWriting(summarizer.status)).toBe(5);
        answer.resolve(JSON.stringify(DECK));
        await summarizer.idle();
        expect(stateWriting(summarizer.status)).toBeNull();
        // The marks were told both when it went out and when it landed.
        expect(seen).toContain(5);
        expect(seen.at(-1)).toBeNull();
    });

    it('shows on the message a rebuild was asked for', async () => {
        const answer = deferred();
        const { summarizer } = run([answer.promise], () => {
            const played = makeChat(6);
            writeState(played, 5, { value: DECK, read: 6, changed: [], prompt: 'h:1', at: 'T' });
            return played;
        });
        summarizer.start();

        expect(summarizer.restate(3)).toEqual({ queued: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(stateWriting(summarizer.status)).toBe(3);

        answer.resolve(JSON.stringify(DECK));
        await summarizer.idle();
        expect(stateWriting(summarizer.status)).toBeNull();
    });
});
