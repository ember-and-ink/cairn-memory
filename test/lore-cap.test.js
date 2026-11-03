import { describe, expect, it } from 'vitest';
import { DEFAULT_LORE_FRACTION, createLoreCap, loreCapTokens } from '../src/prompt/lore-cap.js';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/settings.js';
import { SETTINGS_V1 } from './fixtures/settings-v1.js';
import { makeWorldInfoModule } from './mocks/world-info.js';

/**
 * The lorebook cap (docs/decisions.md D-0069).
 *
 * Cairn writes ST's own `world_info_budget_cap` rather than keeping a private
 * number, because the reserve reads that export live (`prompt/reserves.js`,
 * D-0016) and ST's scan obeys nothing else. So the thing worth testing is that
 * the write lands where the reserve will read it, and that every way it can fail
 * leaves the lorebook with the budget it already had.
 */
function setup({ budgetCap = 0, ...rest } = {}) {
    const worldInfo = makeWorldInfoModule({ budgetCap, ...rest });
    const doc = {
        fields: new Map(),
        getElementById(id) {
            return this.fields.get(id) ?? null;
        },
    };
    doc.fields.set('world_info_budget_cap', { value: '0' });
    doc.fields.set('world_info_budget_cap_counter', { value: '0' });
    const loreCap = createLoreCap({ load: async () => worldInfo, doc });
    return { worldInfo, doc, loreCap };
}

describe('the lorebook cap', () => {
    it('writes the cap where the reserve reads it', async () => {
        const { worldInfo, loreCap } = setup();

        await loreCap.apply(3_500);

        expect(worldInfo.world_info_budget_cap).toBe(3_500);
        expect(loreCap.applied).toBe(3_500);
    });

    it('leaves ST alone when the value is already there', async () => {
        // The bootstrap applies it on every load. Writing it each time would save
        // settings on every page load for no change at all.
        const { worldInfo, loreCap } = setup({ budgetCap: 3_500 });

        await loreCap.apply(3_500);

        expect(worldInfo.saves).toBe(0);
        expect(loreCap.applied).toBe(3_500);
    });

    it('takes 0 as "no cap", which is what ST means by it', async () => {
        const { worldInfo, loreCap } = setup({ budgetCap: 3_500 });

        await loreCap.apply(0);

        expect(worldInfo.world_info_budget_cap).toBe(0);
    });

    it('brings ST\'s own field up to date, so its panel does not lie', async () => {
        // world-info.js:989 — ST sets that field from the stored value on load and
        // never again, so a write behind it leaves the number on screen stale.
        const { doc, loreCap } = setup();

        await loreCap.apply(3_500);

        expect(doc.getElementById('world_info_budget_cap').value).toBe('3500');
        expect(doc.getElementById('world_info_budget_cap_counter').value).toBe('3500');
    });

    it('refuses a value that is not a number, rather than capping at nothing', async () => {
        const { worldInfo, loreCap } = setup({ budgetCap: 3_500 });

        for (const bad of [undefined, null, NaN, 'lots', {}]) {
            await loreCap.apply(bad);
            expect(worldInfo.world_info_budget_cap).toBe(3_500);
        }
    });

    it('clamps a negative cap to no cap instead of writing one', async () => {
        const { worldInfo, loreCap } = setup({ budgetCap: 3_500 });

        await loreCap.apply(-200);

        expect(worldInfo.world_info_budget_cap).toBe(0);
    });

    it('rounds a fractional cap down to whole tokens', async () => {
        const { worldInfo, loreCap } = setup();

        await loreCap.apply(3_500.9);

        expect(worldInfo.world_info_budget_cap).toBe(3_500);
    });

    it('leaves the lorebook as it was when ST cannot be reached', async () => {
        // CLAUDE.md §4.17: a failed import degrades to ST's own behaviour, which
        // is the budget it already had — never to a cap of zero tokens.
        const loreCap = createLoreCap({
            load: async () => { throw new Error('no world-info module'); },
            doc: null,
        });

        await expect(loreCap.apply(3_500)).resolves.toBeNull();
        expect(loreCap.applied).toBeNull();
    });

    it('works with no document at all, as it would outside a browser', async () => {
        const worldInfo = makeWorldInfoModule({});
        const loreCap = createLoreCap({ load: async () => worldInfo, doc: undefined });

        await loreCap.apply(3_500);

        expect(worldInfo.world_info_budget_cap).toBe(3_500);
    });
});

