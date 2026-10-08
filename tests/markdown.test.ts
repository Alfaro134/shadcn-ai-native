// Run with: node --test tests/   (Node ≥ 22.18 or ≥ 23.6 runs TypeScript natively)
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createStreamingParser,
  isSafeUrl,
  parseInline,
  parseBlocks,
  parseMarkdown,
  markdownToPlainText,
  type Inline,
  type Block,
  type MarkdownSegment,
} from "../components/ai/markdown.ts";

/* -------------------------------------------------------------------------------------------------
 * Compact notation: B(bold) I(italic) S(strike) C(code) L(label|url) IMG(alt|url)
 * -----------------------------------------------------------------------------------------------*/

const show = (nodes: Inline[]): string =>
  nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return n.value;
        case "bold":
          return `B(${show(n.children)})`;
        case "italic":
          return `I(${show(n.children)})`;
        case "strike":
          return `S(${show(n.children)})`;
        case "code":
          return `C(${n.value})`;
        case "link":
          return `L(${show(n.children)}|${n.url})`;
        case "image":
          return `IMG(${n.alt}|${n.url})`;
      }
    })
    .join("");

const inl = (s: string, open = false) => show(parseInline(s, open));

const showBlock = (b: Block): string => {
  switch (b.type) {
    case "list":
      return `list[${b.items
        .map((it) => `${it.depth}${it.checked === undefined ? "" : it.checked ? "☑" : "☐"}${it.marker}${show(it.inline)}`)
        .join(",")}]`;
    case "table":
      return `table{${b.align.join(",")}}[${[b.header, ...b.rows].map((row) => row.map(show).join("|")).join(" / ")}]`;
    case "rule":
      return "rule";
    case "heading":
      return `h${b.level}(${show(b.inline)})`;
    default:
      return `${b.type}(${show(b.inline)})`;
  }
};

const blk = (s: string, open = false) => parseBlocks(s, open).map(showBlock).join(" | ");

const showSegments = (segments: MarkdownSegment[]) =>
  segments
    .map((s) => (s.type === "code" ? `code[${s.language ?? ""}${s.complete ? "" : "…"}](${s.value})` : s.blocks.map(showBlock).join(" | ")))
    .join(" || ");

/* -------------------------------------------------------------------------------------------------
 * Inline
 * -----------------------------------------------------------------------------------------------*/

describe("inline, complete text", () => {
  const cases: Array<[string, string, string]> = [
    ["bold", "a **b** c", "a B(b) c"],
    ["italic *", "a *b* c", "a I(b) c"],
    ["italic _", "a _b_ c", "a I(b) c"],
    ["bold + italic", "***x***", "B(I(x))"],
    ["nested", "**bold _it_ end**", "B(bold I(it) end)"],
    ["strike", "a ~~gone~~ b", "a S(gone) b"],
    ["single tilde is literal", "about ~5 minutes", "about ~5 minutes"],
    ["code keeps markers", "use `x*y*z` now", "use C(x*y*z) now"],
    ["link", "see [Google](https://google.com)!", "see L(Google|https://google.com)!"],
    ["link with title", '[G](https://g.co "Google")', "L(G|https://g.co)"],
    ["link with bold label", "[**G**](https://g.co)", "L(B(G)|https://g.co)"],
    ["unsafe link keeps text only", "[x](javascript:alert(1))", "x)"],
    ["image", "![a cat](https://x.io/cat.png)", "IMG(a cat|https://x.io/cat.png)"],
    ["unsafe image is alt text", "![a cat](file:///etc/passwd)", "a cat"],
    ["autolink", "<https://x.io/a>", "L(https://x.io/a|https://x.io/a)"],
    ["bare url", "go to https://x.io/docs.", "go to L(https://x.io/docs|https://x.io/docs)."],
    ["bare url keeps balanced paren", "(see https://en.wikipedia.org/wiki/A_(b))", "(see L(https://en.wikipedia.org/wiki/A_(b)|https://en.wikipedia.org/wiki/A_(b)))"],
    ["url inside word is not linked", "xhttps://x.io", "xhttps://x.io"],
    ["html is literal", "<div>hi</div>", "<div>hi</div>"],
    ["math star is literal", "5 * 3 = 15", "5 * 3 = 15"],
    ["snake_case", "my_var_name here", "my_var_name here"],
    ["unclosed marker is literal", "**not closed", "**not closed"],
    ["brackets without url", "[a] b", "[a] b"],
    ["escapes", String.raw`\*not\* \[x\]`, "*not* [x]"],
    ["mixed runs", "*a **b**", "*a B(b)"],
  ];
  for (const [name, input, expected] of cases) test(name, () => assert.equal(inl(input), expected));
});

