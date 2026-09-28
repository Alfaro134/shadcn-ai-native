# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Since the components are copied into your project,
a **breaking change** means a prop or behavior you rely on changed: read those entries before
re-copying a file.

## [1.2.0] - Unreleased

### Added

- `markdown.ts`: the Markdown parser now lives in its own pure-TypeScript file, usable and
  testable without React Native. `StreamingChatBubble` imports it, so copy both files.
- Markdown: GFM tables with alignment, task lists (`- [ ]` / `- [x]`), `~~strikethrough~~`,
  `~~~` fences, images (rendered as links), `<https://…>` autolinks and bare `https://` URLs.
- `StreamingChatBubble`: `components` prop to override how `code`, `link`, `image`, `heading`,
  `quote` and `listMarker` render; `classNames` prop to replace a part's theme classes;
  `labels` prop; `animateGrowth` prop to turn off the height animation.
- `DynamicPromptInput`: `useKeyboardHeight` prop to swap the keyboard source (for example
  `react-native-keyboard-controller`), `labels` prop. `useReanimatedKeyboardHeight` is exported.
- `CodeBlock`: `labels` and `maxHighlightChars` props. Blocks too large to highlight now show a
  "plain text" badge.
- `ReasoningBlock`: `labels` prop, including a `thoughtFor(seconds)` function for plurals.
  The chevron points the right way in RTL layouts.
- Tests (`npm test`): unit tests, a property test over every streaming prefix of realistic
  replies, fuzzing and timing checks on adversarial input. Benchmarks (`npm run bench`).
  GitHub Actions CI runs the tests and the type check.
- README: supported Markdown subset, compatibility matrix, performance numbers, keyboard
  strategy, customization levels and translations.
- Example app: a "Stress-test the Markdown" reply with the messy cases.
- `highlight.ts`: the syntax highlighter now lives in its own pure-TypeScript file, like
  `markdown.ts`. `CodeBlock` imports it, so copy both files.
- `StreamingChatBubble`: `onLinkPress` prop to intercept every link tap (confirm, show the domain,
  in-app browser). `components.link` and `components.image` receive an `onPress`.
- `markdown.ts` exports `isSafeUrl`.
- Tests for the highlighter, for the example app's use cases (`ChatSession`) and for the
  architecture's dependency rules. ESLint with the React Hooks and React Compiler rules
  (`npm run lint`); `npm run check` runs lint, tests and the type check.
- `ARCHITECTURE.md` and `SECURITY.md` (threat model, reporting, known advisories).
- CI: read-only token, actions pinned to commit SHAs, `npm audit`, lint. Dependabot for npm and
  GitHub Actions. `.gitattributes` and `.editorconfig` normalize line endings and formatting.

### Changed

- Code fences are detected line by line, as in GFM. Triple backticks inside a line are an
  inline code span instead of starting a block.
- The syntax highlighter is documented as best-effort (JS/TS/JSON, Python, shell, plus a generic
  fallback).
- Link safety is stricter: a pressable URL needs a host (`https://x`), and URLs with whitespace,
  control or line-separator characters, or over 2,048 characters, render as plain text.
- Components write Reanimated shared values with `.set()` instead of assigning `.value`
  during render-reachable code, as the React Compiler expects.
- The example app is organized with Clean Architecture (`domain`, `application`,
  `infrastructure`, `ui`) behind a `ChatModel` port, so a real model is one adapter away.
  Replies that fail or are stopped are marked as such.

### Fixed

- `DynamicPromptInput` no longer writes a ref during render, which is unsafe with concurrent
  rendering.
- `DynamicPromptInput` stayed hidden behind the keyboard on older Android versions (verified on
  Android 9 in Expo Go), where `useAnimatedKeyboard` always reports 0. The default keyboard hook
  now falls back to React Native's `Keyboard` events until the animated value reports a height.
- While a table row streamed in, its first cell could briefly show raw markup.
- An over-long run of `https://`-like text made the parser re-scan it from every `h`
  (quadratic time). Rejected URLs are now consumed as plain text.
- `DynamicPromptInput` set state inside an effect to re-clamp its height, causing an extra render;
  the scroll state is now derived during render.
- `ReasoningBlock` read the clock during render; it now starts timing in an effect.
- The example app wrote a ref during render, and a model emitting events after being stopped or
  replaced could write into the wrong reply. `ChatSession` ignores stale events.
- The example's "+" button did nothing; it now explains where to plug in a picker.

## [1.1.0] - 2026-09-28

### Added

- Streaming-safe Markdown in `StreamingChatBubble`: headings, lists, blockquotes, links,
  bold and italic, with no dependencies.
- `ReasoningBlock`: collapsible "Thinking…" accordion for reasoning models.
- `header` prop on `StreamingChatBubble`.

### Fixed

- Android: a code block's horizontal `ScrollView` made the bubble grow without end.
- Android: bubbles after the first reply stopped growing and cut off their text.
- Android: lists pushed the bubble past its maximum width.

## [1.0.0] - 2026-09-28 (untagged)

### Added

- `StreamingChatBubble`, `CodeBlock`, `DynamicPromptInput` and `ActionChips`, plus the Expo
  example app.

[1.2.0]: https://github.com/Alfaro134/shadcn-ai-native/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Alfaro134/shadcn-ai-native/releases/tag/v1.1.0
