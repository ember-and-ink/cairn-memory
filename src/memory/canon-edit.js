/**
 * Pinning and editing canon by hand (docs/decisions.md D-0110): what the canon editor
 * opens on, and what one visit's answers do to the pins and the newest pick.
 *
 * **A pin and an edit are different things.** A pin is the user's word: it lives on the
 * chat, takes a slot ahead of the pick, and stays until it is unpinned. An edit corrects a
 * fact the pick chose, in place, and marks it as the user's; the next pick is told so and
 * keeps the words unless a newer row changes them, but it may still drop the fact. So an
 * edit never becomes permanent by accident, and a pin never needs editing to be kept.
 *
 * Pinning moves a fact out of the pick and unpinning moves it back in, at the end, where
 * the next pick finds it among the canon it carries forward. Nothing is deleted by hand:
 * an unpinned fact the story no longer needs is the picker's to drop.
 *
 * Pure: plain data in, plain data out.
 */
import { liveFact, normaliseFact } from "./canon.js";
import { HARD_FACT_CHARS } from "./canon-strategy.js";
import { clip } from "../util/clip.js";

/**
 * @typedef {{key: string, kind: 'pin'|'fact'|'runner', text: string, pinned: boolean, at: number}} EditorRow
 *          `at` is the row's place in its own list: the pins, or the stored batch's
 *          `facts` or `runnersUp`.
 * @typedef {{batch: {index: number, at: string}|null, slots: number, pins: CanonPin[],
 *            facts: CanonFact[], runnersUp: CanonFact[], rows: EditorRow[]}} EditorModel
 */

/**
 * What the editor opens on: the pins in pin order, then the newest pick's facts, then its
 * runners-up. A fact whose records are gone, or one that repeats a row above it, is not
 * shown, and is written back untouched.
 *
 * @param {StMessage[]} chat
 * @param {CanonPin[]} pins The chat's pins (store/chat-store.js `readPins`).
 * @param {number} slots The canon entries setting.
 * @param {{readCanon: typeof import("../store/chat-store.js").readCanon,
 *          readIndex: typeof import("../store/chat-store.js").readIndex}} readers
 * @returns {EditorModel}
 */
export function canonEditor(chat, pins, slots, { readCanon, readIndex }) {
  const list = chat ?? [];
  /** @type {{index: number, canon: CairnCanon}|null} */
  let newest = null;
  list.forEach((message, index) => {
    const { status, canon } = readCanon(message);
    if (status === "valid") newest = { index, canon };
  });

  const seen = new Set();
  /** @type {EditorRow[]} */
  const rows = [];
  /** @param {'pin'|'fact'|'runner'} kind */
  const offer = (kind, fact, at, check = true) => {
    const key = normaliseFact(fact.text);
    if (!key || seen.has(key) || (check && !liveFact(fact, list, readIndex))) return;
    seen.add(key);
    rows.push({ key: `${kind}:${at}`, kind, text: fact.text, pinned: kind === "pin", at });
  };

  pins.forEach((pin, at) => offer("pin", pin, at, false));
  const found = /** @type {{index: number, canon: CairnCanon}|null} */ (newest);
  const facts = found?.canon.facts ?? [];
  const runnersUp = found?.canon.runnersUp ?? [];
  facts.forEach((fact, at) => offer("fact", fact, at));
  runnersUp.forEach((fact, at) => offer("runner", fact, at));

  return {
    batch: found ? { index: found.index, at: found.canon.at } : null,
    slots,
    pins: pins.map((pin) => ({ ...pin, from: [...pin.from] })),
    facts,
    runnersUp,
    rows,
  };
}

/**
 * What one visit's answers do. A row with no answer is left as it was; an emptied box
 * keeps the old words, since nothing is deleted by hand. A runner-up's words count only
 * if it is pinned: unpinned, it has nowhere to live, because the next pick replaces the
 * runners-up. Pins past the slot count are refused, as the editor's toggles are.
 *
 * @param {EditorModel} model
 * @param {Map<string, {text?: string, pinned?: boolean}>} answers By row `key`.
 * @returns {{pins: CanonPin[], facts: CanonFact[], runnersUp: CanonFact[], changed: boolean,
 *            pinned: number, unpinned: number, edited: number}}
 *          The counts are for the log, which never carries the words (D-0093).
 */
export function applyCanonEditor(model, answers) {
  const byKind = (kind) =>
    new Map(model.rows.filter((row) => row.kind === kind).map((row) => [row.at, row]));
  const rowsOf = { pin: byKind("pin"), fact: byKind("fact"), runner: byKind("runner") };
  const counts = { pinned: 0, unpinned: 0, edited: 0 };
  /** @param {EditorRow|undefined} row */
  const answer = (row) => {
    const given = row ? answers.get(row.key) : undefined;
    const typed =
      typeof given?.text === "string" ? clip(given.text.trim(), HARD_FACT_CHARS).text : "";
    const text = row && typed ? typed : (row?.text ?? "");
    return {
      text,
      pinned: given?.pinned ?? row?.pinned ?? false,
      changed: Boolean(row) && text !== row?.text,
    };
  };

  /** @type {CanonPin[]} */
  const pins = [];
  /** @type {CanonFact[]} */
  const handedBack = [];
  model.pins.forEach((pin, at) => {
    const row = rowsOf.pin.get(at);
    if (!row) return; // A repeat of a pin above it, folded away on read.
    const given = answer(row);
    if (given.changed) counts.edited++;
    const edited = pin.edited === true || given.changed;
    if (given.pinned) {
      pins.push({ text: given.text, from: [...pin.from], ...(edited ? { edited: true } : {}) });
    } else {
      counts.unpinned++;
      handedBack.push({
        text: given.text,
        entities: [],
        from: [...pin.from],
        ...(edited ? { edited: true } : {}),
      });
    }
  });
  const room = () => pins.length < model.slots;

  /** @type {CanonFact[]} */
  const facts = [];
  model.facts.forEach((fact, at) => {
    const row = rowsOf.fact.get(at);
    if (!row) {
      facts.push(fact);
      return;
    }
    const given = answer(row);
    if (given.changed) counts.edited++;
    const edited = fact.edited === true || given.changed;
    if (given.pinned && room()) {
      counts.pinned++;
      pins.push({ text: given.text, from: [...fact.from], ...(edited ? { edited: true } : {}) });
    } else {
      facts.push({ ...fact, text: given.text, ...(edited ? { edited: true } : {}) });
    }
  });
  facts.push(...handedBack);

  /** @type {CanonFact[]} */
  const runnersUp = [];
  model.runnersUp.forEach((fact, at) => {
    const row = rowsOf.runner.get(at);
    const given = answer(row);
    if (row && given.pinned && room()) {
      counts.pinned++;
      if (given.changed) counts.edited++;
      pins.push({
        text: given.text,
        from: [...fact.from],
        ...(given.changed ? { edited: true } : {}),
      });
    } else {
      runnersUp.push(fact);
    }
  });

  return {
    pins,
    facts,
    runnersUp,
    changed: counts.pinned + counts.unpinned + counts.edited > 0,
    ...counts,
  };
}