describe("inline, streaming tail", () => {
  const cases: Array<[string, string, string]> = [
    ["open bold", "hi **strong te", "hi strong te"],
    ["open italic", "hi *emph", "hi emph"],
    ["open strike", "hi ~~gon", "hi gon"],
    ["trailing marker", "hi **", "hi "],
    ["trailing tilde", "hi ~", "hi "],
    ["link mid-url", "go [Google](http", "go Google"],
    ["link text", "go [Goo", "go Goo"],
    ["link label complete", "go [Google]", "go Google"],
    ["image mid-url", "![a cat](https://x.io/c", "a cat"],
    ["autolink open", "<https://x.i", "https://x.i"],
    ["open code", "run `npm i", "run npm i"],
    ["math star stays", "5 * 3", "5 * 3"],
    ["closed parts still render", "**a** and *b", "B(a) and b"],
  ];
  for (const [name, input, expected] of cases) test(name, () => assert.equal(inl(input, true), expected));
});

describe("link safety", () => {
  const safe = ["https://example.com", "http://a.io/x?y=1#z", "HTTPS://EXAMPLE.COM", "mailto:hi@example.com"];
  const unsafe: Array<[string, string]> = [
    ["javascript:", "javascript:alert(1)"],
    ["mixed-case javascript:", "JavaScript:alert(1)"],
    ["leading space", " javascript:alert(1)"],
    ["data:", "data:text/html;base64,PHNjcmlwdD4="],
    ["file:", "file:///etc/passwd"],
    ["intent:", "intent://scan/#Intent;scheme=zxing;end"],
    ["custom app scheme", "myapp://deep/link"],
    ["no slashes", "https:evil.com"],
    ["no host", "https://"],
    ["empty host", "https:///path"],
    ["newline", "https://a.com\nhttps://b.com"],
    ["NUL", "https://a.com/\u0000"],
    ["C1 control", "https://a.com/\u0085"],
    ["line separator", "https://a.com/ "],
    ["space", "https://a.com/ b"],
    ["empty mailto", "mailto:"],
    ["over 2048 chars", "https://a.com/" + "x".repeat(3000)],
    ["empty", ""],
  ];
  for (const url of safe) test(`allows ${url}`, () => assert.equal(isSafeUrl(url), true));
  for (const [name, url] of unsafe) test(`blocks ${name}`, () => assert.equal(isSafeUrl(url), false));

  test("a link whose target spans a line break keeps only its text", () => assert.equal(inl("[a](https://x.com\nfoo)"), "a"));
  test("an autolink with a line break is not an autolink", () =>
    assert.equal(inl("<https://a.com\nb>"), "<L(https://a.com|https://a.com)\nb>"));
  test("an over-long bare URL is plain text", () => {
    const long = "https://a.com/" + "x".repeat(3000);
    assert.equal(inl(long), long);
  });
  test("a bare URL with a control character is not linked", () =>
    assert.equal(inl("https://a.com/\u0001x"), "https://a.com/\u0001x"));
});

/* -------------------------------------------------------------------------------------------------
 * Blocks
 * -----------------------------------------------------------------------------------------------*/

