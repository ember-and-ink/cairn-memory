import { describe, expect, it } from "vitest";
import {
  MIN_INDEX_RECORDS,
  applyPick,
  carriedCanon,
  pendingPick,
} from "../src/pipeline/canon-pick.js";

/** An index of `count` records over messages 0, 1, 2 … — the pick's whole input. */
const records = (count, from = 0) =>
  Array.from({ length: count }, (_, i) => ({ index: from + i, record: { kind: "filler" } }));

/** The fold in force: what `canonFor` returns. */
const canon = (fields = {}) => ({ coveredThrough: 9, slots: 10, dropped: 0, ...fields });

describe("when a canon pick is due", () => {
  it("is due when nothing has ever been picked in this chat", () => {
    expect(pendingPick({ records: records(20), canon: null, slots: 10 })).toMatchObject({
      due: true,
      reason: "no-canon",
      covers: [0, 19],
    });
    expect(
      pendingPick({ records: records(20), canon: canon({ coveredThrough: null }), slots: 10 }),
    ).toMatchObject({ due: true, reason: "no-canon" });
  });

  it("is due when the index has grown past what the last pick read", () => {
    expect(
      pendingPick({ records: records(20), canon: canon({ coveredThrough: 19 }), slots: 10 }),
    ).toMatchObject({ due: false, reason: "covered" });
    expect(
      pendingPick({ records: records(21), canon: canon({ coveredThrough: 19 }), slots: 10 }),
    ).toMatchObject({ due: true, reason: "new-records", covers: [0, 20] });
  });

  /**
   * D-0105: new records wait for a step's worth. A pick every turn, carried forward,
   * chained one degenerate reply into the next; once a step lines the pick up with the
   * step that admits it, at a quarter of the calls.
   */
  it("waits for a step's worth of new records, then is due", () => {
    const last = canon({ coveredThrough: 19 });
    expect(pendingPick({ records: records(21), canon: last, slots: 10, growth: 8 })).toMatchObject({
      due: false,
      reason: "growing",
      covers: null,
    });
    expect(pendingPick({ records: records(27), canon: last, slots: 10, growth: 8 })).toMatchObject({
      due: false,
      reason: "growing",
    });
    expect(pendingPick({ records: records(28), canon: last, slots: 10, growth: 8 })).toMatchObject({
      due: true,
      reason: "new-records",
      covers: [0, 27],
    });
  });

  it("measures the growth in messages, so a gap in the index does not slow it down", () => {
    // Records sit on summarised messages only; a skipped message is still story.
    const sparse = [...records(20), { index: 28, record: { kind: "filler" } }];
    expect(
      pendingPick({ records: sparse, canon: canon({ coveredThrough: 19 }), slots: 10, growth: 8 }),
    ).toMatchObject({ due: true, reason: "new-records", covers: [0, 28] });
  });

  it("answers a lost fact, a changed question and a first pick at once, however little has grown", () => {
    const growth = 8;
    expect(
      pendingPick({
        records: records(21),
        canon: canon({ coveredThrough: 19, dropped: 1 }),
        slots: 10,
        growth,
      }),
    ).toMatchObject({ due: true, reason: "lost-facts" });
    expect(
      pendingPick({
        records: records(21),
        canon: canon({ coveredThrough: 19, slots: 6 }),
        slots: 10,
        growth,
      }),
    ).toMatchObject({ due: true, reason: "slots-changed" });
    expect(pendingPick({ records: records(4), canon: null, slots: 10, growth })).toMatchObject({
      due: true,
      reason: "no-canon",
    });
  });

  it("asks again on any new record with no step set, which is the control", () => {
    expect(
      pendingPick({
        records: records(21),
        canon: canon({ coveredThrough: 19 }),
        slots: 10,
        growth: 0,
      }),
    ).toMatchObject({ due: true, reason: "new-records" });
  });

  it("is due when a fact lost the records it rested on", () => {
    // An edit, a resummarise or a branch took a record away, so the pick in force
    // is missing a slot and the answer is out of date (memory/canon.js).
    expect(
      pendingPick({
        records: records(20),
        canon: canon({ coveredThrough: 19, dropped: 1 }),
        slots: 10,
      }),
    ).toMatchObject({ due: true, reason: "lost-facts" });
  });

  it("is due when the slot count moved, because the question itself changed", () => {
    expect(
      pendingPick({
        records: records(20),
        canon: canon({ coveredThrough: 19, slots: 6 }),
        slots: 10,
      }),
    ).toMatchObject({ due: true, reason: "slots-changed" });
  });

  it("treats a short answer as answered, so it is not asked again every turn", () => {
    // Four facts against ten slots is a spine, not work still to do. Without the
    // stored `slots` this would be indistinguishable from an unanswered question.
    const answered = canon({ coveredThrough: 19, slots: 10 });

    for (let turn = 0; turn < 20; turn++) {
      expect(pendingPick({ records: records(20), canon: answered, slots: 10 })).toMatchObject({
        due: false,
        reason: "covered",
      });
    }
  });

  it("is not due with too few records to rank, or with no slots to fill", () => {
    expect(
      pendingPick({ records: records(MIN_INDEX_RECORDS - 1), canon: null, slots: 10 }),
    ).toMatchObject({ due: false, reason: "too-few", records: [], covers: null });
    expect(pendingPick({ records: records(20), canon: null, slots: 0 })).toMatchObject({
      due: false,
      reason: "no-slots",
    });
    expect(pendingPick()).toMatchObject({ due: false, reason: "no-slots" });
    expect(MIN_INDEX_RECORDS).toBe(3);
  });

  it("carries the whole index, because the pick ranks all of it", () => {
    // Not the newest ones, and not the ones the block still holds: the pick reads
    // the chat, which is the single sentence D-0062's three gaps reduce to.
    const due = pendingPick({ records: records(200), canon: null, slots: 10 });

    expect(due.records).toHaveLength(200);
    expect(due.covers).toEqual([0, 199]);
  });
});

