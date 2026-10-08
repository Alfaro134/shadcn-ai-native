import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { ZoomIn, ZoomOut } from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";

import { createStreamingHighlighter, trimTrailingNewlines, type Token, type TokenKind } from "./highlight";

/* -------------------------------------------------------------------------------------------------
 * Theme — edit these class strings to restyle the component.
 * -----------------------------------------------------------------------------------------------*/

const theme = {
  container: "my-2 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950",
  header: "flex-row items-center justify-between border-b border-zinc-800 bg-zinc-900 py-1.5 pl-4 pr-1.5",
  headerLeft: "flex-row items-center gap-2",
  languageDot: "h-2 w-2 rounded-full bg-emerald-400",
  language: "text-xs font-medium lowercase tracking-wide text-zinc-400",
  streamingBadge: "text-[11px] text-zinc-500",
  copyButton: "flex-row items-center gap-1.5 rounded-lg px-2.5 py-1.5 active:bg-zinc-800",
  copyLabel: "text-xs font-medium text-zinc-400",
  copiedLabel: "text-xs font-medium text-emerald-400",
  // ScrollView defaults to flexGrow: 1. Inside an auto-height bubble on Android that makes it
  // claim the list's free space, which grows the list, which grows the bubble — forever.
  scroll: "flex-grow-0",
  body: "flex-row px-4 py-3.5",
  code: "text-[13px] leading-5 text-zinc-100",
  lineNumbers: "mr-4 text-right text-[13px] leading-5 text-zinc-600",
  // Icon strokes. `iconBackdrop` must match the header background so the copy icon's
  // front square hides the back square's overlapping edges.
  iconStroke: "border-zinc-400",
  iconBackdrop: "bg-zinc-900",
  iconSuccessStroke: "border-emerald-400",
  // Syntax token colors.
  syntax: {
    plain: "",
    keyword: "text-violet-400",
    string: "text-emerald-300",
    comment: "italic text-zinc-500",
    number: "text-amber-300",
    function: "text-sky-300",
    type: "text-orange-300",
  },
} as const;

/** NativeWind's `font-mono` resolves to a CSS stack that native platforms can't use. */
const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

const COPIED_RESET_MS = 2000;

/** Default size above which highlighting is skipped: one nested <Text> per token gets expensive. */
const MAX_HIGHLIGHT_CHARS = 20_000;

// The theme must have a color for every token kind the highlighter emits.
const SYNTAX: Record<TokenKind, string> = theme.syntax;

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

/** Every string the block shows or announces. Override them to translate the component. */
export interface CodeBlockLabels {
  /** Header label when no language is given. */
  code: string;
  copy: string;
  copied: string;
  /** Badge while the fence is still streaming. */
  writing: string;
  /** Badge when the block is too large to highlight and renders as plain text. */
  plain: string;
  /** Screen-reader label of the copy button. */
  copyAction: (language: string) => string;
  /** Announced after copying. */
  copiedAnnouncement: string;
}

const DEFAULT_LABELS: CodeBlockLabels = {
  code: "code",
  copy: "Copy",
  copied: "Copied",
  writing: "writing…",
  plain: "plain text",
  copyAction: (language) => `Copy ${language} to clipboard`,
  copiedAnnouncement: "Code copied to clipboard",
};

export interface CodeBlockProps {
  /** Raw source code. Trailing newlines are trimmed for display only. */
  code: string;
  /** Language label shown in the header, e.g. "tsx", "python". */
  language?: string;
  /** Render a gutter with line numbers. */
  showLineNumbers?: boolean;
  /**
   * Color keywords, strings, comments, numbers, calls and types. Defaults to true. Best-effort:
   * a small regex highlighter tuned for JS/TS/JSON, Python and shell, with a generic fallback.
   */
  highlight?: boolean;
  /**
   * Above this many characters highlighting is skipped (one nested <Text> per token gets
   * expensive) and the header shows a "plain text" badge. Default 20,000.
   */
  maxHighlightChars?: number;
  /** Translated strings. Anything omitted falls back to English. */
  labels?: Partial<CodeBlockLabels>;
  /** True while the fence is still being streamed in (shows a subtle badge). */
  isStreaming?: boolean;
  /** Called after the code was written to the clipboard. */
  onCopy?: (code: string) => void;
  /** Extra classes merged onto the outer container. */
  className?: string;
}

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------------------------------
 * Icons
 * -----------------------------------------------------------------------------------------------*/

