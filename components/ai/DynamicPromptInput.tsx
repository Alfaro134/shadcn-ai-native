import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputProps,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";

/* -------------------------------------------------------------------------------------------------
 * Theme — edit these class strings to restyle the component.
 * -----------------------------------------------------------------------------------------------*/

const theme = {
  root: "w-full bg-white px-3 pt-2 pb-2 dark:bg-zinc-950",
  container:
    "flex-row items-end gap-1 rounded-[26px] border border-zinc-200 bg-zinc-50 p-1.5 dark:border-zinc-800 dark:bg-zinc-900",
  input: "px-1.5 py-2 text-[16px] leading-[22px] text-zinc-900 dark:text-zinc-100",
  placeholderColor: "#a1a1aa", // zinc-400; TextInput needs a raw color here
  selectionColor: "#71717a", // zinc-500
  attachButton: "h-10 w-10 items-center justify-center rounded-full active:bg-zinc-200 dark:active:bg-zinc-800",
  attachIcon: "bg-zinc-500 dark:bg-zinc-400",
  actionButton: {
    enabled: "h-10 w-10 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100",
    disabled: "h-10 w-10 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800",
  },
  actionIconFill: {
    enabled: "bg-white dark:bg-zinc-900",
    disabled: "bg-zinc-400 dark:bg-zinc-600",
  },
  actionIconStroke: {
    enabled: "border-white dark:border-zinc-900",
    disabled: "border-zinc-400 dark:border-zinc-600",
  },
} as const;

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export interface DynamicPromptInputProps {
  /** Controlled value. Omit to let the component manage its own text. */
  value?: string;
  onChangeText?: (text: string) => void;
  /** Called with the trimmed prompt. Uncontrolled inputs clear themselves afterwards. */
  onSend: (text: string) => void;
  /** Called when the user taps the stop button while `isGenerating`. */
  onStop?: () => void;
  /** Called when the attach button is pressed. The button is hidden when omitted. */
  onAttach?: () => void;
  /** Swaps the send button for a stop button. */
  isGenerating?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Height of one line, in px. */
  minHeight?: number;
  /** Height the input grows to before it starts scrolling, in px. */
  maxHeight?: number;
  /**
   * Bottom safe-area inset (e.g. `useSafeAreaInsets().bottom`). Applied when the keyboard is
   * closed; the keyboard height replaces it when open.
   */
  bottomInset?: number;
  /** Set to false if a parent already handles keyboard avoidance. */
  avoidKeyboard?: boolean;
  /** Rendered above the input row, e.g. <ActionChips /> or attachment previews. */
  accessory?: React.ReactNode;
  /** Escape hatch for any other TextInput prop. */
  inputProps?: Omit<TextInputProps, "value" | "onChangeText" | "multiline" | "onContentSizeChange" | "editable">;
  className?: string;
}

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function PlusIcon() {
  return (
    <View className="h-5 w-5 items-center justify-center">
      <View className={cx("absolute h-[2px] w-[18px] rounded-full", theme.attachIcon)} />
      <View className={cx("absolute h-[18px] w-[2px] rounded-full", theme.attachIcon)} />
    </View>
  );
}

function ArrowUpIcon({ enabled }: { enabled: boolean }) {
  const state = enabled ? "enabled" : "disabled";
  return (
    <View className="h-[18px] w-[18px] items-center">
      <View className={cx("absolute top-[3px] h-[9px] w-[9px] rotate-45 border-l-2 border-t-2", theme.actionIconStroke[state])} />
      <View className={cx("absolute bottom-[1px] top-[3px] w-[2px] rounded-full", theme.actionIconFill[state])} />
    </View>
  );
}

function StopIcon() {
  return <View className={cx("h-3 w-3 rounded-[3px]", theme.actionIconFill.enabled)} />;
}

/* -------------------------------------------------------------------------------------------------
 * DynamicPromptInput
 * -----------------------------------------------------------------------------------------------*/

