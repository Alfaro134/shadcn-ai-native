/**
 * A small, dependency-free Markdown parser for streaming chat. Pure TypeScript with no React or
 * React Native imports: <StreamingChatBubble /> renders its output, and tests run it in Node.
 *
 * Supported (a subset of GitHub Flavored Markdown):
 *   blocks  — paragraphs, # headings (1–6), - * + bullet lists, 1. / 1) ordered lists, nested
 *             lists, - [ ] / - [x] task lists, > blockquotes, --- rules, | tables | with
 *             :--- alignment, ``` and ~~~ code fences
 *   inline  — **bold**, *italic* / _italic_, ***both***, ~~strike~~, `code`, [links](https://…),
 *             ![images](https://…) (as links), <https://autolinks>, bare https:// URLs, \escapes
 *
 * Not supported, rendered as plain text: raw HTML, footnotes, reference-style links
 * ([text][id]), setext headings (underlined with ===), hard line breaks via trailing spaces,
 * nested blockquotes and block content (code, lists) inside blockquotes or list items.
 *
 * Streaming: `parseMarkdown(text, true)` treats the end of `text` as the live tail of a stream.
 * There, an opener without its closer is *pending*: the marker is hidden and its text renders
 * plain until the closer arrives ("**bold" → "bold", "[Google](http…" → "Google"), and a last
 * line that is only a block marker so far ("##", "-", "1.", "|") waits for its content. Outside
 * the tail, unclosed markers are literal text, so "5 * 3" keeps its asterisk.
 *
 * Cost: every pass is a left-to-right scan with character checks. The only regex is anchored
 * with no quantified groups, so nothing can backtrack. Closer searches either succeed (and the
 * scan jumps past them) or fail and are cached, and nesting is capped at MAX_INLINE_DEPTH, so
 * parsing is linear in the input length. See tests/markdown.test.ts for the fuzz, prefix and
 * timing checks that back this up.
 */

/** Nested emphasis/links deeper than this render as plain text. Bounds recursion on hostile input. */
export const MAX_INLINE_DEPTH = 4;
/** Deepest list nesting kept; deeper items stay at this level. */
export const MAX_LIST_DEPTH = 3;

