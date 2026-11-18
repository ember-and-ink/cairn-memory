import { describe, expect, it } from "vitest";
import { canonFor } from "../src/memory/canon.js";
import { readCanon, readIndex, readPins } from "../src/store/chat-store.js";
import { canonCardHtml, canonCardView, rebuildText } from "../src/ui/canon-card.js";
import { canonEditText, canonEditorHtml } from "../src/ui/canon-editor.js";
import { deferred } from "./mocks/llm.js";
import { cairnCanonStore, cairnIndexStore } from "./mocks/cairn.js";
import { makeChat as rawChat } from "./mocks/sillytavern.js";
import { queueHarness } from "./helpers/summarizer.js";
import { stubToastr } from "./helpers/toastr.js";

/**
 * The Canon card and Rebuild canon (docs/decisions.md D-0104): one fresh pick over the
 * whole index, made on the user's word, that the next turn admits.
 */

const READERS = { readCanon, readIndex };
const SLOTS = 3;

/** A chat whose messages carry index records, so a pick has rows to read and cite. */
function makeChat(length) {
  const chat = rawChat(length);
  chat.forEach((message, index) => {
    message.extra.cairn = cairnIndexStore(
      message,
      `Matter ${index} was settled before the tide turned.`,
    );
  });
  return chat;
}

const pick = (label) =>
  JSON.stringify({
    canon: Array.from({ length: SLOTS }, (_, i) => ({
      fact: `${label} fact ${i + 1}.`,
      entities: ["Wren"],
      from: [i + 1],
    })),
  });

function harness({ chat = makeChat(12), ...options } = {}) {
  const run = queueHarness({
    chat,
    defaults: { worldState: false, canonSlots: SLOTS },
    // No pick is due on its own, so every call in these tests is the rebuild's.
    memory: () => ({ due: false, writing: true }),
    ...options,
  });
  run.summarizer.start();
  return run;
}

const isPick = (call) => call.prompt[0].content.startsWith("You are choosing the permanent spine");

stubToastr();

describe("rebuilding canon by hand", () => {
  it("picks over the whole index, carrying nothing forward, and writes it where the queue would", async () => {
    const live = makeChat(12);
    live[11].extra.cairn = {
      ...live[11].extra.cairn,
      ...cairnCanonStore([{ text: "An old fact.", from: [2] }], [0, 11], { slots: SLOTS }),
    };
    const { service, summarizer } = harness({ chat: live, responses: [pick("Fresh")] });
    await summarizer.idle();

    const result = await summarizer.rebuildCanon();

    expect(result).toEqual({ ok: true });
    const calls = service.calls.filter(isPick);
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt[0].content).not.toContain("The canon as it stood");
    expect(calls[0].prompt[0].content).toContain("12 | ");
    const now = canonFor(live, READERS);
    expect(now.index).toBe(11);
    expect(now.facts.map((fact) => fact.text)).toEqual([
      "Fresh fact 1.",
      "Fresh fact 2.",
      "Fresh fact 3.",
    ]);
  });

  it("logs its call as a rebuild (D-0093)", async () => {
    const lines = [];
    const { summarizer } = harness({
      responses: [pick("Fresh")],
      onCall: (entry) => lines.push(entry),
    });
    await summarizer.idle();
    await summarizer.rebuildCanon();

    expect(lines).toEqual([
      expect.objectContaining({ job: "canon", during: "rebuild", outcome: "written" }),
    ]);
  });

  it("holds the queue while it is out, and refuses a second click meanwhile", async () => {
    const gate = deferred();
    const { summarizer } = harness({ responses: [gate.promise] });
    await summarizer.idle();

    const first = summarizer.rebuildCanon();
    await Promise.resolve();
    expect(summarizer.rebuildingCanon).toBe(true);
    expect(await summarizer.rebuildCanon()).toEqual({ ok: false, reason: "rebuilding" });

    gate.resolve(pick("Fresh"));
    expect(await first).toEqual({ ok: true });
    expect(summarizer.rebuildingCanon).toBe(false);
  });

  it("changes nothing when the pick fails, and says so", async () => {
    const live = makeChat(12);
    live[11].extra.cairn = {
      ...live[11].extra.cairn,
      ...cairnCanonStore([{ text: "An old fact.", from: [2] }], [0, 11], { slots: SLOTS }),
    };
    const { summarizer } = harness({ chat: live, responses: ["I cannot help with that."] });
    await summarizer.idle();

    expect(await summarizer.rebuildCanon()).toEqual({ ok: false, reason: "failed" });
    expect(canonFor(live, READERS).facts.map((fact) => fact.text)).toEqual(["An old fact."]);
  });

  it("refuses with Keep canon off, before the story has a spine, and with Cairn stopped", async () => {
    const off = harness({ settings: { keepCanon: false } });
    expect(await off.summarizer.rebuildCanon()).toEqual({ ok: false, reason: "off" });

    const short = harness({ chat: makeChat(2) });
    expect(await short.summarizer.rebuildCanon()).toEqual({ ok: false, reason: "too-few" });

    const stopped = harness();
    stopped.summarizer.stop();
    expect(await stopped.summarizer.rebuildCanon()).toEqual({ ok: false, reason: "disabled" });
    expect([off, short, stopped].every((run) => run.service.calls.length === 0)).toBe(true);
  });
});