describe("blocks", () => {
  const cases: Array<[string, string, string]> = [
    ["headings", "# One\n## Two ##\n###### Six", "h1(One) | h2(Two) | h6(Six)"],
    ["hash without space", "#hashtag", "paragraph(#hashtag)"],
    ["bullets", "- a\n* b\n+ c", "list[0•a,0•b,0•c]"],
    ["ordered", "1. a\n2) b\n10. c", "list[01.a,02.b,010.c]"],
    ["nested", "- a\n  - b\n    - c", "list[0•a,1•b,2•c]"],
    ["continuation", "- a\n  more", "list[0•a more]"],
    ["task list", "- [ ] todo\n- [x] done\n- [X] also", "list[0☐•todo,0☑•done,0☑•also]"],
    ["star italic is not a list", "*italic* text", "paragraph(I(italic) text)"],
    ["quote", "> one\n> two", "quote(one\ntwo)"],
    ["rule", "a\n\n---\n\nb", "paragraph(a) | rule | paragraph(b)"],
    ["paragraph keeps line breaks", "l1\nl2\n\nl3", "paragraph(l1\nl2) | paragraph(l3)"],
    ["table", "| a | b |\n|:--|--:|\n| 1 | **2** |", "table{left,right}[a|b / 1|B(2)]"],
    ["table without outer pipes", "a | b\n:-: | ---\n1 | 2", "table{center,left}[a|b / 1|2]"],
    ["table pads short rows", "| a | b |\n|---|---|\n| 1 |", "table{left,left}[a|b / 1|]"],
    ["pipe text is not a table", "a | b\nnot a delimiter", "paragraph(a | b\nnot a delimiter)"],
    ["escaped pipe in cell", "| a \\| b | c |\n|---|---|", "table{left,left}[a | b|c]"],
    ["mixed", "## T\nText **b**\n- x\n- [y](https://y.io)\n> q", "h2(T) | paragraph(Text B(b)) | list[0•x,0•L(y|https://y.io)] | quote(q)"],
  ];
  for (const [name, input, expected] of cases) test(name, () => assert.equal(blk(input), expected));
});

describe("blocks, streaming tail", () => {
  const cases: Array<[string, string, string]> = [
    ["pending heading", "para\n##", "paragraph(para)"],
    ["pending bullet", "- a\n-", "list[0•a]"],
    ["pending ordered", "1. a\n2.", "list[01.a]"],
    ["pending quote", "text\n>", "paragraph(text)"],
    ["heading streams", "## How it", "h2(How it)"],
    ["open markup only in the last item", "- a **b\n- c **d", "list[0•a **b,0•c d]"],
    ["pending table header", "intro\n| a | b |", "paragraph(intro)"],
    ["table while delimiter streams", "| a | b |\n|--", "table{left,left}[a|b]"],
    ["table row streaming", "| a | b |\n|---|---|\n| 1 | **tw", "table{left,left}[a|b / 1|tw]"],
    ["complete text keeps markers", "para\n##", "paragraph(para\n##)"],
    ["a blank line closes the block", "**bold\n\n", "paragraph(**bold)"],
    ["a blank line before a pending marker closes the block", "**bold\n\n-", "paragraph(**bold)"],
    ["a single newline keeps the block open", "**bold\n", "paragraph(bold)"],
    ["blank lines close a block even while a table header arrives", "~~a\n\n| b", "paragraph(~~a)"],
  ];
  for (const [name, input, expected] of cases) {
    const complete = name === "complete text keeps markers";
    test(name, () => assert.equal(blk(input, !complete), expected));
  }
});

describe("code fences", () => {
  test("backticks with language", () =>
    assert.equal(showSegments(parseMarkdown("a\n```ts\nx\n```\nb")), "paragraph(a) || code[ts](x) || paragraph(b)"));
  test("tildes", () => assert.equal(showSegments(parseMarkdown("~~~py\nprint(1)\n~~~")), "code[py](print(1))"));
  test("longer closing fence", () => assert.equal(showSegments(parseMarkdown("````\n```\ninner\n```\n````")), "code[](```\ninner\n```)"));
  test("inline triple backticks are a code span, not a fence", () =>
    assert.equal(showSegments(parseMarkdown("use ```x``` here")), "paragraph(use C(x) here)"));
  test("unterminated fence is a streaming block", () =>
    assert.equal(showSegments(parseMarkdown("```js\nlet a", true)), "code[js…](let a)"));
  test("partial closing fence is hidden while streaming", () =>
    assert.equal(showSegments(parseMarkdown("```js\nlet a\n``", true)), "code[js…](let a)"));
  test("partial opening fence is hidden while streaming", () =>
    assert.equal(showSegments(parseMarkdown("text\n``", true)), "paragraph(text)"));
});

/* -------------------------------------------------------------------------------------------------
 * Property: every prefix of a real-looking LLM reply parses, and never shows raw markup.
 * -----------------------------------------------------------------------------------------------*/

