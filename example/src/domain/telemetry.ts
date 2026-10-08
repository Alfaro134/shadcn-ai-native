/**
 * Domain port: what the chat reports about each reply, for dashboards and alerts (time to first
 * token, error rate, how often users stop a reply). Metrics only, never prompt or reply text, so
 * an adapter can forward them to an analytics service without leaking conversations.
 */
import type { MessageStatus } from "./message";

/** What started the reply. */
export type ReplyTrigger = "send" | "regenerate";

/**
 * How the reply ended: the message status it was saved with, or "discarded" when the chat was
 * cleared or the screen closed while it streamed.
 */
export type ReplyOutcome = MessageStatus | "discarded";

export interface ReplyMetrics {
  readonly trigger: ReplyTrigger;
  readonly outcome: ReplyOutcome;
  /** From the request to the first reasoning or answer text, in ms. Missing if none arrived. */
  readonly timeToFirstTokenMs?: number;
  /** From the request to the end of the reply, in ms. */
  readonly durationMs: number;
  /** Non-empty deltas received, reasoning and answer together. */
  readonly chunks: number;
  readonly reasoningChars: number;
  readonly answerChars: number;
}

export interface ChatTelemetry {
  /**
   * Called once per reply, when it ends. `error` is set when the outcome is "error": it is
   * whatever the model adapter reported, so scrub it before sending it anywhere. Must not throw;
   * if it does, the chat ignores it.
   */
  replyEnded(metrics: ReplyMetrics, error?: unknown): void;
}
