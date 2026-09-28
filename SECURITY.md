# Security

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's
[private vulnerability reporting](https://github.com/Alfaro134/shadcn-ai-native/security/advisories/new)
with a description, the affected file and, if you can, a message or input that reproduces it.
You'll get an answer within a week.

Fixes land in the latest version only. Since the components are copied into your app, re-copy
the fixed file (see the [changelog](./CHANGELOG.md)).

## Threat model

The components render **model output, which is untrusted input**. A reply can be steered by
prompt injection (a web page or document the model read, a malicious user message) to contain
anything. What the kit guarantees, and what stays your app's job:

| Risk | What the kit does | What your app should do |
| --- | --- | --- |
| **Malicious links** (`javascript:`, `intent:`, `file:`, custom app schemes) | Only `http(s)://host` and `mailto:` links are pressable (`isSafeUrl` in `markdown.ts`). Anything else renders as plain text. URLs with whitespace, control or line-separator characters, or longer than 2,048 characters, are rejected. | Nothing extra needed. |
| **Deceptive links** (`[your-bank.com](https://evil.example)`) | The real URL is exposed as the link's accessibility hint. | Pass `onLinkPress` to `StreamingChatBubble` to confirm, show the domain, or open an in-app browser. |
| **ReDoS** (input crafted to make parsing hang the JS thread) | The Markdown parser and the syntax highlighter run in linear time. Adversarial 100,000-character inputs are part of the test suite (`tests/`). | Nothing extra needed. Very long code blocks (> 20,000 chars) skip highlighting. |
| **Deep nesting / huge input** | Inline nesting is capped (`MAX_INLINE_DEPTH`), list depth too. | Cap message length server-side if you accept unbounded input. |
| **Raw HTML** | Never interpreted: it renders as literal text. React Native has no HTML sink. | Don't render model output in a WebView without sanitizing it. |
| **Clipboard** | Copy buttons write only the code or message the user tapped. | — |
| **Secrets** | The kit makes no network requests and stores nothing. | Keep API keys on your server, never in the app bundle. |

## Dependencies

The kit itself adds no runtime dependency beyond React Native, Reanimated, NativeWind and
`expo-clipboard`. CI runs `npm audit` for the repo tooling and the example app, and Dependabot
keeps both, plus the pinned GitHub Actions, up to date.

### Known advisories

| Advisory | Where | Assessment |
| --- | --- | --- |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) (moderate), `uuid` < 11.1.1 | `example/` only: `expo` → `@expo/config-plugins` → `xcode` → `uuid@7`. Reported as 10 moderate findings along that chain. | **Not reachable.** The bug needs `uuid.v3/v5/v6` with a caller-provided buffer; `xcode` only calls `v4()`, and only during iOS prebuild on a developer machine. Nothing ships in the app. Forcing `uuid@11` could break prebuild, so we wait for Expo to update `xcode`. CI fails on high or critical advisories. |
