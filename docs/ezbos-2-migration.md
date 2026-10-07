# ezbos 2.x idiom guide (trinno)

How trinno talks to `@open1s/ezbos` ^2.0.1 / `@open1s/jsbos` ^3.0.2 / `zod` ^4.6.5.
Conventions are enforced by `src/test/suite/typed-tools.test.ts` and the scripts below.

## Tool definition: typed `defineTool` (required)

Every tool uses the object form. The legacy builder
(`defineTool('name','desc').param()/required().handle()`) is banned — the contract
test greps `src/bos/infrastructure/http/*_tools.ts` for `.param(`, `.required(`, `.handle(`.

```ts
import { defineTool, ok, err } from '@open1s/ezbos';
import { z } from 'zod';

const tool = defineTool({
  name: 'websearch',
  description: '…what the model should know before calling…',
  parameters: z.object({ query: z.string().min(1), maxResults: z.number().int().min(1).max(10) }),
  execute: async ({ query, maxResults }) => { … return ok({ … }); },
});
```

Rules learned across the migration (39 sites, 9 files):

- **Enums, not prose.** Type-like params use `z.enum([...])` so the generated JSON
  Schema lists allowed values (`memory_store.type`, `triz_*` action/target, todo status/priority).
- **Keep domain rules in `execute`, returning their original shapes.** Friendly checks that
  are *policies* (one `in_progress` todo, update_goal complete/blocked gate, 3-strike blocked
  audit) stay as code so their exact messages survive; pure type/range validation moves to zod.
- **`.loose()` when runtime-only keys must survive parsing.** `z.object` strips unknown keys;
  bash needs `__call_id__` (tests pass it; nothing in ezbos injects it). `parameters:
  z.object({command, timeout}).loose()` keeps it in `parsed.data` while the model-facing
  schema still declares only `command`/`timeout`.
- **`.describe(...)` carries prompt docs** that legacy `.required(name, type, text)` had.
- **`exactOptionalPropertyTypes`**: omit optional execute-fields with
  `...(x !== undefined ? { x } : {})` instead of `{ x: x }`.

### Error contract (runtime, not throw)

ezbos `defineTool` wraps the callback (`node_modules/@open1s/ezbos/dist/tool.js`):
`def.parameters.safeParse(args)` fails → **returns** the string `'Error: tool "name" received invalid arguments: …'`;
`execute` returning `err({error})` → `'Error: tool "name" failed: …'`; `ok(data)` → JSON string.
Tests must assert the returned string, never `expect(fn).to.throw`.

### Cancellation

Typed defs declare `cancelable: true` + `onCancel: (callId) => …` (ezbos surfaces them as
`cancelable`/`cancelCallback` on the tool object). Call-id-scoped work (bash background jobs)
kills only that process group.

## Agents

- Builder methods are camelCase: `withModel/withBaseUrl/withApiKey/withSystemPrompt/
  withTemperature/withMaxTokens/withTimeout/withApiMode/withReasoningEffort/withTools/
  withHooks/withPlugins/withMcpProcess/withMcpHttp/withSkills/withResilience` (snake_case
  `with_*` is deprecated — zero usages may remain in `src/`).
- Every builder gets `withResilience({circuitBreakerMaxFailures:5, circuitBreakerCooldownSecs:30,
  rateLimitCapacity:120, rateLimitWindowSecs:60, rateLimitMaxRetries:3})` via
  `src/bos/infrastructure/agent-factory.ts` `DEFAULT_RESILIENCE`.
- Streaming: `for await (const ev of agent.streamEvents(prompt, {signal}))`
  (`src/bos/infrastructure/ai/streaming.ts`) — exactly one terminal done/error; partial text
  is returned, zero-text errors rethrow; pass `{ signal }` only when defined (TS2379).
- Structured errors: `src/bos/worker.ts` `errorPayload(err)` attaches `code` from
  `EzbosError` (CONFIGURATION|TOOL_EXECUTION|INVALID_ARGUMENTS|STREAM_ERROR|CANCELLED|TIMEOUT).

## Tooling gotchas

- npm in this repo needs `--cache /tmp/npm-trinno-cache` (home cache is root-owned, EPERM).
- ezbos dist ships an extensionless relative import in a `type:module` package;
  `scripts/fix-ezbos-imports.mjs` (postinstall) appends `.js` — keep it idempotent.
- Tests: `npm run compile` first (`dist/test` is wiped by compile), then
  `npm run test:tools` runs the whole tool-contract suite (typed-tools + worker errorPayload +
  tool-cancel + background-e2e). For a single file:
  `TRINNO_LOG_DIR=/tmp/trinno-logs npx mocha --timeout 20000 dist/test/suite/<file>.js`
  (default mocha timeout is 2000ms; bash-timeout tests wait 5s+; `--exit` needed when a
  suite imports `bos/worker`).
