import "./global.css";

import React, { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FlatList, Platform, Pressable, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, FadeIn, FadeInUp } from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";

import { ActionChips, type ActionChip } from "../components/ai/ActionChips";
import { DynamicPromptInput } from "../components/ai/DynamicPromptInput";
import { ReasoningBlock } from "../components/ai/ReasoningBlock";
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
/** Reasoning streams a little faster than the answer, like real reasoning models. */
const REASONING_INTERVAL_MS = 25;

interface SimulatedResponse {
  /** Optional "thinking" shown in a <ReasoningBlock /> before the answer streams. */
  reasoning?: string;
  /** The answer, as Markdown. */
  answer: string;
}

const RESPONSES: Record<"code" | "general" | "simple" | "stress", SimulatedResponse> = {
  code: {
    reasoning: [
      "The user wants a debounce hook in TypeScript, so it should be generic over the value type.",
      "",
      "A timer in useEffect is enough: restart it on every change and clear it in the cleanup, so only the last value within the delay window wins. Worth explaining the mechanics briefly and ending with a practical tip.",
    ].join("\n"),
    answer: [
      "## A typed `useDebounce` hook",
      "",
      "It waits until the user **stops typing** before updating the value, which is perfect for *search inputs*:",
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
      "### How it works",
      "",
      "- Every change to `value` starts a **new timer**",
      "- The cleanup cancels the previous one, so only the _last_ change wins",
      "- `delay` defaults to **300 ms**",
      "",
      "> Tip: fire your request whenever `query` changes, e.g. `const query = useDebounce(text, 400);`",
    ].join("\n"),
  },
  general: {
    reasoning: [
      "They are asking about perceived performance, not raw speed.",
      "",
      "Key points: time to first token, reading while generating, visible progress. A numbered list fits, plus a link to the classic research on response times.",
    ].join("\n"),
    answer: [
      "### Why streaming feels faster",
      "",
      "Streaming makes an assistant feel **fast** even when the full answer takes seconds to generate:",
      "",
      "1. **Time to first token** drops from seconds to milliseconds",
      "2. You start *reading* while the model is still writing",
      "3. Visible progress makes the wait feel shorter",
      "",
      "> The UI challenge is keeping it smooth: every token can change the bubble's height, so the layout has to **ease** into each new size.",
      "",
      "Read more in [Nielsen Norman Group's guide to response times](https://www.nngroup.com/articles/response-times-3-important-limits/).",
    ].join("\n"),
  },
  stress: {
    reasoning: "Real model output is messy. Exercise tables, task lists, tildes, images, raw HTML and a broken link, and make sure nothing half-written ever shows up raw.",
    answer: [
      "### Framework comparison",
      "",
      "| Framework | Bundle | Streaming |",
      "| :--- | ---: | :---: |",
      "| **shadcn-ai-native** | 0 deps | ✅ |",
      "| Other kit | ~~40 kB~~ 38 kB | partial |",
      "",
      "- [x] Tables with alignment",
      "- [x] Task lists",
      "- [ ] Footnotes (not supported)",
      "",
      "~~~bash",
      "npx expo start --no-dev --minify",
      "~~~",
      "",
      "<details>Raw HTML stays literal text</details>",
      "",
      "An image: ![React Native logo](https://reactnative.dev/img/header_logo.svg), an autolink <https://expo.dev> and a broken one: [docs](https://exa mple.com",
    ].join("\n"),
  },
  simple: {
    answer: [
      "Imagine a backpack 🎒",
      "",
      "A **closure** is a function that carries a backpack. When the function is created, it _packs up_ the variables around it and takes them wherever it goes.",
      "",
      "So even after the outer function has finished, the inner one can still open its backpack and use those values.",
    ].join("\n"),
  },
};

function pickResponse(prompt: string, codeShown: boolean): SimulatedResponse {
  if (/stress|messy|markdown|table/i.test(prompt)) return RESPONSES.stress;
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
  /** The model's thinking, for responses that reason before answering. */
  reasoning?: string;
  /** How long the reasoning phase took, in seconds. */
  thoughtSeconds?: number;
}