const SAFE_SCHEME = /^(?:https?:\/\/[^/?#\s]|mailto:[^\s])/i;

/**
 * True if a link target is safe to hand to `Linking.openURL`: an http(s) URL with a host, or a
 * mailto: address, with no whitespace or control characters (which could smuggle extra lines or
 * spoof what the user sees). Everything else — javascript:, file:, intent:, data:, custom app
 * schemes — renders as plain text. Model output is untrusted input: apps should still let the user
 * see where a link goes (see `onLinkPress` on StreamingChatBubble).
 */
export function isSafeUrl(url: string): boolean {
  if (url.length === 0 || url.length > 2048 || !SAFE_SCHEME.test(url)) return false;
  for (let k = 0; k < url.length; k++) {
    const code = url.charCodeAt(k);
    if (code <= 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f) || code === 0x2028 || code === 0x2029) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold" | "italic" | "strike"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; url: string; children: Inline[] }
  | { type: "image"; url: string; alt: string };

export interface ListItem {
  /** "•" for bullets, "3." for ordered items. */
  marker: string;
  ordered: boolean;
  /** Nesting level, 0-based, capped at MAX_LIST_DEPTH. */
  depth: number;
  /** Set for task-list items: false for "- [ ]", true for "- [x]". */
  checked?: boolean;
  inline: Inline[];
}

export type TableAlign = "left" | "center" | "right";

export type Block =
  | { type: "paragraph"; inline: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inline: Inline[] }
  | { type: "quote"; inline: Inline[] }
  | { type: "list"; items: ListItem[] }
  | { type: "table"; align: TableAlign[]; header: Inline[][]; rows: Inline[][][] }
  | { type: "rule" };

export type MarkdownSegment =
  | { type: "text"; blocks: Block[] }
  | { type: "code"; value: string; language?: string; complete: boolean };

/* -------------------------------------------------------------------------------------------------
 * Character helpers
 * -----------------------------------------------------------------------------------------------*/

const isWhitespace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r";
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isAlphanumeric = (c: string | undefined) =>
  c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9"));

/** Trims leading/trailing newlines without a regex (`/\n+$/` backtracks quadratically on long runs). */
function trimNewlines(value: string): string {
  const isNewline = (c: string | undefined) => c === "\n" || c === "\r";
  let start = 0;
  let end = value.length;
  while (start < end && isNewline(value[start])) start++;
  while (end > start && isNewline(value[end - 1])) end--;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

const stripCR = (line: string) => (line.endsWith("\r") ? line.slice(0, -1) : line);

/* -------------------------------------------------------------------------------------------------
 * Code fences
 * -----------------------------------------------------------------------------------------------*/

interface Fence {
  char: "`" | "~";
  length: number;
}

/** An opening fence: up to 3 spaces, then ≥3 backticks or tildes, then an optional info string. */
function matchFence(line: string): (Fence & { info: string }) | null {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  const ch = line[i];
  if (ch !== "`" && ch !== "~") return null;
  let j = i;
  while (line[j] === ch) j++;
  if (j - i < 3) return null;
  const info = line.slice(j).trim();
  if (ch === "`" && info.includes("`")) return null; // "```js```" on one line is inline code
  return { char: ch, length: j - i, info };
}

function isClosingFence(line: string, fence: Fence): boolean {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  let j = i;
  while (line[j] === fence.char) j++;
  return j - i >= fence.length && line.slice(j).trim().length === 0;
}

/** A tail line inside a code block that may be the start of its closing fence ("`", "``"). */
function isPartialClosingFence(line: string, fence: Fence): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length >= fence.length) return false;
  for (let k = 0; k < t.length; k++) if (t[k] !== fence.char) return false;
  return true;
}

type RawSegment = { type: "text"; value: string } | { type: "code"; value: string; language?: string; complete: boolean };

/** Splits a message into prose and fenced code. An unterminated fence is a code block still streaming. */
function splitFences(source: string, open: boolean): RawSegment[] {
  const lines = source.split("\n");
  const segments: RawSegment[] = [];
  let text: string[] = [];
  let code: string[] = [];
  let fence: (Fence & { info: string }) | null = null;

  // Not trimmed: trailing blank lines tell parseBlocks that the last block is closed.
  const flushText = () => {
    const value = text.join("\n");
    if (trimNewlines(value).length > 0) segments.push({ type: "text", value });
    text = [];
  };

  for (const raw of lines) {
    const line = stripCR(raw);
    if (fence) {
      if (isClosingFence(line, fence)) {
        segments.push({ type: "code", value: code.join("\n"), language: fence.info.split(" ")[0] || undefined, complete: true });
        fence = null;
        code = [];
      } else {
        code.push(line);
      }
      continue;
    }
    const opening = matchFence(line);
    if (opening) {
      flushText();
      fence = opening;
      continue;
    }
    text.push(line);
  }

  if (fence) {
    if (open && code.length > 0 && isPartialClosingFence(code[code.length - 1], fence)) code.pop();
    segments.push({ type: "code", value: code.join("\n"), language: fence.info.split(" ")[0] || undefined, complete: false });
  } else {
    flushText();
  }
  return segments;
}

/* -------------------------------------------------------------------------------------------------
 * Inline
 *
 * A single left-to-right scan instead of one big regex, so there is nothing to backtrack. Each
 * closer search either succeeds (and the scan jumps past it, never re-reading that range) or
 * fails, and a failure is cached per delimiter: no closer after position p means none after any
 * later position either.
 * -----------------------------------------------------------------------------------------------*/

const ESCAPABLE = new Set(["\\", "`", "*", "_", "[", "]", "(", ")", "#", "-", "+", ".", "!", ">", "<", "~", "|"]);
const URL_TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "'", '"', "*", "_", "~"]);

/** Finds the closer for a delimiter run of `len` × `ch`, or -1. */
function findEmphasisCloser(src: string, from: number, ch: string, len: number): number {
  const marker = ch.repeat(len);
  let k = src.indexOf(marker, from);
  while (k !== -1) {
    const before = src[k - 1];
    const after = src[k + len];
    const flanking =
      k > from && // non-empty content
      !isWhitespace(before) &&
      before !== ch &&
      after !== ch &&
      (ch !== "_" || !isAlphanumeric(after)); // snake_case_words are not emphasis
    if (flanking) return k;
    k = src.indexOf(marker, k + 1);
  }
  return -1;
}

