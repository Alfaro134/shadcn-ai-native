import "./global.css";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Platform, Pressable, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, FadeIn, FadeInUp } from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";

import { ActionChips, type ActionChip } from "../components/ai/ActionChips";
import { DynamicPromptInput } from "../components/ai/DynamicPromptInput";
import { StreamingChatBubble, type ChatRole } from "../components/ai/StreamingChatBubble";

/* -------------------------------------------------------------------------------------------------
 * Theme
 * -----------------------------------------------------------------------------------------------*/

const theme = {
  screen: "flex-1 bg-white dark:bg-zinc-950",
  header: "flex-row items-center justify-between border-b border-zinc-100 bg-white px-4 pb-3 dark:border-zinc-900 dark:bg-zinc-950",
  headerLeft: "flex-row items-center gap-3",
  headerTitle: "text-[16px] font-semibold text-zinc-900 dark:text-zinc-50",
  headerSubtitleRow: "flex-row items-center gap-1.5",
  onlineDot: "h-1.5 w-1.5 rounded-full bg-emerald-500",
  headerSubtitle: "text-xs text-zinc-500 dark:text-zinc-400",
  newChatButton: "flex-row items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1.5 active:bg-zinc-100 dark:border-zinc-800 dark:active:bg-zinc-900",
  newChatLabel: "text-[13px] font-medium text-zinc-700 dark:text-zinc-300",
  newChatIcon: "bg-zinc-700 dark:bg-zinc-300",
  avatar: "h-8 w-8 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100",
  avatarSmall: "mt-0.5 h-7 w-7 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100",
  avatarGlyph: "text-[13px] text-white dark:text-zinc-900",
  list: "flex-1",
  listContent: "py-3",
  empty: "flex-1 items-center justify-center px-8",
  emptyLogo: "mb-5 h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 dark:bg-zinc-100",
  emptyLogoGlyph: "text-2xl text-white dark:text-zinc-900",
  emptyTitle: "text-center text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50",
  emptySubtitle: "mt-2 text-center text-[15px] leading-[22px] text-zinc-500 dark:text-zinc-400",
  suggestions: "pb-2",
} as const;

/* -------------------------------------------------------------------------------------------------
 * Simulated model
 * -----------------------------------------------------------------------------------------------*/

const THINKING_DELAY_MS = 650;
const TOKEN_INTERVAL_MS = 40;

const RESPONSES = {
  code: [
    "Here's a fully typed `useDebounce` hook. It waits until the user stops typing before updating the value, which is perfect for search inputs:",
    "",
    "```tsx",
    'import { useEffect, useState } from "react";',
    "",
    "export function useDebounce<T>(value: T, delay = 300): T {",
    "  const [debounced, setDebounced] = useState(value);",
    "",
    "  useEffect(() => {",
    "    const id = setTimeout(() => setDebounced(value), delay);",
    "    return () => clearTimeout(id);",
    "  }, [value, delay]);",
    "",
    "  return debounced;",
    "}",
    "```",
    "",
    "Use it as `const query = useDebounce(text, 400);` and fire your API call whenever **query** changes.",
  ].join("\n"),
  general: [
    "Streaming makes an assistant feel **fast** even when the full answer takes seconds to generate.",
    "",
    "Instead of staring at a spinner, you start reading after the first few hundred milliseconds. Your brain processes the text as it arrives, so the total wait feels much shorter.",
    "",
    "The UI challenge is keeping it smooth: every new token can change the bubble's height, so the layout has to **ease** into each new size instead of jumping.",
  ].join("\n"),
  simple: [
    "Imagine a backpack 🎒",
    "",
    "A **closure** is a function that carries a backpack. When the function is created, it packs up the variables around it and takes them wherever it goes.",
    "",
    "So even after the outer function has finished, the inner one can still open its backpack and use those values.",
  ].join("\n"),
} as const;

