# Architecture

The repository has two parts with different goals, so they follow the same principle — **keep
logic independent of frameworks and I/O, and let dependencies point inward** — at different
scales. `tests/architecture.test.ts` enforces every rule below on each CI run.

## 1. The kit (`components/ai`) — functional core, imperative shell

The kit is copied file by file into apps, so each piece must stay small and self-contained.
Layering every component into four folders would break that, so the kit splits one way only:
**pure logic** vs. **React Native views**.

```
components/ai/
├── markdown.ts            ┐ Functional core: pure TypeScript, no imports at all.
├── highlight.ts           ┘ Tested directly in Node (unit, property, fuzz, timing).
│
├── StreamingChatBubble.tsx ──▶ markdown.ts, CodeBlock.tsx
├── CodeBlock.tsx           ──▶ highlight.ts, expo-clipboard
├── ReasoningBlock.tsx      ┐
├── DynamicPromptInput.tsx  ├ Imperative shell: rendering, animation, gestures, a11y.
└── ActionChips.tsx         ┘ Only React, React Native, Reanimated, expo-clipboard.
```

Rules:

- `markdown.ts` and `highlight.ts` import **nothing**. Anything that can be computed from a
  string belongs there, not in a component.
- Streaming work is incremental: `createStreamingParser` and `createStreamingHighlighter` parse
  text that can no longer change once and return it as the same objects, and the components
  memoize on that identity. A new token costs time proportional to the unfinished tail, not to
  the whole reply. Each has a property test proving it returns exactly what a full parse does.
- Components import only React, React Native, Reanimated, `expo-clipboard` and sibling files.
  No new runtime dependency without a strong reason.
- Every file in `components/ai` is listed in the README's copy instructions.
- Extension points are props, not forks: `theme` (per file), `classNames`, `components`,
  `labels`, `onLinkPress`, `useKeyboardHeight`.

## 2. The example app (`example/`) — Clean Architecture

The demo is a small real app, and the reference for how to use the kit with a real model. It
follows Clean Architecture: the domain and use cases know nothing about React Native or the
simulated model, so swapping in a real backend touches one file.

```
example/
├── App.tsx                        Composition root: picks the ChatModel implementation.
└── src/
    ├── domain/                    Entities and ports. No React, no I/O.
    │   ├── message.ts               Message, Role, MessageStatus
    │   ├── chat-model.ts            ChatModel port: stream(request, handlers) → cancel
    │   └── telemetry.ts             ChatTelemetry port: one metrics record per reply
    ├── application/               Use cases. Depends on domain only.
    │   ├── chat-session.ts          send / stop / regenerate / reset as a framework-free
    │   │                            state machine with two stores (message list, live reply)
    │   └── use-chat.ts              React adapter (useSyncExternalStore)
    ├── infrastructure/            Adapters that implement domain ports.
    │   ├── simulated-chat-model.ts  ChatModel with canned replies and realistic timing
    │   ├── canned-responses.ts
    │   └── console-telemetry.ts     ChatTelemetry that logs to the Metro console (dev)
    └── ui/                        React Native views. Depends on application and the kit.
        ├── ChatScreen.tsx, MessageRow.tsx, ChatHeader.tsx, EmptyState.tsx, …
        └── use-copy-feedback.ts
```

Dependency rule (arrows point to what a layer may import):

```
ui ──▶ application ──▶ domain ◀── infrastructure
 │                                      ▲
 └──▶ components/ai (the kit)           │
App.tsx ───────────────── wires ────────┘
```

- **domain** imports only itself.
- **application** imports domain types (type-only), and React only in the `use-chat.ts` adapter.
  `chat-session.ts` has type-only imports, so the use cases run in Node tests with a fake model.
- **infrastructure** implements domain ports; it never imports application or UI code.
- **ui** never imports infrastructure. Only `App.tsx` chooses the adapters (model, telemetry).

### Using a real model

Write an adapter in `src/infrastructure` that implements `ChatModel`:

```ts
export class MyApiChatModel implements ChatModel {
  stream({ history }: ChatRequest, handlers: ChatStreamHandlers): CancelStream {
    const controller = new AbortController();
    streamFromMyServer(history, controller.signal, {
      onReasoning: handlers.onReasoning,
      onText: handlers.onAnswer,
    })
      .then(handlers.onDone)
      .catch((error) => {
        if (!controller.signal.aborted) handlers.onError(error);
      });
    return () => controller.abort();
  }
}
```

Then change one line in `App.tsx`: `const model = new MyApiChatModel();`. `ChatSession` already
ignores events that arrive after a stream was stopped or replaced, keeps partial replies on
error, and never re-renders the message list per token.

Call your own server, not the model provider directly: API keys don't belong in an app bundle.

### Observability

`ChatSession` reports every reply to an optional `ChatTelemetry` port: trigger, outcome
(`complete`, `stopped`, `error`, or `discarded` when the chat is cleared or the screen closes
mid-reply), time to first token, duration, chunk count and size. The records carry no text, so
they can go to an analytics service unchanged; the model's error is passed separately, for an
error tracker, and must be scrubbed first. Telemetry is best-effort: an adapter that throws is
ignored. A model adapter that throws synchronously ends the reply as an error instead of leaving
the chat stuck in "generating".
