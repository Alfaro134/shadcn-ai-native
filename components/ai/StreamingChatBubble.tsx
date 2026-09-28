import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { CodeBlock } from "./CodeBlock";

/* -------------------------------------------------------------------------------------------------
 * Theme — edit these class strings to restyle the component.
 * -----------------------------------------------------------------------------------------------*/

const theme = {
  row: {
    user: "w-full flex-row justify-end px-4 py-1.5",
    assistant: "w-full flex-row items-start justify-start gap-2.5 px-4 py-1.5",
  },
  column: {
    user: "max-w-[82%] items-end",
    assistant: "max-w-[88%] flex-shrink items-start",
  },
  bubble: {
    user: "rounded-3xl rounded-br-lg bg-zinc-900 px-4 py-2.5 dark:bg-zinc-100",
    assistant: "rounded-3xl rounded-tl-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-800/80",
  },
  text: {
    user: "text-[15px] leading-[22px] text-zinc-50 dark:text-zinc-900",
    assistant: "text-[15px] leading-[22px] text-zinc-900 dark:text-zinc-100",
  },
  heading: {
    1: "text-[20px] leading-[28px] font-bold tracking-tight",
    2: "text-[18px] leading-[26px] font-semibold tracking-tight",
    3: "text-[16px] leading-[24px] font-semibold",
    4: "text-[15px] leading-[22px] font-semibold",
  },
  bold: "font-semibold",
  italic: "italic",
  link: {
    user: "underline text-zinc-50 dark:text-zinc-900",
    assistant: "underline text-blue-600 dark:text-blue-400",
  },
  inlineCode: {
    user: "rounded bg-zinc-700 text-[13px] text-zinc-50 dark:bg-zinc-300 dark:text-zinc-900",
    assistant: "rounded bg-zinc-200 text-[13px] text-rose-600 dark:bg-zinc-700 dark:text-rose-300",
  },
  listMarker: {
    user: "text-zinc-400 dark:text-zinc-500",
    assistant: "text-zinc-400 dark:text-zinc-500",
  },
  quote: {
    user: "border-l-[3px] border-zinc-600 pl-3 dark:border-zinc-400",
    assistant: "border-l-[3px] border-zinc-300 pl-3 dark:border-zinc-600",
  },
  quoteText: {
    user: "text-zinc-300 dark:text-zinc-600",
    assistant: "text-zinc-600 dark:text-zinc-400",
  },
  rule: {
    user: "my-1 h-px self-stretch bg-zinc-700 dark:bg-zinc-300",
    assistant: "my-1 h-px self-stretch bg-zinc-200 dark:bg-zinc-700",
  },
  blockGap: "mb-2",
  caret: "text-zinc-400 dark:text-zinc-500",
  caretHidden: "text-transparent",
  typingRow: "h-[22px] flex-row items-center gap-1.5 px-0.5",
  typingDot: "h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500",
  header: "mb-1.5 self-stretch",
  footer: "mt-1.5",
} as const;

/** Duration of the height tween that absorbs each streamed chunk. */
const GROW_DURATION_MS = 160;

/** Nested emphasis/links deeper than this render as plain text. Bounds recursion on hostile input. */
const MAX_INLINE_DEPTH = 4;
/** Deepest list indentation rendered; deeper items stay at this level. */
const MAX_LIST_DEPTH = 3;
/** Horizontal space reserved for a list marker ("•", "9."), and for wide ones ("10."). */
const LIST_MARKER_WIDTH = 20;
const LIST_MARKER_WIDE = 28;
/** Extra indent per nesting level. */
const LIST_INDENT = 16;
/** Link targets that are safe to hand to `Linking.openURL`. */
const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export type ChatRole = "user" | "assistant";

