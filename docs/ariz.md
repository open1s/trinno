# ARIZ-85C in trinno

ARIZ (Algorithm for Inventive Problem Solving, 1985 revision C) is TRIZ's
step-by-step procedure for a hard, ill-defined problem: it forces the analyst
from a vague complaint to a formulated contradiction, then to a concrete,
measurable first experiment.

trinno exposes it in two places:

| Entry point | Use it when | AI cost |
| --- | --- | --- |
| `/ariz <problem>` (slash command) | you are in the chat UI and want the full walkthrough saved to a phase file | deterministic stages + an AI narrative when a model is configured |
| `triz_ariz` (agent tool) | the Research Master agent decides an ARIZ pass is needed | always runs an AI narrative when a model is configured |

## Inputs

```
/ariz <problem>                                  # keyword/principle fallback
/ariz <improving> vs <worsening>: <problem>      # parameter pair, 1-39
```

The tool takes the same fields plus Su-Field components:

- `problem` (required), `system`
- `tool` (S1), `product` (S2), `field`, `suFieldType`
- `improvingParameter` / `worseningParameter` (1-39)
- no flag needed: ARIZ always applies the AI on top of the deterministic stages when a model is configured

## The eight stages (src/bos/domain/ariz/stages.ts)

1. **Mini-problem & conflict pair** — restate the problem so the function must
   be delivered without the negative effect, at no extra cost.
2. **Technical contradiction** — improving vs worsening parameter. With both
   parameters the contradiction matrix supplies real candidate principles
   (rationale `Contradiction matrix cell (I vs W)`); otherwise principles come
   from keyword search and a note records the gap.
3. **Ideal Final Result (IFR / IFR+)** — the object performs the function
   itself, no extra tooling, no cost, no harm.
4. **Physical contradiction** — one element must carry the useful property and
   its opposite at once.
5. **Separation principles** — time, space, condition, parts-vs-whole
   (`SEPARATION_PRINCIPLES`, each with an explicitly illustrative example).
6. **Su-Field + 76 Standard Solutions** — classifies the interaction
   (complete/incomplete/harmful/insufficient/excessive) and lists matching
   standard solutions.
7. **Ideality check** — Ideality = Benefits / (Costs + Harms).
8. **Plan** — top principles, top standard solutions, one measurable
   acceptance test, and advice to re-intensify if the contradiction persists.

## Engine

`src/bos/domain/ariz/engine.ts` — `ArizEngine`, pure and deterministic:

```ts
const engine = new ArizEngine(principleEngine, suFieldService);
const result = engine.build({ problem, improvingParameter, worseningParameter });
// result.stages / result.principles / result.separation / result.suField? / result.notes
```

Missing inputs never throw: they land in `notes` so the caller can tell the
user what to supply next.

## AI augmentation

ARIZ **always involves the AI**: `AiTrizAgent.analyzeAriz(problem, options)` turns
the deterministic stages into a short narrative (mini-problem → first
experiment), and both entry points call it whenever a model is configured — no
opt-in flag. The deterministic engine grounds that pass (matrix cell,
Su-Field class, standard solutions), so a model failure degrades gracefully:
`aiNarrative` stays `null` and a note explains why (`AI narrative failed …` or
`AI narrative skipped: no model configured …`) while the stage findings are
still returned.

## Output

Both entry points write a phase artifact via `PhaseWriter`:
`03_Analyze/ariz_<slug>.json` (problem, parameters, principles, Su-Field,
stage findings, notes).

## Tests

`src/test/suite/ariz.test.ts` (10 tests) covers the engine (matrix lookup,
keyword fallback, Su-Field dispatch, separation set, plan/ideality findings,
empty-input notes, tool AI paths). Run with:

```
npm run compile && npm run test:tools
```