function pickResponse(prompt: string, codeShown: boolean): string {
  if (/simpl|eli5|like i'?m/i.test(prompt)) return RESPONSES.simple;
  if (/hook|code|typescript|function|snippet|write|debounce|component/i.test(prompt) || !codeShown) {
    return RESPONSES.code;
  }
  return RESPONSES.general;
}

/** Splits text into word/whitespace tokens so indentation inside code survives streaming. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

let idCounter = 0;
const makeId = () => `m${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/* -------------------------------------------------------------------------------------------------
 * Types
 * -----------------------------------------------------------------------------------------------*/

interface Message {
  id: string;
  role: ChatRole;
  content: string;
}

const SUGGESTIONS: ActionChip[] = [
  { id: "s1", label: "Write a debounce hook in TypeScript" },
  { id: "s2", label: "Why does streaming feel faster?" },
  { id: "s3", label: "Explain closures simply" },
];

/* -------------------------------------------------------------------------------------------------
 * Small presentational pieces
 * -----------------------------------------------------------------------------------------------*/

function AssistantAvatar({ small = false }: { small?: boolean }) {
  return (
    <View className={small ? theme.avatarSmall : theme.avatar}>
      <Text className={theme.avatarGlyph}>✦</Text>
    </View>
  );
}

function Header({ topInset, onNewChat }: { topInset: number; onNewChat: () => void }) {
  return (
    <View className={theme.header} style={{ paddingTop: topInset + 8 }}>
      <View className={theme.headerLeft}>
        <AssistantAvatar />
        <View>
          <Text className={theme.headerTitle}>Assistant</Text>
          <View className={theme.headerSubtitleRow}>
            <View className={theme.onlineDot} />
            <Text className={theme.headerSubtitle}>shadcn-ai-native · demo</Text>
          </View>
        </View>
      </View>

      <Pressable onPress={onNewChat} accessibilityRole="button" accessibilityLabel="New chat" className={theme.newChatButton}>
        <View className="h-3 w-3 items-center justify-center">
          <View className={`absolute h-[1.5px] w-3 rounded-full ${theme.newChatIcon}`} />
          <View className={`absolute h-3 w-[1.5px] rounded-full ${theme.newChatIcon}`} />
        </View>
        <Text className={theme.newChatLabel}>New chat</Text>
      </Pressable>
    </View>
  );
}

function EmptyState() {
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

/* -------------------------------------------------------------------------------------------------
 * Chat screen
 * -----------------------------------------------------------------------------------------------*/

function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const streamingIdRef = useRef<string | null>(null);
  const codeShown = useRef(false);
  const timers = useRef<{
    thinking?: ReturnType<typeof setTimeout>;
    tokens?: ReturnType<typeof setInterval>;
    copied?: ReturnType<typeof setTimeout>;
  }>({});

  const clearStreamTimers = useCallback(() => {
    if (timers.current.thinking) clearTimeout(timers.current.thinking);
    if (timers.current.tokens) clearInterval(timers.current.tokens);
  }, []);

  useEffect(
    () => () => {
      clearStreamTimers();
      if (timers.current.copied) clearTimeout(timers.current.copied);
    },
    [clearStreamTimers],
  );

  const finishStream = useCallback(() => {
    clearStreamTimers();
    const id = streamingIdRef.current;
    streamingIdRef.current = null;
    setStreamingId(null);
    // A stop during the "thinking" phase leaves an empty bubble behind; drop it.
    setMessages((prev) => prev.filter((m) => !(m.id === id && m.content.length === 0)));
  }, [clearStreamTimers]);

  const streamResponse = useCallback(
    (prompt: string) => {
      const id = makeId();
      const full = pickResponse(prompt, codeShown.current);
      if (full === RESPONSES.code) codeShown.current = true;

      streamingIdRef.current = id;
      setStreamingId(id);
      setMessages((prev) => [...prev, { id, role: "assistant", content: "" }]);

      const tokens = tokenize(full);
      let cursor = 0;
      let text = "";

      timers.current.thinking = setTimeout(() => {
        timers.current.tokens = setInterval(() => {
          // Emit 1–3 tokens per tick for a natural, slightly uneven cadence.
          const burst = 1 + Math.floor(Math.random() * 3);
          text += tokens.slice(cursor, cursor + burst).join("");
          cursor += burst;
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: text } : m)));
          if (cursor >= tokens.length) finishStream();
        }, TOKEN_INTERVAL_MS);
      }, THINKING_DELAY_MS);
    },
    [finishStream],
  );

  const sendPrompt = useCallback(
    (prompt: string) => {
      if (streamingIdRef.current) return;
      setMessages((prev) => [...prev, { id: makeId(), role: "user", content: prompt }]);
      setDraft("");
      streamResponse(prompt);
    },
    [streamResponse],
  );

  const regenerate = useCallback(() => {
    if (streamingIdRef.current) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setMessages((prev) => (prev[prev.length - 1]?.role === "assistant" ? prev.slice(0, -1) : prev));
    streamResponse(lastUser.content);
  }, [messages, streamResponse]);

  const copyMessage = useCallback(async (message: Message) => {
    await Clipboard.setStringAsync(message.content);
    setCopiedId(message.id);
    if (timers.current.copied) clearTimeout(timers.current.copied);
    timers.current.copied = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const newChat = useCallback(() => {
    clearStreamTimers();
    streamingIdRef.current = null;
    codeShown.current = false;
    setStreamingId(null);
    setMessages([]);
    setDraft("");
  }, [clearStreamTimers]);

  // Inverted list keeps the newest message pinned above the input, so growing bubbles and the
  // opening keyboard never push content off-screen.
  const invertedData = useMemo(() => [...messages].reverse(), [messages]);
  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant")?.id,
    [messages],
  );

  const renderItem = useCallback(
    ({ item }: { item: Message }) => {
      const isStreaming = item.id === streamingId;
      const showChips = item.role === "assistant" && item.id === lastAssistantId && !isStreaming;

      const chips: ActionChip[] = [
        { id: "regenerate", label: "↻  Regenerate", onPress: regenerate },
        { id: "copy", label: copiedId === item.id ? "✓  Copied" : "Copy", onPress: () => copyMessage(item) },
        { id: "simpler", label: "Explain simpler", onPress: () => sendPrompt("Explain that simpler") },
      ];

      return (
        // The list is inverted (scaleY: -1), so FadeInUp reads as "slide up" on screen.
        <Animated.View
          entering={FadeInUp.duration(280)
            .easing(Easing.out(Easing.cubic))
            .withInitialValues({ opacity: 0, transform: [{ translateY: -12 }] })}
        >
          <StreamingChatBubble
            role={item.role}
            content={item.content}
            isStreaming={isStreaming}
            animateEntry={false}
            avatar={item.role === "assistant" ? <AssistantAvatar small /> : undefined}
            footer={showChips ? <ActionChips chips={chips} contentContainerClassName="px-0" /> : null}
          />
        </Animated.View>
      );
    },
    [streamingId, lastAssistantId, copiedId, regenerate, copyMessage, sendPrompt],
  );

  const isEmpty = messages.length === 0;

  return (
    <View className={theme.screen}>
      <StatusBar style="auto" />
      <Header topInset={insets.top} onNewChat={newChat} />

      {isEmpty ? (
        <EmptyState />
      ) : (
        <FlatList
          data={invertedData}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          extraData={renderItem}
          className={theme.list}
          contentContainerClassName={theme.listContent}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}

      <DynamicPromptInput
        value={draft}
        onChangeText={setDraft}
        onSend={sendPrompt}
        onStop={finishStream}
        onAttach={() => {}}
        isGenerating={streamingId !== null}
        placeholder="Message Assistant"
        bottomInset={insets.bottom}
        accessory={
          isEmpty ? (
            <ActionChips
              chips={SUGGESTIONS}
              onChipPress={(chip) => sendPrompt(chip.label)}
              initialDelay={250}
              className={theme.suggestions}
              contentContainerClassName="px-1"
            />
          ) : null
        }
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ChatScreen />
    </SafeAreaProvider>
  );
}
