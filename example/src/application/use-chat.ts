/**
 * React adapter for ChatSession: one session per mounted screen, torn down on unmount.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { ChatModel } from "../domain/chat-model";
import { ChatSession, type ChatState, type LiveReply } from "./chat-session";

export interface UseChat {
  readonly session: ChatSession;
  readonly state: ChatState;
}

/** Creates a session for `model` (read once, on mount) and subscribes to its message list. */
export function useChat(model: ChatModel): UseChat {
  const [session] = useState(() => new ChatSession(model));
  useEffect(() => () => session.dispose(), [session]);
  const state = useSyncExternalStore(session.state.subscribe, session.state.get);
  return { session, state };
}

const NO_SUBSCRIPTION = () => () => {};
const NO_REPLY = () => null;

/**
 * The live reply, for the streaming row only. Other rows pass `active: false` and neither
 * subscribe nor re-render when tokens arrive.
 */
export function useLiveReply(session: ChatSession, active: boolean): LiveReply | null {
  return useSyncExternalStore(active ? session.live.subscribe : NO_SUBSCRIPTION, active ? session.live.get : NO_REPLY);
}
