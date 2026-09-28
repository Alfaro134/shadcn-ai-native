/**
 * A small, dependency-free syntax highlighter for chat code blocks. Pure TypeScript with no React
 * or React Native imports: <CodeBlock /> renders its tokens, and tests run it in Node.
 *
 * Best-effort, not a parser: it aims for "looks right" on the snippets an assistant typically
 * returns. Tuned for JS/TS/JSON, Python and shell; Ruby/YAML/TOML get a generic grammar with #
 * comments, and every other language a generic one with // comments.
 *
 * Cost: one global regex pass. Every alternative is linear-time (mutually exclusive character
 * classes; comments and strings run to their terminator or the end of input), so the pass is
 * linear in the code length. See tests/highlight.test.ts.
 */

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number" | "function" | "type";

export interface Token {
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

/**
 * Matches a call or declaration right after an identifier, including generic ones like
 * `useState<T>(`. Sticky (`y`) so it runs in place at the identifier's end instead of on a copy
 * of the rest of the string. Linear-time by construction: the leading whitespace run can only be
 * followed by `<` or `(`, the generic body can't contain `>` and is capped at 64 chars.
 */
const CALL_LOOKAHEAD = /[ \t]*(?:<[\w ,.[\]|&]{0,64}>[ \t]*)?\(/y;
const UPPERCASE_START = /^[A-Z]/;

function tokenize(code: string, grammar: Grammar): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, value: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.value += value;
    else tokens.push({ kind, value });
  };

  // Every alternative in the grammar is linear-time: character classes in the string patterns are
  // mutually exclusive, and comments and strings run to their terminator or end of input.
  const pattern = grammar.pattern;
  pattern.lastIndex = 0;
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
      CALL_LOOKAHEAD.lastIndex = pattern.lastIndex;
      if (grammar.keywords.has(word)) push("keyword", value);
      else if (CALL_LOOKAHEAD.test(code)) push("function", value);
      else if (UPPERCASE_START.test(word)) push("type", value);
      else push("plain", value);
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < code.length) push("plain", code.slice(cursor));
  return tokens;
}

/** Trims trailing newlines without a regex (`/\n+$/` backtracks quadratically on long runs). */
export function trimTrailingNewlines(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === "\n" || value[end - 1] === "\r")) end--;
  return end === value.length ? value : value.slice(0, end);
}

/** Splits code into colored tokens. Adjacent tokens of the same kind are merged. */
export function highlight(code: string, language?: string): Token[] {
  return tokenize(code, grammarFor(language));
}
