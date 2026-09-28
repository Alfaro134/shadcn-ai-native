import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
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
import {
  inlineToPlainText,
  markdownHasLinks,
  markdownToPlainText,
  parseMarkdown,
  type Block,
  type Inline,
  type ListItem,
  type MarkdownSegment,
  type TableAlign,
} from "./markdown";

/* -------------------------------------------------------------------------------------------------
 * Theme — edit these class strings to restyle the component, or override single parts per
 * instance with the `classNames` prop.
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
  strike: "line-through",
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
  taskDone: "text-emerald-500 dark:text-emerald-400",
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
  table: {
    user: "overflow-hidden rounded-xl border border-zinc-700 dark:border-zinc-300",
    assistant: "overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700",
  },
  tableHeader: {
    user: "bg-zinc-800 dark:bg-zinc-200",
    assistant: "bg-zinc-200/70 dark:bg-zinc-800",
  },
  tableRow: {
    user: "border-t border-zinc-700 dark:border-zinc-300",
    assistant: "border-t border-zinc-200 dark:border-zinc-700",
  },
  tableCell: "px-3 py-2",
  tableText: "text-[14px] leading-5",
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
/** Horizontal space reserved for a list marker ("•", "9."), and for wide ones ("10.", "☐"). */
const LIST_MARKER_WIDTH = 20;
const LIST_MARKER_WIDE = 28;
/** Extra indent per list nesting level. */
const LIST_INDENT = 16;
/** Table column width bounds, and the rough width of one character at the table font size. */
const TABLE_COLUMN_MIN = 64;
const TABLE_COLUMN_MAX = 220;
const TABLE_CHAR_WIDTH = 7.5;

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export type ChatRole = "user" | "assistant";

/** Every string the bubble shows or announces. Override them to translate the component. */
export interface StreamingChatBubbleLabels {
  /** Screen-reader label of the typing indicator. */
  typing: string;
  /** Prefix of the screen-reader label for user messages ("You: …"). */
  user: string;
  /** Prefix of the screen-reader label for assistant messages ("Assistant: …"). */
  assistant: string;
  /** Prefix for images, which render as links ("Image: a cat"). */
  image: string;
}

const DEFAULT_LABELS: StreamingChatBubbleLabels = {
  typing: "Assistant is typing",
  user: "You",
  assistant: "Assistant",
  image: "Image",
};

/** Parts of the bubble whose theme classes can be replaced per instance. */
export type StreamingChatBubbleSlot =
  | "bubble"
  | "text"
  | "link"
  | "inlineCode"
  | "listMarker"
  | "quote"
  | "quoteText"
  | "rule"
  | "table";

/**
 * Replace how a Markdown element renders without forking the file. Keep the object stable
 * (hoisted or `useMemo`) so finished bubbles don't re-render.
 *
 * `link` and `image` render *inside* a <Text>, so they must return text nodes (<Text>, strings).
 */
export interface MarkdownComponents {
  code?: (props: { code: string; language?: string; isStreaming: boolean }) => React.ReactNode;
  /** `onPress` opens the URL through `onLinkPress`; the URL is already validated. */
  link?: (props: { url: string; children: React.ReactNode; role: ChatRole; onPress: () => void }) => React.ReactNode;
  image?: (props: { url: string; alt: string; role: ChatRole; onPress: () => void }) => React.ReactNode;
  heading?: (props: { level: 1 | 2 | 3 | 4 | 5 | 6; children: React.ReactNode; role: ChatRole }) => React.ReactNode;
  quote?: (props: { children: React.ReactNode; role: ChatRole }) => React.ReactNode;
  /** Just the marker: return e.g. <Text>→</Text> to change bullets. */
  listMarker?: (props: { item: ListItem; role: ChatRole }) => React.ReactNode;
}

