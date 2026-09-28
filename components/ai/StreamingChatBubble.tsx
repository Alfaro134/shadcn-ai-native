import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
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
  bold: "font-semibold",
  inlineCode: {
    user: "rounded bg-zinc-700 text-[13px] text-zinc-50 dark:bg-zinc-300 dark:text-zinc-900",
    assistant: "rounded bg-zinc-200 text-[13px] text-rose-600 dark:bg-zinc-700 dark:text-rose-300",
  },
  paragraphGap: "mb-2",
  caret: "text-zinc-400 dark:text-zinc-500",
  caretHidden: "text-transparent",
  typingRow: "h-[22px] flex-row items-center gap-1.5 px-0.5",
  typingDot: "h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500",
  footer: "mt-1.5",
} as const;

/** Duration of the height tween that absorbs each streamed chunk. */
const GROW_DURATION_MS = 160;

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export type ChatRole = "user" | "assistant";

export interface StreamingChatBubbleProps {
  /** Who sent the message. Controls alignment and colors. */
  role: ChatRole;
  /** Full message text so far. Triple-backtick fences render as <CodeBlock />. */
  content: string;
  /** True while tokens are still arriving: shows a caret, or a typing indicator if empty. */
  isStreaming?: boolean;
  /**
   * Optional avatar rendered to the left of assistant messages. The bubble is memoized: pass a
   * stable element (hoisted or `useMemo`) so finished bubbles don't re-render with the list.
   */
  avatar?: React.ReactNode;
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

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

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

/** Renders **bold** and `inline code` spans inside a paragraph. */
function renderInline(value: string, role: ChatRole): React.ReactNode[] {
  return value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((token, i) => {
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return (
        <Text key={i} className={theme.bold}>
          {token.slice(2, -2)}
        </Text>
      );
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return (
        <Text key={i} className={theme.inlineCode[role]}>
          {` ${token.slice(1, -1)} `}
        </Text>
      );
    }
    return token;
  });
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
  footer,
  animateEntry = true,
  className,
}: StreamingChatBubbleProps) {
  const segments = useMemo(() => parseSegments(content), [content]);
  const showTyping = isStreaming && segments.length === 0;
  const lastSegment = segments[segments.length - 1];
  const hasCode = segments.some((segment) => segment.type === "code");
  // Plain-text bubbles are one screen-reader stop. Bubbles with code stay ungrouped so the
  // CodeBlock's copy button remains reachable.
  const groupForScreenReader = !hasCode && !showTyping;

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

  return (
    <Animated.View entering={animateEntry ? FadeInDown.duration(260).withInitialValues({ opacity: 0, transform: [{ translateY: 10 }] }) : undefined}>
      <View className={theme.row[role]}>
        {role === "assistant" && avatar ? avatar : null}

        <View className={theme.column[role]}>
          {/* "scroll" clips like "hidden", but Yoga only measures children unconstrained by this
              view's (animated) height when overflow is "scroll". With "hidden" the content is
              capped at the current height, never reports growing, and the bubble freezes. */}
          <Animated.View style={[{ overflow: "scroll" }, heightStyle]}>
            <View
              onLayout={onContentLayout}
              className={cx(theme.bubble[role], className)}
              accessible={groupForScreenReader}
              accessibilityLabel={groupForScreenReader ? `${role === "user" ? "You" : "Assistant"}: ${content}` : undefined}
            >
              {showTyping ? <TypingIndicator /> : null}

              {segments.map((segment, index) => {
                const isLast = segment === lastSegment;

                if (segment.type === "code") {
                  const codeStreaming = isStreaming && !segment.complete;
                  // A stream cut off right after an opening fence leaves an empty block: drop it.
                  if (!codeStreaming && segment.value.trim().length === 0) return null;
                  return (
                    <CodeBlock
                      key={`code-${index}`}
                      code={segment.value}
                      language={segment.language}
                      isStreaming={codeStreaming}
                    />
                  );
                }

                return (
                  <Text
                    key={`text-${index}`}
                    className={cx(theme.text[role], !isLast && theme.paragraphGap)}
                    selectable
                  >
                    {renderInline(segment.value, role)}
                    {isStreaming && isLast ? <BlinkingCaret /> : null}
                  </Text>
                );
              })}
            </View>
          </Animated.View>

          {footer ? <View className={theme.footer}>{footer}</View> : null}
        </View>
      </View>
    </Animated.View>
  );
}

export const StreamingChatBubble = memo(StreamingChatBubbleImpl);
StreamingChatBubble.displayName = "StreamingChatBubble";

export default StreamingChatBubble;
