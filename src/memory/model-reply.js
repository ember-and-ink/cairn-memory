/**
 * Cleanup every memory strategy's parser does first: reasoning that leaked into
 * the content, a code fence, and a refusal in place of output
 * (docs/decisions.md D-0037, D-0044). The JSON parsers start from `readJsonReply`.
 *
 * Pure: text in, text out.
 */

/** A parser's refusal of a reply: why it could not be read. */
export function reject(reason) {
    return { ok: false, reason };
}

const REFUSAL = /^(?:I'?m sorry|I am sorry|sorry\b|I apologi[sz]e|I can(?:not|'t)\b|I won't\b|I will not\b|I'?m (?:not able|unable)|I am (?:not able|unable)|as an AI\b|I must decline|I'?m afraid)/i;

/**
 * Remove `<think>` blocks from a reply.
 *
 * @param {unknown} content The reply's `content`; anything but a string is empty.
 * @returns {{truncated: boolean, text: string}} `truncated` when the tokens ran out mid-thought.
 */
export function stripThinking(content) {
    let text = typeof content === 'string' ? content : '';

    if (/^\s*<think>/i.test(text) && !/<\/think>/i.test(text)) return { truncated: true, text: '' };
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // The chat template opened the block in the prompt, so only its close arrived.
    const close = text.search(/<\/think>/i);
    if (close >= 0) text = text.slice(close + '</think>'.length);
    return { truncated: false, text };
}

/** The first closed code fence's body, or the text as it is. */
export function unfence(text) {
    const fence = text.match(/```[^\n]*\n([\s\S]*?)\n?```/);
    return fence ? fence[1] : text;
}

/** Whether text opens like a refusal, however its apostrophes are typed. */
export function looksLikeRefusal(text) {
    return REFUSAL.test(straightQuotes(text.trim()));
}

export function straightQuotes(text) {
    return text.replace(/[‘’]/g, '\'');
}

/**
 * The first bracketed span that parses as JSON. Spans that do not parse, like a
 * `[Current scene]` echoed in a preamble, are skipped whole, so an object nested
 * inside a broken one is never taken for the reply. Not "first `{` to last `}`":
 * that read a preamble's punctuation as structure (docs/decisions.md D-0044).
 * A span that fails is given one `repairJson` before it is skipped (D-0095).
 *
 * `unclosed` is a bracket still open when the reply ends — a cut-off reply, since ST
 * returns no finish reason (public/scripts/custom-request.js:60). A closer of the wrong
 * kind is a malformed reply, not a cut-off one.
 *
 * @param {string} text
 * @returns {{parsed: true, value: unknown} | {parsed: false, unclosed: boolean}}
 */
