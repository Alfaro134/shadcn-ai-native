import React, { useCallback, useMemo } from "react";
import { Alert, FlatList, Platform, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionChips, type ActionChip } from "../../../components/ai/ActionChips";
import { DynamicPromptInput } from "../../../components/ai/DynamicPromptInput";
import { useChat } from "../application/use-chat";
import type { ChatModel } from "../domain/chat-model";
import type { Message } from "../domain/message";
import { ChatHeader } from "./ChatHeader";
import { EmptyState } from "./EmptyState";
import { MessageRow, type RowActions } from "./MessageRow";
import { theme } from "./theme";
import { useCopyFeedback } from "./use-copy-feedback";

const SUGGESTIONS: ActionChip[] = [
  { id: "s1", label: "Write a debounce hook in TypeScript" },
  { id: "s2", label: "Why does streaming feel faster?" },
  { id: "s3", label: "Stress-test the Markdown" },
  { id: "s4", label: "Explain closures simply" },
];

const keyExtractor = (message: Message) => message.id;

function showAttachHint() {
  Alert.alert("Attachments", "Hook up your file or image picker in the onAttach prop.");
}

export function ChatScreen({ model }: { model: ChatModel }) {
  const insets = useSafeAreaInsets();
  const { session, state } = useChat(model);
  const { messages, streamingId } = state;
  const { copiedId, copy } = useCopyFeedback();

  const send = useCallback((prompt: string) => void session.send(prompt), [session]);
  const stop = useCallback(() => session.stop(), [session]);
  const newChat = useCallback(() => session.reset(), [session]);

  const actions = useMemo<RowActions>(
    () => ({
      regenerate: () => void session.regenerate(),
      copy: (message) => void copy(message),
      simpler: () => void session.send("Explain that simpler"),
    }),
    [session, copy],
  );

  // Inverted list keeps the newest message pinned above the input, so growing bubbles and the
  // opening keyboard never push content off-screen.
  const invertedData = useMemo(() => [...messages].reverse(), [messages]);
  const lastAssistantId = useMemo(() => invertedData.find((m) => m.role === "assistant")?.id, [invertedData]);

  // Changes only when a reply starts or ends, or the copy confirmation toggles; never per token.
  const renderItem = useCallback(
    ({ item }: { item: Message }) => {
      const isStreaming = item.id === streamingId;
      return (
        <MessageRow
          message={item}
          isStreaming={isStreaming}
          showActions={item.role === "assistant" && item.id === lastAssistantId && !isStreaming}
          copied={copiedId === item.id}
          session={session}
          actions={actions}
        />
      );
    },
    [streamingId, lastAssistantId, copiedId, session, actions],
  );

  const suggestionChips = useMemo(
    () => (
      <ActionChips
        chips={SUGGESTIONS}
        onChipPress={(chip) => send(chip.label)}
        initialDelay={250}
        className={theme.suggestions}
        contentContainerClassName="px-1"
      />
    ),
    [send],
  );

  const isEmpty = messages.length === 0;

  return (
    <View className={theme.screen}>
      <StatusBar style="auto" />
      <ChatHeader topInset={insets.top} onNewChat={newChat} />

      {isEmpty ? (
        <EmptyState />
      ) : (
        <FlatList
          data={invertedData}
          inverted
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          className={theme.list}
          contentContainerClassName={theme.listContent}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Uncontrolled: typing re-renders only the input, never the chat list. */}
      <DynamicPromptInput
        onSend={send}
        onStop={stop}
        onAttach={showAttachHint}
        isGenerating={streamingId !== null}
        placeholder="Message Assistant"
        bottomInset={insets.bottom}
        accessory={isEmpty ? suggestionChips : null}
      />
    </View>
  );
}
