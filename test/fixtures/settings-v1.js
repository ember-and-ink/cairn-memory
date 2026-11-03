/**
 * Cairn's settings at SETTINGS_VERSION 1, written out by hand (CLAUDE.md §8.32).
 *
 * A literal, never generated from DEFAULT_SETTINGS: when the settings shape changes
 * this file stays behind as the old shape, and the migration is tested against it.
 * The keys are the v1 defaults as an install saved them; the lorebook cap was a
 * token count, written into ST's `world_info_budget_cap` (D-0069).
 */
export const SETTINGS_V1 = Object.freeze({
    version: 1,
    enabled: true,
    memoryProfileId: 'profile-a',
    summaryPrompt: '',
    indexPrompt: '',
    canonPrompt: '',
    statePrompt: '',
    showInspector: true,
    debugLogging: false,
    logToDisk: true,
    holdWorldInfo: true,
    ownMemoryBlock: true,
    worldState: true,
    keepCanon: true,
    canonSlots: 10,
    dropExamples: true,
    loreCap: 3500,
    memoryFraction: 0.35,
    canonFraction: 0.2,
    compactFraction: 0.2,
    rawWindow: 8,
    step: 8,
    memoryReasoning: 'none',
    reasoningRefused: {},
    fictionFrame: true,
});