/** D-0098: the cap is a share of this context, Cairn owns ST's field while on, and gives it back. */
describe('the lorebook cap as a share of the prompt', () => {
    function syncing({ budgetCap = 0, maxPrompt = 32_000, ...config } = {}) {
        const worldInfo = makeWorldInfoModule({ budgetCap });
        const settings = { enabled: true, loreFraction: DEFAULT_LORE_FRACTION, loreCapBefore: null, ...config };
        let saves = 0;
        let prompt = maxPrompt;
        const loreCap = createLoreCap({
            load: async () => worldInfo,
            doc: undefined,
            maxPromptTokens: async () => prompt,
            settings: () => settings,
            save: () => { saves += 1; },
        });
        return { worldInfo, settings, loreCap, saves: () => saves, setPrompt: (tokens) => { prompt = tokens; } };
    }

    it('is 11% of the max prompt, which is D-0069\'s 3,500 at 32k', () => {
        expect(loreCapTokens(32_000, DEFAULT_LORE_FRACTION)).toBe(3_520);
        expect(loreCapTokens(128_000, DEFAULT_LORE_FRACTION)).toBe(14_080);
        expect(loreCapTokens(0, DEFAULT_LORE_FRACTION)).toBe(0);
        expect(loreCapTokens(32_000, 0)).toBe(0);
    });

    it('writes the share of this context, and follows the context when it changes', async () => {
        const { worldInfo, loreCap, setPrompt } = syncing();

        await loreCap.sync({});
        expect(worldInfo.world_info_budget_cap).toBe(3_520);

        setPrompt(128_000);
        await loreCap.sync({});
        expect(worldInfo.world_info_budget_cap).toBe(14_080);
    });

    it('remembers what ST had before its first write, once', async () => {
        const { settings, loreCap, saves } = syncing({ budgetCap: 6_000 });

        await loreCap.sync({});
        await loreCap.sync({});

        expect(settings.loreCapBefore).toBe(6_000);
        expect(saves()).toBe(1);
    });

    it('gives ST its own cap back when turned off', async () => {
        const { worldInfo, settings, loreCap } = syncing({ budgetCap: 6_000 });
        await loreCap.sync({});

        settings.enabled = false;
        await loreCap.sync({});

        expect(worldInfo.world_info_budget_cap).toBe(6_000);
        expect(settings.loreCapBefore).toBeNull();
        expect(loreCap.applied).toBeNull();
    });

    it('gives it back at a share of 0, and then leaves the field alone', async () => {
        const { worldInfo, settings, loreCap } = syncing();
        await loreCap.sync({});

        settings.loreFraction = 0;
        await loreCap.sync({});
        expect(worldInfo.world_info_budget_cap).toBe(0);

        worldInfo.updateWorldInfoSettings({ world_info_budget_cap: 9_000 });
        await loreCap.sync({});
        expect(worldInfo.world_info_budget_cap).toBe(9_000);
    });

    it('never touches ST while off, if it never set the cap', async () => {
        const { worldInfo, settings, loreCap } = syncing({ budgetCap: 9_000, enabled: false });

        await loreCap.sync({});

        expect(worldInfo.world_info_budget_cap).toBe(9_000);
        expect(settings.loreCapBefore).toBeNull();
    });

    it('overwrites a hand edit while on: the field is Cairn\'s until it is turned off', async () => {
        const { worldInfo, loreCap } = syncing();
        await loreCap.sync({});

        worldInfo.updateWorldInfoSettings({ world_info_budget_cap: 1_000 });
        await loreCap.sync({});

        expect(worldInfo.world_info_budget_cap).toBe(3_520);
    });
});

describe('the lorebook cap as a setting', () => {
    it('ships as a share, because ST ships without a cap', () => {
        expect(DEFAULT_SETTINGS.loreFraction).toBe(DEFAULT_LORE_FRACTION);
        expect(DEFAULT_LORE_FRACTION).toBe(0.11);
        expect(DEFAULT_SETTINGS.loreCapBefore).toBeNull();
        expect('loreCap' in DEFAULT_SETTINGS).toBe(false);
    });

    it('migrates a v1 token cap to the default share, restoring to ST\'s shipped 0', () => {
        const migrated = migrateSettings(SETTINGS_V1);

        expect(migrated.version).toBe(2);
        expect(migrated.loreFraction).toBe(DEFAULT_LORE_FRACTION);
        expect(migrated.loreCapBefore).toBe(0);
        expect('loreCap' in migrated).toBe(false);
        expect(migrated.memoryProfileId).toBe('profile-a');
    });

    it('keeps a v1 "leave ST alone" as a share of 0, with nothing to restore', () => {
        const migrated = migrateSettings({ ...SETTINGS_V1, loreCap: 0 });

        expect(migrated.loreFraction).toBe(0);
        expect(migrated.loreCapBefore).toBeNull();
    });

    it('carries a stored diagnostic choice over rather than the new default', () => {
        // logToDisk now ships off; an install that had it on keeps it on.
        expect(migrateSettings(SETTINGS_V1).logToDisk).toBe(true);
        expect(DEFAULT_SETTINGS.logToDisk).toBe(false);
    });
});
