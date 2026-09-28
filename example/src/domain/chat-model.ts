/**
 * Domain port: anything that can stream a reply. The simulated model implements it today; a real
 * backend (OpenAI, Anthropic, the Vercel AI SDK, your own server) only needs a new adapter in
 * src/infrastructure, and nothing in the application or UI layers changes.
 */
import type { Message } from "./message";

export interface ChatRequest {
  readonly prompt: string;
  /**
   * The conversation to send, oldest first, ending with the user message for `prompt`. Replies
   * still streaming are never included.
   */
  readonly history: readonly Message[];
}

/**
 * Callbacks for one streamed reply. Deltas are appended as they arrive. Reasoning (if any) comes
 * before the answer. Exactly one of `onDone` or `onError` ends the stream.
 */
export interface ChatStreamHandlers {
  /** A piece of the model's thinking. An empty delta signals that reasoning has started. */
  onReasoning(delta: string): void;
  /** A piece of the answer. */
  onAnswer(delta: string): void;
  onDone(): void;
  onError(error: unknown): void;
}

/** Stops the stream. After it's called the model must not call any handler again. */
export type CancelStream = () => void;

export interface ChatModel {
  stream(request: ChatRequest, handlers: ChatStreamHandlers): CancelStream;
}
