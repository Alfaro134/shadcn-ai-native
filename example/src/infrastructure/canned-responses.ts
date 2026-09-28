/**
 * Infrastructure: the canned replies the simulated model streams, so the demo runs with no API
 * key. Replace SimulatedChatModel with a real adapter and this file goes away.
 */
import type { Message } from "../domain/message";

export interface SimulatedResponse {
  /** Optional "thinking" shown in a <ReasoningBlock /> before the answer streams. */
  reasoning?: string;
  /** The answer, as Markdown. */
  answer: string;
}

const RESPONSES: Record<"code" | "general" | "simple" | "stress", SimulatedResponse> = {
  code: {
    reasoning: [
      "The user wants a debounce hook in TypeScript, so it should be generic over the value type.",
      "",
      "A timer in useEffect is enough: restart it on every change and clear it in the cleanup, so only the last value within the delay window wins. Worth explaining the mechanics briefly and ending with a practical tip.",
    ].join("\n"),
    answer: [
      "## A typed `useDebounce` hook",
      "",
      "It waits until the user **stops typing** before updating the value, which is perfect for *search inputs*:",
      "",
      "```tsx",
      'import { useEffect, useState } from "react";',
      "",
      "export function useDebounce<T>(value: T, delay = 300): T {",
      "  const [debounced, setDebounced] = useState(value);",
      "",
      "  useEffect(() => {",
      "    const id = setTimeout(() => setDebounced(value), delay);",
      "    return () => clearTimeout(id);",
      "  }, [value, delay]);",
      "",
      "  return debounced;",
      "}",
      "```",
      "",
      "### How it works",
      "",
      "- Every change to `value` starts a **new timer**",
      "- The cleanup cancels the previous one, so only the _last_ change wins",
      "- `delay` defaults to **300 ms**",
      "",
      "> Tip: fire your request whenever `query` changes, e.g. `const query = useDebounce(text, 400);`",
    ].join("\n"),
  },
  general: {
    reasoning: [
      "They are asking about perceived performance, not raw speed.",
      "",
      "Key points: time to first token, reading while generating, visible progress. A numbered list fits, plus a link to the classic research on response times.",
    ].join("\n"),
    answer: [
      "### Why streaming feels faster",
      "",
      "Streaming makes an assistant feel **fast** even when the full answer takes seconds to generate:",
      "",
      "1. **Time to first token** drops from seconds to milliseconds",
      "2. You start *reading* while the model is still writing",
      "3. Visible progress makes the wait feel shorter",
      "",
      "> The UI challenge is keeping it smooth: every token can change the bubble's height, so the layout has to **ease** into each new size.",
      "",
      "Read more in [Nielsen Norman Group's guide to response times](https://www.nngroup.com/articles/response-times-3-important-limits/).",
    ].join("\n"),
  },
  stress: {
    reasoning: "Real model output is messy. Exercise tables, task lists, tildes, images, raw HTML and a broken link, and make sure nothing half-written ever shows up raw.",
    answer: [
      "### Framework comparison",
      "",
      "| Framework | Bundle | Streaming |",
      "| :--- | ---: | :---: |",
      "| **shadcn-ai-native** | 0 deps | ✅ |",
      "| Other kit | ~~40 kB~~ 38 kB | partial |",
      "",
      "- [x] Tables with alignment",
      "- [x] Task lists",
      "- [ ] Footnotes (not supported)",
      "",
      "~~~bash",
      "npx expo start --no-dev --minify",
      "~~~",
      "",
      "<details>Raw HTML stays literal text</details>",
      "",
      "An image: ![React Native logo](https://reactnative.dev/img/header_logo.svg), an autolink <https://expo.dev> and a broken one: [docs](https://exa mple.com",
    ].join("\n"),
  },
  simple: {
    answer: [
      "Imagine a backpack 🎒",
      "",
      "A **closure** is a function that carries a backpack. When the function is created, it _packs up_ the variables around it and takes them wherever it goes.",
      "",
      "So even after the outer function has finished, the inner one can still open its backpack and use those values.",
    ].join("\n"),
  },
};

/** Picks a canned reply. The first reply of a conversation always shows off the code block. */
export function pickResponse(prompt: string, history: readonly Message[]): SimulatedResponse {
  const codeShown = history.some((m) => m.role === "assistant" && m.content.includes("```"));
  if (/stress|messy|markdown|table/i.test(prompt)) return RESPONSES.stress;
  if (/simpl|eli5|like i'?m/i.test(prompt)) return RESPONSES.simple;
  if (/hook|code|typescript|function|snippet|write|debounce|component/i.test(prompt) || !codeShown) {
    return RESPONSES.code;
  }
  return RESPONSES.general;
}
