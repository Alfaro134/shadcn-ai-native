/**
 * Domain: the chat's core entities. No React, no React Native, no I/O.
 */

export type Role = "user" | "assistant";

/** How an assistant message ended. User messages are always "complete". */
export type MessageStatus = "complete" | "stopped" | "error";

export interface Message {
  readonly id: string;
  readonly role: Role;
  /** Markdown text. */
  readonly content: string;
  /** The model's thinking, for replies that reason before answering. */
  readonly reasoning?: string;
  /** How long the reasoning phase took, in whole seconds. */
  readonly thoughtSeconds?: number;
  readonly status: MessageStatus;
}
