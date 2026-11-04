import { describe, expect, it } from 'vitest';
import { MAX_SUMMARY_CHARS } from '../src/memory/scene-strategy.js';
import { readScene } from '../src/store/chat-store.js';
import { editRefusalMessage } from '../src/ui/edit-popup.js';
import { deferred } from './mocks/llm.js';
import { cairnSummary, makeMixedChat } from './mocks/cairn.js';
import { queueHarness } from './helpers/summarizer.js';
import { stubToastr } from './helpers/toastr.js';

/**
 * Editing a summary by hand (docs/decisions.md D-0099): no model call, refused while a
 * job could land on top of it, and logged by length alone.
 */

/** Synthetic and finished, so the parser accepts it. */
const summary = (index) => `Wren and Aster went back over matter ${index} by the harbour wall, and agreed to wait for the ferry.`;

/** qvink summarised 0-9 and Cairn 10-12, so nothing waits. The index gate is shut as in resummarise.test.js. */
function harness(options = {}) {
    const calls = [];
    const parts = queueHarness({
        chat: makeMixedChat({ length: 14, qvinkThrough: 9, cairnThrough: 12 }),
        defaults: { worldState: false },
        memory: () => ({ writing: false }),
        onCall: (entry) => calls.push(entry),
        clock: () => Date.parse('2026-11-04T12:00:00.000Z'),
        ...options,
    });
    return { ...parts, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

stubToastr();

describe('editing a summary by hand', () => {
    it('writes the new text, saves the chat, and makes no memory call', async () => {
        const { context, service, summarizer } = harness();
        summarizer.start();
        await summarizer.idle();

        expect(await summarizer.editSummary(11, 'Wren and Aster made peace.')).toEqual({ written: true });
        await summarizer.idle();

        const { scene } = readScene(context.chat[11]);
        expect(scene).toMatchObject({ text: 'Wren and Aster made peace.', edited: true, at: '2026-11-04T12:00:00.000Z' });
        expect(context.saved.chat).toBe(1);
        expect(service.calls).toHaveLength(0);
    });

    it('logs the lengths and never the text', async () => {
        const { calls, summarizer } = harness();
        summarizer.start();

        await summarizer.editSummary(11, 'Wren and Aster made peace.');

        const edit = calls.find((entry) => entry.kind === 'edit');
        expect(edit).toMatchObject({ job: 'summary', message: 11, chars_before: cairnSummary(11).length, chars_after: 26 });
        expect(JSON.stringify(edit)).not.toContain('peace');
    });

    it('writes and logs nothing for unchanged text', async () => {
        const { calls, context, summarizer } = harness();
        summarizer.start();

        expect(await summarizer.editSummary(11, cairnSummary(11))).toEqual({ written: false, reason: 'unchanged' });
        expect(calls.filter((entry) => entry.kind === 'edit')).toHaveLength(0);
        expect(context.saved.chat).toBe(0);
    });

    it('refuses more than a model\'s summary may hold', async () => {
        const { context, summarizer } = harness();
        summarizer.start();

        expect(await summarizer.editSummary(11, 'x'.repeat(MAX_SUMMARY_CHARS + 1))).toEqual({ written: false, reason: 'too-long' });
        expect(readScene(context.chat[11]).scene.text).toBe(cairnSummary(11));
    });

    it('refuses while a resummarise is out, which would land on top of it', async () => {
        const answer = deferred();
        const { context, summarizer } = harness({ responses: [answer.promise] });
        summarizer.start();

        summarizer.resummarise(11);
        await flush();
        expect(await summarizer.editSummary(11, 'Hand-written.')).toEqual({ written: false, reason: 'writing' });
        answer.resolve(summary(11));
        await summarizer.idle();

        expect(readScene(context.chat[11]).scene.text).toBe(summary(11));
    });

    it('is replaced by a resummarise, with no mark left behind', async () => {
        const { context, summarizer } = harness({ responses: [summary(11)] });
        summarizer.start();

        await summarizer.editSummary(11, 'Hand-written.');
        summarizer.resummarise(11);
        await summarizer.idle();

        expect(readScene(context.chat[11]).scene).toMatchObject({ text: summary(11) });
        expect(readScene(context.chat[11]).scene.edited).toBeUndefined();
    });

    it('refuses when Cairn is off', async () => {
        const { summarizer } = harness();

        expect(await summarizer.editSummary(11, 'Hand-written.')).toEqual({ written: false, reason: 'off' });
    });
});

describe('what a refused edit says', () => {
    it('names the reason, and says nothing for unchanged text', () => {
        expect(editRefusalMessage(11, 'writing')).toBe('Cairn didn\'t save the summary of message #11: Cairn is writing a new summary for it.');
        expect(editRefusalMessage(11, 'too-long')).toContain(`${MAX_SUMMARY_CHARS} characters`);
        expect(editRefusalMessage(11, 'unchanged')).toBeNull();
    });
});
