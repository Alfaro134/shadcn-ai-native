import React, { memo, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, FadeInUp } from "react-native-reanimated";

import { ActionChips, type ActionChip } from "../../../components/ai/ActionChips";
import { ReasoningBlock } from "../../../components/ai/ReasoningBlock";
import { StreamingChatBubble } from "../../../components/ai/StreamingChatBubble";
import type { ChatSession } from "../application/chat-session";
import { useLiveReply } from "../application/use-chat";
import type { Message } from "../domain/message";
import { AssistantAvatar } from "./AssistantAvatar";
import { theme } from "./theme";

export interface RowActions {
  regenerate: () => void;
  copy: (message: Message) => void;
  simpler: () => void;
}

interface MessageRowProps {
  message: Message;
  isStreaming: boolean;
  showActions: boolean;
  copied: boolean;
  session: ChatSession;
  actions: RowActions;
}

// Hoisted so the memoized bubble receives the same element on every render.
const ASSISTANT_AVATAR = <AssistantAvatar small />;

// The list is inverted (scaleY: -1), so FadeInUp reads as "slide up" on screen.
const ROW_ENTERING = FadeInUp.duration(280)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({ opacity: 0, transform: [{ translateY: -12 }] });

export const MessageRow = memo(function MessageRow({ message, isStreaming, showActions, copied, session, actions }: MessageRowProps) {
  // Only the streaming row subscribes to per-token updates.
  const live = useLiveReply(session, isStreaming);
  const thinking = live?.phase === "reasoning";
  const content = live ? live.content : message.content;
  const reasoning = live ? (thinking || live.reasoning.length > 0 ? live.reasoning : undefined) : message.reasoning;
  // While the model is thinking, the ReasoningBlock carries the "busy" state, not a typing bubble.
  const answerStreaming = isStreaming && !thinking;

  const header = useMemo(
    () =>
      reasoning !== undefined ? (
        <ReasoningBlock content={reasoning} isStreaming={thinking} duration={message.thoughtSeconds} />
      ) : undefined,
    [reasoning, thinking, message.thoughtSeconds],
  );

  const footer = useMemo(() => {
    const status =
      message.status === "error" ? (
        <Text className={theme.statusError}>⚠︎ The reply was interrupted.</Text>
      ) : message.status === "stopped" ? (
        <Text className={theme.status}>Stopped</Text>
      ) : null;
    if (!showActions) return status;
    const chips: ActionChip[] = [
      { id: "regenerate", label: "↻  Regenerate", onPress: actions.regenerate },
      { id: "copy", label: copied ? "✓  Copied" : "Copy", onPress: () => actions.copy(message) },
      { id: "simpler", label: "Explain simpler", onPress: actions.simpler },
    ];
    return (
      <View>
        {status}
        <ActionChips chips={chips} contentContainerClassName="px-0" />
      </View>
    );
  }, [showActions, copied, actions, message]);

  return (
    <Animated.View entering={ROW_ENTERING}>
      <StreamingChatBubble
        role={message.role}
        content={content}
        isStreaming={answerStreaming}
        animateEntry={false}
        avatar={message.role === "assistant" ? ASSISTANT_AVATAR : undefined}
        header={header}
        footer={footer}
      />
    </Animated.View>
  );
});
