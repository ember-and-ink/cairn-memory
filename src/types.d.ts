// Ambient types for `task lint-typing`: tsc over the shipped JavaScript (docs/decisions.md D-0109).
// Type-only. manifest.json never lists this file, so SillyTavern never loads it.
//
// The ST shapes are the subset Cairn depends on, the same subset test/mocks/sillytavern.js
// mirrors. Each is cited against the pinned checkout in docs/st-api-surface.md, not here:
// a field added below without a row there is an undeclared dependency.

// ---- SillyTavern ----

/** One entry of ST's `chat`. */
interface StMessage {
  name?: string;
  is_user?: boolean;
  /** ST hides a message by setting this (public/scripts/chats.js:157). */
  is_system?: boolean;
  mes: string;
  send_date?: string;
  swipe_id?: number;
  swipes?: string[];
  extra?: StMessageExtra;
}

/** `message.extra`. Other extensions keep their own keys here, which Cairn reads but never types. */
interface StMessageExtra {
  /** Unknown until store/schema.js `migrateStore` reads it. */
  cairn?: unknown;
  [key: string]: any;
  /** ST's ignore flag lives under a symbol (`symbols.ignore`). */
  [key: symbol]: any;
}

interface StConnectionProfile {
  id: string;
  name?: string;
  api?: string;
  preset?: string;
  model?: string;
  [key: string]: any;
}

/** `extension_settings`: Cairn's own slot and the two of ST's it reads. */
interface StExtensionSettings {
  cairn?: CairnSettings;
  disabledExtensions?: string[];
  connectionManager?: { profiles?: StConnectionProfile[]; selectedProfile?: string | null };
  [key: string]: any;
}

interface StExtensionPrompt {
  value: string;
  position: number;
  depth: number;
  scan: boolean;
  role: number;
  filter: (() => boolean | Promise<boolean>) | null;
}

interface StEventSource {
  on(type: string, listener: (...args: any[]) => unknown): void;
  removeListener(type: string, listener: (...args: any[]) => unknown): void;
  emit(type: string, ...args: unknown[]): Promise<void>;
}

/**
 * The subset of `SillyTavern.getContext()` Cairn depends on. Optional only where ST can
 * leave it out: no chat open, no group, no stream, the Connection Manager disabled.
 */
interface StContext {
  chat: StMessage[];
  chatId?: string;
  chatMetadata: Record<string, any>;
  name1: string;
  name2: string;
  characterId: number | string;
  groupId?: string | null;
  maxContext: number;
  mainApi: string;
  eventSource: StEventSource;
  eventTypes: Record<string, string>;
  streamingProcessor?: { isFinished?: boolean } | null;
  extensionSettings: StExtensionSettings;
  extensionPrompts: Record<string, StExtensionPrompt>;
  /**
   * `position` and `depth` have no defaults in ST; left out they are stored as NaN, which
   * an empty value never reaches. ST's own clears pass NONE and a depth
   * (public/scripts/authors-note.js:352).
   */
  setExtensionPrompt(
    key: string,
    value: string,
    position?: number,
    depth?: number,
    scan?: boolean,
    role?: number,
    filter?: StExtensionPrompt["filter"],
  ): void;
  getExtensionManifest(name: string): object | null;
  ConnectionManagerRequestService?: {
    sendRequest(
      profileId: string,
      prompt: unknown,
      maxTokens: number,
      ...rest: unknown[]
    ): Promise<any>;
  } | null;
  CONNECT_API_MAP: Record<string, { selected: string; source?: string; type?: string }>;
  substituteParams(content: string, ...rest: unknown[]): string;
  substituteParamsExtended(content: string, additionalMacro?: Record<string, unknown>): string;
  symbols: { ignore: symbol };
  getCharacterCardFields(): Record<string, any>;
  powerUserSettings: Record<string, any>;
  getTokenCountAsync(text: string, padding?: number): Promise<number>;
  getRequestHeaders(): Record<string, string>;
  renderExtensionTemplateAsync(extension: string, template: string, data?: object): Promise<string>;
  saveSettingsDebounced(): void;
  saveMetadataDebounced(): void;
  saveChat(): Promise<void>;
  callGenericPopup(
    content: string,
    type: number,
    inputValue?: string,
    options?: object,
  ): Promise<any>;
  Popup: new (
    content: string,
    type: number,
    inputValue?: string,
    options?: object,
  ) => {
    show(): Promise<any>;
    [key: string]: any;
  };
  POPUP_TYPE: Record<string, number>;
  POPUP_RESULT: Record<string, number | null>;
}