/** End (exclusive) of a bare http(s) URL starting at `i`, or -1. */
function scanBareUrl(src: string, i: number): number {
  const scheme = src.startsWith("https://", i) ? 8 : src.startsWith("http://", i) ? 7 : 0;
  if (scheme === 0 || isAlphanumeric(src[i - 1])) return -1;
  let j = i + scheme;
  while (j < src.length && !isWhitespace(src[j]) && src[j] !== "<") j++;
  while (j > i + scheme && URL_TRAILING_PUNCTUATION.has(src[j - 1])) j--;
  // Keep a closing parenthesis only if the URL opened one: "(see https://x.io/a_(b))".
  if (src[j - 1] === ")") {
    let balance = 0;
    for (let k = i; k < j; k++) balance += src[k] === "(" ? 1 : src[k] === ")" ? -1 : 0;
    if (balance < 0) j--;
  }
  return j > i + scheme ? j : -1;
}

export function parseInline(src: string, open: boolean, depth = 0): Inline[] {
  if (depth >= MAX_INLINE_DEPTH) return src ? [{ type: "text", value: src }] : [];

  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", value: buffer });
    buffer = "";
  };

  // Delimiters proven to have no closer ahead, and cached closer positions (see section comment).
  const exhausted = new Set<string>();
  let nextBracket = -1;
  let nextParen = -1;
  let nextAngle = -1;
  const indexAfter = (ch: string, from: number, cached: number) => {
    if (exhausted.has(ch)) return -1;
    if (cached >= from) return cached;
    const found = src.indexOf(ch, from);
    if (found === -1) exhausted.add(ch);
    return found;
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "\\" && ESCAPABLE.has(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }

    // `code`
    if (c === "`") {
      const end = indexAfter("`", i + 1, -1);
      if (end !== -1) {
        flush();
        if (end > i + 1) out.push({ type: "code", value: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      if (open) {
        // Pending code span: hide the backtick, show the rest verbatim (no emphasis inside code).
        buffer += src.slice(i + 1);
        break;
      }
      buffer += c;
      i++;
      continue;
    }

    // Bare URL: https://example.com
    if (c === "h") {
      const end = scanBareUrl(src, i);
      if (end !== -1) {
        const url = src.slice(i, end);
        if (isSafeUrl(url)) {
          flush();
          out.push({ type: "link", url, children: [{ type: "text", value: url }] });
        } else {
          buffer += url; // too long or has control characters: plain text, and never re-scanned
        }
        i = end;
        continue;
      }
    }

    // Autolink: <https://example.com>. Anything else starting with "<" (HTML) stays literal.
    if (c === "<" && (src.startsWith("<http", i) || src.startsWith("<mailto:", i))) {
      const close = indexAfter(">", i + 1, nextAngle);
      nextAngle = close;
      if (close !== -1) {
        const url = src.slice(i + 1, close);
        if (isSafeUrl(url)) {
          flush();
          out.push({ type: "link", url, children: [{ type: "text", value: url }] });
          i = close + 1;
          continue;
        }
      } else if (open) {
        buffer += src.slice(i + 1); // pending autolink: hide the "<"
        break;
      }
    }

    // *italic*, **bold**, ***both***, _italic_, ~~strike~~
    if (c === "*" || c === "_" || c === "~") {
      let len = 1;
      while (len < 3 && src[i + len] === c) len++;
      const next = src[i + len];

      if (c === "~" && len !== 2) {
        // Only exactly two tildes strike through; a lone "~" at the tail may become "~~".
        if (!(open && len === 1 && next === undefined)) buffer += src.slice(i, i + len);
        i += len;
        continue;
      }

      const marker = c.repeat(len);
      if (next === undefined) {
        // A marker at the very end of the tail is probably the start of a run.
        if (!open) buffer += marker;
        i += len;
        continue;
      }

      const canOpen = !isWhitespace(next) && (c !== "_" || !isAlphanumeric(src[i - 1]));
      const close = canOpen && !exhausted.has(marker) ? findEmphasisCloser(src, i + len, c, len) : -1;
      if (close !== -1) {
        flush();
        const inner = parseInline(src.slice(i + len, close), false, depth + 1);
        if (c === "~") out.push({ type: "strike", children: inner });
        else if (len === 1) out.push({ type: "italic", children: inner });
        else if (len === 2) out.push({ type: "bold", children: inner });
        else out.push({ type: "bold", children: [{ type: "italic", children: inner }] });
        i = close + len;
        continue;
      }
      if (canOpen) exhausted.add(marker);
      if (!(canOpen && open)) buffer += marker;
      i += len;
      continue;
    }

    // [link](url) and ![image](url)
    if (c === "[" || (c === "!" && src[i + 1] === "[")) {
      const image = c === "!";
      const start = image ? i + 1 : i;
      const bracket = indexAfter("]", start + 1, nextBracket);
      nextBracket = bracket;

      if (bracket === -1) {
        if (!open) buffer += src.slice(i, start + 1); // pending link text: hide the "[" / "!["
        i = start + 1;
        continue;
      }

      const label = src.slice(start + 1, bracket);
      const labelOnly = () => {
        flush();
        if (image) out.push({ type: "text", value: inlineToPlainText(parseInline(label, false, depth + 1)) });
        else out.push(...parseInline(label, false, depth + 1));
      };

      if (src[bracket + 1] === "(") {
        const paren = indexAfter(")", bracket + 2, nextParen);
        nextParen = paren;
        if (paren !== -1) {
          // Drop an optional title: [text](https://x.io "Title").
          const target = src.slice(bracket + 2, paren).trim().split(" ")[0];
          if (!isSafeUrl(target)) {
            labelOnly(); // unsafe schemes (javascript:, file:, …) keep their text but lose the link
          } else if (image) {
            flush();
            out.push({ type: "image", url: target, alt: inlineToPlainText(parseInline(label, false, depth + 1)) });
          } else {
            flush();
            out.push({ type: "link", url: target, children: parseInline(label, false, depth + 1) });
          }
          i = paren + 1;
          continue;
        }
        if (open) {
          labelOnly(); // mid-URL: show the label, hide "(http…" until the ")" arrives
          i = src.length;
          continue;
        }
      } else if (open && bracket === src.length - 1) {
        labelOnly(); // "[label]" at the very end: the "(" may be the next token
        i = src.length;
        continue;
      }

      buffer += src.slice(i, start + 1);
      i = start + 1;
      continue;
    }

    buffer += c;
    i++;
  }

  flush();
  return out;
}

export function inlineToPlainText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "image") return node.alt;
      if ("children" in node) return inlineToPlainText(node.children);
      return node.value;
    })
    .join("");
}