describe("what the card shows", () => {
  const PLANNED = { inPrompt: ["Her brother is dead."], spilled: [], waiting: [], slots: 10 };
  const context = (chat) => ({ chatId: "c1", chat });

  it("shows what the prompt carries once a turn has been planned", () => {
    const view = canonCardView(PLANNED, context([]), {});
    expect(view).toMatchObject({ kind: "planned", facts: ["Her brother is dead."], slots: 10 });
    expect(canonCardHtml(view)).toContain("In the prompt now: 1 of 10 entries.");
    expect(canonCardHtml(view)).toContain("<li><span>Her brother is dead.</span></li>");
  });

  it("shows the newest pick before the first turn, and after a rebuild by hand, since the next turn admits it", () => {
    const chat = makeChat(12);
    chat[11].extra.cairn = {
      ...chat[11].extra.cairn,
      ...cairnCanonStore([{ text: "The boat is green.", from: [2] }], [0, 11], { slots: 10 }),
    };

    for (const view of [
      canonCardView(null, context(chat), {}),
      canonCardView(PLANNED, context(chat), {}, { forcing: true }),
    ]) {
      expect(view).toMatchObject({ kind: "unplanned", facts: ["The boat is green."] });
      expect(canonCardHtml(view)).toContain("It goes into the prompt on your next message.");
    }
  });

  it("says a newer pick is waiting for the next step", () => {
    const view = canonCardView(
      { ...PLANNED, waiting: ["Her brother is dead.", "The boat is green."] },
      context([]),
      {},
    );
    expect(canonCardHtml(view)).toContain("A newer pick, which goes in at the next step:");
  });

  it("escapes the facts, which are the model's words", () => {
    const view = canonCardView(
      { ...PLANNED, inPrompt: ["<img src=x onerror=alert(1)>"] },
      context([]),
      {},
    );
    expect(canonCardHtml(view)).not.toContain("<img");
  });

  it("has a sentence for no chat, canon off, and no canon yet", () => {
    expect(canonCardHtml(canonCardView(PLANNED, { chatId: null }, {}))).toContain("Open a chat");
    expect(canonCardHtml(canonCardView(PLANNED, context([]), { keepCanon: false }))).toContain(
      "Canon is off",
    );
    expect(canonCardHtml(canonCardView(null, context(makeChat(4)), {}))).toContain("No canon yet");
  });

  it("words a rebuild's outcome for the panel", () => {
    expect(rebuildText({ ok: true })).toContain("on your next message");
    expect(rebuildText({ ok: false, reason: "too-few" })).toBe(
      "Canon was not rebuilt: the story is too short to have a spine yet.",
    );
    expect(rebuildText({ ok: false, reason: "no-profile" })).toBe(
      "Canon was not rebuilt: no memory connection chosen.",
    );
  });
});