declare const SillyTavern: { getContext(): StContext };

declare const toastr: {
  success(message: string, title?: string, options?: object): unknown;
  info(message: string, title?: string, options?: object): unknown;
  warning(message: string, title?: string, options?: object): unknown;
  error(message: string, title?: string, options?: object): unknown;
};

/** A World Info entry as WORLD_INFO_ACTIVATED hands it over (prompt/lorebook.js). */
interface StWorldInfoEntry {
  uid?: number | string;
  world?: string;
  order?: number;
  content?: string;
  ignoreBudget?: boolean;
  [key: string]: any;
}

// ST's own modules, imported by URL at run time (util/st-modules.js). Interfaces rather
// than `declare module`: TypeScript reads a specifier starting with "/" as a file path.
interface StScriptModule {
  getMaxPromptTokens(): number;
}
interface StWorldInfoModule {
  world_info_budget: number;
  world_info_budget_cap: number;
  getSortedEntries(): Promise<any[]>;
  updateWorldInfoSettings(settings: object, data?: object): void;
}

// ---- The standard library ----

/** True only for a number, so the checks below narrow as they do at run time. */
interface NumberConstructor {
  isInteger(number: unknown): number is number;
  isFinite(number: unknown): number is number;
}

// ---- Cairn ----

/** A frozen default's literal type, widened to what the setting can hold. */
type Widened<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T;

type CairnSettings = Omit<
  {
    -readonly [K in keyof typeof import("./settings.js").DEFAULT_SETTINGS]: Widened<
      (typeof import("./settings.js").DEFAULT_SETTINGS)[K]
    >;
  },
  "loreCapBefore" | "reasoningRefused"
> & {
  loreCapBefore: number | null;
  /** Efforts a model refused, by `refusalKey` (D-0088). */
  reasoningRefused: Record<string, string[]>;
};

/** A summary, on the message it summarises (store/chat-store.js). */
interface CairnScene {
  text: string;
  hash: string;
  prompt: string;
  at: string;
  edited?: boolean;
}

/** The world state's value (memory/state-schema.js): top-level text, and characters by name. */
interface WorldState {
  location?: string;
  weather?: string;
  characters?: Record<string, { hair?: string; outfit?: string }>;
}

interface CairnState {
  value: WorldState;
  read: number;
  hash: string;
  changed: string[];
  prompt: string;
  at: string;
  edited?: boolean;
}

interface CanonFact {
  text: string;
  entities: string[];
  from: number[];
  clipped?: true;
  /** The user rewrote it (D-0110). */
  edited?: boolean;
}

/** A fact the user pinned, on the chat's metadata (store/chat-store.js `readPins`). */
interface CanonPin {
  text: string;
  from: number[];
  edited?: true;
}

interface CairnCanon {
  facts: CanonFact[];
  runnersUp?: CanonFact[];
  covers: [number, number];
  slots?: number;
  prompt: string;
  at: string;
}

/** One index record (memory/index-record.js `validRecord`). */
interface IndexRecord {
  /** One of index-record.js `KINDS`. */
  kind: string;
  who: string[];
  what: string;
  changed: string;
  because: string;
  background: string;
  line: string;
}

interface CairnIndexEntry {
  record: IndexRecord;
  hash: string;
  prompt: string;
  at: string;
}