describe("what a pick becomes", () => {
  const sent = [{ index: 4 }, { index: 7 }, { index: 11 }];

  it("maps the rows the model cited back to the messages they came from", () => {
    const applied = applyPick({
      picked: [
        { text: "Her brother is dead.", entities: ["Wren"], from: [1] },
        { text: "He burned the army to buy her freedom.", entities: [], from: [2, 3] },
      ],
      records: sent,
      covers: [4, 11],
      slots: 10,
      prompt: "h:1",
      at: "T",
    });

    expect(applied.batch.facts).toEqual([
      { text: "Her brother is dead.", entities: ["Wren"], from: [4] },
      { text: "He burned the army to buy her freedom.", entities: [], from: [7, 11] },
    ]);
    expect(applied).toMatchObject({ picked: 2, duplicates: 0, dropped: 0, uncited: 0 });
    expect(applied.batch).toMatchObject({ covers: [4, 11], slots: 10, prompt: "h:1", at: "T" });
  });

  it("refuses a fact whose every row fell outside the index it was sent", () => {
    // An uncitable fact is a permanent one, which is what a pick exists not to be.
    const applied = applyPick({
      picked: [{ text: "Invented.", entities: [], from: [99] }],
      records: sent,
      covers: [4, 11],
      slots: 10,
      prompt: "h:1",
      at: "T",
    });

    expect(applied).toMatchObject({ picked: 0, uncited: 1 });
    expect(applied.batch.facts).toEqual([]);
  });

  it("counts the facts it actually wrote, not the ones the model claimed", () => {
    const applied = applyPick({
      picked: [
        { text: "Her brother is dead.", entities: [], from: [1] },
        { text: "her brother is dead!", entities: [], from: [2] },
      ],
      dropped: [{ reason: "fact-too-long" }, { reason: "over-slots" }],
      records: sent,
      covers: [4, 11],
      slots: 10,
      prompt: "h:1",
      at: "T",
    });

    expect(applied).toMatchObject({ picked: 1, duplicates: 1, dropped: 2 });
  });

  it("writes the same batch twice from the same reply, so a re-derivation is stable", () => {
    // Canon is derivable rather than remembered (memory/canon.js): nothing about
    // when or how often it ran may show up in what is stored.
    const reply = {
      picked: [{ text: "Her brother is dead.", entities: ["Wren"], from: [1, 3] }],
      records: sent,
      covers: [4, 11],
      slots: 10,
      prompt: "h:1",
      at: "T",
    };

    expect(applyPick(reply)).toEqual(applyPick(reply));
  });

  it("copies the range, so the caller's array cannot reach the store", () => {
    const mutable = [4, 11];
    const applied = applyPick({
      picked: [],
      records: sent,
      covers: mutable,
      slots: 10,
      prompt: "h:1",
      at: "T",
    });
    mutable[1] = 99;

    expect(applied.batch.covers).toEqual([4, 11]);
  });
});

