/**
 * One kind of memory work: bringing the world state up to the newest message
 * (docs/decisions.md D-0044, D-0053).
 *
 * The queue and the transport are the summarizer's, and the failure policy is the
 * shared job's (pipeline/job.js); what this file owns is the shape of one state update — what it reads,
 * what invalidates it while the request is out, and what is written when it lands.
 *
 * Its counterparts are summary-job.js, index-job.js and canon-job.js.
 */
import { jobStillCurrent, lastSeen, pendingStateJob } from "../memory/state.js";
import { isObject } from "../util/values.js";
import { foldName, mergeReply } from "../memory/state-schema.js";
import { stateRecord } from "../memory/state-strategy.js";
import { writeState } from "../store/chat-store.js";
import { debug } from "../util/log.js";
import { createJob } from "./job.js";
import { MAX_ATTEMPTS } from "./tally.js";

/** What `run` resolves to when the reply was discarded because a message it read changed. */
export const READ_CHANGED = "read-changed";

/**
 * @param {{getContext: () => StContext, send: SendMemory, save: Function, clock: () => number,
 *          strategy?: typeof stateRecord}} machinery The summarizer's transport and shared helpers.
 */
export function createStateJob({ getContext, send, save, clock, strategy = stateRecord }) {
  const job = createJob(
    /** @type {JobKind<StateWork, {dropped: number}>} */ ({
      log: "state",
      name: "state",
      article: "a state update",
      counters: { dropped: 0 },
      /** A state update is tried again once what it reads changes: an edit, or a new message. */
      key: (chatId, work) => `${chatId}\n${work.read}\n${work.hash}`,
      failed: (work, at = work.index) => `The world state update through message #${at}`,
      gaveUp: (work, at = work.index, count) =>
        `Gave up on the world state through message #${at} after ${count} failures. The previous state stays in the prompt until a new message arrives.`,
    }),
    { send },
  );
  const states = job.tally;

  return {
    job,
    tally: states,

    /** The next update, or null when the newest visible message already carries one. */
    pending: (chat) => pendingStateJob(chat),

    givenUp: job.givenUp,

    /** Forget a job's failures, so a rebuild the user asked for is tried at all. */
    forget: job.forget,

    /**
     * One update. Its outcome is only recorded: a failing state must not starve summaries.
     *
     * @param {StContext} context
     * @param {Partial<CairnSettings>} settings
     */
    async run(context, { memoryProfileId, statePrompt }, work) {
      const { chatId } = context;
      const sent = await job.request(context, memoryProfileId, work, work.index, () =>
        strategy.build({
          template: statePrompt,
          state: work.state,
          messages: work.messages,
          earlier: work.earlier,
          expand: (text) => context.substituteParams(text),
        }),
      );
      if (!sent) return false;

      // Found by identity and checked against the hash of what was read, so an edit,
      // hide, deletion, swipe, continue or chat change meanwhile discards the reply.
      const now = getContext();
      const index = jobStillCurrent(now.chat, work);
      if (index < 0) {
        if (!now.chat?.includes(work.message))
          return job.discard(work.index, "its message is no longer in the chat");
        job.discard(work.index, "a message it read changed");
        return READ_CHANGED;
      }

      const parsed = strategy.parse(sent.reply?.content);
      if (!parsed.ok) return job.fail(chatId, work, parsed.reason, undefined, index);
      // Anyone the reply lists who is not in the record starts from how they were
      // last seen, so leaving and coming back costs no hair or outfit (D-0103).
      // Read back from just before this message, found by identity above, so a
      // deletion while the request was out cannot shift where it looks.
      const present = new Set(Object.keys(work.state.characters ?? {}).map(foldName));
      const returning = Object.keys(
        isObject(parsed.record.characters) ? parsed.record.characters : {},
      ).filter((name) => !present.has(foldName(name)));
      const known = returning.length ? lastSeen(now.chat, index - 1, returning) : {};
      const { value, changed, dropped } = mergeReply(work.state, parsed.record, { known });
      if (dropped.length) {
        states.stats.dropped += dropped.length;
        debug(
          `Dropped from the state reply: ${dropped.map((drop) => `${drop.field} (${drop.reason})`).join(", ")}.`,
        );
      }
      if (
        !writeState(now.chat, index, {
          value,
          read: work.read,
          changed,
          prompt: sent.request.prompt,
          at: new Date(clock()).toISOString(),
        })
      ) {
        return job.fail(chatId, work, "write", undefined, index);
      }

      job.succeed(chatId, work);
      debug(
        `Brought the state up to message #${index}: ${changed.length ? changed.join(", ") : "no change"}.`,
      );
      await save(now, "the state");
      return true;
    },

    /** One job at a time, so no lists. */
    status: (gate) =>
      job.status(
        gate,
        (status) => {
          const { chat, chatId } = getContext();
          const work = pendingStateJob(chat);
          status.pending = Boolean(work);
          const record = work ? job.record(chatId, work) : undefined;
          if (record && work) {
            status.failed = { index: work.index, attempts: record.count, reason: record.reason };
            status.givenUp = record.count >= MAX_ATTEMPTS;
          }
        },
        { tracker: gate.tracker },
      ),
  };
}