export function DynamicPromptInput({
  value,
  onChangeText,
  onSend,
  onStop,
  onAttach,
  isGenerating = false,
  disabled = false,
  placeholder = "Message",
  minHeight = 40,
  maxHeight = 160,
  bottomInset = 0,
  avoidKeyboard = true,
  accessory,
  inputProps,
  className,
}: DynamicPromptInputProps) {
  const isControlled = value !== undefined;
  const [innerValue, setInnerValue] = useState("");
  const text = isControlled ? value : innerValue;

  const [scrollEnabled, setScrollEnabled] = useState(false);
  const inputHeight = useSharedValue(minHeight);
  const buttonScale = useSharedValue(1);

  // Keyboard avoidance runs on the UI thread and tracks the keyboard frame by frame on both
  // platforms, including Android edge-to-edge where KeyboardAvoidingView falls short.
  const keyboard = useAnimatedKeyboard();

  const canSend = text.trim().length > 0 && !disabled;
  const mode: "send" | "stop" = isGenerating ? "stop" : "send";
  const actionEnabled = mode === "stop" ? !!onStop : canSend;

  const handleChangeText = useCallback(
    (next: string) => {
      if (!isControlled) setInnerValue(next);
      onChangeText?.(next);
    },
    [isControlled, onChangeText],
  );

  const handleContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const contentHeight = event.nativeEvent.contentSize.height;
      const next = Math.min(maxHeight, Math.max(minHeight, contentHeight));
      inputHeight.value = withTiming(next, { duration: 140, easing: Easing.out(Easing.cubic) });
      setScrollEnabled(contentHeight > maxHeight);
    },
    [inputHeight, maxHeight, minHeight],
  );

  // Android does not always emit a content-size change when the text is cleared programmatically.
  useEffect(() => {
    if (text.length === 0) {
      inputHeight.value = withTiming(minHeight, { duration: 140, easing: Easing.out(Easing.cubic) });
      setScrollEnabled(false);
    }
  }, [text, minHeight, inputHeight]);

  const handleActionPress = useCallback(() => {
    if (mode === "stop") {
      onStop?.();
      return;
    }
    if (!canSend) return;
    onSend(text.trim());
    if (!isControlled) setInnerValue("");
  }, [mode, onStop, canSend, onSend, text, isControlled]);

  const inputStyle = useAnimatedStyle(() => ({ height: inputHeight.value }));

  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: buttonScale.value }] }));

  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: avoidKeyboard ? Math.max(keyboard.height.value, bottomInset) : bottomInset,
  }));

  return (
    <View className={cx(theme.root, className)}>
      {accessory}

      <View className={theme.container}>
        {onAttach ? (
          <Pressable
            onPress={onAttach}
            disabled={disabled}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Attach file"
            className={theme.attachButton}
          >
            <PlusIcon />
          </Pressable>
        ) : null}

        <View className="flex-1">
          <Animated.View style={inputStyle}>
            <TextInput
              {...inputProps}
              value={text}
              onChangeText={handleChangeText}
              onContentSizeChange={handleContentSizeChange}
              multiline
              editable={!disabled}
              scrollEnabled={scrollEnabled}
              placeholder={placeholder}
              placeholderTextColor={theme.placeholderColor}
              selectionColor={theme.selectionColor}
              textAlignVertical="top"
              accessibilityLabel={placeholder}
              className={theme.input}
              style={{ height: "100%" }}
            />
          </Animated.View>
        </View>

        <Animated.View style={buttonStyle}>
          <Pressable
            onPress={handleActionPress}
            onPressIn={() => {
              buttonScale.value = withSpring(0.9, { damping: 15, stiffness: 400 });
            }}
            onPressOut={() => {
              buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
            }}
            disabled={!actionEnabled}
            accessibilityRole="button"
            accessibilityLabel={mode === "stop" ? "Stop generating" : "Send message"}
            accessibilityState={{ disabled: !actionEnabled }}
            className={actionEnabled ? theme.actionButton.enabled : theme.actionButton.disabled}
          >
            <Animated.View key={mode} entering={ZoomIn.duration(160)} exiting={ZoomOut.duration(120)}>
              {mode === "stop" ? <StopIcon /> : <ArrowUpIcon enabled={actionEnabled} />}
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>

      <Animated.View style={keyboardSpacerStyle} />
    </View>
  );
}

export default DynamicPromptInput;
