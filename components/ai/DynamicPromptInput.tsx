import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputProps,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
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

/** The input never grows taller than this fraction of the window, whatever `maxHeight` says. */
const MAX_WINDOW_FRACTION = 0.35;
const GROW_TIMING = { duration: 140, easing: Easing.out(Easing.cubic) };
const PRESS_SPRING = { damping: 15, stiffness: 400 };
/** 40px buttons + 4px slop on each side = 48px touch target (Material / Apple HIG minimum). */
const BUTTON_HIT_SLOP = 4;

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

/** Every string the input shows or announces. Override them to translate the component. */
export interface DynamicPromptInputLabels {
  placeholder: string;
  attach: string;
  send: string;
  stop: string;
}

const DEFAULT_LABELS: DynamicPromptInputLabels = {
  placeholder: "Message",
  attach: "Attach file",
  send: "Send message",
  stop: "Stop generating",
};

/** The keyboard's current height in px, readable on the UI thread (a Reanimated shared/derived value). */
export interface KeyboardHeight {
  readonly value: number;
}

const KEYBOARD_FALLBACK_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };

/**
 * Default keyboard source: Reanimated's `useAnimatedKeyboard`, which follows the keyboard frame
 * by frame and works in Expo Go with no extra native module. Reanimated 4 deprecates it in favor
 * of react-native-keyboard-controller; for production apps with a dev build, pass a
 * keyboard-controller hook as `useKeyboardHeight`.
 *
 * On older Android versions (verified on Android 9 in Expo Go) the system never delivers the
 * inset animation and `useAnimatedKeyboard` stays at 0. Until it reports a real height, this falls
 * back to React Native's Keyboard events, which fire everywhere (eased, not frame-synced).
 */