export interface StreamingChatBubbleProps {
  /** Who sent the message. Controls alignment and colors. */
  role: ChatRole;
  /**
   * Full message text so far, as Markdown (see markdown.ts for the supported subset). Code fences
   * render as <CodeBlock />. Safe to pass mid-stream: half-written markup is never shown raw.
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
  /**
   * Ease the bubble's height into each streamed chunk (default `true`). Set `false` to let it grow
   * instantly, e.g. on low-end devices or if the measured-height animation misbehaves.
   */
  animateGrowth?: boolean;
  /** Translated strings. Anything omitted falls back to English. */
  labels?: Partial<StreamingChatBubbleLabels>;
  /** Custom renderers for Markdown elements. Same stability note as `avatar`. */
  components?: MarkdownComponents;
  /**
   * Called when the user taps a link or image in the message. Defaults to `Linking.openURL`.
   * Model output is untrusted: a reply can show "your-bank.com" and point elsewhere. Use this to
   * confirm, show the real domain, or open links in an in-app browser. Only http(s) and mailto:
   * URLs ever reach it.
   */
  onLinkPress?: (url: string) => void;
  /**
   * Replace a part's theme classes (not merged, so no utility conflicts). Prefer this over
   * `className` when changing something the theme already sets, like padding or background.
   */
  classNames?: Partial<Record<StreamingChatBubbleSlot, string>>;
  /** Extra classes appended to the bubble surface. Conflicting utilities are not resolved. */
  className?: string;
}

/* -------------------------------------------------------------------------------------------------
 * Rendering context
 * -----------------------------------------------------------------------------------------------*/

interface RenderContext {
  role: ChatRole;
  labels: StreamingChatBubbleLabels;
  components: MarkdownComponents;
  cls: (slot: StreamingChatBubbleSlot) => string;
  openLink: (url: string) => void;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function defaultOpenLink(url: string) {
  Linking.openURL(url).catch(() => {});
}

function renderInline(nodes: Inline[], ctx: RenderContext, keyPrefix = ""): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "bold":
      case "italic":
      case "strike":
        return (
          <Text key={key} className={theme[node.type]}>
            {renderInline(node.children, ctx, `${key}.`)}
          </Text>
        );
      case "code":
        return (
          <Text key={key} className={ctx.cls("inlineCode")}>
            {` ${node.value} `}
          </Text>
        );
      case "link": {
        const children = renderInline(node.children, ctx, `${key}.`);
        if (ctx.components.link) {
          return <React.Fragment key={key}>{ctx.components.link({ url: node.url, children, role: ctx.role, onPress: () => ctx.openLink(node.url) })}</React.Fragment>;
        }
        return (
          <Text
            key={key}
            className={ctx.cls("link")}
            onPress={() => ctx.openLink(node.url)}
            accessibilityRole="link"
            accessibilityHint={node.url}
          >
            {children}
          </Text>
        );
      }
      case "image": {
        if (ctx.components.image) {
          return <React.Fragment key={key}>{ctx.components.image({ url: node.url, alt: node.alt, role: ctx.role, onPress: () => ctx.openLink(node.url) })}</React.Fragment>;
        }
        // Remote images have unknown sizes and would make the bubble jump mid-stream, so by
        // default they render as a link. Pass `components.image` to show them inline.
        const label = node.alt ? `${ctx.labels.image}: ${node.alt}` : ctx.labels.image;
        return (
          <Text key={key} className={ctx.cls("link")} onPress={() => ctx.openLink(node.url)} accessibilityRole="link" accessibilityLabel={label}>
            {`🖼 ${node.alt || ctx.labels.image}`}
          </Text>
        );
      }
    }
  });
}

/* -------------------------------------------------------------------------------------------------
 * Blocks
 * -----------------------------------------------------------------------------------------------*/

function ListMarker({ item, ctx }: { item: ListItem; ctx: RenderContext }) {
  if (ctx.components.listMarker) return <>{ctx.components.listMarker({ item, role: ctx.role })}</>;
  if (item.checked !== undefined) {
    return <Text className={cx(ctx.cls("text"), item.checked ? theme.taskDone : ctx.cls("listMarker"))}>{item.checked ? "☑" : "☐"}</Text>;
  }
  return <Text className={cx(ctx.cls("text"), ctx.cls("listMarker"))}>{item.marker}</Text>;
}

const TEXT_ALIGN: Record<TableAlign, "left" | "center" | "right"> = { left: "left", center: "center", right: "right" };

