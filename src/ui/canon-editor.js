/**
 * The canon editor (docs/decisions.md D-0110), opened from the Canon card: the pins, the
 * canon the newest pick chose and its runners-up, each with its words in a box and a pin.
 * One visit is saved as one change, and the card makes the next turn a rebuild so it goes
 * in on the next message.
 *
 * What a visit does is memory/canon-edit.js's; the summarizer refuses and writes.
 * `canonEditorHtml`, `readEditorAnswers` and `canonEditText` are pure. `openCanonEditor`
 * is the DOM glue, on ST's own Popup (public/scripts/popup.js:196).
 */
import { SLUG } from "../constants.js";
import { HARD_FACT_CHARS } from "../memory/canon-strategy.js";
import { escapeHtml, fmt } from "./html.js";

const ROW = `${SLUG}-canon-row`;
const PIN = `${SLUG}-canon-pin`;
const TEXT = `${SLUG}-canon-text`;
const COUNT = `${SLUG}-canon-count`;

const REFUSED = Object.freeze({
  disabled: "Cairn is turned off",
  off: "Keep canon is off",
  adopting: "an adoption is running",
  picking: "a canon pick is being written",
  empty: "there is no canon to edit yet",
  changed: "a new pick landed while the editor was open",
  "no-pick": "an unpinned fact needs a pick to go back to, and there is none",
  write: "it could not be stored",
});

/** Why the editor did not open, or did not save; null when there is nothing to say. */
export function canonEditText(reason) {
  if (reason === "unchanged") return null;
  return `Canon was not changed: ${REFUSED[String(reason)] ?? reason}.`;
}

/**
 * The editor's body. A runner-up's box is read-only until it is pinned, because an edit
 * to one that stays unpinned has nowhere to live; the glue unlocks it.
 *
 * @param {import("../memory/canon-edit.js").EditorModel} model
 * @returns {string}
 */
export function canonEditorHtml(model) {
  const pinned = model.rows.filter((row) => row.pinned).length;
  const full = pinned >= model.slots;
  const row = (entry) => {
    const locked = entry.kind === "runner" && !entry.pinned;
    const disabled = !entry.pinned && full ? " disabled" : "";
    return `<div class="${ROW}" data-key="${escapeHtml(entry.key)}" data-kind="${entry.kind}">
      <label class="checkbox_label ${SLUG}-canon-pin-label" title="Pin: keep this whatever the pick says">
        <input type="checkbox" class="${PIN}"${entry.pinned ? " checked" : ""}${disabled} />
        <i class="fa-solid fa-thumbtack"></i>
      </label>
      <textarea class="text_pole ${TEXT}" rows="2" maxlength="${HARD_FACT_CHARS}"${locked ? " readonly" : ""}>${escapeHtml(entry.text)}</textarea>
    </div>`;
  };
  const section = (kind, title, hint) => {
    const rows = model.rows.filter((entry) => entry.kind === kind);
    if (!rows.length) return "";
    return `<h4>${title}</h4><p class="${SLUG}-hint">${hint}</p>${rows.map(row).join("")}`;
  };

  return `<h3>Canon for this chat</h3>
    <p class="${SLUG}-hint">Pinned facts stay in canon whatever the pick says, and take its entries first.
      An edit corrects a fact the pick chose: the next pick keeps your words unless the story
      changes them, but may still drop it. Your changes go in on your next message.</p>
    <p class="${SLUG}-hint ${COUNT}">${countText(pinned, model.slots)}</p>
    ${section("pin", "Pinned", "Unpin one to hand it back to the pick, which keeps it or lets it go.")}
    ${section("fact", "Canon now", "The newest pick. Edit a fact to correct it, or pin it to keep it.")}
    ${section("runner", "Runners-up", "What came closest to an entry. Pin one to keep it, and edit it once pinned.")}`;
}

function countText(pinned, slots) {
  const left = Math.max(0, slots - pinned);
  return `${fmt(pinned)} of ${fmt(slots)} entries pinned; the pick fills ${left === 1 ? "the other one" : `the other ${fmt(left)}`}.`;
}

/**
 * The answers in the editor, by row key.
 *
 * @param {ParentNode} root
 * @returns {Map<string, {text: string, pinned: boolean}>}
 */
export function readEditorAnswers(root) {
  const answers = new Map();
  for (const row of root.querySelectorAll(`.${ROW}`)) {
    const key = row.getAttribute("data-key");
    const box = row.querySelector(`.${TEXT}`);
    const pin = row.querySelector(`.${PIN}`);
    if (!key || !box || !pin) continue;
    answers.set(key, {
      text: /** @type {HTMLTextAreaElement} */ (box).value,
      pinned: /** @type {HTMLInputElement} */ (pin).checked,
    });
  }
  return answers;
}

/**
 * Open the editor, and save what the user chose.
 *
 * @param {() => StContext} getContext
 * @param {Pick<Summarizer, "canonEditable" | "editCanon">} summarizer
 * @returns {Promise<{written: boolean, text: string|null}>} `text` is for the card's status line.
 */
export async function openCanonEditor(getContext, summarizer) {
  const editable = summarizer.canonEditable();
  if (!editable.ok) return { written: false, text: canonEditText(editable.reason) };
  const { model } = editable;

  const { Popup, POPUP_TYPE, POPUP_RESULT } = getContext();
  /** @type {Map<string, {text: string, pinned: boolean}>|null} */
  let answers = null;
  const popup = new Popup(canonEditorHtml(model), POPUP_TYPE.CONFIRM, "", {
    okButton: "Save",
    cancelButton: "Cancel",
    wide: true,
    allowVerticalScrolling: true,
    leftAlign: true,
    // Read before the popup goes, and only on Save (popup.js:775).
    onClosing: (closing) => {
      if (closing.result === POPUP_RESULT.AFFIRMATIVE) answers = readEditorAnswers(popup.dlg);
      return true;
    },
  });

  // Pins take entries, so once they fill them the rest cannot be pinned, and a runner-up's
  // box opens only when it is pinned.
  const pins = [...popup.dlg.querySelectorAll(`.${PIN}`)].map(
    (box) => /** @type {HTMLInputElement} */ (box),
  );
  const count = popup.dlg.querySelector(`.${COUNT}`);
  const sync = () => {
    const pinned = pins.filter((box) => box.checked).length;
    for (const box of pins) {
      box.disabled = !box.checked && pinned >= model.slots;
      const row = box.closest(`.${ROW}`);
      const text = /** @type {HTMLTextAreaElement|null} */ (row?.querySelector(`.${TEXT}`) ?? null);
      if (text && row?.getAttribute("data-kind") === "runner") text.readOnly = !box.checked;
    }
    if (count) count.textContent = countText(pinned, model.slots);
  };
  for (const box of pins) box.addEventListener("change", sync);

  const result = await popup.show();
  if (result !== POPUP_RESULT.AFFIRMATIVE || !answers) return { written: false, text: null };

  const saved = await summarizer.editCanon(model, answers);
  if (!saved.written) return { written: false, text: canonEditText(saved.reason) };
  return {
    written: true,
    text: "Saved. Your canon changes go into the prompt on your next message.",
  };
}