/** One summary as memory/scenes.js `readScenes` reads it, from Cairn's store or qvink's. */
interface SceneEntry {
  index: number;
  source: "cairn" | "qvink";
  text: string;
  chars: number;
  /** Cairn's own only (D-0099). */
  edited?: boolean;
  eligible: boolean;
  remembered: boolean;
  excluded: boolean;
  include: string | null;
  lagging: boolean;
}

/** `message.extra.cairn` at the current STORE_VERSION. */
interface CairnStore {
  v: number;
  scene?: CairnScene;
  state?: CairnState;
  canon?: CairnCanon;
  index?: CairnIndexEntry;
}

// ---- Memory work (pipeline/) ----

/** What every kind of memory work counts (pipeline/tally.js); a kind adds its own counters. */
interface TallyStats {
  calls: number;
  written: number;
  failures: number;
  lastReason: string | null;
  lastMs: number | null;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  discarded: number;
  lastDiscard: string | null;
}

/** One kind of memory work, as pipeline/job.js `createJob` takes it. `W` is one job's work. */
interface JobKind<W, C extends Record<string, number> = {}> {
  log: string;
  name: string;
  article: string;
  counters?: C;
  key(chatId: string, work: W): string;
  failed(work: W, at?: number): string;
  gaveUp(work: W, at: number | undefined, count: number): string;
}

/** A strategy's built request: what the memory model is sent. */
interface MemoryRequest {
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  [key: string]: any;
}

/** What came back from Connection Manager's `sendRequest`. */
interface MemoryReply {
  content?: unknown;
  [key: string]: any;
}

/** The summarizer's transport (pipeline/summarizer.js `send`). */
type SendMemory = (
  context: StContext,
  memoryProfileId: string | undefined,
  built: MemoryRequest,
  job: any,
  index?: number,
) => Promise<{ reply?: MemoryReply; error?: unknown; signal: AbortSignal }>;

/** One world-state update (memory/state.js `stateJobAt`). */
interface StateWork {
  index: number;
  message: StMessage;
  read: number;
  hash: string;
  messages: StMessage[];
  state: WorldState;
  baseIndex: number | null;
  earlier: string[];
}

/** One index record with the message it sits beside (pipeline/index-reads.js). */
interface IndexedRecord {
  index: number;
  record: IndexRecord;
}

/** A canon pick that is due, and what it reads (pipeline/canon-pick.js `pendingPick`). */
interface CanonPickWork {
  due: true;
  reason: string;
  records: IndexedRecord[];
  covers: [number, number];
  /** What the pick is asked to fill: the setting less the pins (D-0110). */
  slots: number;
}

/** A fact the pick is shown as the canon so far (pipeline/canon-pick.js `carriedCanon`). */
interface CarriedFact {
  text: string;
  rows: number[];
  edited?: true;
}

/** The assembler's compaction pass for the turn just planned (prompt/assembler.js `pendingPass`). */
type PendingPass = (CanonPickWork | { due: false; reason: string; covers: null; slots: number }) & {
  writing: boolean;
  records: Array<IndexedRecord & { message: StMessage }>;
  message: StMessage | null;
  previous: CarriedFact[];
};

// ---- The prompt (prompt/) ----

/** One writer in ST's extension-prompt bag (prompt/inventory.js `buildInventory`). */
interface InventoryEntry {
  tokens: number;
  estimated: boolean;
  key: string;
  owner: string;
  label: string;
  position: number;
  positionName: string;
  placed: boolean;
  depth: number;
  role: number;
  chars: number;
}

/** An inventory entry found in the flattened prompt (prompt/locate.js `locateInjections`). */
interface LocatedInjection extends InventoryEntry {
  offset: number | null;
  endOffset: number | null;
  offsetPercent: number | null;
  match: string;
  ambiguous: boolean;
}

// ---- What the UI reads ----

type Summarizer = ReturnType<typeof import("./pipeline/summarizer.js").createSummarizer>;
/** The summarizer's `status`: per-kind tallies, gates and work, for the panel and the marks. */
type SummarizerStatus = Summarizer["status"];
type Assembler = ReturnType<typeof import("./prompt/assembler.js").createAssembler>;
