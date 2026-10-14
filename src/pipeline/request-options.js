/**
 * What Cairn asks of every memory request, whatever the profile's preset says
 * (docs/decisions.md D-0086).
 *
 * Summaries, records, state and canon are short readings of short text, and a
 * reasoning model spends its whole token budget thinking about them: on OpenRouter
 * that reasoning is hidden and billed, and the reply comes back empty or cut off.
 * So Cairn asks for none. ST forwards the override into the request body
 * (public/scripts/extensions/shared.js:460) ahead of the preset
 * (public/scripts/custom-request.js:605).
 *
 * Pure: the context and profile come in.
 */

/** The value ST itself sends to OpenRouter for "Minimum" with thoughts hidden (public/scripts/openai.js:2618-2620). */
export const NO_REASONING = 'none';

/**
 * What to ask for, in order. Some OpenRouter endpoints cannot turn reasoning off and
 * refuse `none` outright ("Reasoning is mandatory for this endpoint"); `low` still
 * keeps the thinking short. Past the last, the request goes out as the preset has it.
 */
export const EFFORTS = [NO_REASONING, 'low'];

/**
 * The efforts to try for the `memoryReasoning` setting, most restrained first: it is
 * where the ladder starts, and `preset` asks nothing at all.
 *
 * @param {string} [setting]
 * @returns {string[]}
 */
export function effortsFor(setting = NO_REASONING) {
    if (setting === 'preset') return [];
    const start = EFFORTS.indexOf(setting);
    return EFFORTS.slice(start < 0 ? 0 : start);
}

/**
 * @param {object} context `SillyTavern.getContext()`
 * @param {string} [memoryProfileId]
 * @returns {object|null} The Connection Manager profile, or null.
 */
export function memoryProfile(context, memoryProfileId) {
    if (!memoryProfileId) return null;
    const profiles = context?.extensionSettings?.connectionManager?.profiles ?? [];
    return profiles.find((profile) => profile.id === memoryProfileId) ?? null;
}

/**
 * The chat completion source a profile sends to, as ST resolves it
 * (public/scripts/slash-commands.js:191, exposed at public/scripts/st-context.js:285).
 *
 * @returns {string|null}
 */
export function profileSource(context, profile) {
    if (!profile?.api) return null;
    return context?.CONNECT_API_MAP?.[profile.api]?.source ?? null;
}

/**
 * The fields Cairn adds to a memory request's body. Only OpenRouter is asked:
 * its backend passes `reasoning_effort` on as `reasoning.effort`
 * (src/endpoints/backends/chat-completions.js:2349), while other sources forward it
 * as it is and not every provider accepts `none`. A custom endpoint turns reasoning
 * off in its own request body, as the profile's preset already can.
 *
 * @param {Set<string>} [refused] Efforts this profile's model has refused.
 * @param {string} [setting] The `memoryReasoning` setting: where the ladder starts.
 * @returns {{reasoning_effort?: string}}
 */
export function requestOverrides(context, profile, refused = new Set(), setting = NO_REASONING) {
    if (profileSource(context, profile) !== 'openrouter') return {};
    const effort = effortsFor(setting).find((value) => !refused.has(value));
    return effort ? { reasoning_effort: effort } : {};
}

/**
 * Said ahead of every memory request while `fictionFrame` is on (docs/decisions.md D-0095).
 * It says what the material is and nothing else: a model that declines the story knowing
 * it is fiction is not argued with.
 */
export const FICTION_FRAME = 'The material in this request comes from a work of collaborative fiction: an interactive story that a writer and an AI storyteller are writing together in SillyTavern, a roleplay application. Its characters, places and events are invented, and nothing in it happened to anyone real. The task that follows is bookkeeping for that story: recording what happens in it so that it can be continued consistently. It does not ask you to write any of the story.';

/**
 * A request's messages with the frame ahead of them as a system message. Chat completion
 * sends it as it is (public/scripts/extensions/shared.js:443); text completion formats it
 * as the instruct preset's system turn (public/scripts/custom-request.js:232,
 * public/scripts/instruct-mode.js:396-397).
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {boolean} [setting] The `fictionFrame` setting; only `false` leaves the frame out.
 */
export function framedMessages(messages, setting) {
    return setting === false ? messages : [{ role: 'system', content: FICTION_FRAME }, ...messages];
}

/** Refusals are remembered per profile and model: another model on the same profile may accept. */
export function refusalKey(profile) {
    return `${profile?.id ?? ''}\n${profile?.model ?? ''}`;
}

/**
 * Whether a failed request was refused as malformed. ST's server hands the browser only
 * the HTTP status text (src/endpoints/backends/chat-completions.js:2705-2710), wrapped
 * once more by `sendRequest` (public/scripts/extensions/shared.js:490), so the provider's
 * own reason is not visible here — only that it was a 400.
 */
export function isBadRequest(err) {
    for (let at = err, depth = 0; at && depth < 5; at = at.cause, depth++) {
        if (/bad request/i.test(String(at.message ?? ''))) return true;
    }
    return false;
}