function inlineHasLink(nodes: Inline[]): boolean {
  return nodes.some(
    (node) => node.type === "link" || node.type === "image" || ("children" in node && inlineHasLink(node.children)),
  );
}

/* -------------------------------------------------------------------------------------------------
 * Blocks
 *
 * Line by line with character checks, so cost is linear in the text length.
 * -----------------------------------------------------------------------------------------------*/

function indentWidth(line: string): { width: number; index: number } {
  let width = 0;
  let index = 0;
  while (index < line.length && (line[index] === " " || line[index] === "\t")) {
    width += line[index] === "\t" ? 2 : 1;
    index++;
  }
  return { width, index };
}

function matchHeading(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === "#") hashes++;
  if (hashes === 0 || hashes > 6 || line[hashes] !== " ") return null;
  let text = line.slice(hashes + 1).trim();
  // Optional closing sequence: "## Title ##".
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end < text.length && (end === 0 || text[end - 1] === " ")) text = text.slice(0, end).trimEnd();
  return { level: hashes as 1 | 2 | 3 | 4 | 5 | 6, text };
}

interface DraftItem {
  marker: string;
  ordered: boolean;
  depth: number;
  checked?: boolean;
  lines: string[];
}

function matchListItem(line: string): DraftItem | null {
  const { width, index: i } = indentWidth(line);
  const depth = Math.min(Math.floor(width / 2), MAX_LIST_DEPTH);
  const c = line[i];
  let item: DraftItem | null = null;

  if ((c === "-" || c === "*" || c === "+") && line[i + 1] === " ") {
    item = { marker: "•", ordered: false, depth, lines: [line.slice(i + 2).trimStart()] };
  } else {
    let j = i;
    while (j < line.length && j - i < 9 && isDigit(line[j])) j++;
    if (j > i && (line[j] === "." || line[j] === ")") && line[j + 1] === " ") {
      item = { marker: `${line.slice(i, j)}.`, ordered: true, depth, lines: [line.slice(j + 2).trimStart()] };
    }
  }
  if (!item) return null;

  // Task list: "- [ ] todo", "- [x] done".
  const text = item.lines[0];
  if (text[0] === "[" && text[2] === "]" && (text.length === 3 || text[3] === " ")) {
    if (text[1] === " ") item.checked = false;
    else if (text[1] === "x" || text[1] === "X") item.checked = true;
    if (item.checked !== undefined) item.lines[0] = text.slice(4);
  }
  return item;
}

