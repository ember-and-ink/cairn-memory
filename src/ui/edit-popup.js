/**
 * Editing Cairn's own memory by hand: the summary (docs/decisions.md D-0099) in ST's
 * input popup, and the newest world state (D-0100) in two popups of ST's own static
 * inputs — the scene (location, weather, who is present) and one character's hair and
 * outfit. The summarizer refuses and writes; nothing here touches the store.
 *
 * The refusal messages and the popups' inputs are pure. `installEditPopup` is the DOM glue.
 */
import { SLUG } from '../constants.js';
import { MAX_SUMMARY_CHARS } from '../memory/scene-strategy.js';
import {
    CHARACTER_FIELDS, MAX_CHARACTERS, MAX_NAME_CHARS, TEXT_FIELDS, applyCharacterEdit, applySceneEdit,
} from '../memory/state-schema.js';
import { readScene } from '../store/chat-store.js';
import { toast, warn } from '../util/log.js';
import { escapeHtml } from './html.js';

export const EDIT_CLASS = `${SLUG}-scene-edit`;
export const STATE_EDIT_CLASS = `${SLUG}-state-edit`;
export const CHARACTER_EDIT_CLASS = `${SLUG}-character-edit`;

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

/** Why a world state edit was not saved, keyed by the summarizer's reason. */
const STATE_REFUSED = Object.freeze({
    'disabled': 'Cairn is turned off',
    'off': 'Track the world state is turned off',
    'wtracker-loaded': 'WTracker is keeping the world state',
    'no-message': 'the message is no longer in the chat',
    'writing': 'Cairn is updating the world state',
    'not-newest': 'only the newest world state can be edited',
    'changed': 'the world state changed while it was open',
    'gone': 'that character is no longer present',
    'invalid': 'the result isn\'t a state Cairn can use',
    'too-long': 'a value is longer than its limit',
    'too-many': `at most ${MAX_CHARACTERS} characters can be present`,
    'no-state': 'the world state is gone',
});

/**
 * @param {number} index
 * @param {string} reason
 * @returns {string|null} Null when there is nothing to tell the user.
 */
export function stateRefusalMessage(index, reason) {
    if (reason === 'unchanged') return null;
    return `Cairn didn't save the world state on message #${index}: ${STATE_REFUSED[reason] ?? reason}.`;
}

/** ST's ids are document-wide, so every input id carries the slug. */
const inputId = (name) => `${SLUG}-edit-${name}`;

/** Two rows wrap a long value on a phone instead of scrolling it sideways in its box. */
const field = (name, label, value, cap) => ({
    id: inputId(name), label, type: cap > 80 ? 'textarea' : 'text', rows: 2, defaultState: value ?? '', cap,
});

/**
 * The scene popup's inputs: location, weather and one box per place in the cast, filled
 * with the state as it stands. ST draws them as a plain list (public/scripts/popup.js:355-400).
 *
 * @param {object} value A valid state.
 * @returns {Array<{id: string, label: string, type: string, rows: number, defaultState: string, cap: number}>}
 */
export function sceneInputs(value) {
    const names = Object.keys(value.characters ?? {});
    return [
        field('location', 'Location', value.location, TEXT_FIELDS.location),
        field('weather', 'Weather', value.weather, TEXT_FIELDS.weather),
        ...Array.from({ length: MAX_CHARACTERS }, (_, i) => ({
            ...field(`present-${i}`, `Present ${i + 1}`, names[i], MAX_NAME_CHARS), type: 'text',
        })),
    ];
}

/** The scene popup's answers, as `applySceneEdit` takes them. */
export function sceneForm(results) {
    return {
        location: results.get(inputId('location')),
        weather: results.get(inputId('weather')),
        people: Array.from({ length: MAX_CHARACTERS }, (_, i) => results.get(inputId(`present-${i}`))),
    };
}

/** The character popup's inputs: hair and outfit, filled with what is stored. */
export function characterInputs(fields) {
    return Object.entries(CHARACTER_FIELDS).map(([name, cap]) => field(name, name[0].toUpperCase() + name.slice(1), fields[name], cap));
}

/** The character popup's answers, as `applyCharacterEdit` takes them. */
export function characterForm(results) {
    return Object.fromEntries(Object.keys(CHARACTER_FIELDS).map((name) => [name, results.get(inputId(name))]));
}

export function sceneEditHtml(index) {
    return `<h3>Edit the world state on message #${index}</h3>
        <p>Leave a box empty for "Not described". Empty a Present box to remove someone; a new
        name starts with nothing described. Cairn's next update lists whoever the story has in the scene.</p>`;
}

