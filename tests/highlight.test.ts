import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createStreamingHighlighter, highlight, trimTrailingNewlines, type Token } from "../components/ai/highlight.ts";

/** Compact notation: only colored tokens, as kind:value. */
const colored = (tokens: Token[]) => tokens.filter((t) => t.kind !== "plain").map((t) => `${t.kind}:${t.value}`);

describe("highlight", () => {
  test("typescript", () => {
    assert.deepEqual(colored(highlight("const x = useState<T>(1) // hi", "ts")), [
      "keyword:const",
      "function:useState",
      "type:T",
      "number:1",
      "comment:// hi",
    ]);
  });

  test("strings win over keywords inside them", () => {
    assert.deepEqual(colored(highlight('return "if else"', "js")), ["keyword:return", 'string:"if else"']);
  });

  test("python uses # comments and its own keywords", () => {
    assert.deepEqual(colored(highlight("def f(): # note\n  return None", "python")), [
      "keyword:def",
      "function:f",
      "comment:# note",
      "keyword:return",
      "keyword:None",
    ]);
  });

  test("shell", () => {
    assert.deepEqual(colored(highlight("npm i && echo $HOME # done", "bash")), ["keyword:npm", "keyword:echo", "comment:# done"]);
  });

  test("unknown language falls back to a generic grammar", () => {
    assert.deepEqual(colored(highlight("fn main() {}", "rust")), ["keyword:fn", "function:main"]);
  });

  test("unterminated string and block comment run to the end", () => {
    assert.deepEqual(colored(highlight('let s = "open', "js")), ["keyword:let", 'string:"open']);
    assert.deepEqual(colored(highlight("a /* open\nstill", "js")), ["comment:/* open\nstill"]);
  });

  test("tokens always reassemble the input exactly", () => {
    const code = 'import { a } from "b";\n\n// c\nconst d = 0x1F + 2.5e3;\nfunction e<T>(f: T) { return `g${f}`; }\n';
    for (const language of ["ts", "python", "bash", "yaml", "rust", undefined]) {
      assert.equal(highlight(code, language).map((t) => t.value).join(""), code, String(language));
    }
  });

  test("trimTrailingNewlines", () => {
    assert.equal(trimTrailingNewlines("a\n\r\n"), "a");
    assert.equal(trimTrailingNewlines("\n\n"), "");
    assert.equal(trimTrailingNewlines("a"), "a");
  });
});

describe("highlight: linear time on adversarial input (100k chars, < 300 ms each)", () => {
  const N = 100_000;
  const inputs: Record<string, string> = {
    "unterminated block comments": "/*".repeat(N / 2),
    "unterminated strings": '"'.repeat(N),
    "escaped quotes": '"\\'.repeat(N / 2),
    "template literals": "`\\".repeat(N / 2),
    "long number then letter": "1".repeat(N) + "x",
    "many dotted numbers": "1.".repeat(N / 2),
    "call lookahead generics": "f<".repeat(N / 2) + "(",
    "call lookahead spaces": "f" + " ".repeat(N) + "x",
    "identifiers": "a_$".repeat(N / 3),
    "trailing newlines": "\n".repeat(N),
  };
  for (const [name, input] of Object.entries(inputs)) {
    test(name, () => {
      const start = performance.now();
      highlight(input, "ts");
      trimTrailingNewlines(input);
      const ms = performance.now() - start;
      assert.ok(ms < 300, `${ms.toFixed(1)} ms`);
    });
  }
});

describe("createStreamingHighlighter", () => {
  /** Flattens chunks and merges neighbors of the same kind, as one highlight() call would. */
  const merged = (chunks: Token[][]) => {
    const out: Token[] = [];
    for (const token of chunks.flat()) {
      const last = out[out.length - 1];
      if (last && last.kind === token.kind) out[out.length - 1] = { kind: token.kind, value: last.value + token.value };
      else out.push({ ...token });
    }
    return out;
  };

  const SAMPLES: Array<[string, string]> = [
    [
      "ts",
      [
        'import { useState } from "react";',
        "",
        "/* block",
        "   comment */",
        "export function useDebounce<T>(value: T, delay = 300): T {",
        "  const [v, setV] = useState(value); // state",
        "  const s = `multi",
        "line ${v}`;",
        "  return 0x1F + 2.5e3;",
        "}",
        "",
      ].join("\n"),
    ],
    ["python", ["def f(x):", "    # comment", '    return "a\\"b" if x else None', "", "class Thing:", "    pass", ""].join("\n")],
    ["bash", ["npm i && echo $HOME # done", "if [ -f x ]; then", "  git status", "fi", ""].join("\n")],
  ];

  for (const [language, code] of SAMPLES) {
    test(`${language}: every prefix matches highlight()`, () => {
      const run = createStreamingHighlighter();
      for (let end = 1; end <= code.length; end++) {
        const prefix = code.slice(0, end);
        assert.deepEqual(merged(run(prefix, language)), highlight(prefix, language), JSON.stringify(prefix));
      }
    });
  }

  test("random code in random chunks matches highlight()", () => {
    let seed = 11;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const alphabet = ["/*", "*/", "//", "#", "`", '"', "'", "\\", "\n", "\n\n", " ", "\t", "foo", "Bar", "if", "(", ")", "<T>", "12", ".5", "e3", "x"];
    const run = createStreamingHighlighter(); // shared: each new snippet must reset it
    for (let doc = 0; doc < 1500; doc++) {
      let code = "";
      const length = Math.floor(random() * 60);
      for (let k = 0; k < length; k++) code += alphabet[Math.floor(random() * alphabet.length)];
      const language = ["ts", "python", "bash", "rust"][doc % 4];
      let end = 0;
      while (end < code.length) {
        end = Math.min(code.length, end + 1 + Math.floor(random() * 5));
        const prefix = code.slice(0, end);
        assert.deepEqual(merged(run(prefix, language)), highlight(prefix, language), JSON.stringify([language, prefix]));
      }
    }
  });

  test("finished lines come back as the same arrays", () => {
    const run = createStreamingHighlighter();
    const first = run("const a = 1;\nconst b", "ts");
    const second = run("const a = 1;\nconst b = 2;", "ts");
    assert.equal(second[0], first[0]);
    assert.equal(second.length, 2);
  });
});
