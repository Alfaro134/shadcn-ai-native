import React, { memo, useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

/* -------------------------------------------------------------------------------------------------
 * Theme — edit these class strings to restyle the component.
 * -----------------------------------------------------------------------------------------------*/

const theme = {
  scroll: "flex-grow-0",
  content: "flex-row items-center gap-2 px-4 py-1",
  chip: "flex-row items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-2 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800",
  chipDisabled: "opacity-40",
  label: "text-[13px] font-medium text-zinc-700 dark:text-zinc-300",
} as const;

/**
 * Chips are ~36px tall; 6px above and below brings the touch target to 48px. Horizontal slop
 * stays under half the 8px gap so neighbouring chips never overlap.
 */
const CHIP_HIT_SLOP = { top: 6, bottom: 6, left: 3, right: 3 };

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export interface ActionChip {
  /** Stable key; also used to re-trigger the entry animation if the list changes. */
  id: string;
  label: string;
  /** Optional leading icon node (keep it ~14px). */
  icon?: React.ReactNode;
  /** Per-chip handler. Runs before `onChipPress`. */
  onPress?: () => void;
  disabled?: boolean;
}

export interface ActionChipsProps {
  chips: ActionChip[];
  /** Shared handler for every chip. */
  onChipPress?: (chip: ActionChip) => void;
  /** Delay before the first chip animates in, in ms. */
  initialDelay?: number;
  /** Delay between each chip's entrance, in ms. */
  stagger?: number;
  className?: string;
  contentContainerClassName?: string;
}

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------------------------------
 * Chip
 * -----------------------------------------------------------------------------------------------*/

interface ChipProps {
  chip: ActionChip;
  index: number;
  initialDelay: number;
  stagger: number;
  onChipPress?: (chip: ActionChip) => void;
}

function Chip({ chip, index, initialDelay, stagger, onChipPress }: ChipProps) {
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = useCallback(() => {
    chip.onPress?.();
    onChipPress?.(chip);
  }, [chip, onChipPress]);

  return (
    <Animated.View
      entering={FadeInDown.delay(initialDelay + index * stagger)
        .duration(320)
        .easing(Easing.out(Easing.cubic))
        .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })}
    >
      <Animated.View style={pressStyle}>
        <Pressable
          onPress={handlePress}
          onPressIn={() => {
            scale.value = withSpring(0.95, { damping: 15, stiffness: 400 });
          }}
          onPressOut={() => {
            scale.value = withSpring(1, { damping: 15, stiffness: 400 });
          }}
          disabled={chip.disabled}
          hitSlop={CHIP_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={chip.label}
          accessibilityState={{ disabled: !!chip.disabled }}
          className={cx(theme.chip, chip.disabled && theme.chipDisabled)}
        >
          {chip.icon ? <View>{chip.icon}</View> : null}
          <Text className={theme.label} numberOfLines={1}>
            {chip.label}
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------------------------------
 * ActionChips
 * -----------------------------------------------------------------------------------------------*/

function ActionChipsImpl({
  chips,
  onChipPress,
  initialDelay = 80,
  stagger = 50,
  className,
  contentContainerClassName,
}: ActionChipsProps) {
  if (chips.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className={cx(theme.scroll, className)}
      contentContainerClassName={cx(theme.content, contentContainerClassName)}
    >
      {chips.map((chip, index) => (
        <Chip
          key={chip.id}
          chip={chip}
          index={index}
          initialDelay={initialDelay}
          stagger={stagger}
          onChipPress={onChipPress}
        />
      ))}
    </ScrollView>
  );
}

export const ActionChips = memo(ActionChipsImpl);
ActionChips.displayName = "ActionChips";

export default ActionChips;
