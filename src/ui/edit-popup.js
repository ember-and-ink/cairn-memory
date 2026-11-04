/**
 * Editing Cairn's own summary by hand (docs/decisions.md D-0099): the pencil at the end
 * of a written summary opens ST's input popup on its text, and the summarizer writes it.
 * The world state's form will join it here.
 *
 * The refusal messages are pure. `installEditPopup` is the DOM glue.
 */
import { SLUG } from '../constants.js';
import { MAX_SUMMARY_CHARS } from '../memory/scene-strategy.js';
import { readScene } from '../store/chat-store.js';
import { toast, warn } from '../util/log.js';

export const EDIT_CLASS = `${SLUG}-scene-edit`;

/** Why an edit was not saved. `unchanged` is missing on purpose: nothing to say. */
const REFUSED = Object.freeze({
    'off': 'Cairn is turned off',
    'no-message': 'the message is no longer in the chat',
    'no-summary': 'the summary changed or is gone',
    'writing': 'Cairn is writing a new summary for it',
    'blank': 'a summary can\'t be empty',
    'too-long': `a summary is at most ${MAX_SUMMARY_CHARS} characters`,
});

/**
 * @param {number} index
 * @param {string} reason The summarizer's `editSummary` reason.
 * @returns {string|null} Null when there is nothing to tell the user.
 */
export function editRefusalMessage(index, reason) {
    if (reason === 'unchanged') return null;
    return `Cairn didn't save the summary of message #${index}: ${REFUSED[reason] ?? reason}.`;
}

/** The popup's text above the box. Plain, so nothing in it needs escaping. */
export function editPopupHtml(index) {
    return `<h3>Edit Cairn's summary of message #${index}</h3>
        <p>Cairn reads this in place of the message. Up to ${MAX_SUMMARY_CHARS} characters.</p>`;
}

/**
 * Answers the pencil from the chat: a click, or Enter or Space when it has focus.
 *
 * @param {() => object} getContext
 * @param {{editSummary: (index: number, text: string) => Promise<{written: boolean, reason?: string}>}} summarizer
 */
export function installEditPopup(getContext, summarizer) {
    try {
        const chat = document.getElementById('chat');
        if (!chat) return;
        let open = false;

        async function edit(target) {
            const index = Number(target.closest('.mes[mesid]')?.getAttribute('mesid'));
            if (!Number.isInteger(index) || open) return;
            const context = getContext();
            const { status, scene } = readScene(context.chat?.[index]);
            if (status !== 'valid') return;

            open = true;
            try {
                // ST's Popup (public/scripts/popup.js:196) has `rows` but no length cap, so
                // the cap goes on its textarea (`mainInput`, :157) before it is shown.
                const { Popup, POPUP_TYPE } = context;
                const popup = new Popup(editPopupHtml(index), POPUP_TYPE.INPUT, scene.text, {
                    rows: 8, wide: true, okButton: 'Save', cancelButton: 'Cancel',
                });
                popup.mainInput.maxLength = MAX_SUMMARY_CHARS;
                const text = await popup.show();
                // An INPUT popup gives the text on Save, and null or false otherwise (:761).
                if (typeof text !== 'string') return;
                const { written, reason } = await summarizer.editSummary(index, text);
                const message = written ? null : editRefusalMessage(index, reason);
                if (message) toast(message);
            } finally {
                open = false;
            }
        }

        const answer = (event) => {
            const target = event.target instanceof Element ? event.target.closest(`.${EDIT_CLASS}`) : null;
            if (!target) return;
            if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            edit(target).catch((err) => warn('Could not edit the summary.', err));
        };
        chat.addEventListener('click', answer);
        chat.addEventListener('keydown', answer);
    } catch (err) {
        warn('Could not add Cairn\'s summary editing.', err);
    }
}
