<div align="center">

# shadcn-ai-native

**Beautiful AI chat components for React Native & Expo. Copy, paste, ship.**

Streaming bubbles · Markdown · Reasoning block · Code blocks · Auto-growing prompt input · Action chips

[![MIT License](https://img.shields.io/badge/license-MIT-black.svg)](./LICENSE)
![Expo](https://img.shields.io/badge/Expo-SDK%2057-000020?logo=expo&logoColor=white)
![iOS & Android](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)
![NativeWind](https://img.shields.io/badge/styled%20with-NativeWind-38bdf8)
![Reanimated](https://img.shields.io/badge/animated%20with-Reanimated-7c3aed)
[![GitHub stars](https://img.shields.io/github/stars/Alfaro134/shadcn-ai-native?style=social)](https://github.com/Alfaro134/shadcn-ai-native)

![Demo](./demo.gif)

</div>

---

## Why this exists

Every app is shipping an AI assistant, and on the web you can have a polished chat UI in an afternoon. In React Native it's a different story:

- Streaming text makes bubbles **jump and jitter** on every token.
- The **keyboard** covers your input on one platform and leaves a gap on the other.
- The input needs to **grow with the text**, cap its height, then scroll.
- Code answers need a **readable, copyable** code block, not a wall of monospace.

You end up rebuilding the same four components in every project, and they rarely feel smooth.

**shadcn-ai-native** gives you those components, done right, as plain `.tsx` files you **own**. It follows the [shadcn/ui](https://ui.shadcn.com) approach: no npm package, no version lock-in, no hidden styles. Copy a file into your project and change anything you like.

## ✨ Features

- 🌊 **Smooth streaming.** Bubbles ease into their new height on every chunk instead of snapping. There's a blinking caret while tokens arrive and a typing indicator before the first one.
- 📝 **Streaming-safe Markdown, zero dependencies.** A [documented subset of GitHub Flavored Markdown](#-markdown-support): headings, lists, task lists, tables, blockquotes, links, images, bold/italic/strikethrough, code. While a reply streams, half-written markup isn't shown raw: `**bold te` renders as `bold te` and `[Google](http…` as `Google` until the closing marker arrives. [Tested](#-tests) against every prefix of real-looking replies, fuzzed, and [benchmarked](#-performance).
- 🧠 **Reasoning block.** A collapsible "Thinking…" / "Thought for 4 seconds" accordion for reasoning models, animated with Reanimated.
- 🎨 **Best-effort syntax highlighting.** A small regex highlighter tuned for JS/TS/JSON, Python and shell, with a generic fallback for other languages. **No highlighting library.** Very large blocks show a "plain text" badge instead of silently losing their colors.
- 📋 **One-tap copy.** Code blocks copy to the clipboard with an animated ✓ confirmation.
- ⌨️ **Keyboard handling on both platforms.** The prompt input follows the keyboard frame by frame on the UI thread, including on Android edge-to-edge, and the keyboard source is [swappable](#keyboard-handling).
- 📏 **Auto-growing input.** Grows line by line up to a max height, then scrolls. The action button switches between **Send** and **Stop generating**.
- 🪄 **Animated action chips.** "Regenerate", "Copy", "Explain simpler" and your own chips fade in and slide up one after another.
- 🌍 **Translatable.** Every visible or announced string is a `labels` prop.
- 🌗 **Dark mode.** Every class has a `dark:` variant and follows the system theme.
- 🧩 **Few dependencies.** Only React Native, NativeWind and Reanimated, plus `expo-clipboard` for the code block. Works in **Expo Go**.
- 🎛️ **Restyle without forking.** A `theme` object per file, `classNames` to replace single parts, and `components` to swap how Markdown elements render.

## 🧱 Components

| File | What it does |
| --- | --- |
| [`StreamingChatBubble`](./components/ai/StreamingChatBubble.tsx) | User/assistant message bubble with smooth streaming growth and Markdown. Code fences render as `<CodeBlock />`. `header` and `footer` slots. |
| [`markdown.ts`](./components/ai/markdown.ts) | The streaming-safe Markdown parser behind the bubble. Pure TypeScript, no React, usable on its own. |
| [`ReasoningBlock`](./components/ai/ReasoningBlock.tsx) | Collapsible "Thinking…" accordion for a model's reasoning. Times itself while streaming, then collapses to "Thought for N seconds". Pass it as the bubble's `header`. |
| [`CodeBlock`](./components/ai/CodeBlock.tsx) | Dark code block with language header, best-effort highlighting, horizontal scroll, optional line numbers and copy-to-clipboard. |
| [`DynamicPromptInput`](./components/ai/DynamicPromptInput.tsx) | Chat input with auto-grow, keyboard avoidance, attach button and a Send ⇄ Stop button. |
| [`ActionChips`](./components/ai/ActionChips.tsx) | Horizontal row of suggestion chips with a staggered entrance animation. |

## 🚀 Installation

> Already using NativeWind v4 and Reanimated? Skip to [step 3](#3-install-expo-clipboard).

### 1. Install Reanimated

```bash
npx expo install react-native-reanimated react-native-worklets
```

On Expo SDK 54+, `babel-preset-expo` configures the Reanimated Babel plugin automatically.

### 2. Install and configure NativeWind v4

```bash
npx expo install nativewind react-native-safe-area-context
npx expo install --dev tailwindcss@^3.4.17 babel-preset-expo
npx tailwindcss init
```

**`tailwind.config.js`:** point `content` at your app and at the folder you'll paste the components into:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
```

**`global.css`:**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**`babel.config.js`:**

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
```

**`metro.config.js`:**

```js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
```

**`nativewind-env.d.ts`** (TypeScript support for `className`):

```ts
/// <reference types="nativewind/types" />
```

Finally, import the stylesheet once at your app's entry point (`app/_layout.tsx` or `App.tsx`):

```tsx
import "./global.css";
```

### 3. Install expo-clipboard

`CodeBlock` uses it for the copy button:

```bash
npx expo install expo-clipboard
```

### 4. Copy the components

Create `components/ai/` and paste in the files you need, either from the [`components/ai`](./components/ai) folder on GitHub or with curl:

```bash
mkdir -p components/ai && cd components/ai
BASE=https://raw.githubusercontent.com/Alfaro134/shadcn-ai-native/main/components/ai

curl -O $BASE/StreamingChatBubble.tsx
curl -O $BASE/markdown.ts            # required by StreamingChatBubble
curl -O $BASE/CodeBlock.tsx          # required by StreamingChatBubble
curl -O $BASE/ReasoningBlock.tsx
curl -O $BASE/DynamicPromptInput.tsx
curl -O $BASE/ActionChips.tsx
```

Each file stands on its own, except `StreamingChatBubble`, which imports `./markdown` and `./CodeBlock`.

## 💬 Usage example

A complete chat screen in about 40 lines:

```tsx
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionChips } from "@/components/ai/ActionChips";
import { DynamicPromptInput } from "@/components/ai/DynamicPromptInput";
import { StreamingChatBubble } from "@/components/ai/StreamingChatBubble";

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { messages, streamingId, send, stop, regenerate } = useYourChat(); // your AI hook

  return (
    <View className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        inverted
        data={[...messages].reverse()}
        keyExtractor={(m) => m.id}
        keyboardDismissMode="interactive"
        renderItem={({ item }) => (
          <StreamingChatBubble
            role={item.role}
            content={item.content}
            isStreaming={item.id === streamingId}
            footer={
              item.role === "assistant" && item.id !== streamingId ? (
                <ActionChips
                  contentContainerClassName="px-0"
                  chips={[
                    { id: "regen", label: "Regenerate", onPress: regenerate },
                    { id: "simpler", label: "Explain simpler", onPress: () => send("Explain that simpler") },
                  ]}
                />
              ) : null
            }
          />
        )}
      />

      <DynamicPromptInput
        onSend={send}
        onStop={stop}
        onAttach={() => {/* open a picker */}}
        isGenerating={streamingId !== null}
        bottomInset={insets.bottom}
      />
    </View>
  );
}
```

`CodeBlock` can also be used on its own:

```tsx
<CodeBlock language="tsx" code={source} showLineNumbers />
```

### Keyboard handling

Put `DynamicPromptInput` at the bottom of a `flex-1` screen and **don't** wrap it in a `KeyboardAvoidingView`. If a parent already handles the keyboard, pass `avoidKeyboard={false}`. If something sits below the input, such as a tab bar, pass its height as `keyboardOffset` (the equivalent of `keyboardVerticalOffset`).

The keyboard height comes from a hook you can swap with `useKeyboardHeight`:

| Strategy | When to use it |
| --- | --- |
| **Reanimated** (default, `useReanimatedKeyboardHeight`) | Expo Go and quick prototypes. No extra native module. Reanimated 4 marks `useAnimatedKeyboard` as deprecated, but it still works. On older Android versions where it reports no height (seen on Android 9), it falls back to React Native's `Keyboard` events: correct position, but eased instead of frame-synced. |
| **[react-native-keyboard-controller](https://github.com/kirillzyusko/react-native-keyboard-controller)** | **Recommended for production apps with a dev build.** Actively maintained and more precise across devices. |

```tsx
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useDerivedValue } from "react-native-reanimated";

// Defined at module level: it's called as a hook, so it must never change between renders.
function useKeyboardControllerHeight() {
  const { height } = useReanimatedKeyboardAnimation(); // negative while the keyboard is open
  return useDerivedValue(() => -height.value);
}

<DynamicPromptInput useKeyboardHeight={useKeyboardControllerHeight} onSend={send} />;
```

Remember to wrap your app in keyboard-controller's `<KeyboardProvider>`.

## 📝 Markdown support

`StreamingChatBubble` renders a subset of [GitHub Flavored Markdown](https://github.github.com/gfm/). Anything outside it renders as plain text, never as a crash or a broken layout.

| Supported | Syntax |
| --- | --- |
| Headings | `#` to `######` (5 and 6 render like 4) |
| Emphasis | `**bold**`, `*italic*`, `_italic_`, `***both***`, `~~strike~~` |
| Code | `` `inline` ``, ```` ``` ```` and `~~~` fences with a language |
| Lists | `-` `*` `+` bullets, `1.` / `1)` ordered, nested by indentation, `- [ ]` / `- [x]` task lists |
| Blockquotes | `> quote` (one level) |
| Tables | GFM pipe tables with `:---`, `:---:`, `---:` alignment, scrollable horizontally |
| Links | `[text](https://…)`, `<https://…>`, bare `https://…` URLs. Only `http(s)` and `mailto:` are pressable |
| Images | `![alt](https://…)`, rendered **as a link** by default (remote images would make the bubble jump mid-stream). Use `components.image` to render them inline |
| Rules | `---`, `***`, `___` |
| Escapes | `\*`, `\[`, `\|` … |

**Not supported** (shown as plain text): raw HTML, footnotes, reference-style links (`[text][id]`), setext headings (`===` underlines), hard breaks via trailing spaces, nested blockquotes, and block content (code, lists) inside quotes or list items.

**While streaming**, only the tail of the message is treated as unfinished. An opener without its closer hides its marker until the closer arrives, and a last line that is only a block marker so far (`##`, `-`, `1.`, `|`) waits for its text. Once the message is complete, unclosed markers render literally, so `5 * 3` keeps its asterisk.

## 🎨 Customization

There are three levels, from global to per element.

**1. The `theme` object.** Every component starts with one. That's where the look lives, so edit it once for your whole app:

```tsx
const theme = {
  bubble: {
    user: "rounded-3xl rounded-br-lg bg-zinc-900 px-4 py-2.5 dark:bg-zinc-100",
    assistant: "rounded-3xl rounded-tl-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-800/80",
  },
  // ...
};
```

**2. `classNames` per part** (`StreamingChatBubble`). Replaces a part's theme classes for one instance: `bubble`, `text`, `link`, `inlineCode`, `listMarker`, `quote`, `quoteText`, `rule`, `table`.

```tsx
<StreamingChatBubble classNames={{ bubble: "rounded-2xl bg-indigo-600 px-4 py-3" }} ... />
```

> ⚠️ `className` **appends** classes, it doesn't merge them. If you pass `className="px-2"` to a part the theme already gives `px-4`, NativeWind doesn't guarantee which one wins. Use `className` for things the theme doesn't set (margins, shadows), and `classNames` or the theme for everything else.

**3. `components`** (`StreamingChatBubble`). Swap how a Markdown element renders without forking the file: `code`, `link`, `image`, `heading`, `quote`, `listMarker`. Keep the object stable (hoisted or `useMemo`).

```tsx
const components = {
  listMarker: () => <Text className="text-indigo-500">→</Text>,
  code: ({ code, language }) => <MyCodeBlock code={code} language={language} />,
};

<StreamingChatBubble components={components} ... />
```

### Translations

Every visible or announced string is a `labels` prop, with English defaults:

```tsx
<ReasoningBlock labels={{ thinking: "Pensando…", thoughtFor: (s) => `Pensó durante ${s} s` }} ... />
<DynamicPromptInput labels={{ placeholder: "Mensaje", send: "Enviar", stop: "Detener", attach: "Adjuntar" }} ... />
<CodeBlock labels={{ copy: "Copiar", copied: "Copiado" }} ... />
<StreamingChatBubble labels={{ typing: "El asistente está escribiendo" }} ... />
```

Layouts use left/right styles, which React Native mirrors automatically in RTL (`I18nManager.isRTL`), and the reasoning chevron flips direction. RTL has **not** been tested on a device yet.

## 📱 Run the demo

The [`example/`](./example) folder is an Expo SDK 57 app. It imports the components straight from `../components`, the same way your app would after pasting them in.

```bash
cd example
npm install
npx expo start
```

Scan the QR code with **Expo Go**, or press `i` / `a` for a simulator. The demo streams simulated AI replies with a reasoning phase, Markdown and a highlighted code block, so you can try everything without an API key. Tap **"Stress-test the Markdown"** for the messy cases: a table, task lists, `~~~`, an image, raw HTML and a broken link.

## ⚡ Performance

Parser numbers from `npm run bench` (Node 24, Intel Core i5-1235U laptop). They measure **parsing only**, not rendering, and a phone's JS thread is typically several times slower:

| Case | Time |
| --- | --- |
| Parse a finished 10,000-char message | 0.36 ms |
| Parse a finished 50,000-char message | 2.05 ms |
| Stream a 20,000-char message (6,448 chunks) | 0.47 ms per chunk at the end |

Cost grows linearly with message length: there is no backtracking regex, and 100,000-character adversarial inputs parse in milliseconds ([tests](./tests/markdown.test.ts)). The bubble re-parses the whole message on every chunk, so very long replies cost more per chunk as they grow.

**Not measured yet:** rendering on low-end Android, 200+ message lists, tablets, and RTL. If you run into a slow case, please open an issue with the device and message.

## 🧪 Tests

```bash
npm test           # Markdown parser: unit tests, every-prefix streaming property, fuzzing, timing
npm run bench      # parser benchmarks
npm run typecheck  # needs `npm install` in example/ first
```

Tests use Node's built-in runner (Node ≥ 22.18), so the repo has **no dev dependencies**. CI runs them and the type check on every push. There are no visual regression tests yet: UI changes are checked by hand in the example app.

## ✅ Compatibility

| Setup | Status |
| --- | --- |
| Expo SDK 57 · React Native 0.86.3 (New Architecture) · Reanimated 4.5.1 · NativeWind 4.2 | ✅ Tested on an Android 9 emulator |
| iOS | ⚠️ Expected to work, **not tested yet** |
| Older React Native versions / Old Architecture | ❓ Untested |
| Expo Go | ✅ No native modules beyond the Expo Go set |

`StreamingChatBubble` animates its height by measuring its content with `onLayout`. That relies on a Yoga detail (`overflow: "scroll"` measures children unconstrained) verified on the versions above. If it misbehaves on your setup, pass `animateGrowth={false}` to turn the animation off.

## 🗺️ Roadmap

Stability first:

- [x] Parser tests, fuzzing and benchmarks · CI · changelog
- [ ] Visual regression tests (Maestro screenshots) on iOS and Android
- [ ] Test matrix across Expo SDKs / React Native versions, and RTL on a device
- [ ] Rendering benchmarks on a low-end Android device

Then features:

- [x] Markdown (headings, lists, task lists, tables, blockquotes, links) · Reasoning block
- [ ] **AI SDK recipe:** a ready-made example with the Vercel AI SDK `useChat`, plus a tool-call block
- [ ] Attachment previews · Voice input · Message editing
- [ ] **CLI:** `npx shadcn-ai-native add <component>`, once the component APIs are stable

See the [changelog](./CHANGELOG.md) for what changed in each version. Have an idea? [Open an issue](https://github.com/Alfaro134/shadcn-ai-native/issues). PRs are welcome!

## 🤝 Contributing

Contributions are welcome, especially new components (message actions, attachment previews, voice input…). Please:

1. Keep components **copy-paste friendly**: no new runtime dependencies, and pure logic in its own file (like `markdown.ts`) so it can be tested.
2. Put all styling in the file's `theme` object with `dark:` variants, and every string in `labels`.
3. Run `npm test` and `npm run typecheck`, and try your change in the `example/` app on both iOS and Android.

## 📄 License

[MIT](./LICENSE) © 2026 Josué E. Alfaro

Free to use in personal and commercial projects. If it saved you a weekend, a ⭐ helps a lot.