export interface StreamingChatBubbleProps {
  /** Who sent the message. Controls alignment and colors. */
  role: ChatRole;
  /**
   * Full message text so far, as Markdown: headings, lists, blockquotes, links, `---`, **bold**,
   * *italic*, `inline code` and ``` fences (rendered as <CodeBlock />). Safe to pass mid-stream.
   */
  content: string;
  /** True while tokens are still arriving: shows a caret, or a typing indicator if empty. */
  isStreaming?: boolean;
  /**
   * Optional avatar rendered to the left of assistant messages. The bubble is memoized: pass a
   * stable element (hoisted or `useMemo`) so finished bubbles don't re-render with the list.
   */
  avatar?: React.ReactNode;
  /** Optional node above the bubble, e.g. <ReasoningBlock />. Same stability note as `avatar`. */
  header?: React.ReactNode;
  /** Optional node under the bubble, e.g. <ActionChips />. Same stability note as `avatar`. */
  footer?: React.ReactNode;
  /** Animate the bubble in on mount. Disable for history loaded in bulk. */
  animateEntry?: boolean;
  /** Extra classes merged onto the bubble surface. */
  className?: string;
}

type Segment =
  | { type: "text"; value: string }
  | { type: "code"; value: string; language?: string; complete: boolean };

type Inline =
  | { type: "text"; value: string }
  | { type: "bold" | "italic"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; url: string; children: Inline[] };

interface ListItem {
  marker: string;
  depth: number;
  inline: Inline[];
}

type Block =
  | { type: "paragraph"; inline: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4; inline: Inline[] }
  | { type: "quote"; inline: Inline[] }
  | { type: "list"; items: ListItem[] }
  | { type: "rule" };

type RenderedSegment =
  | { type: "text"; blocks: Block[] }
  | { type: "code"; value: string; language?: string; complete: boolean };

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

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

/**
 * Splits a message on ``` fences. Tolerates an unterminated trailing fence so code blocks
 * appear (and grow) while they are still being streamed.
 */
function parseSegments(source: string): Segment[] {
  const parts = source.split("```");
  const segments: Segment[] = [];

  parts.forEach((part, index) => {
    const isCode = index % 2 === 1;
    if (!isCode) {
      const value = trimNewlines(part);
      if (value.length > 0) segments.push({ type: "text", value });
      return;
    }

    const newline = part.indexOf("\n");
    const header = newline === -1 ? part : part.slice(0, newline);
    const body = newline === -1 ? "" : part.slice(newline + 1);
    // Info strings can carry extras (```tsx title="App.tsx"); only the first word is the language.
    const language = header.trim().split(" ")[0];
    segments.push({
      type: "code",
      language: language || undefined,
      value: body,
      complete: index < parts.length - 1,
    });
  });

  return segments;
}

/* -------------------------------------------------------------------------------------------------
 * Markdown: inline
 *
 * A single left-to-right scan instead of one big regex, so there is nothing to backtrack. Each
 * closer search either succeeds (and the scan jumps past it, never re-reading that range) or
 * fails, and a failure is cached per delimiter: no closer after position p means none after any
 * later position either. Every character is therefore visited a bounded number of times per
 * nesting level, and nesting is capped at MAX_INLINE_DEPTH.
 *
 * `open` marks the live tail of a stream. There, an opener without its closer is *pending*: the
 * marker is hidden and its text renders plain until the closer arrives ("**bold" → "bold",
 * "[Google](http…" → "Google"). Outside the tail an unclosed marker is literal text ("5 * 3").
 * -----------------------------------------------------------------------------------------------*/

const ESCAPABLE = new Set(["\\", "`", "*", "_", "[", "]", "(", ")", "#", "-", "+", ".", "!", ">"]);

/** Finds the closer for an emphasis run of `len` × `ch`, or -1. */
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
      (ch === "*" || !isAlphanumeric(after)); // snake_case_words are not emphasis
    if (flanking) return k;
    k = src.indexOf(marker, k + 1);
  }
  return -1;
}