function MarkdownTable({ block, ctx }: { block: Extract<Block, { type: "table" }>; ctx: RenderContext }) {
  // Explicit column widths from the longest cell keep the grid aligned without measuring, and
  // keep Yoga from sizing the bubble by unwrapped cell text.
  const widths = block.align.map((_, col) => {
    let longest = 0;
    for (const row of [block.header, ...block.rows]) longest = Math.max(longest, inlineToPlainText(row[col] ?? []).length);
    return Math.min(TABLE_COLUMN_MAX, Math.max(TABLE_COLUMN_MIN, Math.round(longest * TABLE_CHAR_WIDTH + 24)));
  });

  const renderRow = (cells: Inline[][], header: boolean, key: string) => (
    <View key={key} className={cx("flex-row", header ? theme.tableHeader[ctx.role] : theme.tableRow[ctx.role])}>
      {cells.map((cell, col) => (
        <View key={col} className={theme.tableCell} style={{ width: widths[col] }}>
          <Text className={cx(ctx.cls("text"), theme.tableText, header && theme.bold)} style={{ textAlign: TEXT_ALIGN[block.align[col]] }} selectable>
            {renderInline(cell, ctx)}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    // flex-grow-0: ScrollView defaults to flexGrow 1, which inside an auto-height bubble claims the
    // list's free space and makes the bubble grow without end (same fix as CodeBlock).
    <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} className="flex-grow-0">
      <View className={ctx.cls("table")}>
        {renderRow(block.header, true, "h")}
        {block.rows.map((row, r) => renderRow(row, false, `r${r}`))}
      </View>
    </ScrollView>
  );
}

interface MarkdownBlockProps {
  block: Block;
  ctx: RenderContext;
  caret: boolean;
  gap: boolean;
}

function MarkdownBlock({ block, ctx, caret, gap }: MarkdownBlockProps) {
  const caretNode = caret ? <BlinkingCaret /> : null;
  const gapClass = gap && theme.blockGap;

  switch (block.type) {
    case "paragraph":
      return (
        <Text className={cx(ctx.cls("text"), gapClass)} selectable>
          {renderInline(block.inline, ctx)}
          {caretNode}
        </Text>
      );

    case "heading": {
      const children = (
        <>
          {renderInline(block.inline, ctx)}
          {caretNode}
        </>
      );
      if (ctx.components.heading) {
        return <View className={cx(gapClass)}>{ctx.components.heading({ level: block.level, children, role: ctx.role })}</View>;
      }
      const size = theme.heading[Math.min(block.level, 4) as 1 | 2 | 3 | 4];
      return (
        <Text className={cx(ctx.cls("text"), size, gapClass)} accessibilityRole="header" selectable>
          {children}
        </Text>
      );
    }

    case "quote": {
      const children = (
        <Text className={cx(ctx.cls("text"), ctx.cls("quoteText"))} selectable>
          {renderInline(block.inline, ctx)}
          {caretNode}
        </Text>
      );
      if (ctx.components.quote) return <View className={cx(gapClass)}>{ctx.components.quote({ children, role: ctx.role })}</View>;
      return <View className={cx(ctx.cls("quote"), gapClass)}>{children}</View>;
    }

    case "list": {
      // Not a flex-row of [marker, text]: inside a content-sized bubble Yoga sizes such a row by the
      // text's *unwrapped* width, pushing the bubble past its max width. Instead the text is a
      // normal block with left padding, and the marker sits absolutely inside that padding.
      const wide = block.items.some((it) => it.marker.length > 2 || it.checked !== undefined);
      const markerWidth = wide ? LIST_MARKER_WIDE : LIST_MARKER_WIDTH;
      return (
        <View className={cx(gapClass)}>
          {block.items.map((item, index) => {
            const indent = item.depth * LIST_INDENT;
            return (
              <View key={index} style={{ paddingLeft: indent + markerWidth }}>
                <View style={{ position: "absolute", left: indent, top: 0 }}>
                  <ListMarker item={item} ctx={ctx} />
                </View>
                <Text className={ctx.cls("text")} selectable>
                  {renderInline(item.inline, ctx)}
                  {caret && index === block.items.length - 1 ? caretNode : null}
                </Text>
              </View>
            );
          })}
        </View>
      );
    }

    case "table":
      return (
        <View className={cx(gapClass)}>
          <MarkdownTable block={block} ctx={ctx} />
        </View>
      );

    case "rule":
      return <View className={cx(ctx.cls("rule"), gapClass)} />;
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
    progress.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 320, easing: Easing.in(Easing.quad) }),
          ),
          -1,
        ),
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

function TypingIndicator({ label }: { label: string }) {
  return (
    <View className={theme.typingRow} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <TypingDot delay={0} />
      <TypingDot delay={140} />
      <TypingDot delay={280} />
    </View>
  );
}

/* -------------------------------------------------------------------------------------------------
 * StreamingChatBubble
 * -----------------------------------------------------------------------------------------------*/