function CopyIcon() {
  return (
    <View className="h-3.5 w-3.5">
      <View className={cx("absolute left-0 top-0 h-2.5 w-2.5 rounded-[3px] border-[1.5px]", theme.iconStroke)} />
      <View
        className={cx(
          "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-[3px] border-[1.5px]",
          theme.iconStroke,
          theme.iconBackdrop,
        )}
      />
    </View>
  );
}

function CheckIcon() {
  return (
    <View className="h-3.5 w-3.5 items-center justify-center">
      <View className={cx("-mt-0.5 h-2.5 w-1.5 rotate-45 border-b-[1.5px] border-r-[1.5px]", theme.iconSuccessStroke)} />
    </View>
  );
}

/**
 * One chunk of highlighted tokens. Memoized: finished chunks keep their identity while a block
 * streams, so a new token re-renders only the line being written.
 */
const TokenRun = memo(function TokenRun({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((token, i) =>
        token.kind === "plain" ? (
          token.value
        ) : (
          <Text key={i} className={SYNTAX[token.kind]}>
            {token.value}
          </Text>
        ),
      )}
    </>
  );
});

/* -------------------------------------------------------------------------------------------------
 * CodeBlock
 * -----------------------------------------------------------------------------------------------*/

function CodeBlockImpl({
  code,
  language,
  showLineNumbers = false,
  highlight = true,
  maxHighlightChars = MAX_HIGHLIGHT_CHARS,
  isStreaming = false,
  onCopy,
  labels: labelOverrides,
  className,
}: CodeBlockProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const displayCode = useMemo(() => trimTrailingNewlines(code), [code]);
  const lineNumbers = useMemo(() => {
    if (!showLineNumbers) return "";
    const count = displayCode.split("\n").length;
    return Array.from({ length: count }, (_, i) => String(i + 1)).join("\n");
  }, [displayCode, showLineNumbers]);
  const tooLarge = highlight && displayCode.length > maxHighlightChars;
  // One highlighter per block: while it streams, only the line being written is re-tokenized.
  const [highlightStream] = useState(createStreamingHighlighter);
  const chunks = useMemo(
    () => (highlight && !tooLarge ? highlightStream(displayCode, language) : null),
    [highlightStream, displayCode, language, highlight, tooLarge],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(displayCode);
    } catch {
      return;
    }
    // The clipboard write is async: don't start a timer for a block that has since unmounted.
    if (!mounted.current) return;
    setCopied(true);
    AccessibilityInfo.announceForAccessibility(labels.copiedAnnouncement);
    onCopy?.(displayCode);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [displayCode, onCopy, labels.copiedAnnouncement]);

  return (
    <View className={cx(theme.container, className)}>
      <View className={theme.header}>
        <View className={theme.headerLeft}>
          <View className={theme.languageDot} />
          <Text className={theme.language} numberOfLines={1}>
            {language || labels.code}
          </Text>
          {isStreaming ? <Text className={theme.streamingBadge}>{labels.writing}</Text> : null}
          {tooLarge && !isStreaming ? <Text className={theme.streamingBadge}>{labels.plain}</Text> : null}
        </View>

        <Pressable
          onPress={handleCopy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={copied ? labels.copied : labels.copyAction(language || labels.code)}
          className={theme.copyButton}
        >
          <Animated.View key={copied ? "check" : "copy"} entering={ZoomIn.duration(180)} exiting={ZoomOut.duration(120)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Animated.View>
          <Text className={copied ? theme.copiedLabel : theme.copyLabel}>{copied ? labels.copied : labels.copy}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false} className={theme.scroll}>
        <View className={theme.body}>
          {showLineNumbers ? (
            <Text className={theme.lineNumbers} style={{ fontFamily: MONO_FONT }} selectable={false}>
              {lineNumbers}
            </Text>
          ) : null}
          <Text className={theme.code} style={{ fontFamily: MONO_FONT }} selectable>
            {chunks ? chunks.map((tokens, i) => <TokenRun key={i} tokens={tokens} />) : displayCode}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

export const CodeBlock = memo(CodeBlockImpl);
CodeBlock.displayName = "CodeBlock";

export default CodeBlock;
