import { describe, expect, it } from "vitest";
import { applyCanonEditor, canonEditor } from "../src/memory/canon-edit.js";
import { HARD_FACT_CHARS } from "../src/memory/canon-strategy.js";
import { readCanon, readIndex } from "../src/store/chat-store.js";
import { cairnCanonStore, cairnIndexStore } from "./mocks/cairn.js";
import { makeChat } from "./mocks/sillytavern.js";

/**
 * The canon editor's two halves (docs/decisions.md D-0110): what it opens on, and what one
 * visit's answers do. A pin and an edit are different things, pinning moves a fact out of
 * the pick, unpinning moves it back, and nothing is deleted by hand.
 */

const READERS = { readCanon, readIndex };

/** Twelve indexed messages, with the newest pick on #11. */
function chatWith(facts, { runnersUp } = {}) {
  const chat = makeChat(12);
  chat.forEach((message, index) => {
    message.extra.cairn = cairnIndexStore(message, `Matter ${index} was settled.`);
  });
  chat[11].extra.cairn = {
    ...chat[11].extra.cairn,
    ...cairnCanonStore(facts, [0, 11], { slots: 4, runnersUp }),
  };
  return chat;
}

const fact = (text, from = [2]) => ({ text, from });
const answer = (entries) => new Map(entries);

describe("what the canon editor opens on", () => {
  it("lists the pins, then the newest pick's facts, then its runners-up", () => {
    const chat = chatWith([fact("Picked one."), fact("Picked two.")], {
      runnersUp: [fact("Near miss.")],
    });
    const model = canonEditor(chat, [{ text: "Pinned.", from: [] }], 4, READERS);

    expect(model.rows.map((row) => [row.key, row.text, row.pinned])).toEqual([
      ["pin:0", "Pinned.", true],
      ["fact:0", "Picked one.", false],
      ["fact:1", "Picked two.", false],
      ["runner:0", "Near miss.", false],
    ]);
    expect(model.batch).toEqual({ index: 11, at: "2026-09-17T09:00:00.000Z" });
  });

  it("hides a fact whose records are gone, or one that repeats a row above it", () => {
    const chat = chatWith([fact("Gone.", [40]), fact("pinned"), fact("Kept.")]);
    const model = canonEditor(chat, [{ text: "Pinned.", from: [] }], 4, READERS);
    expect(model.rows.map((row) => row.text)).toEqual(["Pinned.", "Kept."]);
  });
});

describe("what one visit does", () => {
  const open = (facts, pins = [], options = {}) =>
    canonEditor(chatWith(facts, options), pins, 4, READERS);

  it("changes nothing when nothing was touched", () => {
    const model = open([fact("One."), fact("Two.")]);
    const result = applyCanonEditor(model, answer([["fact:0", { text: "One.", pinned: false }]]));
    expect(result).toMatchObject({ changed: false, pinned: 0, unpinned: 0, edited: 0 });
    expect(result.facts).toEqual(model.facts);
  });

  it("corrects a fact in place and marks it the user's, without pinning it", () => {
    const model = open([fact("She wears the collar."), fact("Two.")]);
    const result = applyCanonEditor(
      model,
      answer([["fact:0", { text: "  The collar was destroyed.  ", pinned: false }]]),
    );
    expect(result.pins).toEqual([]);
    expect(result.facts[0]).toMatchObject({ text: "The collar was destroyed.", edited: true });
    expect(result.facts[1].edited).toBeUndefined();
    expect(result).toMatchObject({ changed: true, edited: 1 });
  });

  it("moves a pinned fact out of the pick, keeping its rows, edited or not", () => {
    const model = open([fact("One.", [3]), fact("Two.", [5])]);
    const result = applyCanonEditor(
      model,
      answer([
        ["fact:0", { text: "One.", pinned: true }],
        ["fact:1", { text: "Two, put better.", pinned: true }],
      ]),
    );
    expect(result.pins).toEqual([
      { text: "One.", from: [3] },
      { text: "Two, put better.", from: [5], edited: true },
    ]);
    expect(result.facts).toEqual([]);
    expect(result).toMatchObject({ pinned: 2, edited: 1 });
  });

  it("hands an unpinned fact back to the pick, at the end, with its rows", () => {
    const model = open([fact("Picked.")], [{ text: "Was pinned.", from: [7], edited: true }]);
    const result = applyCanonEditor(
      model,
      answer([["pin:0", { text: "Was pinned.", pinned: false }]]),
    );
    expect(result.pins).toEqual([]);
    expect(result.facts.map((entry) => entry.text)).toEqual(["Picked.", "Was pinned."]);
    expect(result.facts[1]).toMatchObject({ from: [7], edited: true });
    expect(result.unpinned).toBe(1);
  });

  it("pins a runner-up, with its words if edited, and ignores an edit to one left unpinned", () => {
    const model = open([fact("Picked.")], [], {
      runnersUp: [fact("Near one.", [4]), fact("Near two.", [6])],
    });
    const result = applyCanonEditor(
      model,
      answer([
        ["runner:0", { text: "Near one, as it stands now.", pinned: true }],
        ["runner:1", { text: "Rewritten but not pinned.", pinned: false }],
      ]),
    );
    expect(result.pins).toEqual([{ text: "Near one, as it stands now.", from: [4], edited: true }]);
    expect(result.runnersUp.map((entry) => entry.text)).toEqual(["Near two."]);
    expect(result).toMatchObject({ pinned: 1, edited: 1 });
  });

  it("keeps the old words when a box is emptied, since nothing is deleted by hand", () => {
    const model = open([fact("Keep me.")]);
    const result = applyCanonEditor(model, answer([["fact:0", { text: "   ", pinned: false }]]));
    expect(result.facts[0].text).toBe("Keep me.");
    expect(result.changed).toBe(false);
  });

  it("refuses pins past the slot count, as the editor's toggles do", () => {
    const model = open(
      [fact("A."), fact("B."), fact("C.")],
      [
        { text: "P1.", from: [] },
        { text: "P2.", from: [] },
      ],
    );
    const result = applyCanonEditor(
      model,
      answer(["fact:0", "fact:1", "fact:2"].map((key) => [key, { pinned: true }])),
    );
    expect(result.pins.map((pin) => pin.text)).toEqual(["P1.", "P2.", "A.", "B."]);
    expect(result.facts.map((entry) => entry.text)).toEqual(["C."]);
  });

  it("cuts an edit past the hard cap, as it would a pick's", () => {
    const model = open([fact("Short.")]);
    const result = applyCanonEditor(
      model,
      answer([["fact:0", { text: "word ".repeat(200), pinned: false }]]),
    );
    expect(result.facts[0].text.length).toBeLessThanOrEqual(HARD_FACT_CHARS + 1);
  });
});