function parseInline(src: string, open: boolean, depth = 0): Inline[] {
  if (depth >= MAX_INLINE_DEPTH) return src ? [{ type: "text", value: src }] : [];

  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", value: buffer });
    buffer = "";
  };

  // Delimiters proven to have no closer ahead, and cached bracket positions (see header comment).
  const exhausted = new Set<string>();
  let nextBracket = -1;
  let nextParen = -1;
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

    if (c === "*" || c === "_") {
      let len = 1;
      while (len < 3 && src[i + len] === c) len++;
      const marker = c.repeat(len);
      const next = src[i + len];

      if (next === undefined) {
        // A marker at the very end of the tail is probably the start of an emphasis run.
        if (!open) buffer += marker;
        i += len;
        continue;
      }

      const canOpen = !isWhitespace(next) && (c === "*" || !isAlphanumeric(src[i - 1]));
      const close = canOpen && !exhausted.has(marker) ? findEmphasisCloser(src, i + len, c, len) : -1;
      if (close !== -1) {
        flush();
        const inner = parseInline(src.slice(i + len, close), false, depth + 1);
        if (len === 1) out.push({ type: "italic", children: inner });
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

    if (c === "[") {
      const bracket = indexAfter("]", i + 1, nextBracket);
      nextBracket = bracket;

      if (bracket === -1) {
        if (!open) buffer += c; // pending link text: hide the "["
        i++;
        continue;
      }

      const label = src.slice(i + 1, bracket);
      if (src[bracket + 1] === "(") {
        const paren = indexAfter(")", bracket + 2, nextParen);
        nextParen = paren;
        if (paren !== -1) {
          const url = src.slice(bracket + 2, paren).trim();
          const children = parseInline(label, false, depth + 1);
          flush();
          // Unsafe schemes (javascript:, file:, …) keep their text but lose the link.
          if (SAFE_URL.test(url)) out.push({ type: "link", url, children });
          else out.push(...children);
          i = paren + 1;
          continue;
        }
        if (open) {
          // Mid-URL: show the label, hide "(http…" until the ")" arrives.
          flush();
          out.push(...parseInline(label, false, depth + 1));
          i = src.length;
          continue;
        }
      } else if (open && bracket === src.length - 1) {
        // "[label]" at the very end: the "(" may be the next token.
        flush();
        out.push(...parseInline(label, false, depth + 1));
        i = src.length;
        continue;
      }

      buffer += c;
      i++;
      continue;
    }

    buffer += c;
    i++;
  }

  flush();
  return out;
}

function inlineToPlainText(nodes: Inline[]): string {
  return nodes.map((node) => ("children" in node ? inlineToPlainText(node.children) : node.value)).join("");
}

function inlineHasLink(nodes: Inline[]): boolean {
  return nodes.some((node) => node.type === "link" || ("children" in node && inlineHasLink(node.children)));
}

/* -------------------------------------------------------------------------------------------------
 * Markdown: blocks
 *
 * Line by line with character checks (no regex), so cost is linear in the text length.
 * -----------------------------------------------------------------------------------------------*/

/** Visual width of leading whitespace, counting a tab as two spaces. */
function indentWidth(line: string): { width: number; index: number } {
  let width = 0;
  let index = 0;
  while (index < line.length && (line[index] === " " || line[index] === "\t")) {
    width += line[index] === "\t" ? 2 : 1;
    index++;
  }
  return { width, index };
}

function matchHeading(line: string): { level: 1 | 2 | 3 | 4; text: string } | null {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === "#") hashes++;
  if (hashes === 0 || hashes > 6 || line[hashes] !== " ") return null;
  const level = Math.min(hashes, 4) as 1 | 2 | 3 | 4;
  let text = line.slice(hashes + 1).trim();
  // Optional closing sequence: "## Title ##".
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  if (end < text.length && (end === 0 || text[end - 1] === " ")) text = text.slice(0, end).trimEnd();
  return { level, text };
}

