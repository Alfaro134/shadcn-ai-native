import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { ZoomIn, ZoomOut } from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";

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

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

export interface CodeBlockProps {
  /** Raw source code. Trailing newlines are trimmed for display only. */
  code: string;
  /** Language label shown in the header, e.g. "tsx", "python". */
  language?: string;
  /** Render a gutter with line numbers. */
  showLineNumbers?: boolean;
  /** Color keywords, strings, comments, numbers, calls and types. Defaults to true. */
  highlight?: boolean;
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
 * Syntax highlighter — a single-pass regex tokenizer. Not a parser: it aims for "looks right"
 * on the snippets an assistant typically returns, with zero dependencies.
 * -----------------------------------------------------------------------------------------------*/

type TokenKind = keyof typeof theme.syntax;

interface Token {
  kind: TokenKind;
  value: string;
}

const JS_KEYWORDS =
  "abstract as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield";
const PYTHON_KEYWORDS =
  "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield";
const SHELL_KEYWORDS =
  "if then else elif fi for in do done case esac while until function return export local echo cd sudo npm npx yarn pnpm bun git";
const GENERIC_KEYWORDS = `${JS_KEYWORDS} ${PYTHON_KEYWORDS} fn mut pub impl struct trait use mod match func package go defer chan map int float bool string char long short unsigned`;

type CommentStyle = "slash" | "hash";

interface Grammar {
  keywords: Set<string>;
  pattern: RegExp;
}

const STRING_PATTERN = String.raw`"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|` + "`(?:[^`\\\\]|\\\\[\\s\\S])*`?";
const NUMBER_PATTERN = String.raw`\b(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`;
const WORD_PATTERN = String.raw`[A-Za-z_$][\w$]*`;
const COMMENT_PATTERNS: Record<CommentStyle, string> = {
  slash: String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)`,
  hash: String.raw`#[^\n]*`,
};

function createGrammar(keywords: string, comments: CommentStyle): Grammar {
  return {
    keywords: new Set(keywords.split(" ")),
    // Group order matters: comments win over strings, strings over numbers and words.
    pattern: new RegExp(`(${COMMENT_PATTERNS[comments]})|(${STRING_PATTERN})|(${NUMBER_PATTERN})|(${WORD_PATTERN})`, "g"),
  };
}

const GRAMMARS = {
  js: createGrammar(JS_KEYWORDS, "slash"),
  python: createGrammar(PYTHON_KEYWORDS, "hash"),
  shell: createGrammar(SHELL_KEYWORDS, "hash"),
  hashGeneric: createGrammar(GENERIC_KEYWORDS, "hash"),
  generic: createGrammar(GENERIC_KEYWORDS, "slash"),
} as const;

function grammarFor(language?: string): Grammar {
  switch ((language ?? "").toLowerCase()) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "javascript":
    case "typescript":
    case "json":
      return GRAMMARS.js;
    case "py":
    case "python":
      return GRAMMARS.python;
    case "sh":
    case "bash":
    case "zsh":
    case "shell":
    case "console":
      return GRAMMARS.shell;
    case "rb":
    case "ruby":
    case "yml":
    case "yaml":
    case "toml":
      return GRAMMARS.hashGeneric;
    default:
      return GRAMMARS.generic;
  }
}

function tokenize(code: string, grammar: Grammar): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, value: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.value += value;
    else tokens.push({ kind, value });
  };

  const pattern = new RegExp(grammar.pattern.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex++;
      continue;
    }
    if (match.index > cursor) push("plain", code.slice(cursor, match.index));

    const [value, comment, string, number, word] = match;
    if (comment) push("comment", value);
    else if (string) push("string", value);
    else if (number) push("number", value);
    else if (word) {
      const rest = code.slice(pattern.lastIndex);
      if (grammar.keywords.has(word)) push("keyword", value);
      // Calls and declarations, including generic ones like `useState<T>(`.
      else if (/^\s*(?:<[\w\s,.[\]|&]*>)?\s*\(/.test(rest)) push("function", value);
      else if (/^[A-Z]/.test(word)) push("type", value);
      else push("plain", value);
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < code.length) push("plain", code.slice(cursor));
  return tokens;
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

/* -------------------------------------------------------------------------------------------------
 * CodeBlock
 * -----------------------------------------------------------------------------------------------*/

function CodeBlockImpl({
  code,
  language,
  showLineNumbers = false,
  highlight = true,
  isStreaming = false,
  onCopy,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayCode = useMemo(() => code.replace(/\n+$/, ""), [code]);
  const lineNumbers = useMemo(() => {
    if (!showLineNumbers) return "";
    const count = displayCode.split("\n").length;
    return Array.from({ length: count }, (_, i) => String(i + 1)).join("\n");
  }, [displayCode, showLineNumbers]);
  const tokens = useMemo(
    () => (highlight ? tokenize(displayCode, grammarFor(language)) : null),
    [displayCode, language, highlight],
  );

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(displayCode);
    } catch {
      return;
    }
    setCopied(true);
    onCopy?.(displayCode);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [displayCode, onCopy]);

  return (
    <View className={cx(theme.container, className)}>
      <View className={theme.header}>
        <View className={theme.headerLeft}>
          <View className={theme.languageDot} />
          <Text className={theme.language}>{language || "code"}</Text>
          {isStreaming ? <Text className={theme.streamingBadge}>writing…</Text> : null}
        </View>

        <Pressable
          onPress={handleCopy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={copied ? "Code copied" : "Copy code to clipboard"}
          className={theme.copyButton}
        >
          <Animated.View key={copied ? "check" : "copy"} entering={ZoomIn.duration(180)} exiting={ZoomOut.duration(120)}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Animated.View>
          <Text className={copied ? theme.copiedLabel : theme.copyLabel}>{copied ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
        <View className={theme.body}>
          {showLineNumbers ? (
            <Text className={theme.lineNumbers} style={{ fontFamily: MONO_FONT }} selectable={false}>
              {lineNumbers}
            </Text>
          ) : null}
          <Text className={theme.code} style={{ fontFamily: MONO_FONT }} selectable>
            {tokens
              ? tokens.map((token, i) =>
                  token.kind === "plain" ? (
                    token.value
                  ) : (
                    <Text key={i} className={theme.syntax[token.kind]}>
                      {token.value}
                    </Text>
                  ),
                )
              : displayCode}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

export const CodeBlock = memo(CodeBlockImpl);
CodeBlock.displayName = "CodeBlock";

export default CodeBlock;
