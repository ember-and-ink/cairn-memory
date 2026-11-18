/**
 * The Canon card in the settings panel (docs/decisions.md D-0104): what the open chat's
 * canon is, and **Rebuild canon**, which picks it fresh and puts it in on the next message.
 *
 * Rebuilding lives here and not under a message: it is one judgement over the whole
 * story, and a button on a message would read as being about that message. So does
 * **Edit & pin…**, the canon editor (D-0110, src/ui/canon-editor.js).
 *
 * `canonCardView`, `canonCardHtml` and `rebuildText` are pure. `installCanonCard` is the DOM glue.
 */
import { SLUG } from "../constants.js";
import { canonFor, slotsFor } from "../memory/canon.js";
import { readCanon, readIndex, readPins } from "../store/chat-store.js";
import { toast, warn } from "../util/log.js";
import { openCanonEditor } from "./canon-editor.js";
import { escapeHtml, fmt, gateReason } from "./html.js";

const REFUSED = Object.freeze({
  off: "Keep canon is off",
  disabled: "Cairn is turned off",
  adopting: "an adoption is running",
  rebuilding: "a rebuild is already running",
  "not-writing": "Cairn is not writing the memory block in this chat",
  "too-few": "the story is too short to have a spine yet",
  "all-pinned": "every entry is pinned, so there is nothing left to pick",
  failed: "the memory model did not give a usable pick",
});

/**
 * What the card shows. The assembler's view is what the prompt carries, and exists once a
 * turn has been planned. Before that — just after a reload — and after a rebuild by hand,
 * the newest pick in the chat is shown instead, because the next turn admits it either
 * way: a session's first turn is a rebuild, and so is a forced one (D-0104).
 *
 * @param {{inPrompt: string[], pinned?: string[], spilled: string[], waiting: string[],
 *          slots: number}|null} planned The assembler's `canonView`, or null.
 * @param {{chat?: StMessage[], chatId?: string|null, chatMetadata?: Record<string, any>}} context
 * @param {{keepCanon?: boolean, canonSlots?: number}} settings
 * @param {{forcing?: boolean}} [assembler] `forcing`: the next turn is a forced rebuild.
 * @returns {{kind: 'no-chat'|'off'|'planned'|'unplanned', facts: string[], pinned: string[],
 *            spilled: string[], waiting: string[], slots: number|null}}
 */
export function canonCardView(planned, context, settings = {}, { forcing = false } = {}) {
  const empty = { facts: [], pinned: [], spilled: [], waiting: [], slots: null };
  if (!context?.chatId) return { kind: "no-chat", ...empty };
  if (settings.keepCanon === false) return { kind: "off", ...empty };
  if (planned && !forcing) {
    return {
      kind: "planned",
      facts: [...planned.inPrompt],
      pinned: [...(planned.pinned ?? [])],
      spilled: [...planned.spilled],
      waiting: [...planned.waiting],
      slots: planned.slots,
    };
  }
  const slots = slotsFor(settings.canonSlots);
  const newest = canonFor(
    context.chat ?? [],
    { readCanon, readIndex },
    { pins: readPins(context.chatMetadata), slots },
  );
  return {
    kind: "unplanned",
    ...empty,
    facts: newest.facts.map((fact) => fact.text),
    pinned: newest.facts.filter((fact) => fact.pinned).map((fact) => fact.text),
    slots,
  };
}

