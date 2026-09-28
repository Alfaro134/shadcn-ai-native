import React from "react";
import { Text, View } from "react-native";

import { theme } from "./theme";

export function AssistantAvatar({ small = false }: { small?: boolean }) {
  return (
    <View className={small ? theme.avatarSmall : theme.avatar}>
      <Text className={theme.avatarGlyph}>✦</Text>
    </View>
  );
}
