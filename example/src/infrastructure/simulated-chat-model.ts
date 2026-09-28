/**
 * Infrastructure: a ChatModel adapter that streams canned replies with realistic timing, so the
 * demo works offline and without an API key.
 *
 * To use a real model, write another adapter that implements ChatModel (call your API, forward
 * reasoning and answer deltas to the handlers, return a function that aborts the request) and
 * pass it to <ChatScreen /> in App.tsx. Nothing else changes.
 */
import type { CancelStream, ChatModel, ChatRequest, ChatStreamHandlers } from "../domain/chat-model";
import { pickResponse } from "./canned-responses";

export interface SimulatedChatModelOptions {
  /** Pause before the first token, like a real model's time to first token. */
  thinkingDelayMs?: number;
  /** Interval between answer chunks. */
  tokenIntervalMs?: number;
  /** Interval between reasoning chunks; reasoning models think faster than they write. */
  reasoningIntervalMs?: number;
}

/** Splits text into word/whitespace tokens so indentation inside code survives streaming. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

export class SimulatedChatModel implements ChatModel {
  private readonly thinkingDelayMs: number;
  private readonly tokenIntervalMs: number;
  private readonly reasoningIntervalMs: number;

  constructor(options: SimulatedChatModelOptions = {}) {
    this.thinkingDelayMs = options.thinkingDelayMs ?? 650;
    this.tokenIntervalMs = options.tokenIntervalMs ?? 40;
    this.reasoningIntervalMs = options.reasoningIntervalMs ?? 25;
  }

  stream(request: ChatRequest, handlers: ChatStreamHandlers): CancelStream {
    const response = pickResponse(request.prompt, request.history);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // One pending timer at a time, so cancelling is a single clearTimeout.
    const schedule = (run: () => void, delay: number) => {
      timer = setTimeout(() => {
        if (!cancelled) run();
      }, delay);
    };

    // Emits 1–3 tokens per tick for a natural, slightly uneven cadence.
    const emit = (tokens: string[], interval: number, onChunk: (chunk: string) => void, done: () => void) => {
      let cursor = 0;
      const tick = () => {
        const burst = 1 + Math.floor(Math.random() * 3);
        onChunk(tokens.slice(cursor, cursor + burst).join(""));
        cursor += burst;
        if (cursor >= tokens.length) done();
        else schedule(tick, interval);
      };
      schedule(tick, interval);
    };

    const streamAnswer = () => emit(tokenize(response.answer), this.tokenIntervalMs, handlers.onAnswer, handlers.onDone);

    // Tell the UI right away that this reply will reason, so "Thinking…" shows during the delay.
    if (response.reasoning !== undefined) handlers.onReasoning("");

    schedule(() => {
      if (response.reasoning === undefined) streamAnswer();
      else emit(tokenize(response.reasoning), this.reasoningIntervalMs, handlers.onReasoning, streamAnswer);
    }, this.thinkingDelayMs);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }
}