/** Pins take slots (docs/decisions.md D-0110): a pick is asked only for what they leave. */
describe("a pick around the user's pins", () => {
  it("asks for the slots the pins leave", () => {
    expect(pendingPick({ records: records(20), canon: null, slots: 10, pinned: 3 })).toMatchObject({
      due: true,
      slots: 7,
    });
  });

  it("asks nothing once the pins fill every slot", () => {
    expect(pendingPick({ records: records(20), canon: null, slots: 3, pinned: 3 })).toMatchObject({
      due: false,
      reason: "all-pinned",
      slots: 0,
    });
  });

  it("is due at once when a pin or an unpin changes what is left to pick", () => {
    const last = canon({ coveredThrough: 19, slots: 10, picked: 10 });
    expect(
      pendingPick({ records: records(20), canon: last, slots: 10, pinned: 1, growth: 8 }),
    ).toMatchObject({ due: true, reason: "slots-changed", slots: 9 });
  });

  it("is due when the pick holds more facts than the slots it may fill", () => {
    // A pin swapped for an unpin leaves the count alone but hands a fact back.
    const last = canon({ coveredThrough: 19, slots: 7, picked: 8 });
    expect(
      pendingPick({ records: records(20), canon: last, slots: 10, pinned: 3, growth: 8 }),
    ).toMatchObject({ due: true, reason: "slots-changed" });
  });

  it("carries the picked facts forward without the pins, and says which the user edited", () => {
    const facts = [
      { text: "Pinned.", from: [2], pinned: true },
      { text: "Corrected.", from: [4], edited: true },
      { text: "Plain.", from: [6] },
    ];
    expect(carriedCanon(facts, records(10))).toEqual([
      { text: "Corrected.", rows: [5], edited: true },
      { text: "Plain.", rows: [7] },
    ]);
  });

  it("keeps the edited mark on a fact the pick kept in the user's words", () => {
    const applied = applyPick({
      picked: [
        { text: "Corrected.", entities: [], from: [1] },
        { text: "Reworded by the pick.", entities: [], from: [2] },
      ],
      previous: [
        { text: "corrected", rows: [1], edited: true },
        { text: "Reworded.", rows: [2], edited: true },
      ],
      records: records(3),
      covers: [0, 2],
      slots: 2,
      prompt: "h:1",
      at: "2026-11-18T00:00:00.000Z",
    });
    expect(applied.batch.facts.map((fact) => fact.edited ?? false)).toEqual([true, false]);
  });

  it("maps the runners-up to messages, dropping repeats of canon and uncited ones quietly", () => {
    const applied = applyPick({
      picked: [{ text: "Canon.", entities: [], from: [1] }],
      runnersUp: [
        { text: "Close.", entities: ["Wren"], from: [2] },
        { text: "canon", entities: [], from: [3] },
        { text: "Off the end.", entities: [], from: [9] },
      ],
      records: records(3, 10),
      covers: [10, 12],
      slots: 1,
      prompt: "h:1",
      at: "2026-11-18T00:00:00.000Z",
    });
    expect(applied.batch.runnersUp).toEqual([{ text: "Close.", entities: ["Wren"], from: [11] }]);
    expect(applied).toMatchObject({ picked: 1, uncited: 0 });
  });
});
