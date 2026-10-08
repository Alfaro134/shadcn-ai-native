/**
 * Infrastructure: a ChatTelemetry adapter that prints one line per reply to the Metro console.
 * Development only (see App.tsx). In production, write an adapter for your analytics or error
 * tracker (Sentry, PostHog, Datadog…) with the same interface, and scrub `error` before sending
 * it: it can contain whatever your backend put in the message.
 */
import type { ChatTelemetry, ReplyMetrics } from "../domain/telemetry";

export class ConsoleTelemetry implements ChatTelemetry {
  replyEnded(metrics: ReplyMetrics, error?: unknown): void {
    const ttft = metrics.timeToFirstTokenMs === undefined ? "–" : `${metrics.timeToFirstTokenMs} ms`;
    const line =
      `[chat] ${metrics.trigger} → ${metrics.outcome} · first token ${ttft} · ${metrics.durationMs} ms · ` +
      `${metrics.chunks} chunks · ${metrics.answerChars} chars`;
    if (error === undefined) {
      // eslint-disable-next-line no-console -- this adapter's whole job is logging
      console.log(line);
    } else {
      console.error(line, error);
    }
  }
}
