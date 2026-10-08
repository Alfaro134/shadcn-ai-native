# Contributing

Thanks for helping. This page covers how changes get into `main`. For how the code is organized,
read [ARCHITECTURE.md](./ARCHITECTURE.md); for security issues, [SECURITY.md](./SECURITY.md)
(report those privately, never in a public issue).

## Setup

```bash
npm install                 # repo tooling: ESLint, TypeScript
cd example && npm install   # the demo app, needed for the type check
```

Node 22.18 or newer runs the TypeScript tests directly, with no build step.

## Workflow

1. Open an issue first for anything bigger than a small fix, so we can agree on the API.
2. Branch from `main` and keep the change focused: one topic per pull request.
3. Write commits in the [Conventional Commits](https://www.conventionalcommits.org) style the
   history uses: `fix(bubble): …`, `feat(markdown): …`, `docs: …`, `ci: …`.
4. Run `npm run check` (lint, tests, type check) and try the change in the `example/` app.
5. Open a pull request and fill in the template.

`main` is protected: every change lands through a pull request, the required CI checks must pass
on an up-to-date branch, and pull requests are squash-merged so `main` stays a linear history of
one commit per change. Nobody pushes to `main` directly, maintainers included.

## What a good change looks like

- **Components stay copy-paste friendly.** No new runtime dependency in `components/ai`. Logic
  that can be computed from a string goes in a pure file (`markdown.ts`, `highlight.ts`) with
  tests; components only render.
- **Styling lives in the `theme` object** of each file, with a `dark:` variant for every color.
  Every visible or announced string goes in `labels`.
- **Streaming stays incremental.** A new token must not cost work proportional to the whole
  reply. If you touch the parser or the highlighter, keep the property tests that compare the
  streaming version with a full parse passing.
- **The dependency rules hold.** `tests/architecture.test.ts` enforces them.
- **Users hear about it.** Add a `CHANGELOG.md` entry for anything a user of a component will
  notice, and mark breaking changes.

## Releases

Versions follow [Semantic Versioning](https://semver.org). A release updates the version in
`package.json`, moves the `Unreleased` changelog section under the new version, and is tagged
`vX.Y.Z` from `main`.
