import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { highlight, trimTrailingNewlines, type Token } from "../components/ai/highlight.ts";

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
