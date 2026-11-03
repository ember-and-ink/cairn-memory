/**
 * The lorebook cap (docs/decisions.md D-0069, D-0098).
 *
 * SillyTavern already caps World Info absolutely — `world_info_budget_cap`,
 * `public/scripts/world-info.js:81` — and ships it at 0, meaning no cap, so the
 * percentage budget is all that ever binds. On the P4 run's book that was 21.6%
 * of the prompt against a 25% default: it had never bound either. The lorebook
 * was the second largest reserve, larger than the card, and nothing was holding
 * it to anything. Cairn sets the number ST left off; the trim in
 * `prompt/lorebook.js` decides *when* the held set is brought back under it.
 *
 * **Why Cairn writes ST's setting rather than keeping a cap of its own.** The
 * reserve is worked out from `world_info_budget_cap` as a live export
 * (`prompt/reserves.js`, D-0016). A private cap would trim what Cairn holds while
 * the reserve still counted ST's larger budget, so the reclaim would vanish into
 * the margin with nothing to see — the same failure the card and the examples
 * latch have to agree about (D-0068) — and ST would keep adding keyword hits past
 * it regardless, because the scan's budget is the only thing the scan obeys.
 *
 * **It persists, and that is the deal.** `updateWorldInfoSettings` ends in
 * `saveSettingsDebounced()` (`:819`, `:852`), and the setting is global rather
 * than per-chat, so unlike the examples latch there is no version of this that
 * lasts only for the session.
 *
 * **A share of the max prompt, not a token count** (D-0098). The cap is worked out
 * from the context each generation, so a 128k context gets four times a 32k one's.
 * While Cairn is on it owns ST's field; off, or at 0, ST gets back what it had.
 */
import { createMaxPromptTokens } from '../util/context-size.js';
import { warn } from '../util/log.js';
import { loadWorldInfo } from '../util/st-modules.js';

/**
 * Cairn's default share of the max prompt. 11% of a 32k context is the 3,500 tokens
 * D-0069 sized from the P4 run (a 4,982-token book in a 23,040-token prompt), so a
 * 32k chat is unchanged and a larger context scales with it (D-0098).
 */
export const DEFAULT_LORE_FRACTION = 0.11;

/** The cap a share gives, in whole tokens. 0 for anything that is not a usable share. */
export function loreCapTokens(maxPromptTokens, fraction) {
    if (!(maxPromptTokens > 0) || !(fraction > 0) || fraction > 1) return 0;
    return Math.floor(maxPromptTokens * fraction);
}

/**
 * @param {{load?: () => Promise<object>, doc?: object, maxPromptTokens?: Function,
 *          settings?: () => object, save?: () => void}} [options]
 *        `load` is injected in tests; there is no `/scripts/world-info.js`
 *        outside the browser. `settings` is Cairn's live settings object, which
 *        holds `loreFraction`, `enabled` and `loreCapBefore`.
 */
export function createLoreCap({
    load = loadWorldInfo,
    doc = globalThis.document,
    maxPromptTokens = createMaxPromptTokens(),
    settings = () => ({}),
    save = () => {},
} = {}) {
    let applied = null;

    /**
     * @param {number} cap Tokens; 0 leaves ST's own budget alone, as ST's own 0 does.
     * @returns {Promise<number|null>} What was applied, or null when nothing was.
     */
    async function apply(cap) {
        // `Number(null)` and `Number('')` are both 0, and 0 here means *uncap the
        // lorebook* — so a missing setting or a blanked box would quietly undo the
        // cap rather than be refused. Only a real number counts as one.
        const raw = typeof cap === 'string' ? cap.trim() : cap;
        if (raw === '' || raw === null || raw === undefined || typeof raw === 'boolean') return applied;
        const wanted = Number(raw);
        if (!Number.isFinite(wanted)) return applied;

        try {
            const worldInfo = await load();
            const floored = Math.max(0, Math.floor(wanted));
            if (worldInfo.world_info_budget_cap === floored) {
                applied = floored;
                return applied;
            }
            worldInfo.updateWorldInfoSettings({ world_info_budget_cap: floored });
            // ST's own field would otherwise read whatever it last loaded
            // (world-info.js:989). Written, not triggered — `updateWorldInfoSettings`
            // has already saved, and the field's own handler would save again.
            const input = doc?.getElementById?.('world_info_budget_cap');
            if (input) input.value = String(floored);
            const counter = doc?.getElementById?.('world_info_budget_cap_counter');
            if (counter) counter.value = String(floored);
            applied = floored;
        } catch (err) {
            // The lorebook keeps whatever budget it had, which is ST's own
            // behaviour without Cairn installed (CLAUDE.md §4.17).
            warn('Could not set the World Info budget cap; the lorebook keeps its own budget.', err);
        }
        return applied;
    }

    /**
     * Bring ST's cap in line with the settings: the share of this context while Cairn is
     * on, or ST's own value back when it is off or the share is 0. Cheap when nothing
     * changed, so it runs every generation, ahead of ST's World Info scan.
     */
    async function sync(context) {
        const config = settings();
        const fraction = Number(config.loreFraction);
        if (config.enabled === false || !(fraction > 0)) return restore();

        const target = loreCapTokens(await maxPromptTokens(context), fraction);
        if (!(target > 0)) return applied;
        if (config.loreCapBefore === null || config.loreCapBefore === undefined) {
            try {
                const before = Number((await load()).world_info_budget_cap);
                config.loreCapBefore = Number.isFinite(before) ? before : 0;
                save();
            } catch (err) {
                warn('Could not read the World Info budget cap; the lorebook keeps its own budget.', err);
                return applied;
            }
        }
        return apply(target);
    }

    /** Give ST back the cap it had before Cairn set one, once. */
    async function restore() {
        const config = settings();
        const before = config.loreCapBefore;
        if (before === null || before === undefined) return applied;
        const result = await apply(before);
        if (result === Math.max(0, Math.floor(Number(before)))) {
            config.loreCapBefore = null;
            save();
            applied = null;
        }
        return applied;
    }

    return {
        apply,
        sync,
        restore,
        /** What Cairn last put there, for the inspector. Null until it has run. */
        get applied() {
            return applied;
        },
    };
}
