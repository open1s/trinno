# AGENTS.md

## Project

**vscode-jupyter-typst** — VS Code extension adding Typst markup cells to Jupyter notebooks (live SVG preview on blur) plus a Trinno Chat research assistant sidebar panel.

## forbid
**node_modules**: not allow to edit

## Commands

```
npm run compile   # tsc + copy webview assets to dist/
npm run watch     # tsc --watch
npm run test      # runs via @vscode/test-electron (launches VS Code instance)
npm run lint      # eslint src --ext ts  (no eslint config file exists yet)
```

`npm run compile` must succeed before `npm run test` — tests run from `dist/`.

## Package manager

Three lockfiles/configs coexist: `bun.lock`, `package-lock.json`, and `"packageManager": "yarn@..."` in package.json. Use `npm` (package-lock.json is present).

## Architecture

```
src/
  extension.ts          # entrypoint — activate/deactivate
  cells/                # Typst cell + notebook controllers
  chat/                 # Research assistant panel, agent, sessions, webview/
  commands/             # VS Code command registrations
  compiler/             # Typst CLI compilation (spawns typst process)
  languages/            # Typst completions
  lsp/                  # Tinymist LSP client (optional, falls back to static completions)
  output/               # Output channel utilities
  renderer/             # SVG rendering
  types/                # Shared type definitions
  bos/                  # BOS framework — excluded from tsconfig, do not edit
```

Key facts:
- `src/bos/` is excluded from `tsconfig.json` — do not modify it
- LSP uses Tinymist; if unavailable, falls back to static completions (`src/languages/typstCompletions.ts`)
- Chat panel is a webview in `src/chat/webview/`; the compile script copies this dir to `dist/`
- Extension entry: `dist/extension.js` (from `src/extension.ts`)

## Testing

- Framework: Mocha + `@vscode/test-electron`
- Runs in a real VS Code instance (`--disable-extensions`)
- Test files: `src/test/suite/`
- Must `compile` before `test` — test runner loads from `dist/test/runTest.js`

## TypeScript

- Strict mode: all strict flags enabled including `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`
- Target: ES2020, CommonJS modules
- `@types/vscode` pinned to `^1.120.0` (very recent API)

## Docs

- `CLAUDE.md` — agent skill references (triage, to-issues, to-prd, diagnose, tdd, etc.)
- `docs/agents/` — skill configuration (domain, issue-tracker, triage-labels)
- `docs/adr/` — empty, for future architectural decisions
- `CONTEXT.md` — template, not yet filled in