export function useReanimatedKeyboardHeight(): KeyboardHeight {
  const animated = useAnimatedKeyboard().height;
  const fallback = useSharedValue(0);
  const animatedWorks = useSharedValue(false);

  useAnimatedReaction(
    () => animated.value,
    (height) => {
      if (height > 0) animatedWorks.set(true);
    },
  );

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      // Android apps draw edge-to-edge (mandatory from SDK 54), down under the navigation bar, but
      // the event's `height` leaves that bar out. Measure from the keyboard's top edge instead.
      const height =
        Platform.OS === "android"
          ? Dimensions.get("screen").height - event.endCoordinates.screenY
          : event.endCoordinates.height;
      fallback.set(withTiming(Math.max(0, height), KEYBOARD_FALLBACK_TIMING));
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      fallback.set(withTiming(0, KEYBOARD_FALLBACK_TIMING));
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [fallback]);

  return useDerivedValue(() => (animatedWorks.value ? animated.value : fallback.value));
}

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
  /** Shortcut for `labels.placeholder`. */
  placeholder?: string;
  /** Translated strings. Anything omitted falls back to English. */
  labels?: Partial<DynamicPromptInputLabels>;
  /** Height of one line, in px. */
  minHeight?: number;
  /**
   * Height the input grows to before it starts scrolling, in px. Also capped at 35% of the
   * window height, so a huge paste can never cover the conversation.
   */
  maxHeight?: number;
  /**
   * Bottom safe-area inset (e.g. `useSafeAreaInsets().bottom`). Applied when the keyboard is
   * closed; the keyboard height replaces it when open.
   */
  bottomInset?: number;
  /**
   * Distance between this component's bottom edge and the bottom of the screen, e.g. a tab bar's
   * height. Subtracted from the keyboard height (same role as KeyboardAvoidingView's
   * `keyboardVerticalOffset`).
   */
  keyboardOffset?: number;
  /** Set to false if a parent already handles keyboard avoidance. */
  avoidKeyboard?: boolean;
  /**
   * Hook that returns the keyboard height as a shared value. Defaults to
   * `useReanimatedKeyboardHeight`. It is called as a hook, so pass a stable function (defined at
   * module level) and never switch it between renders. See the README for a
   * react-native-keyboard-controller adapter.
   */
  useKeyboardHeight?: () => KeyboardHeight;
  /** Rendered above the input row, e.g. <ActionChips /> or attachment previews. */
  accessory?: React.ReactNode;
  /** Escape hatch for any other TextInput prop (e.g. `maxLength`). */
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
  placeholder,
  labels: labelOverrides,
  minHeight = 40,
  maxHeight = 160,
  bottomInset = 0,
  keyboardOffset = 0,
  avoidKeyboard = true,
  useKeyboardHeight = useReanimatedKeyboardHeight,
  accessory,
  inputProps,
  className,
}: DynamicPromptInputProps) {
  const isControlled = value !== undefined;
  const [innerValue, setInnerValue] = useState("");
  const text = isControlled ? value : innerValue;
  const labels = { ...DEFAULT_LABELS, ...labelOverrides, ...(placeholder !== undefined ? { placeholder } : null) };

  // Latest text, readable synchronously from event handlers. Guards against a double tap sending
  // twice before the cleared value has re-rendered. Written only in handlers and effects, never
  // during render, so it stays correct under concurrent rendering.
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const { height: windowHeight } = useWindowDimensions();
  const effectiveMax = Math.max(minHeight, Math.min(maxHeight, Math.round(windowHeight * MAX_WINDOW_FRACTION)));

  // The TextInput's measured content height. Android doesn't always report a size change when
  // the text is cleared programmatically, so an empty input always counts as one line.
  const [contentHeight, setContentHeight] = useState(minHeight);
  const measuredHeight = text.length === 0 ? minHeight : contentHeight;
  const scrollEnabled = measuredHeight > effectiveMax;
  const inputHeight = useSharedValue(minHeight);
  const buttonScale = useSharedValue(1);

  // Tracks the keyboard frame by frame on the UI thread on both platforms, including Android
  // edge-to-edge (mandatory from SDK 54), where KeyboardAvoidingView is unreliable.
  const keyboardHeight = useKeyboardHeight();

  const canSend = text.trim().length > 0 && !disabled;
  const mode: "send" | "stop" = isGenerating ? "stop" : "send";
  const actionEnabled = mode === "stop" ? !!onStop : canSend;

  const handleContentSizeChange = useCallback((event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
    setContentHeight(event.nativeEvent.contentSize.height);
  }, []);

  // Ease the input to its clamped height whenever the content or the cap (rotation, split
  // screen, new props) changes. Only the shared value is written here, never React state.
  useEffect(() => {
    inputHeight.set(withTiming(Math.min(effectiveMax, Math.max(minHeight, measuredHeight)), GROW_TIMING));
  }, [measuredHeight, effectiveMax, minHeight, inputHeight]);

  const handleChangeText = useCallback(
    (next: string) => {
      textRef.current = next;
      if (!isControlled) setInnerValue(next);
      onChangeText?.(next);
    },
    [isControlled, onChangeText],
  );

  const handleActionPress = useCallback(() => {
    if (mode === "stop") {
      onStop?.();
      return;
    }
    const prompt = textRef.current.trim();
    if (prompt.length === 0 || disabled) return;
    textRef.current = "";
    onSend(prompt);
    if (!isControlled) setInnerValue("");
  }, [mode, onStop, disabled, onSend, isControlled]);

  const inputStyle = useAnimatedStyle(() => ({ height: inputHeight.value }));

  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: buttonScale.value }] }));

  const keyboardSpacerStyle = useAnimatedStyle(() => ({
    height: avoidKeyboard ? Math.max(keyboardHeight.value - keyboardOffset, bottomInset) : bottomInset,
  }));

  return (
    <View className={cx(theme.root, className)}>
      {accessory}

      <View className={theme.container}>
        {onAttach ? (
          <Pressable
            onPress={onAttach}
            disabled={disabled}
            hitSlop={BUTTON_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={labels.attach}
            accessibilityState={{ disabled }}
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
              placeholder={labels.placeholder}
              placeholderTextColor={theme.placeholderColor}
              selectionColor={theme.selectionColor}
              textAlignVertical="top"
              accessibilityLabel={inputProps?.accessibilityLabel ?? labels.placeholder}
              className={theme.input}
              style={{ height: "100%" }}
            />
          </Animated.View>
        </View>

        <Animated.View style={buttonStyle}>
          <Pressable
            onPress={handleActionPress}
            onPressIn={() => {
              buttonScale.set(withSpring(0.9, PRESS_SPRING));
            }}
            onPressOut={() => {
              buttonScale.set(withSpring(1, PRESS_SPRING));
            }}
            disabled={!actionEnabled}
            hitSlop={BUTTON_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={mode === "stop" ? labels.stop : labels.send}
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