const CORPUS: Record<string, string> = {
  tutorial: [
    "## A typed `useDebounce` hook",
    "",
    "It waits until the user **stops typing** before updating the value, perfect for *search inputs*.",
    "",
    "```tsx",
    "export function useDebounce<T>(value: T, delay = 300): T {",
    "  return value;",
    "}",
    "```",
    "",
    "### How it works",
    "",
    "1. Every change to `value` starts a **new timer**",
    "2. The cleanup cancels the previous one",
    "   - so only the _last_ change wins",
    "",
    "> Tip: read [the React docs](https://react.dev/reference/react/useEffect) for details.",
  ].join("\n"),
  comparison: [
    "Here's a comparison:",
    "",
    "| Library | Size | Streaming |",
    "| :--- | ---: | :---: |",
    "| **ours** | 0 deps | ~~no~~ yes |",
    "| other | 40 kB | [partial](https://example.com/a_(b)) |",
    "",
    "- [x] Tables",
    "- [ ] Footnotes",
    "",
    "---",
    "",
    "See ![diagram](https://example.com/d.png) or visit https://example.com/docs.",
  ].join("\n"),
  messy: [
    "<details><summary>HTML stays literal</summary></details>",
    "",
    "~~~bash",
    "npm i && echo *done*",
    "~~~",
    "",
    "Nested ***bold italic*** and __bold__ and *italic with `code` inside*.",
    "",
    "Broken link [text](https://exa mple.com and an <https://autolink.dev>.",
    "",
    "مرحبا **بالعالم** — RTL text with bold. 日本語の*テキスト*。 Emoji 🎒 ✓",
  ].join("\n"),
};

/** Markers that must never be visible mid-stream in these fixtures (they don't use them literally). */
const RAW_MARKERS = ["**", "~~", "](", "```", "~~~", "<https"];

