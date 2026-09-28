import React, { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { AssistantAvatar } from "./AssistantAvatar";
import { theme } from "./theme";

interface ChatHeaderProps {
  topInset: number;
  onNewChat: () => void;
}

export const ChatHeader = memo(function ChatHeader({ topInset, onNewChat }: ChatHeaderProps) {
  return (
    <View className={theme.header} style={{ paddingTop: topInset + 8 }}>
      <View className={theme.headerLeft}>
        <AssistantAvatar />
        <View>
          <Text className={theme.headerTitle} accessibilityRole="header">
            Assistant
          </Text>
          <View className={theme.headerSubtitleRow}>
            <View className={theme.onlineDot} />
            <Text className={theme.headerSubtitle}>shadcn-ai-native · demo</Text>
          </View>
        </View>
      </View>

      <Pressable
        onPress={onNewChat}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="New chat"
        accessibilityHint="Clears the current conversation"
        className={theme.newChatButton}
      >
        <View className="h-3 w-3 items-center justify-center">
          <View className={`absolute h-[1.5px] w-3 rounded-full ${theme.newChatIcon}`} />
          <View className={`absolute h-3 w-[1.5px] rounded-full ${theme.newChatIcon}`} />
        </View>
        <Text className={theme.newChatLabel}>New chat</Text>
      </Pressable>
    </View>
  );
});