const SUGGESTIONS: ActionChip[] = [
  { id: "s1", label: "Write a debounce hook in TypeScript" },
  { id: "s2", label: "Why does streaming feel faster?" },
  { id: "s3", label: "Stress-test the Markdown" },
  { id: "s4", label: "Explain closures simply" },
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

const Header = memo(function Header({ topInset, onNewChat }: { topInset: number; onNewChat: () => void }) {
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
 * Streaming store
 *
 * Tokens are written here, not into React state. Only the row that is currently streaming
 * subscribes, so a token re-renders exactly one bubble instead of the whole screen and list.
 * -----------------------------------------------------------------------------------------------*/

type StreamPhase = "reasoning" | "answer";

/** What the streaming row renders. Replaced (never mutated) on every token. */
interface StreamSnapshot {
  phase: StreamPhase;
  reasoning: string;
  content: string;
}

const EMPTY_SNAPSHOT: StreamSnapshot = { phase: "answer", reasoning: "", content: "" };

interface StreamStore {
  get: () => StreamSnapshot;
  set: (next: StreamSnapshot) => void;
  subscribe: (listener: () => void) => () => void;
}

function createStreamStore(): StreamStore {
  let snapshot = EMPTY_SNAPSHOT;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    set: (next) => {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const NOOP_SUBSCRIBE = () => () => {};
const NULL_SNAPSHOT = () => null;

/** Live snapshot for the streaming row; `null` (and no subscription) for every other row. */
function useLiveSnapshot(store: StreamStore, active: boolean): StreamSnapshot | null {
  return useSyncExternalStore(active ? store.subscribe : NOOP_SUBSCRIBE, active ? store.get : NULL_SNAPSHOT);
}

/* -------------------------------------------------------------------------------------------------
 * Message row
 * -----------------------------------------------------------------------------------------------*/

interface RowActions {
  regenerate: () => void;
  copy: (message: Message) => void;
  simpler: () => void;
}

interface MessageRowProps {
  message: Message;
  isStreaming: boolean;
  showActions: boolean;
  copied: boolean;
  store: StreamStore;
  actions: RowActions;
}

// Hoisted so the memoized bubble receives the same element on every render.
const ASSISTANT_AVATAR = <AssistantAvatar small />;

// The list is inverted (scaleY: -1), so FadeInUp reads as "slide up" on screen.
const ROW_ENTERING = FadeInUp.duration(280)
  .easing(Easing.out(Easing.cubic))
  .withInitialValues({ opacity: 0, transform: [{ translateY: -12 }] });

const MessageRow = memo(function MessageRow({ message, isStreaming, showActions, copied, store, actions }: MessageRowProps) {
  const live = useLiveSnapshot(store, isStreaming);
  const content = live ? live.content : message.content;
  const reasoning = live ? live.reasoning : message.reasoning;
  const thinking = live?.phase === "reasoning";
  // While the model is thinking, the ReasoningBlock carries the "busy" state, not a typing bubble.
  const answerStreaming = isStreaming && !thinking;

  const header = useMemo(
    () =>
      reasoning !== undefined && (reasoning.length > 0 || thinking) ? (
        <ReasoningBlock content={reasoning} isStreaming={thinking} duration={message.thoughtSeconds} />
      ) : undefined,
    [reasoning, thinking, message.thoughtSeconds],
  );

  const footer = useMemo(() => {
    if (!showActions) return null;
    const chips: ActionChip[] = [
      { id: "regenerate", label: "↻  Regenerate", onPress: actions.regenerate },
      { id: "copy", label: copied ? "✓  Copied" : "Copy", onPress: () => actions.copy(message) },
      { id: "simpler", label: "Explain simpler", onPress: actions.simpler },
    ];
    return <ActionChips chips={chips} contentContainerClassName="px-0" />;
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

/* -------------------------------------------------------------------------------------------------
 * Chat screen
 * -----------------------------------------------------------------------------------------------*/

function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [store] = useState(createStreamStore);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const streamingIdRef = useRef<string | null>(null);
  const codeShown = useRef(false);
  const mounted = useRef(true);
  const timers = useRef<{
    thinking?: ReturnType<typeof setTimeout>;
    tokens?: ReturnType<typeof setInterval>;
    copied?: ReturnType<typeof setTimeout>;
  }>({});

  const clearStreamTimers = useCallback(() => {
    if (timers.current.thinking) clearTimeout(timers.current.thinking);
    if (timers.current.tokens) clearInterval(timers.current.tokens);
    timers.current.thinking = undefined;
    timers.current.tokens = undefined;
  }, []);

  // Single teardown point: no timer, interval or pending copy can outlive the screen.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearStreamTimers();
      if (timers.current.copied) clearTimeout(timers.current.copied);
    };
  }, [clearStreamTimers]);

  /** Timing of the current stream, for the "Thought for N seconds" label. */
  const streamMeta = useRef<{ startedAt: number; hasReasoning: boolean; thoughtSeconds?: number }>({
    startedAt: 0,
    hasReasoning: false,
  });

  /** Ends the stream (completed or aborted) and commits the streamed text into state once. */
  const finishStream = useCallback(() => {
    clearStreamTimers();
    const id = streamingIdRef.current;
    if (!id) return;
    streamingIdRef.current = null;
    const final = store.get();
    const meta = streamMeta.current;
    const thoughtSeconds = meta.hasReasoning
      ? (meta.thoughtSeconds ?? Math.max(1, Math.round((Date.now() - meta.startedAt) / 1000)))
      : undefined;
    setStreamingId(null);
    setMessages((prev) =>
      final.content.length === 0 && final.reasoning.length === 0
        ? prev.filter((m) => m.id !== id) // aborted before anything arrived: drop the empty row
        : prev.map((m) =>
            m.id === id
              ? { ...m, content: final.content, reasoning: meta.hasReasoning ? final.reasoning : undefined, thoughtSeconds }
              : m,
          ),
    );
  }, [clearStreamTimers, store]);

  const streamResponse = useCallback(
    (prompt: string) => {
      const id = makeId();
      const response = pickResponse(prompt, codeShown.current);
      if (response === RESPONSES.code) codeShown.current = true;
      const hasReasoning = response.reasoning !== undefined;

      streamMeta.current = { startedAt: Date.now(), hasReasoning };
      store.set({ phase: hasReasoning ? "reasoning" : "answer", reasoning: "", content: "" });
      streamingIdRef.current = id;
      setStreamingId(id);
      setMessages((prev) => [...prev, { id, role: "assistant", content: "", reasoning: hasReasoning ? "" : undefined }]);

      let reasoning = "";
      let content = "";

      // Emits 1–3 tokens per tick for a natural, slightly uneven cadence; calls `done` at the end.
      const emit = (tokens: string[], interval: number, onChunk: (chunk: string) => void, done: () => void) => {
        let cursor = 0;
        timers.current.tokens = setInterval(() => {
          const burst = 1 + Math.floor(Math.random() * 3);
          onChunk(tokens.slice(cursor, cursor + burst).join(""));
          cursor += burst;
          if (cursor >= tokens.length) {
            if (timers.current.tokens) clearInterval(timers.current.tokens);
            done();
          }
        }, interval);
      };

      const streamAnswer = () =>
        emit(
          tokenize(response.answer),
          TOKEN_INTERVAL_MS,
          (chunk) => {
            content += chunk;
            store.set({ phase: "answer", reasoning, content });
          },
          finishStream,
        );

      timers.current.thinking = setTimeout(() => {
        if (!hasReasoning) {
          streamAnswer();
          return;
        }
        emit(
          tokenize(response.reasoning ?? ""),
          REASONING_INTERVAL_MS,
          (chunk) => {
            reasoning += chunk;
            store.set({ phase: "reasoning", reasoning, content });
          },
          () => {
            streamMeta.current.thoughtSeconds = Math.max(1, Math.round((Date.now() - streamMeta.current.startedAt) / 1000));
            store.set({ phase: "answer", reasoning, content });
            streamAnswer();
          },
        );
      }, THINKING_DELAY_MS);
    },
    [finishStream, store],
  );

  const sendPrompt = useCallback(
    (prompt: string) => {
      if (streamingIdRef.current) return;
      setMessages((prev) => [...prev, { id: makeId(), role: "user", content: prompt }]);
      streamResponse(prompt);
    },
    [streamResponse],
  );

  const regenerate = useCallback(() => {
    if (streamingIdRef.current) return;
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setMessages((prev) => (prev[prev.length - 1]?.role === "assistant" ? prev.slice(0, -1) : prev));
    streamResponse(lastUser.content);
  }, [streamResponse]);

  const copyMessage = useCallback(async (message: Message) => {
    try {
      await Clipboard.setStringAsync(message.content);
    } catch {
      return;
    }
    if (!mounted.current) return;
    setCopiedId(message.id);
    if (timers.current.copied) clearTimeout(timers.current.copied);
    timers.current.copied = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const newChat = useCallback(() => {
    clearStreamTimers();
    streamingIdRef.current = null;
    codeShown.current = false;
    store.set(EMPTY_SNAPSHOT);
    setStreamingId(null);
    setMessages([]);
  }, [clearStreamTimers, store]);

  const actions = useMemo<RowActions>(
    () => ({ regenerate, copy: copyMessage, simpler: () => sendPrompt("Explain that simpler") }),
    [regenerate, copyMessage, sendPrompt],
  );

  // Inverted list keeps the newest message pinned above the input, so growing bubbles and the
  // opening keyboard never push content off-screen.
  const invertedData = useMemo(() => [...messages].reverse(), [messages]);
  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant")?.id,
    [messages],
  );

  // Changes only when a message starts or finishes, or the copy confirmation toggles; never per token.
  const renderItem = useCallback(
    ({ item }: { item: Message }) => {
      const isStreaming = item.id === streamingId;
      return (
        <MessageRow
          message={item}
          isStreaming={isStreaming}
          showActions={item.role === "assistant" && item.id === lastAssistantId && !isStreaming}
          copied={copiedId === item.id}
          store={store}
          actions={actions}
        />
      );
    },
    [streamingId, lastAssistantId, copiedId, store, actions],
  );

  const suggestionChips = useMemo(
    () => (
      <ActionChips
        chips={SUGGESTIONS}
        onChipPress={(chip) => sendPrompt(chip.label)}
        initialDelay={250}
        className={theme.suggestions}
        contentContainerClassName="px-1"
      />
    ),
    [sendPrompt],
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
          className={theme.list}
          contentContainerClassName={theme.listContent}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Uncontrolled: typing re-renders only the input, never the chat list. */}
      <DynamicPromptInput
        onSend={sendPrompt}
        onStop={finishStream}
        onAttach={() => {}}
        isGenerating={streamingId !== null}
        placeholder="Message Assistant"
        bottomInset={insets.bottom}
        accessory={isEmpty ? suggestionChips : null}
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