export function characterEditHtml(name) {
    return `<h3>Edit ${escapeHtml(name)}</h3>
        <p>Leave a box empty for "Not described".</p>`;
}

/**
 * Answers the pencils from the chat: a click, or Enter or Space when one has focus.
 *
 * @param {() => object} getContext
 * @param {{editSummary: (index: number, text: string) => Promise<{written: boolean, reason?: string}>,
 *          stateEditable: (index: number) => ({ok: true, state: object} | {ok: false, reason: string}),
 *          editState: (index: number, value: object, at: string) => Promise<{written: boolean, reason?: string}>}} summarizer
 */
export function installEditPopup(getContext, summarizer) {
    try {
        const chat = document.getElementById('chat');
        if (!chat) return;
        let open = false;

        async function editSummary(index) {
            const context = getContext();
            const { status, scene } = readScene(context.chat?.[index]);
            if (status !== 'valid') return;

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
        }

        /**
         * Either world state popup. `build` turns the answers into the new state, or a
         * refusal; a bad name keeps the popup open, so nothing typed is lost.
         */
        async function editState(index, html, inputs, build) {
            const editable = summarizer.stateEditable(index);
            if (!editable.ok) {
                toast(stateRefusalMessage(index, editable.reason));
                return;
            }
            const { at, value: current } = editable.state;
            const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();
            let built = null;
            const popup = new Popup(html, POPUP_TYPE.CONFIRM, '', {
                okButton: 'Save', cancelButton: 'Cancel', allowVerticalScrolling: true,
                customInputs: inputs(current),
                // The answers are read before this runs, and `false` keeps it open (popup.js:775, :787).
                onClosing: (closing) => {
                    if (closing.result !== POPUP_RESULT.AFFIRMATIVE) return true;
                    built = build(current, closing.inputResults);
                    if (built.ok || built.reason !== 'bad-name') return true;
                    toast(`"${built.name}" can't be a name: names need a letter and at most ${MAX_NAME_CHARS} characters.`);
                    return false;
                },
            });
            // ST's custom inputs take no length cap, so it goes on each one (popup.js:324).
            for (const input of popup.customInputs) {
                const control = popup.dlg.querySelector(`#${input.id}`);
                if (control) control.maxLength = input.cap;
            }
            const result = await popup.show();
            if (result !== POPUP_RESULT.AFFIRMATIVE || !built) return;

            const { written, reason } = built.ok
                ? await summarizer.editState(index, built.value, at)
                : { written: false, reason: built.reason };
            const message = written ? null : stateRefusalMessage(index, reason);
            if (message) toast(message);
        }

        function editScene(index) {
            return editState(index, sceneEditHtml(index), sceneInputs,
                (current, results) => applySceneEdit(current, sceneForm(results)));
        }

        /** The pencil carries the character's place in the cast; the name is read as the popup opens. */
        async function editCharacter(index, place) {
            const editable = summarizer.stateEditable(index);
            const name = editable.ok ? Object.keys(editable.state.value.characters ?? {})[place] : undefined;
            if (name === undefined) {
                toast(stateRefusalMessage(index, editable.ok ? 'gone' : editable.reason));
                return;
            }
            await editState(index, characterEditHtml(name),
                (current) => characterInputs(current.characters?.[name] ?? {}),
                (current, results) => applyCharacterEdit(current, name, characterForm(results)));
        }

        const PENCILS = [
            [EDIT_CLASS, (index) => editSummary(index), 'the summary'],
            [STATE_EDIT_CLASS, (index) => editScene(index), 'the world state'],
            [CHARACTER_EDIT_CLASS, (index, target) => editCharacter(index, Number(target.dataset.character)), 'a character'],
        ];

        const answer = (event) => {
            if (!(event.target instanceof Element)) return;
            const found = PENCILS.map(([name, ...rest]) => [event.target.closest(`.${name}`), ...rest]).find(([target]) => target);
            if (!found) return;
            if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
            // Also keeps a click on the World state line's pencil from opening or closing the section.
            event.preventDefault();
            const [target, edit, what] = found;
            const index = Number(target.closest('.mes[mesid]')?.getAttribute('mesid'));
            if (!Number.isInteger(index) || open) return;
            open = true;
            edit(index, target)
                .catch((err) => warn(`Could not edit ${what}.`, err))
                .finally(() => { open = false; });
        };
        chat.addEventListener('click', answer);
        chat.addEventListener('keydown', answer);
    } catch (err) {
        warn('Could not add Cairn\'s memory editing.', err);
    }
}
