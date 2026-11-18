/**
 * The derive cadence — when a canon pick is due, and what its reply becomes
 * (docs/decisions.md D-0071). What it reads comes from pipeline/index-reads.js.
 *
 * **The eviction trigger is gone.** Until P5 a pass fired one step before the rebuild
 * that would drop its summaries, read exactly that evict-set, and promoted out of it.
 * Every part of that was wrong for the job: eviction from the *prompt* says nothing
 * about availability on *disk* (`readScenes` always returned the whole chat), and a
 * window sampled by recency is almost entirely description and filler, so it cannot
 * rank what matters (D-0062, D-0064). The pressure test, the evict-set simulation and
 * the once-per-cycle `covers` test all went with it.
 *
 * What replaces them is the shape `pendingScenes` already uses for summaries: **work is
 * due when something is missing.** A summary with no record is indexing work; an index
 * with records the current pick never read is derivation work. Nothing is stored about
 * what has run, so a branch, a swipe, an edit or a resummarise needs no bookkeeping.
 *
 * Pure: plain data in, plain data out. No ST, no DOM, no network.
 */
import { newFacts } from "../memory/canon.js";

/**
 * Fewer records than this and there is no story to rank. Three is the same floor the
 * old evict-set used, for the same reason: the call is not worth making, and a spine
 * picked out of two scenes is those two scenes.
 */
export const MIN_INDEX_RECORDS = 3;

/**
 * Whether a canon pick is due, and what it would read.
 *
 * Four things make one due, and each is a statement about the *stored* pick rather
 * than about pressure:
 *
 *   `no-canon`     nothing has ever been picked in this chat.
 *   `new-records`  the index has grown at least `growth` messages past what the last
 *                  pick read — a step's worth, so a pick runs about once a step and the
 *                  step admits it (D-0105). Less than that is `growing`, not due.
 *   `lost-facts`   a fact's records are gone — edited, resummarised or branched away
 *                  (memory/canon.js) — so the pick in force is missing a slot.
 *   `slots-changed` the user moved the slot count, so the question itself changed.
 *
 * All four terminate. A pick that comes back short is *answered*, not under-filled:
 * the batch records how many slots were asked for, so a story with four durable facts
 * and ten slots is not re-derived every turn forever.
 *
 * @param {{records?: IndexedRecord[], canon?: {coveredThrough: number|null,
 *          slots: number|null, dropped: number}|null, slots?: number, growth?: number}} [input]
 *        `records` is every valid index record in the chat, oldest first;
 *        `canon` is the fold in force (`canonFor`); `growth` the see-saw step, where
 *        0 or less asks again on any new record.
 * @returns {CanonPickWork | {due: false, reason: string, records: IndexedRecord[], covers: null,
 *            slots: number}} `reason` is a stable string the log and the inspector record.
 */
export function pendingPick({ records = [], canon = null, slots = 0, growth = 0 } = {}) {
  /** @param {string} reason */
  const refuse = (reason) => ({
    due: /** @type {const} */ (false),
    reason,
    records: /** @type {IndexedRecord[]} */ ([]),
    covers: null,
    slots,
  });

  if (!(slots >= 1)) return refuse("no-slots");
  if (records.length < MIN_INDEX_RECORDS) return refuse("too-few");

  /** @type {[number, number]} */
  const covers = [records[0].index, records[records.length - 1].index];
  const reason = pickReason(canon, covers[1], slots, growth);
  if (reason === "growing" || !reason) return refuse(reason ?? "covered");

  return { due: /** @type {const} */ (true), reason, records, covers, slots };
}

/**
 * Why a pick is due, `growing` when only new records are waiting and too few of them, or
 * null when the one in force still answers. A lost fact or a changed question is answered
 * at once; new records wait for a step's worth, because a pick every turn chained one bad
 * reply into the next (D-0105).
 */
function pickReason(canon, newest, slots, growth) {
  if (!canon || canon.coveredThrough === null) return "no-canon";
  if (canon.dropped > 0) return "lost-facts";
  if (canon.slots !== null && canon.slots !== slots) return "slots-changed";
  if (newest > canon.coveredThrough) {
    return newest - canon.coveredThrough >= growth ? "new-records" : "growing";
  }
  return null;
}

/**
 * The canon in force, cited by row in the index a pick is about to read (D-0090, D-0101).
 * A pick starts from this rather than from nothing, so a fact an earlier pick corrected
 * stays corrected unless a row changes it again.
 *
 * @param {Array<{text: string, from: number[]}>} facts The fold's facts (`canonFor`).
 * @param {Array<{index: number}>} records The records the pick reads, oldest first;
 *        row N is `records[N - 1]`.
 * @returns {Array<{text: string, rows: number[]}>}
 */
export function carriedCanon(facts = [], records = []) {
  const rowOf = new Map(records.map((entry, at) => [entry.index, at + 1]));
  return facts.map((fact) => ({
    text: fact.text,
    rows: (fact.from ?? []).map((index) => rowOf.get(index)).filter((row) => row !== undefined),
  }));
}

/**
 * What a reply becomes: the batch to store, and the counts to report.
 *
 * The counts are of the *applied* change, not the model's claimed output
 * (CLAUDE.md §4.18) — a repeat inside the pick is refused here and counted as refused,
 * and the caps the parser enforced are already counted in `dropped`.
 *
 * **The rows are mapped to chat indexes here**, because the caller is the only thing
 * that knows which records it sent and in what order. A fact whose every row falls
 * outside that list loses its grounding, so it is dropped rather than stored uncited:
 * an uncitable fact is a permanent one, which is what a pick exists not to be.
 *
 * @param {{picked: CanonFact[], dropped?: Array<object>, records: Array<{index: number}>,
 *          covers: [number, number], slots: number, prompt: string, at: string}} input
 * @returns {{batch: {facts: CanonFact[], covers: [number, number], slots: number,
 *            prompt: string, at: string}, picked: number, duplicates: number,
 *            dropped: number, uncited: number}}
 */
export function applyPick({ picked, dropped = [], records = [], covers, slots, prompt, at }) {
  const { facts, duplicates } = newFacts(picked);
  const kept = [];
  let uncited = 0;

  for (const fact of facts) {
    const from = fact.from
      .map((row) => records[row - 1]?.index)
      .filter((index) => Number.isInteger(index));
    if (!from.length) {
      uncited++;
      continue;
    }
    kept.push({ ...fact, from });
  }

  return {
    batch: { facts: kept, covers: [...covers], slots, prompt, at },
    picked: kept.length,
    duplicates,
    dropped: dropped.length,
    uncited,
  };
}
