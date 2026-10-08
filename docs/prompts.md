# Prompt system

Every LLM prompt the extension sends is built in `src/bos/prompts/` and
registered with `definePrompt`. Nothing in `src/bos/prompts/` imports the
agent stack, so the whole prompt surface can be rendered, measured and asserted
without starting a model — that is what makes the drift test possible.

Run it with `npm run test:tools` (or `npx mocha --ui bdd dist/test/suite/prompt-contract.test.js`).

## The four adherence tiers

A rule is only as strong as the mechanism that enforces it. Each prompt records
the tiers it actually relies on (`meta.enforcedBy`), and the convention is to
**use the lowest tier that can actually enforce the rule**:

| Tier | Mechanism | Example |
| --- | --- | --- |
| **L0** | Machine-enforced: tool parameter schemas, parser shapes, code guards | `update_goal` only accepts `complete`/`blocked`; the incremental writer owns file writes, so the prompt must not call `write_file` |
| **L1** | A short, non-negotiable invariant block injected into every prompt of a kind (`CORE_INVARIANTS`, `DATA_INVARIANTS`, `PROBE_INVARIANTS`) | evidence, no fabrication, tool truth, bounded failure |
| **L2** | Runtime validation of the model output: the caller parses it and can repair once, then fail loudly | the extractor JSON schemas, the `===SCOPE===` planner split |
| **L3** | Drift test (`src/test/suite/prompt-contract.test.ts`) — fails when a prompt loses a section, an invariant, a declared JSON key, a named tool, or grows past its budget | every registered prompt |

A prompt-only rule (L1 alone) is a weaker promise than a parsed one (L2). If a
rule can be checked by code, check it there and let the prompt say what to do
rather than being the only defence.

## Invariant sets

| Set | Used by | Rules |
| --- | --- | --- |
| `core` | system, task, writer, planner, prose extractors | evidence traceable to a tool result / file / URL; no fabrication; tool truth; stop after two failed attempts and report the error |
| `data` | JSON extractors | no invented values (`null` + a note instead); every value traceable; **the exact declared JSON shape, with the shape rule last** so format is the model's final instruction |
| `probe` | context-capacity self-test | answer the unrelated question directly; do not behave like an agent (the full contract would falsify the measurement) |

Invariants are appended by `withInvariants()` under the heading
`### NON-NEGOTIABLE INVARIANTS`, which is the marker the drift test greps for.

## Inventory

| id | kind | enforced by | file | purpose |
| --- | --- | --- | --- | --- |
| `agent.artemis` | system | L0/L1/L2/L3 | `src/bos/agents/common-agent.ts` | shared ARTEMIS identity |
| `agent.triz` | system | L1/L3 | `src/bos/infrastructure/ai/triz_ai_agent.ts` | TRIZ expert |
| `chat.autoresearch` | task | L1/L3 | `src/bos/worker.ts` | /auto iteration |
| `chat.compact.summary` | task | L1/L3 | `src/bos/worker.ts` | conversation compaction |
| `chat.goal` | task | L0/L1/L3 | `src/bos/worker.ts` | active-goal state machine |
| `chat.incremental.bootstrap` | writer | L0/L1/L3 | `src/chat/incremental_writer.ts` | first section |
| `chat.incremental.continue` | writer | L0/L1/L3 | `src/chat/incremental_writer.ts` | next section |
| `chat.methodology` | system | L1/L3 | `src/bos/worker.ts` | pipeline + rules contract |
| `chat.paper.instructions` | writer | L1/L3 | `src/chat/write_paper.ts` | paper instruction block |
| `chat.paper.once` | writer | L1/L3 | `src/bos/worker.ts` | host-triggered paper workflow |
| `chat.persona.fallback` | system | L1/L3 | `src/bos/worker.ts` | default identity |
| `extractor.scurve.data` | extractor | L1/L2/L3 | `src/bos/infrastructure/s_curve/ai_data_extractor.ts` | S-curve data extraction |
| `extractor.scurve.estimate` | extractor | L1/L2/L3 | `src/bos/infrastructure/s_curve/ai_estimator.ts` | S-curve parameter fit |
| `extractor.summarizer` | extractor | L1/L3 | `src/bos/infrastructure/search/ai_summarizer.ts` | document summarisation |
| `extractor.trl` | extractor | L1/L2/L3 | `src/bos/infrastructure/triz/trl_assessor.ts` | TRL assessment |
| `planner.autoresearch.scope-eval` | planner | L0/L1/L2/L3 | `src/bos/slash-commands/auto.ts` | scope.md + eval.md |
| `probe.context.historian` | task | L1/L3 | `src/bos/slash-commands/ping.ts` | context-capacity self-test |
| `subagent.system` | system | L0/L1/L3 | `src/bos/infrastructure/subagent-manager.ts` | spawned subagents |
| `task.triz.contradiction` | task | L1/L3 | `src/bos/slash-commands/contradiction.ts` | /contradiction analysis |

## Changing a prompt

1. Edit the builder in `src/bos/prompts/<area>.ts`; prefer `composePrompt({role, mission, body, outputContract})` so the skeleton stays fixed (role → `## Mission` → body → `## Output Contract` → invariants).
2. Keep the registry metadata honest: `requiredSections` (headings that must survive), `jsonKeys` (every key the caller parses), `namesTools` (every tool the prompt tells the model to call), `maxChars` (the budget), `sampleArgs` (so the test can render a parameterised prompt), `usedBy` (the call site).
3. Bump `PROMPT_VERSION` when prompt bodies change.
4. `npm run compile && npm run test:tools`.

## What the drift test enforces

- every id in `EXPECTED_IDS` is registered — a prompt cannot be deleted silently;
- every prompt declares an enforcement tier including `L3`, plus a `usedBy` and a budget;
- the declared invariant set is present verbatim;
- every `requiredSections` heading is present;
- every `jsonKeys` entry is named in the prompt;
- every `namesTools` entry exists as a real `defineTool()` name **and** is named in the prompt (this is how two prompts were caught telling the model to use TRIZ tools they never named);
- every fenced ```json``` example parses after interpolation;
- no `TODO`/`FIXME`/`XXX`/`lorem ipsum` placeholder ships;
- the rendered prompt fits `maxChars`;
- every registered id is documented in this file.

## Deliberate exclusions

- `getLanguagePrompt()` in `src/bos/domain/shared/i18n.ts` is a one-line locale
  directive appended by code to every localised agent call — it is L0 by
  construction, not a behaviour prompt.
- Webview UI strings in `src/chat/webview/` are user interface copy, not model
  input.