describe("property: every streaming prefix parses cleanly", () => {
  for (const [name, text] of Object.entries(CORPUS)) {
    test(`${name}: ${text.length} prefixes`, () => {
      for (let end = 1; end <= text.length; end++) {
        const prefix = text.slice(0, end);
        const segments = parseMarkdown(prefix, true);
        const plain = markdownToPlainText(segments.filter((s) => s.type === "text"));
        for (const marker of RAW_MARKERS) {
          // The "messy" fixture has a deliberately broken link, which is literal once complete.
          if (name === "messy" && marker === "](") continue;
          assert.ok(!plain.includes(marker), `prefix ${end} of "${name}" shows raw "${marker}":\n${plain}`);
        }
      }
    });
  }

  test("final parse of the comparison fixture", () => {
    const blocks = parseMarkdown(CORPUS.comparison).flatMap((s) => (s.type === "text" ? s.blocks.map(showBlock) : []));
    assert.deepEqual(blocks, [
      "paragraph(Here's a comparison:)",
      "table{left,right,center}[Library|Size|Streaming / B(ours)|0 deps|S(no) yes / other|40 kB|L(partial|https://example.com/a_(b))]",
      "list[0☑•Tables,0☐•Footnotes]",
      "rule",
      "paragraph(See IMG(diagram|https://example.com/d.png) or visit L(https://example.com/docs|https://example.com/docs).)",
    ]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * Streaming parser: same result as a full parse, with finished blocks reused.
 * -----------------------------------------------------------------------------------------------*/

describe("createStreamingParser", () => {
  for (const [name, text] of Object.entries(CORPUS)) {
    test(`${name}: every prefix matches a full parse`, () => {
      const parse = createStreamingParser();
      for (let end = 1; end <= text.length; end++) {
        const prefix = text.slice(0, end);
        assert.deepEqual(parse(prefix, true), parseMarkdown(prefix, true), `prefix ${end} of "${name}"`);
      }
      assert.deepEqual(parse(text, false), parseMarkdown(text, false));
    });
  }

  test("random documents in random chunks match a full parse", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const alphabet = ["*", "_", "~", "`", "[", "]", "(", ")", "<", "#", "-", "|", ":", "\n", "\n\n", "\r\n", " ", "1.", "a", "https://x.io", "```", "```js", "~~~", "- [ ] ", "> "];
    const parse = createStreamingParser(); // shared across documents: each new one must reset it
    for (let doc = 0; doc < 1500; doc++) {
      let text = "";
      const length = Math.floor(random() * 80);
      for (let k = 0; k < length; k++) text += alphabet[Math.floor(random() * alphabet.length)];
      let end = 0;
      while (end < text.length) {
        end = Math.min(text.length, end + 1 + Math.floor(random() * 6));
        const prefix = text.slice(0, end);
        assert.deepEqual(parse(prefix, true), parseMarkdown(prefix, true), JSON.stringify(prefix));
      }
      assert.deepEqual(parse(text, false), parseMarkdown(text, false), JSON.stringify(text));
    }
  });

  test("finished blocks are the same objects on later calls", () => {
    const parse = createStreamingParser();
    const first = parse("## Title\n\nSome **bold** text.\n\n- one", true);
    const second = parse("## Title\n\nSome **bold** text.\n\n- one\n- two", true);
    const blocks = (segments: MarkdownSegment[]) => segments.flatMap((s) => (s.type === "text" ? s.blocks : []));
    assert.equal(blocks(second)[0], blocks(first)[0]);
    assert.equal(blocks(second)[1], blocks(first)[1]);
    assert.notEqual(blocks(second)[2], blocks(first)[2]); // the list is still being written
  });

  test("a different message starts over", () => {
    const parse = createStreamingParser();
    parse("```js\nlet a = 1\n", true);
    assert.equal(showSegments(parse("plain **text**\n\nmore", true)), "paragraph(plain B(text)) | paragraph(more)");
  });
});

/* -------------------------------------------------------------------------------------------------
 * Fuzz: random Markdown-ish soup never throws, streaming or not.
 * -----------------------------------------------------------------------------------------------*/

describe("fuzz", () => {
  test("5,000 random documents and their prefixes", () => {
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const alphabet = ["*", "_", "~", "`", "[", "]", "(", ")", "!", "<", ">", "#", "-", "+", "|", ":", "\\", "\n", " ", "1", ".", "a", "h", "https://", "```", "~~~", "- [ ] "];
    for (let doc = 0; doc < 5000; doc++) {
      let text = "";
      const length = Math.floor(random() * 120);
      for (let k = 0; k < length; k++) text += alphabet[Math.floor(random() * alphabet.length)];
      for (const streaming of [false, true]) {
        assert.doesNotThrow(() => markdownToPlainText(parseMarkdown(text, streaming)), JSON.stringify(text));
      }
      const cut = Math.floor(random() * (text.length + 1));
      assert.doesNotThrow(() => parseMarkdown(text.slice(0, cut), true), JSON.stringify(text.slice(0, cut)));
    }
  });
});

/* -------------------------------------------------------------------------------------------------
 * Linear time: pathological inputs that make naive regex parsers explode.
 * -----------------------------------------------------------------------------------------------*/

describe("linear time on adversarial input (100k chars, < 300 ms each)", () => {
  const N = 100_000;
  const inputs: Record<string, string> = {
    "unclosed *": "*a ".repeat(N / 3),
    "unclosed **": "**a ".repeat(N / 4),
    "many [": "[".repeat(N) + "]",
    "many [x](": "[x](".repeat(N / 4),
    "many _": "_a_b ".repeat(N / 5),
    "many backticks": "`".repeat(N),
    "many ~~": "~~a ".repeat(N / 4),
    "many <http": "<http".repeat(N / 5),
    "many https://": "https://".repeat(N / 8),
    "deep nesting": "**_*[~~".repeat(N / 7),
    "many pipes": "|".repeat(N),
    "table of pipes": "|a|\n|-|\n".repeat(N / 8),
    "long list": "- item **b** [l](https://x.y)\n".repeat(N / 30),
    "many #": "#".repeat(N),
  };
  for (const [name, input] of Object.entries(inputs)) {
    for (const streaming of [false, true]) {
      test(`${name}${streaming ? " (streaming)" : ""}`, () => {
        const start = performance.now();
        parseMarkdown(input, streaming);
        const ms = performance.now() - start;
        assert.ok(ms < 300, `${ms.toFixed(1)} ms`);
      });
    }
  }
});
