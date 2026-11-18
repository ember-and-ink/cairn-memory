import { describe, expect, it } from "vitest";
import { canonFor } from "../src/memory/canon.js";
import { readCanon, readIndex } from "../src/store/chat-store.js";
import { canonCardHtml, canonCardView, rebuildText } from "../src/ui/canon-card.js";
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
    expect(canonCardHtml(view)).toContain("<li>Her brother is dead.</li>");
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