export function firstJson(text) {
    for (let start = text.search(/[{[]/); start >= 0;) {
        const end = closingIndex(text, start);
        const span = end < 0 ? text.slice(start) : text.slice(start, end + 1);
        const value = parseOrRepair(span);
        if (value.parsed) return value;
        if (end === UNCLOSED) return { parsed: false, unclosed: true };
        if (end === MISMATCHED) return { parsed: false, unclosed: false };
        const next = text.slice(end + 1).search(/[{[]/);
        start = next < 0 ? -1 : end + 1 + next;
    }
    return { parsed: false, unclosed: false };
}

function parseOrRepair(span) {
    for (const candidate of [span, repairJson(span)]) {
        if (candidate === null) continue;
        try {
            return { parsed: true, value: JSON.parse(candidate) };
        } catch {
            // Try the next candidate.
        }
    }
    return { parsed: false };
}

/** Full-width punctuation a model writes in place of JSON's own, outside a string. */
const FULLWIDTH = Object.freeze({ '，': ',', '：': ':' });

/**
 * A finished reply's JSON with the slips a lighter model makes put right (docs/decisions.md
 * D-0095): full-width `，` and `：` between values, and one missing closing bracket. One is a
 * slip; a reply missing two, or stopping inside a string or after anything but a closer, was
 * cut off, and closing it would store half an answer as a whole one.
 *
 * @param {string} text Starts at the opening bracket.
 * @returns {string|null} The repaired JSON, or null when there was nothing this can mend.
 */
export function repairJson(text) {
    const out = [];
    const open = [];
    let inString = false;
    let mended = false;
    let added = 0;
    let last = '';
    for (let i = 0; i < text.length; i++) {
        let ch = text[i];
        if (inString) {
            if (ch === '\\') out.push(ch, text[++i] ?? '');
            else out.push(ch);
            if (ch === '"') inString = false;
            continue;
        }
        if (FULLWIDTH[ch]) {
            ch = FULLWIDTH[ch];
            mended = true;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{' || ch === '[') {
            open.push(ch === '{' ? '}' : ']');
        } else if (ch === '}' || ch === ']') {
            if (!open.includes(ch)) return null;
            // A closer for a bracket further out: the model skipped the inner one's.
            while (open.at(-1) !== ch) {
                out.push(open.pop());
                added++;
            }
            open.pop();
        }
        out.push(ch);
        if (!/\s/.test(ch)) last = ch;
        if (!open.length) break;
    }
    if (open.length) {
        if (inString || (last !== '}' && last !== ']')) return null;
        added += open.length;
        out.push(...open.reverse());
    }
    return (mended || added) && added <= 1 ? out.join('') : null;
}

/**
 * The JSON a structured reply carries, or why it carries none: the cleanup above, then
 * the first span that parses. What the value must look like is each parser's own business.
 *
 * @param {unknown} content The reply's `content`.
 * @returns {{ok: true, value: unknown} | {ok: false, reason: 'empty'|'refusal'|'format'|'truncated'}}
 */
export function readJsonReply(content) {
    const thought = stripThinking(content);
    if (thought.truncated) return reject('truncated');
    const text = unfence(thought.text).trim();
    if (!text) return reject('empty');

    const found = firstJson(text);
    if (found.parsed) return { ok: true, value: found.value };
    if (looksLikeRefusal(text)) return reject('refusal');
    return reject(found.unclosed ? 'truncated' : 'format');
}

const UNCLOSED = -1;
const MISMATCHED = -2;

/**
 * Where the bracket at `start` closes, skipping brackets inside JSON strings: UNCLOSED if
 * it never does, MISMATCHED at a `}` that meets an open `[` or the other way round.
 */
function closingIndex(text, start) {
    const open = [];
    let inString = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (ch === '\\') i++;
            else if (ch === '"') inString = false;
        } else if (ch === '"') {
            inString = true;
        } else if (ch === '{' || ch === '[') {
            open.push(ch === '{' ? '}' : ']');
        } else if (ch === '}' || ch === ']') {
            if (open.pop() !== ch) return MISMATCHED;
            if (!open.length) return i;
        }
    }
    return UNCLOSED;
}

/**
 * Where a reply stopped being JSON, for the log of a failed call (docs/decisions.md
 * D-0094): the engine's own parse error and a short window of the reply around it,
 * because the reason alone cannot tell a cut-off from a stray quote.
 *
 * @param {unknown} content The reply's `content`.
 * @param {number} [span] Characters kept either side of the spot.
 * @returns {{error: string|null, at: number|null, near: string, tail: string}}
 *          `error` is null when a JSON span parsed and only its shape was wrong.
 */
export function describeReply(content, span = 80) {
    const raw = typeof content === 'string' ? content : '';
    const thought = stripThinking(raw);
    const text = thought.truncated ? raw : unfence(thought.text);
    const tail = text.slice(-span);
    const start = text.search(/[{[]/);
    if (start < 0) return { error: 'no JSON', at: null, near: text.slice(0, 2 * span), tail };
    if (firstJson(text).parsed) return { error: null, at: null, near: text.slice(start, start + 2 * span), tail };

    const body = text.slice(start);
    let error = null;
    try {
        JSON.parse(body);
    } catch (err) {
        error = String(err?.message ?? err).slice(0, 200);
    }
    const offset = errorOffset(error, body);
    const at = offset === null ? null : start + offset;
    const near = at === null ? body.slice(0, 2 * span) : text.slice(Math.max(0, at - span), at + span);
    return { error, at, near, tail };
}

/** The offset a JSON.parse message names, as V8 ("position N") or Firefox ("line L column C") word it. */
function errorOffset(message, body) {
    const position = /position (\d+)/.exec(message ?? '');
    if (position) return Number(position[1]);
    const lineColumn = /line (\d+) column (\d+)/.exec(message ?? '');
    if (!lineColumn) return null;
    const lines = body.split('\n').slice(0, Number(lineColumn[1]) - 1);
    return lines.reduce((sum, line) => sum + line.length + 1, 0) + Number(lineColumn[2]) - 1;
}