function matchListItem(line: string): { depth: number; marker: string; text: string } | null {
  const { width, index: i } = indentWidth(line);
  const depth = Math.min(Math.floor(width / 2), MAX_LIST_DEPTH);
  const c = line[i];

  if ((c === "-" || c === "*" || c === "+") && line[i + 1] === " ") {
    return { depth, marker: "•", text: line.slice(i + 2).trimStart() };
  }

  let j = i;
  while (j < line.length && j - i < 9 && isDigit(line[j])) j++;
  if (j > i && (line[j] === "." || line[j] === ")") && line[j + 1] === " ") {
    return { depth, marker: `${line.slice(i, j)}.`, text: line.slice(j + 2).trimStart() };
  }
  return null;
}

function isRule(line: string): boolean {
  const t = line.trim();
  if (t.length < 3) return false;
  const ch = t[0];
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  for (let k = 1; k < t.length; k++) if (t[k] !== ch) return false;
  return true;
}

const PENDING_MARKERS = new Set(["-", "--", "*", "+", ">", "_", "__"]);

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

/**
 * Parses one text segment into blocks. `open` marks the live tail of a stream: its last line may
 * be an incomplete marker, and its last block's inline markup may be unclosed.
 */
function parseBlocks(source: string, open: boolean): Block[] {
  const lines = source.split("\n");
  if (open && isPendingMarker(lines[lines.length - 1])) lines.pop();

  type Draft =
    | { type: "paragraph"; lines: string[] }
    | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
    | { type: "quote"; lines: string[] }
    | { type: "list"; items: Array<{ marker: string; depth: number; lines: string[] }> }
    | { type: "rule" };

  const drafts: Draft[] = [];
  let current: Draft | null = null;
  const push = (draft: Draft) => {
    drafts.push(draft);
    current = draft;
  };

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const cur = current as Draft | null;

    if (line.trim().length === 0) {
      current = null;
      continue;
    }

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

    const trimmed = line.trimStart();
    if (trimmed.startsWith(">")) {
      const text = trimmed[1] === " " ? trimmed.slice(2) : trimmed.slice(1);
      if (cur?.type === "quote") cur.lines.push(text);
      else push({ type: "quote", lines: [text] });
      continue;
    }

    const item = matchListItem(line);
    if (item) {
      const entry = { marker: item.marker, depth: item.depth, lines: [item.text] };
      if (cur?.type === "list") cur.items.push(entry);
      else push({ type: "list", items: [entry] });
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

  return drafts.map((draft, index): Block => {
    const tail = open && index === drafts.length - 1;
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
            depth: it.depth,
            inline: parseInline(it.lines.join(" "), tail && itemIndex === draft.items.length - 1),
          })),
        };
      case "rule":
        return { type: "rule" };
    }
  });
}

function blocksToPlainText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === "rule") return "";
      if (block.type === "list") return block.items.map((it) => `${it.marker} ${inlineToPlainText(it.inline)}`).join("\n");
      return inlineToPlainText(block.inline);
    })
    .join("\n");
}

function blocksHaveLink(blocks: Block[]): boolean {
  return blocks.some((block) =>
    block.type === "list"
      ? block.items.some((it) => inlineHasLink(it.inline))
      : block.type !== "rule" && inlineHasLink(block.inline),
  );
}

/* -------------------------------------------------------------------------------------------------
 * Rendering
 * -----------------------------------------------------------------------------------------------*/

function openLink(url: string) {
  Linking.openURL(url).catch(() => {});
}

function renderInline(nodes: Inline[], role: ChatRole, keyPrefix = ""): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "bold":
        return (
          <Text key={key} className={theme.bold}>
            {renderInline(node.children, role, `${key}.`)}
          </Text>
        );
      case "italic":
        return (
          <Text key={key} className={theme.italic}>
            {renderInline(node.children, role, `${key}.`)}
          </Text>
        );
      case "code":
        return (
          <Text key={key} className={theme.inlineCode[role]}>
            {` ${node.value} `}
          </Text>
        );
      case "link":
        return (
          <Text
            key={key}
            className={theme.link[role]}
            onPress={() => openLink(node.url)}
            accessibilityRole="link"
            accessibilityHint={node.url}
          >
            {renderInline(node.children, role, `${key}.`)}
          </Text>
        );
    }
  });
}