/** The card's canon list, as HTML. */
export function canonCardHtml(view) {
  const pinned = new Set(view.pinned ?? []);
  const pin = `<i class="fa-solid fa-thumbtack ${SLUG}-pin" title="Pinned"></i> `;
  const list = (texts) =>
    `<ul class="${SLUG}-list ${SLUG}-canon-facts">${texts
      .map((text) => `<li><span>${pinned.has(text) ? pin : ""}${escapeHtml(text)}</span></li>`)
      .join("")}</ul>`;
  const hint = (text) => `<div class="${SLUG}-hint">${text}</div>`;

  if (view.kind === "no-chat") return hint("Open a chat to see its canon.");
  if (view.kind === "off") return hint("Canon is off for every chat.");
  if (!view.facts.length && !view.waiting.length) {
    return hint("No canon yet. It is picked once the story has a few summaries.");
  }
  if (view.kind === "unplanned") {
    return (
      hint(
        `The newest pick, ${fmt(view.facts.length)} facts. It goes into the prompt on your next message.`,
      ) + list(view.facts)
    );
  }
  const spilled = view.spilled.length
    ? hint("Left out for want of room:") + list(view.spilled)
    : "";
  const waiting = view.waiting.length
    ? hint("A newer pick, which goes in at the next step:") + list(view.waiting)
    : "";
  const head = view.facts.length
    ? hint(`In the prompt now: ${fmt(view.facts.length)} of ${fmt(view.slots)} entries.`) +
      list(view.facts)
    : hint("None in the prompt yet.");
  return head + spilled + waiting;
}

/** The status line after a rebuild, in the panel's words. */
export function rebuildText(result) {
  if (result.ok) return "Picked fresh. It goes into the prompt on your next message.";
  const why = REFUSED[result.reason] ?? gateReason(result.reason) ?? result.reason;
  return `Canon was not rebuilt: ${why}.`;
}

/**
 * @param {() => StContext} getContext
 * @param {Pick<Summarizer, "rebuildCanon" | "adopting" | "rebuildingCanon" | "canonEditable"
 *          | "editCanon">} summarizer
 * @param {Pick<Assembler, "canonView" | "forcing" | "forceRebuild">} assembler
 * @param {{settings: () => CairnSettings}} options
 * @returns {{refresh: () => void, reset: () => void}}
 */
export function installCanonCard(getContext, summarizer, assembler, { settings }) {
  const host = document.getElementById(`${SLUG}_canonView`);
  const button = document.getElementById(`${SLUG}_canonRebuild`);
  const edit = document.getElementById(`${SLUG}_canonEdit`);
  const status = document.getElementById(`${SLUG}_canonStatus`);
  if (!host || !button || !edit || !status) return { refresh() {}, reset() {} };

  const refresh = () => {
    try {
      host.innerHTML = canonCardHtml(
        canonCardView(assembler.canonView, getContext(), settings(), assembler),
      );
      const busy = summarizer.rebuildingCanon || summarizer.adopting;
      for (const control of [button, edit]) {
        control.classList.toggle("disabled", busy);
        control.setAttribute("aria-disabled", String(busy));
      }
    } catch (err) {
      warn("Could not draw the canon card.", err);
    }
  };

  button.addEventListener("click", async () => {
    if (summarizer.rebuildingCanon || summarizer.adopting) return;
    try {
      status.textContent = "Picking canon from the whole story…";
      refresh();
      const result = await summarizer.rebuildCanon();
      // The pick is in the chat; the next turn puts it in the prompt, at the one
      // prefix break the user just chose (D-0104).
      if (result.ok) assembler.forceRebuild();
      status.textContent = rebuildText(result);
    } catch (err) {
      warn("Could not rebuild canon.", err);
      status.textContent = "The rebuild stopped with an error; see the console.";
      toast("Cairn could not rebuild canon. The canon you had is unchanged.");
    } finally {
      refresh();
    }
  });

  edit.addEventListener("click", async () => {
    if (summarizer.rebuildingCanon || summarizer.adopting) return;
    try {
      const result = await openCanonEditor(getContext, summarizer);
      // One prefix break for the whole visit, on the next message (D-0110).
      if (result.written) assembler.forceRebuild();
      if (result.text) status.textContent = result.text;
    } catch (err) {
      warn("Could not edit canon.", err);
      toast("Cairn could not save your canon changes. The canon you had is unchanged.");
    } finally {
      refresh();
    }
  });

  refresh();
  return {
    refresh,
    /** A new chat's canon is its own; last chat's status line is not about it. */
    reset() {
      status.textContent = "";
      refresh();
    },
  };
}
