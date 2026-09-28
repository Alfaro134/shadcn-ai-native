import React from "react";
import { Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { theme } from "./theme";

export function EmptyState() {
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ flex: 1 }}>
      <View className={theme.empty}>
        <View className={theme.emptyLogo}>
          <Text className={theme.emptyLogoGlyph}>✦</Text>
        </View>
        <Text className={theme.emptyTitle}>How can I help today?</Text>
        <Text className={theme.emptySubtitle}>
          Copy-paste AI chat components for React Native, built with Reanimated and NativeWind.
        </Text>
      </View>
    </Animated.View>
  );
}