interface MarkdownBlockProps {
  block: Block;
  role: ChatRole;
  caret: boolean;
  gap: boolean;
}

function MarkdownBlock({ block, role, caret, gap }: MarkdownBlockProps) {
  const caretNode = caret ? <BlinkingCaret /> : null;
  const gapClass = gap && theme.blockGap;

  switch (block.type) {
    case "paragraph":
      return (
        <Text className={cx(theme.text[role], gapClass)} selectable>
          {renderInline(block.inline, role)}
          {caretNode}
        </Text>
      );

    case "heading":
      return (
        <Text className={cx(theme.text[role], theme.heading[block.level], gapClass)} accessibilityRole="header" selectable>
          {renderInline(block.inline, role)}
          {caretNode}
        </Text>
      );

    case "quote":
      return (
        <View className={cx(theme.quote[role], gapClass)}>
          <Text className={cx(theme.text[role], theme.quoteText[role])} selectable>
            {renderInline(block.inline, role)}
            {caretNode}
          </Text>
        </View>
      );

    case "list": {
      // Not a flex-row of [marker, text]: inside a content-sized bubble Yoga sizes such a row by the
      // text's *unwrapped* width, pushing the bubble past its max width. Instead the text is a
      // normal block with left padding, and the marker sits absolutely inside that padding.
      const markerWidth = block.items.some((it) => it.marker.length > 2) ? LIST_MARKER_WIDE : LIST_MARKER_WIDTH;
      return (
        <View className={cx(gapClass)}>
          {block.items.map((item, index) => {
            const indent = item.depth * LIST_INDENT;
            return (
              <View key={index} style={{ paddingLeft: indent + markerWidth }}>
                <Text
                  className={cx(theme.text[role], theme.listMarker[role])}
                  style={{ position: "absolute", left: indent, top: 0 }}
                >
                  {item.marker}
                </Text>
                <Text className={theme.text[role]} selectable>
                  {renderInline(item.inline, role)}
                  {caret && index === block.items.length - 1 ? caretNode : null}
                </Text>
              </View>
            );
          })}
        </View>
      );
    }

    case "rule":
      return <View className={cx(theme.rule[role], gapClass)} />;
  }
}

/* -------------------------------------------------------------------------------------------------
 * Sub-components
 * -----------------------------------------------------------------------------------------------*/

function BlinkingCaret() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  return <Text className={visible ? theme.caret : theme.caretHidden}>{" ▍"}</Text>;
}

function TypingDot({ delay }: { delay: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(progress);
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ translateY: -3 * progress.value }],
  }));

  return (
    <Animated.View style={style}>
      <View className={theme.typingDot} />
    </Animated.View>
  );
}

function TypingIndicator() {
  return (
    <View className={theme.typingRow} accessible accessibilityRole="progressbar" accessibilityLabel="Assistant is typing">
      <TypingDot delay={0} />
      <TypingDot delay={140} />
      <TypingDot delay={280} />
    </View>
  );
}

/* -------------------------------------------------------------------------------------------------
 * StreamingChatBubble
 * -----------------------------------------------------------------------------------------------*/