/** Pins and edits by hand (docs/decisions.md D-0110), through the summarizer as the editor saves them. */
describe("pinning and editing canon by hand", () => {
  const withPick = (facts, options = {}) => {
    const live = makeChat(12);
    live[11].extra.cairn = {
      ...live[11].extra.cairn,
      ...cairnCanonStore(facts, [0, 11], { slots: SLOTS, ...options }),
    };
    return live;
  };

  it("rebuilds around the pins, asking only for the slots they leave", async () => {
    const chatMetadata = { cairn: { pins: [{ text: "The collar was destroyed.", from: [] }] } };
    const { service, summarizer } = harness({
      chat: withPick(["Old."]),
      context: { chatMetadata },
      responses: [pick("Fresh")],
    });
    await summarizer.idle();

    expect(await summarizer.rebuildCanon()).toEqual({ ok: true });
    const content = service.calls.filter(isPick)[0].prompt[0].content;
    expect(content).toContain("exactly 2 facts");
    expect(content).toContain("- The collar was destroyed.");
  });

  it("refuses to rebuild once the pins fill every slot", async () => {
    const pins = ["One.", "Two.", "Three."].map((text) => ({ text, from: [] }));
    const { service, summarizer } = harness({ context: { chatMetadata: { cairn: { pins } } } });
    expect(await summarizer.rebuildCanon()).toEqual({ ok: false, reason: "all-pinned" });
    expect(service.calls).toHaveLength(0);
  });

  it("saves a visit: the pin on the chat, the edit in the pick, and counts in the log", async () => {
    const live = withPick([
      { text: "She wears the collar.", from: [3] },
      { text: "They left the castle.", from: [5] },
    ]);
    const chatMetadata = {};
    const lines = [];
    const { context, summarizer } = harness({
      chat: live,
      context: { chatMetadata },
      onCall: (entry) => lines.push(entry),
    });
    const editable = summarizer.canonEditable();
    expect(editable.ok).toBe(true);

    const result = await summarizer.editCanon(
      editable.model,
      new Map([
        ["fact:0", { text: "The collar was destroyed.", pinned: false }],
        ["fact:1", { text: "They left the castle.", pinned: true }],
      ]),
    );

    expect(result).toEqual({ written: true });
    expect(readPins(chatMetadata)).toEqual([{ text: "They left the castle.", from: [5] }]);
    expect(readCanon(live[11]).canon.facts).toEqual([
      { text: "The collar was destroyed.", entities: [], from: [3], edited: true },
    ]);
    const fold = canonFor(live, READERS, { pins: readPins(chatMetadata), slots: SLOTS });
    expect(fold.facts.map((fact) => fact.text)).toEqual([
      "They left the castle.",
      "The collar was destroyed.",
    ]);
    expect(lines).toEqual([
      expect.objectContaining({ kind: "edit", job: "canon", pinned: 1, edited: 1, unpinned: 0 }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("collar");
    expect(context.saved.chat).toBeGreaterThan(0);
  });

  it("refuses a visit whose pick was replaced while the editor was open", async () => {
    const live = withPick(["Old."]);
    const { summarizer } = harness({ chat: live });
    const { model } = /** @type {any} */ (summarizer.canonEditable());

    live[11].extra.cairn = {
      ...live[11].extra.cairn,
      ...cairnCanonStore(["Newer."], [0, 11], { slots: SLOTS, at: "2026-11-18T10:00:00.000Z" }),
    };
    const result = await summarizer.editCanon(
      model,
      new Map([["fact:0", { text: "Old.", pinned: true }]]),
    );
    expect(result).toEqual({ written: false, reason: "changed" });
  });

  it("does not open while a pick is out, nor with no canon to edit", async () => {
    const gate = deferred();
    const busy = harness({ chat: withPick(["Old."]), responses: [gate.promise] });
    await busy.summarizer.idle();
    const rebuilding = busy.summarizer.rebuildCanon();
    await Promise.resolve();
    expect(busy.summarizer.canonEditable()).toEqual({ ok: false, reason: "picking" });
    gate.resolve(pick("Fresh"));
    await rebuilding;

    expect(harness().summarizer.canonEditable()).toEqual({ ok: false, reason: "empty" });
  });
});

describe("the canon editor's page", () => {
  const model = (rows, slots = 3) => ({
    batch: null,
    slots,
    pins: [],
    facts: [],
    runnersUp: [],
    rows: rows.map(([kind, text, pinned], at) => ({
      key: `${kind}:${at}`,
      kind,
      text,
      pinned,
      at,
    })),
  });

  it("escapes the words, and locks a runner-up's box until it is pinned", () => {
    const html = canonEditorHtml(
      model([
        ["fact", "<b>bold</b>", false],
        ["runner", "Near.", false],
      ]),
    );
    expect(html).not.toContain("<b>bold");
    expect(html).toMatch(/data-kind="runner">[\s\S]*readonly/);
    expect(html).toContain("0 of 3 entries pinned; the pick fills the other 3.");
  });

  it("disables the unpinned toggles once the pins fill every entry", () => {
    const html = canonEditorHtml(
      model(
        [
          ["pin", "One.", true],
          ["fact", "Two.", false],
        ],
        1,
      ),
    );
    expect(html.match(/ disabled/g)).toHaveLength(1);
    expect(html).toContain("1 of 1 entries pinned");
  });

  it("marks the pins on the card", () => {
    const view = canonCardView(
      { inPrompt: ["Pinned.", "Picked."], pinned: ["Pinned."], spilled: [], waiting: [], slots: 4 },
      { chatId: "c1", chat: [] },
      {},
    );
    const html = canonCardHtml(view);
    expect(html.indexOf("fa-thumbtack")).toBeLessThan(html.indexOf("Pinned."));
    expect(html.match(/fa-thumbtack/g)).toHaveLength(1);
  });

  it("says why the editor did not save, and nothing when nothing changed", () => {
    expect(canonEditText("unchanged")).toBeNull();
    expect(canonEditText("changed")).toBe(
      "Canon was not changed: a new pick landed while the editor was open.",
    );
  });
});