const NO_COMPONENTS: MarkdownComponents = {};

function StreamingChatBubbleImpl({
  role,
  content,
  isStreaming = false,
  avatar,
  header,
  footer,
  animateEntry = true,
  animateGrowth = true,
  labels: labelOverrides,
  components = NO_COMPONENTS,
  onLinkPress = defaultOpenLink,
  classNames,
  className,
}: StreamingChatBubbleProps) {
  const segments = useMemo(() => parseMarkdown(content, isStreaming), [content, isStreaming]);

  const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...labelOverrides }), [labelOverrides]);
  const ctx = useMemo<RenderContext>(
    () => ({
      role,
      labels,
      components,
      cls: (slot) => {
        const override = classNames?.[slot];
        if (override !== undefined) return override;
        const entry = theme[slot];
        return typeof entry === "string" ? entry : entry[role];
      },
      openLink: onLinkPress,
    }),
    [role, labels, components, classNames, onLinkPress],
  );

  // Segments that will actually draw something: a tail that is only "##" has no blocks yet, and a
  // stream cut off right after an opening fence leaves an empty code block to drop.
  const visible = segments.filter((segment): segment is MarkdownSegment =>
    segment.type === "code"
      ? (isStreaming && !segment.complete) || segment.value.trim().length > 0
      : segment.blocks.length > 0,
  );
  const showTyping = isStreaming && visible.length === 0;
  const showSurface = showTyping || visible.length > 0;

  const hasCode = segments.some((segment) => segment.type === "code");
  // Plain-text bubbles are one screen-reader stop. Bubbles with code or links stay ungrouped so
  // the CodeBlock's copy button and each link remain reachable.
  const groupForScreenReader = !hasCode && !showTyping && !markdownHasLinks(segments);
  const plainText = useMemo(() => (groupForScreenReader ? markdownToPlainText(segments) : ""), [segments, groupForScreenReader]);

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
        height.set(next);
        setMeasured(true);
        return;
      }
      height.set(withTiming(next, { duration: GROW_DURATION_MS, easing: Easing.out(Easing.cubic) }));
    },
    [height],
  );

  const heightStyle = useAnimatedStyle(() => (measured ? { height: height.value } : {}), [measured]);

  const lastVisible = visible[visible.length - 1];

  const surface = (
    <View
      onLayout={animateGrowth ? onContentLayout : undefined}
      className={cx(ctx.cls("bubble"), className)}
      accessible={groupForScreenReader}
      accessibilityLabel={groupForScreenReader ? `${role === "user" ? labels.user : labels.assistant}: ${plainText}` : undefined}
    >
      {showTyping ? <TypingIndicator label={labels.typing} /> : null}

      {visible.map((segment, index) => {
        const isLastSegment = segment === lastVisible;

        if (segment.type === "code") {
          const codeStreaming = isStreaming && !segment.complete;
          if (components.code) {
            return (
              <React.Fragment key={`code-${index}`}>
                {components.code({ code: segment.value, language: segment.language, isStreaming: codeStreaming })}
              </React.Fragment>
            );
          }
          return <CodeBlock key={`code-${index}`} code={segment.value} language={segment.language} isStreaming={codeStreaming} />;
        }

        return segment.blocks.map((block, blockIndex) => {
          const isLastBlock = isLastSegment && blockIndex === segment.blocks.length - 1;
          return (
            <MarkdownBlock key={`text-${index}-${blockIndex}`} block={block} ctx={ctx} caret={isStreaming && isLastBlock} gap={!isLastBlock} />
          );
        });
      })}
    </View>
  );

  return (
    <Animated.View entering={animateEntry ? FadeInDown.duration(260).withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] }) : undefined}>
      <View className={theme.row[role]}>
        {role === "assistant" && avatar ? avatar : null}

        <View className={theme.column[role]}>
          {header ? <View className={theme.header}>{header}</View> : null}

          {showSurface ? (
            animateGrowth ? (
              // "scroll" clips like "hidden", but Yoga only measures children unconstrained by this
              // view's (animated) height when overflow is "scroll". With "hidden" the content is
              // capped at the current height, never reports growing, and the bubble freezes.
              // Verified on React Native 0.86 (Fabric); `animateGrowth={false}` skips it entirely.
              <Animated.View style={[{ overflow: "scroll" }, heightStyle]}>{surface}</Animated.View>
            ) : (
              surface
            )
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
