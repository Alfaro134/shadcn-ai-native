import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/* -------------------------------------------------------------------------------------------------
 * Theme — edit these class strings to restyle the component.
 * -----------------------------------------------------------------------------------------------*/

const theme = {
  container: "self-stretch",
  header: "flex-row items-center gap-2 self-start rounded-full py-1 pr-2 active:opacity-60",
  sparkle: "text-[13px] text-zinc-400 dark:text-zinc-500",
  label: "text-[13px] font-medium text-zinc-500 dark:text-zinc-400",
  chevron: "h-[7px] w-[7px] border-b-[1.5px] border-r-[1.5px] border-zinc-400 dark:border-zinc-500",
  body: "ml-[5px] mt-1 border-l-2 border-zinc-200 py-0.5 pl-3.5 dark:border-zinc-800",
  text: "text-[13px] leading-5 text-zinc-500 dark:text-zinc-400",
} as const;

const TOGGLE_DURATION_MS = 240;
const GROW_DURATION_MS = 160;

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export interface ReasoningBlockProps {
  /** The model's thought process so far. Rendered as plain text unless `children` is given. */
  content: string;
  /** True while reasoning tokens are arriving: shows "Thinking…" and keeps the block open. */
  isStreaming?: boolean;
  /**
   * How long the model thought, in seconds. Omit it to have the block time the stream itself
   * (from `isStreaming` turning on to turning off). Pass it for messages loaded from history.
   */
  duration?: number;
  /** Start expanded. Defaults to `isStreaming`, so live thoughts are visible and history is tidy. */
  defaultOpen?: boolean;
  /** Collapse automatically when streaming ends, unless the user toggled it. Default `true`. */
  autoCollapse?: boolean;
  /** Override the header text, e.g. "Chain of thought". */
  label?: string;
  /** Custom body, e.g. a Markdown renderer. Replaces the plain `content` text. */
  children?: React.ReactNode;
  /** Extra classes merged onto the outer container. */
  className?: string;
}

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function headerLabel(isStreaming: boolean, seconds: number | undefined, label: string | undefined): string {
  if (label) return label;
  if (isStreaming) return "Thinking…";
  if (seconds === undefined) return "Reasoning";
  if (seconds < 1) return "Thought for a moment";
  return `Thought for ${seconds} second${seconds === 1 ? "" : "s"}`;
}

/* -------------------------------------------------------------------------------------------------
 * Sub-components
 * -----------------------------------------------------------------------------------------------*/

/** A slow breathing pulse on the header while the model is thinking. */
function useThinkingPulse(active: boolean) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!active) {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 200 });
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.45, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    return () => cancelAnimation(pulse);
  }, [active, pulse]);

  return useAnimatedStyle(() => ({ opacity: pulse.value }));
}

/* -------------------------------------------------------------------------------------------------
 * ReasoningBlock
 * -----------------------------------------------------------------------------------------------*/

function ReasoningBlockImpl({
  content,
  isStreaming = false,
  duration,
  defaultOpen,
  autoCollapse = true,
  label,
  children,
  className,
}: ReasoningBlockProps) {
  const [open, setOpen] = useState(defaultOpen ?? isStreaming);
  const userToggled = useRef(false);

  // Time the stream when no duration is supplied.
  const startedAt = useRef<number | null>(isStreaming ? Date.now() : null);
  const [measuredSeconds, setMeasuredSeconds] = useState<number | undefined>(undefined);
  const wasStreaming = useRef(isStreaming);

  useEffect(() => {
    if (isStreaming && !wasStreaming.current) {
      startedAt.current = Date.now();
      if (!userToggled.current) setOpen(true);
    }
    if (!isStreaming && wasStreaming.current) {
      if (startedAt.current !== null) setMeasuredSeconds(Math.round((Date.now() - startedAt.current) / 1000));
      if (autoCollapse && !userToggled.current) setOpen(false);
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, autoCollapse]);

  const toggle = useCallback(() => {
    userToggled.current = true;
    setOpen((value) => !value);
  }, []);

  // Expand/collapse: height = measured content height × progress, both on the UI thread.
  const progress = useSharedValue(open ? 1 : 0);
  const contentHeight = useSharedValue(0);
  const hasMeasured = useRef(false);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: TOGGLE_DURATION_MS, easing: Easing.out(Easing.cubic) });
  }, [open, progress]);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.height;
      if (!hasMeasured.current) {
        hasMeasured.current = true;
        contentHeight.value = next;
        return;
      }
      // Streaming thoughts grow the body; ease into each new line like the chat bubble does.
      contentHeight.value = withTiming(next, { duration: GROW_DURATION_MS, easing: Easing.out(Easing.cubic) });
    },
    [contentHeight],
  );

  const bodyStyle = useAnimatedStyle(() => ({
    height: contentHeight.value * progress.value,
    opacity: progress.value,
  }));
  const chevronStyle = useAnimatedStyle(() => ({
    // -45° points right (collapsed); 45° points down (expanded).
    transform: [{ rotate: `${-45 + progress.value * 90}deg` }],
  }));
  const pulseStyle = useThinkingPulse(isStreaming);

  const seconds = duration ?? measuredSeconds;
  const title = headerLabel(isStreaming, seconds === undefined ? undefined : Math.max(0, Math.round(seconds)), label);

  return (
    <View className={cx(theme.container, className)}>
      <Pressable
        onPress={toggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={open ? "Hides the reasoning" : "Shows the reasoning"}
        accessibilityState={{ expanded: open, busy: isStreaming }}
        className={theme.header}
      >
        <Animated.View style={pulseStyle}>
          <View className="flex-row items-center gap-2">
            <Text className={theme.sparkle}>✦</Text>
            <Text className={theme.label}>{title}</Text>
          </View>
        </Animated.View>
        <Animated.View style={chevronStyle}>
          <View className="ml-0.5 h-3 w-3 items-center justify-center">
            <View className={theme.chevron} />
          </View>
        </Animated.View>
      </Pressable>

      {/* "scroll" clips like "hidden" but lets Yoga measure the body at its natural height even
          while the container is animating from 0, so onLayout always reports the real size. */}
      <Animated.View
        style={[{ overflow: "scroll" }, bodyStyle]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        <View onLayout={onContentLayout} className={theme.body}>
          {children ?? (
            <Text className={theme.text} selectable>
              {content}
            </Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

export const ReasoningBlock = memo(ReasoningBlockImpl);
ReasoningBlock.displayName = "ReasoningBlock";

export default ReasoningBlock;