function isRule(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return false;
  const ch = t[0];
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  for (let k = 1; k < t.length; k++) if (t[k] !== ch) return false;
  return true;
}

/** Splits a table row on unescaped pipes, ignoring the optional outer ones. */
function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let k = 0; k < t.length; k++) {
    if (t[k] === "\\" && t[k + 1] === "|") {
      cell += "|";
      k++;
    } else if (t[k] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += t[k];
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Parses a delimiter row ("| :--- | :-: | --: |"), or returns null if the line isn't one. */
function parseAlignRow(line: string): TableAlign[] | null {
  if (!line.includes("-")) return null;
  const align: TableAlign[] = [];
  for (const cell of splitRow(line)) {
    const left = cell[0] === ":";
    const right = cell.length > 1 && cell[cell.length - 1] === ":";
    const core = cell.slice(left ? 1 : 0, right ? cell.length - 1 : cell.length);
    if (core.length === 0) return null;
    for (let k = 0; k < core.length; k++) if (core[k] !== "-") return null;
    align.push(left && right ? "center" : right ? "right" : "left");
  }
  return align;
}

/** A delimiter row still streaming in: only pipes, colons, dashes and spaces so far. */
function isPartialAlignRow(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  for (let k = 0; k < t.length; k++) if (!"|:- ".includes(t[k])) return false;
  return true;
}

const PENDING_MARKERS = new Set(["-", "--", "*", "+", ">", "_", "__", "`", "``", "~", "~~", "|"]);

/** A tail line that is only a block marker so far ("##", "-", "12.", ">"): wait for its text. */
function isPendingMarker(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (PENDING_MARKERS.has(t)) return true;
  let k = 0;
  while (k < t.length && t[k] === "#") k++;
  if (k > 0 && k === t.length && k <= 6) return true;
  k = 0;
  while (k < t.length && isDigit(t[k])) k++;
  if (k > 0 && k <= 9 && (k === t.length || (k === t.length - 1 && (t[k] === "." || t[k] === ")")))) return true;
  return false;
}

type Draft =
  | { type: "paragraph"; lines: string[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "list"; items: DraftItem[] }
  | { type: "table"; align: TableAlign[]; header: string[]; rows: string[][] }
  | { type: "rule" };

/**
 * Parses prose (no code fences) into blocks. `open` marks the live tail of a stream: its last
 * line may be an incomplete marker, and its last block's inline markup may be unclosed.
 */
export function parseBlocks(source: string, open: boolean): Block[] {
  const lines = source.split("\n").map(stripCR);
  const droppedMarker = open && isPendingMarker(lines[lines.length - 1]);
  if (droppedMarker) lines.pop();

  const drafts: Draft[] = [];
  let current: Draft | null = null;
  let lastDraftLine = -1; // last line that went into a draft
  const push = (draft: Draft) => {
    drafts.push(draft);
    current = draft;
  };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const cur = current as Draft | null;
    const isLastLine = n === lines.length - 1;

    if (line.trim().length === 0) {
      current = null;
      continue;
    }
    const previousDraftLine = lastDraftLine;
    lastDraftLine = n;

    const heading = matchHeading(line);
    if (heading) {
      push({ type: "heading", level: heading.level, text: heading.text });
      current = null;
      continue;
    }

    if (isRule(line)) {
      push({ type: "rule" });
      current = null;
      continue;
    }

    if (line.includes("|")) {
      const header = splitRow(line);
      const next = lines[n + 1];
      const align = next !== undefined ? parseAlignRow(next) : null;
      const streamingDelimiter = open && next !== undefined && n + 1 === lines.length - 1 && isPartialAlignRow(next);
      if ((align && align.length === header.length) || streamingDelimiter) {
        const rows: string[][] = [];
        let m = n + 2;
        while (m < lines.length && lines[m].trim().length > 0 && lines[m].includes("|")) {
          rows.push(splitRow(lines[m]));
          m++;
        }
        push({ type: "table", align: align && align.length === header.length ? align : header.map(() => "left"), header, rows });
        current = null;
        n = m - 1;
        lastDraftLine = n;
        continue;
      }
      // A lone "| a | b" at the tail may be a table header whose delimiter row hasn't arrived.
      if (open && isLastLine && line.trimStart().startsWith("|")) {
        lastDraftLine = previousDraftLine;
        continue;
      }
    }

    const trimmed = line.trimStart();
    if (trimmed.startsWith(">")) {
      const text = trimmed[1] === " " ? trimmed.slice(2) : trimmed.slice(1);
      if (cur?.type === "quote") cur.lines.push(text);
      else push({ type: "quote", lines: [text] });
      continue;
    }

    const item = matchListItem(line);
    if (item) {
      if (cur?.type === "list") cur.items.push(item);
      else push({ type: "list", items: [item] });
      continue;
    }

    // An indented line right under a list item continues that item.
    if (cur?.type === "list" && isWhitespace(line[0])) {
      cur.items[cur.items.length - 1].lines.push(line.trim());
      continue;
    }

    if (cur?.type === "paragraph") cur.lines.push(line);
    else push({ type: "paragraph", lines: [line] });
  }

  // A finished blank line after the last block closes it: no closer can reach it any more, so it
  // parses like finished text ("**bold\n\n" keeps its asterisks), whatever is still arriving below.
  // The last line is still being written, unless it was a dropped marker.
  let tailOpen = open;
  const lastFinished = droppedMarker ? lines.length - 1 : lines.length - 2;
  for (let k = lastDraftLine + 1; k <= lastFinished && tailOpen; k++) {
    if (lines[k].trim().length === 0) tailOpen = false;
  }

  return drafts.map((draft, index): Block => {
    const tail = tailOpen && index === drafts.length - 1;
    switch (draft.type) {
      case "paragraph":
        return { type: "paragraph", inline: parseInline(draft.lines.join("\n"), tail) };
      case "heading":
        return { type: "heading", level: draft.level, inline: parseInline(draft.text, tail) };
      case "quote":
        return { type: "quote", inline: parseInline(draft.lines.join("\n"), tail) };
      case "list":
        return {
          type: "list",
          items: draft.items.map((it, itemIndex) => ({
            marker: it.marker,
            ordered: it.ordered,
            depth: it.depth,
            checked: it.checked,
            inline: parseInline(it.lines.join(" "), tail && itemIndex === draft.items.length - 1),
          })),
        };
      case "table": {
        const lastRow = draft.rows.length - 1;
        return {
          type: "table",
          align: draft.align,
          header: draft.header.map((cell) => parseInline(cell, tail && lastRow === -1)),
          // Rows are padded/truncated to the header width; only the cell being written is open.
          rows: draft.rows.map((row, r) =>
            draft.header.map((_, col) => parseInline(row[col] ?? "", tail && r === lastRow && col === row.length - 1)),
          ),
        };
      }
      case "rule":
        return { type: "rule" };
    }
  });
}

/* -------------------------------------------------------------------------------------------------
 * Public API
 * -----------------------------------------------------------------------------------------------*/

/**
 * Parses a (possibly still streaming) message. Pass `streaming: true` while tokens are arriving
 * so the tail is treated as open (see the file header).
 */
export function parseMarkdown(source: string, streaming = false): MarkdownSegment[] {
  const raw = splitFences(source, streaming);
  return raw.map((segment, index): MarkdownSegment =>
    segment.type === "code" ? segment : { type: "text", blocks: parseBlocks(segment.value, streaming && index === raw.length - 1) },
  );
}

/**
 * Returns a parser for one message that grows by appending, as a stream does. Each call returns
 * exactly what `parseMarkdown(source, streaming)` would, but only re-parses the part that can
 * still change, so streaming a reply costs linear time in total instead of quadratic.
 *
 * Text before a finished blank line (outside code) or a closing fence can't change any more:
 * blocks never span a blank line, and every inline span ends with its block. Those blocks are
 * parsed once and returned as the same objects on later calls, so a renderer can memoize them by
 * identity. If `source` stops extending the previous one (a different message), it starts over.
 */
export function createStreamingParser(): (source: string, streaming?: boolean) => MarkdownSegment[] {
  let settledSource = ""; // source.slice(0, settledSource.length) is parsed into `settled` + `run`
  let settled: MarkdownSegment[] = [];
  let run: Block[] | null = null; // blocks of a text segment that continues past settledSource
  let scanned = ""; // finished lines already checked for a checkpoint
  let fence: Fence | null = null; // fence open at the end of `scanned`
  let last: { source: string; streaming: boolean; result: MarkdownSegment[] } | null = null;

  const reset = () => {
    settledSource = "";
    settled = [];
    run = null;
    scanned = "";
    fence = null;
  };

  const settle = (chunk: string) => {
    for (const segment of parseMarkdown(chunk, false)) {
      if (segment.type === "text") {
        if (run) run.push(...segment.blocks);
        else run = [...segment.blocks];
      } else {
        if (run) settled.push({ type: "text", blocks: run });
        run = null;
        settled.push(segment);
      }
    }
  };

  return (source, streaming = false) => {
    if (last && last.source === source && last.streaming === streaming) return last.result;
    if (!source.startsWith(scanned)) reset();

    // Find the last checkpoint among the finished lines (each ends with "\n").
    let checkpoint = -1;
    let start = scanned.length;
    for (let end = source.indexOf("\n", start); end !== -1; end = source.indexOf("\n", start)) {
      const line = stripCR(source.slice(start, end));
      start = end + 1;
      if (fence) {
        if (isClosingFence(line, fence)) {
          fence = null;
          checkpoint = start;
        }
      } else {
        fence = matchFence(line);
        if (!fence && line.trim().length === 0) checkpoint = start;
      }
    }
    scanned = source.slice(0, start);
    if (checkpoint !== -1) {
      settle(source.slice(settledSource.length, checkpoint));
      settledSource = source.slice(0, checkpoint);
    }

    const tail = parseMarkdown(source.slice(settledSource.length), streaming);
    const result = [...settled];
    if (run) {
      const head = tail[0]?.type === "text" ? tail.shift() : undefined;
      result.push({ type: "text", blocks: head?.type === "text" ? [...run, ...head.blocks] : [...run] });
    }
    result.push(...tail);
    last = { source, streaming, result };
    return result;
  };
}

// Blocks are immutable, and the streaming parser hands back the same objects for text that can't
// change, so per-block results are cached: per-token work stays proportional to the new text.
const plainTextCache = new WeakMap<Block, string>();
const hasLinkCache = new WeakMap<Block, boolean>();

function blockToPlainText(block: Block): string {
  let text = plainTextCache.get(block);
  if (text === undefined) {
    switch (block.type) {
      case "rule":
        text = "";
        break;
      case "list":
        text = block.items.map((it) => `${it.marker} ${inlineToPlainText(it.inline)}`).join("\n");
        break;
      case "table":
        text = [block.header, ...block.rows].map((row) => row.map(inlineToPlainText).join(" | ")).join("\n");
        break;
      default:
        text = inlineToPlainText(block.inline);
    }
    plainTextCache.set(block, text);
  }
  return text;
}

function blockHasLink(block: Block): boolean {
  let found = hasLinkCache.get(block);
  if (found === undefined) {
    switch (block.type) {
      case "rule":
        found = false;
        break;
      case "list":
        found = block.items.some((it) => inlineHasLink(it.inline));
        break;
      case "table":
        found = [block.header, ...block.rows].some((row) => row.some(inlineHasLink));
        break;
      default:
        found = inlineHasLink(block.inline);
    }
    hasLinkCache.set(block, found);
  }
  return found;
}

export function blocksToPlainText(blocks: Block[]): string {
  return blocks.map(blockToPlainText).join("\n");
}

/** Plain text for screen readers and copy actions. Code blocks are included verbatim. */
export function markdownToPlainText(segments: MarkdownSegment[]): string {
  return segments.map((segment) => (segment.type === "code" ? segment.value : blocksToPlainText(segment.blocks))).join("\n");
}

/** True if any segment contains a pressable link or image. */
export function markdownHasLinks(segments: MarkdownSegment[]): boolean {
  return segments.some((segment) => segment.type === "text" && segment.blocks.some(blockHasLink));
}