function StreamingChatBubbleImpl({
  role,
  content,
  isStreaming = false,
  avatar,
  header,
  footer,
  animateEntry = true,
  className,
}: StreamingChatBubbleProps) {
  const segments = useMemo<RenderedSegment[]>(() => {
    const raw = parseSegments(content);
    return raw.map((segment, index) =>
      segment.type === "code"
        ? segment
        : { type: "text", blocks: parseBlocks(segment.value, isStreaming && index === raw.length - 1) },
    );
  }, [content, isStreaming]);

  // Segments that will actually draw something: a tail that is only "##" has no blocks yet, and a
  // stream cut off right after an opening fence leaves an empty code block to drop.
  const visible = segments.filter((segment) =>
    segment.type === "code"
      ? (isStreaming && !segment.complete) || segment.value.trim().length > 0
      : segment.blocks.length > 0,
  );
  const showTyping = isStreaming && visible.length === 0;
  const showSurface = showTyping || visible.length > 0;

  const hasCode = segments.some((segment) => segment.type === "code");
  const hasLink = segments.some((segment) => segment.type === "text" && blocksHaveLink(segment.blocks));
  // Plain-text bubbles are one screen-reader stop. Bubbles with code or links stay ungrouped so
  // the CodeBlock's copy button and each link remain reachable.
  const groupForScreenReader = !hasCode && !hasLink && !showTyping;
  const plainText = useMemo(
    () =>
      groupForScreenReader
        ? segments.map((segment) => (segment.type === "text" ? blocksToPlainText(segment.blocks) : "")).join("\n")
        : "",
    [segments, groupForScreenReader],
  );

  // The bubble's height follows its measured content through a short tween, so each streamed
  // chunk (or a new line wrapping) eases in instead of snapping the list.
  const height = useSharedValue(0);
  const hasMeasured = useRef(false);
  const [measured, setMeasured] = useState(false);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.height;
      if (!hasMeasured.current) {
        hasMeasured.current = true;
        height.value = next;
        setMeasured(true);
        return;
      }
      height.value = withTiming(next, { duration: GROW_DURATION_MS, easing: Easing.out(Easing.cubic) });
    },
    [height],
  );

  const heightStyle = useAnimatedStyle(() => (measured ? { height: height.value } : {}), [measured]);

  const lastVisible = visible[visible.length - 1];

  return (
    <Animated.View entering={animateEntry ? FadeInDown.duration(260).withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] }) : undefined}>
      <View className={theme.row[role]}>
        {role === "assistant" && avatar ? avatar : null}

        <View className={theme.column[role]}>
          {header ? <View className={theme.header}>{header}</View> : null}

          {showSurface ? (
            // "scroll" clips like "hidden", but Yoga only measures children unconstrained by this
            // view's (animated) height when overflow is "scroll". With "hidden" the content is
            // capped at the current height, never reports growing, and the bubble freezes.
            <Animated.View style={[{ overflow: "scroll" }, heightStyle]}>
              <View
                onLayout={onContentLayout}
                className={cx(theme.bubble[role], className)}
                accessible={groupForScreenReader}
                accessibilityLabel={groupForScreenReader ? `${role === "user" ? "You" : "Assistant"}: ${plainText}` : undefined}
              >
                {showTyping ? <TypingIndicator /> : null}

                {visible.map((segment, index) => {
                  const isLastSegment = segment === lastVisible;

                  if (segment.type === "code") {
                    return (
                      <CodeBlock
                        key={`code-${index}`}
                        code={segment.value}
                        language={segment.language}
                        isStreaming={isStreaming && !segment.complete}
                      />
                    );
                  }

                  return segment.blocks.map((block, blockIndex) => {
                    const isLastBlock = isLastSegment && blockIndex === segment.blocks.length - 1;
                    return (
                      <MarkdownBlock
                        key={`text-${index}-${blockIndex}`}
                        block={block}
                        role={role}
                        caret={isStreaming && isLastBlock}
                        gap={!isLastBlock}
                      />
                    );
                  });
                })}
              </View>
            </Animated.View>
          ) : null}

          {footer ? <View className={theme.footer}>{footer}</View> : null}
        </View>
      </View>
    </Animated.View>
  );
}

export const StreamingChatBubble = memo(StreamingChatBubbleImpl);
StreamingChatBubble.displayName = "StreamingChatBubble";

export default StreamingChatBubble;
