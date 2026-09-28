/**
 * Application layer: the chat's use cases (send, stop, regenerate, reset) as a framework-free
 * state machine. It talks to the model only through the ChatModel port and exposes two
 * observable stores for the UI:
 *
 *  - `state`: the message list and which message is streaming. Changes only when a stream
 *    starts or ends, so the list never re-renders per token.
 *  - `live`: the text of the reply being streamed. Changes on every token; only the streaming
 *    row subscribes to it.
 *
 * Only type imports, so Node can run it in tests without a bundler.
 */
import type { CancelStream, ChatModel } from "../domain/chat-model";
import type { Message, MessageStatus } from "../domain/message";

export interface ChatState {
  readonly messages: readonly Message[];
  /** Id of the assistant message being streamed, or null when idle. */
  readonly streamingId: string | null;
}

export type LivePhase = "waiting" | "reasoning" | "answer";

/** The reply being streamed. Replaced (never mutated) on every change. */
export interface LiveReply {
  readonly phase: LivePhase;
  readonly reasoning: string;
  readonly content: string;
}

type Listener = () => void;

export interface ChatSessionOptions {
  /** Id generator. Defaults to a time-based counter. */
  createId?: () => string;
  /** Clock in ms, for the "Thought for N seconds" timing. */
  now?: () => number;
}

const IDLE_REPLY: LiveReply = { phase: "waiting", reasoning: "", content: "" };

let idCounter = 0;
const defaultCreateId = () => `m${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** A readable store in the shape `useSyncExternalStore` expects. */
class Store<T> {
  private value: T;
  private readonly listeners = new Set<Listener>();

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => this.value;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    this.listeners.forEach((listener) => listener());
  }
}

interface ActiveStream {
  readonly messageId: string;
  readonly cancel: CancelStream;
  readonly startedAt: number;
  thoughtSeconds?: number;
}

export class ChatSession {
  readonly state = new Store<ChatState>({ messages: [], streamingId: null });
  readonly live = new Store<LiveReply>(IDLE_REPLY);

  private readonly model: ChatModel;
  private readonly createId: () => string;
  private readonly now: () => number;
  private active: ActiveStream | null = null;

  constructor(model: ChatModel, options: ChatSessionOptions = {}) {
    this.model = model;
    this.createId = options.createId ?? defaultCreateId;
    this.now = options.now ?? Date.now;
  }

  get isStreaming(): boolean {
    return this.active !== null;
  }

  /** Sends a prompt. Ignored while a reply is streaming or when the prompt is blank. */
  send(prompt: string): boolean {
    const text = prompt.trim();
    if (text.length === 0 || this.active) return false;
    const history = this.state.get().messages;
    const user: Message = { id: this.createId(), role: "user", content: text, status: "complete" };
    this.startReply(text, [...history, user]);
    return true;
  }

  /** Streams a new reply to the last prompt, replacing the last assistant message. */
  regenerate(): boolean {
    if (this.active) return false;
    const messages = this.state.get().messages;
    let lastUser = -1;
    for (let k = messages.length - 1; k >= 0; k--) {
      if (messages[k].role === "user") {
        lastUser = k;
        break;
      }
    }
    if (lastUser === -1) return false;
    this.startReply(messages[lastUser].content, messages.slice(0, lastUser + 1));
    return true;
  }

  /** Stops the reply being streamed and keeps what arrived so far. */
  stop(): void {
    if (this.active) this.finish("stopped");
  }

  /** Cancels any stream and clears the conversation. */
  reset(): void {
    const active = this.active;
    this.active = null;
    active?.cancel();
    this.live.set(IDLE_REPLY);
    this.state.set({ messages: [], streamingId: null });
  }

  /** Call when the owner unmounts: cancels the stream so no timer or request outlives it. */
  dispose(): void {
    const active = this.active;
    this.active = null;
    active?.cancel();
  }

  private startReply(prompt: string, messages: readonly Message[]): void {
    const messageId = this.createId();
    const placeholder: Message = { id: messageId, role: "assistant", content: "", status: "complete" };
    this.live.set(IDLE_REPLY);
    this.state.set({ messages: [...messages, placeholder], streamingId: messageId });

    // Handlers ignore anything that arrives after this stream stopped being the active one, so a
    // model that keeps emitting after cancel (a late network chunk, a stray timer) can't corrupt
    // a newer reply or a cleared chat.
    const isCurrent = () => this.active?.messageId === messageId;
    const startedAt = this.now();
    let cancel: CancelStream = () => {};
    this.active = { messageId, startedAt, cancel: () => cancel() };

    cancel = this.model.stream(
      { prompt, history: messages },
      {
        onReasoning: (delta) => {
          if (!isCurrent()) return;
          const reply = this.live.get();
          this.live.set({ phase: "reasoning", reasoning: reply.reasoning + delta, content: reply.content });
        },
        onAnswer: (delta) => {
          const active = this.active;
          if (!active || !isCurrent()) return;
          const reply = this.live.get();
          if (reply.phase === "reasoning" && active.thoughtSeconds === undefined) {
            active.thoughtSeconds = this.secondsSince(active.startedAt);
          }
          this.live.set({ phase: "answer", reasoning: reply.reasoning, content: reply.content + delta });
        },
        onDone: () => {
          if (isCurrent()) this.finish("complete");
        },
        onError: () => {
          if (isCurrent()) this.finish("error");
        },
      },
    );
  }

  /** Commits the streamed reply into the message list, once. */
  private finish(status: MessageStatus): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    if (status !== "complete") active.cancel();

    const reply = this.live.get();
    const hasReasoning = reply.phase === "reasoning" || reply.reasoning.length > 0;
    const thoughtSeconds = hasReasoning ? (active.thoughtSeconds ?? this.secondsSince(active.startedAt)) : undefined;
    const { messages } = this.state.get();

    // A reply stopped before anything arrived leaves nothing worth keeping.
    const empty = reply.content.length === 0 && reply.reasoning.length === 0;
    const next =
      empty && status !== "error"
        ? messages.filter((m) => m.id !== active.messageId)
        : messages.map((m) =>
            m.id === active.messageId
              ? {
                  ...m,
                  content: reply.content,
                  reasoning: hasReasoning ? reply.reasoning : undefined,
                  thoughtSeconds,
                  status,
                }
              : m,
          );

    this.state.set({ messages: next, streamingId: null });
    this.live.set(IDLE_REPLY);
  }

  private secondsSince(start: number): number {
    return Math.max(1, Math.round((this.now() - start) / 1000));
  }
}
