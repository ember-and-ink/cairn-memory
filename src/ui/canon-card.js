/**
 * The Canon card in the settings panel (docs/decisions.md D-0104): what the open chat's
 * canon is, and **Rebuild canon**, which picks it fresh and puts it in on the next message.
 *
 * Rebuilding lives here and not under a message: it is one judgement over the whole
 * story, and a button on a message would read as being about that message.
 *
 * `canonCardView`, `canonCardHtml` and `rebuildText` are pure. `installCanonCard` is the DOM glue.
 */
import { SLUG } from '../constants.js';
import { canonFor } from '../memory/canon.js';
import { readCanon, readIndex } from '../store/chat-store.js';
import { toast, warn } from '../util/log.js';
import { escapeHtml, fmt, gateReason } from './html.js';

const REFUSED = Object.freeze({
    off: 'Keep canon is off',
    disabled: 'Cairn is turned off',
    adopting: 'an adoption is running',
    rebuilding: 'a rebuild is already running',
    'not-writing': 'Cairn is not writing the memory block in this chat',
    'too-few': 'the story is too short to have a spine yet',
    failed: 'the memory model did not give a usable pick',
});

/**
 * What the card shows. The assembler's view is what the prompt carries, and exists once a
 * turn has been planned. Before that — just after a reload — and after a rebuild by hand,
 * the newest pick in the chat is shown instead, because the next turn admits it either
 * way: a session's first turn is a rebuild, and so is a forced one (D-0104).
 *
 * @param {{inPrompt: string[], spilled: string[], waiting: string[], slots: number}|null} planned
 *        The assembler's `canonView`, or null.
 * @param {{chat?: Array<object>, chatId?: string|null}} context
 * @param {{keepCanon?: boolean}} settings
 * @param {{forcing?: boolean}} [assembler] `forcing`: the next turn is a forced rebuild.
 * @returns {{kind: 'no-chat'|'off'|'planned'|'unplanned', facts: string[], spilled: string[],
 *            waiting: string[], slots: number|null}}
 */
export function canonCardView(planned, context, settings = {}, { forcing = false } = {}) {
    const empty = { facts: [], spilled: [], waiting: [], slots: null };
    if (!context?.chatId) return { kind: 'no-chat', ...empty };
    if (settings.keepCanon === false) return { kind: 'off', ...empty };
    if (planned && !forcing) {
        return {
            kind: 'planned', facts: [...planned.inPrompt], spilled: [...planned.spilled], waiting: [...planned.waiting], slots: planned.slots,
        };
    }
    const newest = canonFor(context.chat ?? [], { readCanon, readIndex });
    return { kind: 'unplanned', ...empty, facts: newest.facts.map((fact) => fact.text), slots: newest.slots };
}

/** The card's canon list, as HTML. */
export function canonCardHtml(view) {
    const list = (texts) => `<ul class="${SLUG}-list ${SLUG}-canon-facts">${
        texts.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`;
    const hint = (text) => `<div class="${SLUG}-hint">${text}</div>`;

    if (view.kind === 'no-chat') return hint('Open a chat to see its canon.');
    if (view.kind === 'off') return hint('Canon is off for every chat.');
    if (!view.facts.length && !view.waiting.length) {
        return hint('No canon yet. It is picked once the story has a few summaries.');
    }
    if (view.kind === 'unplanned') {
        return hint(`The newest pick, ${fmt(view.facts.length)} facts. It goes into the prompt on your next message.`)
            + list(view.facts);
    }
    const spilled = view.spilled.length ? hint('Left out for want of room:') + list(view.spilled) : '';
    const waiting = view.waiting.length ? hint('A newer pick, which goes in at the next step:') + list(view.waiting) : '';
    const head = view.facts.length
        ? hint(`In the prompt now: ${fmt(view.facts.length)} of ${fmt(view.slots)} entries.`) + list(view.facts)
        : hint('None in the prompt yet.');
    return head + spilled + waiting;
}

/** The status line after a rebuild, in the panel's words. */
export function rebuildText(result) {
    if (result.ok) return 'Picked fresh. It goes into the prompt on your next message.';
    const why = REFUSED[result.reason] ?? gateReason(result.reason) ?? result.reason;
    return `Canon was not rebuilt: ${why}.`;
}

/**
 * @param {() => object} getContext
 * @param {{rebuildCanon: () => Promise<{ok: boolean, reason?: string}>, adopting: boolean,
 *          rebuildingCanon: boolean}} summarizer
 * @param {{canonView: object|null, forcing: boolean, forceRebuild: () => void}} assembler
 * @param {{settings: () => object}} options
 * @returns {{refresh: () => void, reset: () => void}}
 */
export function installCanonCard(getContext, summarizer, assembler, { settings }) {
    const host = document.getElementById(`${SLUG}_canonView`);
    const button = document.getElementById(`${SLUG}_canonRebuild`);
    const status = document.getElementById(`${SLUG}_canonStatus`);
    if (!host || !button || !status) return { refresh() {}, reset() {} };

    const refresh = () => {
        try {
            host.innerHTML = canonCardHtml(canonCardView(assembler.canonView, getContext(), settings(), assembler));
            const busy = summarizer.rebuildingCanon || summarizer.adopting;
            button.classList.toggle('disabled', busy);
            button.setAttribute('aria-disabled', String(busy));
        } catch (err) {
            warn('Could not draw the canon card.', err);
        }
    };

    button.addEventListener('click', async () => {
        if (summarizer.rebuildingCanon || summarizer.adopting) return;
        try {
            status.textContent = 'Picking canon from the whole story…';
            refresh();
            const result = await summarizer.rebuildCanon();
            // The pick is in the chat; the next turn puts it in the prompt, at the one
            // prefix break the user just chose (D-0104).
            if (result.ok) assembler.forceRebuild();
            status.textContent = rebuildText(result);
        } catch (err) {
            warn('Could not rebuild canon.', err);
            status.textContent = 'The rebuild stopped with an error; see the console.';
            toast('Cairn could not rebuild canon. The canon you had is unchanged.');
        } finally {
            refresh();
        }
    });

    refresh();
    return {
        refresh,
        /** A new chat's canon is its own; last chat's status line is not about it. */
        reset() {
            status.textContent = '';
            refresh();
        },
    };
}
