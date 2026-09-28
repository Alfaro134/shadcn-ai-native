// Parser benchmarks. Run with: npm run bench  (Node ≥ 22.18)
//
// Measures the Markdown parser only (no React rendering, no device). Numbers depend on the
// machine; the point is the order of magnitude and that cost grows linearly with length.
import os from "node:os";

import { parseMarkdown } from "../components/ai/markdown.ts";

const SAMPLE = [
  "## A typed `useDebounce` hook",
  "",
  "It waits until the user **stops typing** before updating the value, perfect for *search inputs*.",
  "",
  "```tsx",
  "export function useDebounce<T>(value: T, delay = 300): T {",
  "  const [debounced, setDebounced] = useState(value);",
  "  return debounced;",
  "}",
  "```",
  "",
  "| Option | Default | Notes |",
  "| :--- | ---: | --- |",
  "| `delay` | 300 | in **ms** |",
  "",
  "1. Every change starts a **new timer**",
  "2. The cleanup cancels the previous one, so only the _last_ change wins",
  "- [x] Typed  - [ ] Tested",
  "",
  "> Tip: see [the docs](https://react.dev/reference/react/useEffect) or https://example.com/more.",
  "",
].join("\n");

function build(length: number): string {
  let text = "";
  while (text.length < length) text += SAMPLE;
  return text.slice(0, length);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timeOnce(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

/** Splits like the demo stream: word/whitespace tokens. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

const rows: Array<[string, string]> = [];

// 1. One full parse of a finished message.
for (const length of [1_000, 10_000, 50_000]) {
  const text = build(length);
  for (let k = 0; k < 5; k++) parseMarkdown(text); // warm up
  const ms = median(Array.from({ length: 21 }, () => timeOnce(() => parseMarkdown(text))));
  rows.push([`Parse a finished ${length.toLocaleString("en")}-char message`, `${ms.toFixed(2)} ms`]);
}

// 2. Streaming: the bubble re-parses the whole message on every chunk.
for (const length of [5_000, 20_000]) {
  const tokens = tokenize(build(length));
  let text = "";
  const perChunk: number[] = [];
  for (const token of tokens) {
    text += token;
    perChunk.push(timeOnce(() => parseMarkdown(text, true)));
  }
  const total = perChunk.reduce((a, b) => a + b, 0);
  const last = perChunk.slice(-50);
  rows.push([
    `Stream a ${length.toLocaleString("en")}-char message (${tokens.length.toLocaleString("en")} chunks)`,
    `${total.toFixed(0)} ms total · ${median(last).toFixed(2)} ms per chunk at the end`,
  ]);
}

console.log(`\nMarkdown parser · Node ${process.version} · ${os.cpus()[0]?.model.trim() ?? "unknown CPU"}\n`);
const width = Math.max(...rows.map(([name]) => name.length));
for (const [name, value] of rows) console.log(`  ${name.padEnd(width)}  ${value}`);
console.log();
