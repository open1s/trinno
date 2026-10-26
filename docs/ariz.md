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
- `improvingParameter` / `worseningParameter` — integers 1-39 at the tool's
  schema boundary; the engine also ignores (and reports) anything else rather
  than printing a parameter number that does not exist
- no flag needed: ARIZ always applies the AI on top of the deterministic stages when a model is configured

The tool is **cancellable**: the UI's stop reaches the model stream, and the
narrative call carries a 180 s ceiling, so a dead relay cannot leave the tool
spinning. Both failure modes keep the deterministic stages and add a note.

## The eight stages (src/bos/domain/ariz/stages.ts)

1. **Mini-problem & conflict pair** — restate the problem so the function must
   be delivered without the negative effect, at no extra cost.
2. **Technical contradiction** — improving vs worsening parameter. With both
   parameters the contradiction matrix supplies real candidate principles
   (rationale `Contradiction matrix cell (I vs W)`). An **empty matrix cell**
   (236 of the 1 482 pairs) falls back to keyword principles with an honest
   rationale, so the stage never comes back empty; an out-of-range or repeated
   parameter is reported in `notes` and the same fallback applies.
3. **Ideal Final Result (IFR / IFR+)** — the object performs the function
   itself, no extra tooling, no cost, no harm.
4. **Physical contradiction** — names the conflicting element (product, else
   system) and states that it must deliver the improving parameter while
   tolerating the worsening one at the same time.
5. **Separation principles** — time, space, condition, parts-vs-whole
   (`SEPARATION_PRINCIPLES`, each with an explicitly illustrative example).
6. **Su-Field + 76 Standard Solutions** — classifies the interaction
   (complete/incomplete/harmful/insufficient/excessive) and lists matching
   standard solutions. **Partial inputs still model**: supplying any of
   tool/product/field yields the incomplete class with the missing component
   named, and a non-classical field name is modelled but flagged.
7. **Ideality check** — Ideality = Benefits / (Costs + Harms) on a 0-10 scale,
   with the denominator offset by 1 so a zero-cost candidate cannot divide by
   zero; a candidate that adds a component or reuses no in-system resource is
   called weak by name.
8. **Plan** — top principles, top standard solutions, a first experiment
   written against the two parameters, one measurable acceptance test, and
   advice to re-intensify if the contradiction persists.

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
opt-in flag. The prompt now carries the engine's own findings (stage lines plus
notes, capped at 24) with an instruction to compress them and never contradict
them, so the narrative cannot silently re-derive a different contradiction.

The answer is sanitised before it is returned: a wrapping code fence is
dropped, the text is capped at 4 000 characters, and a blank answer is reported
as `AI narrative returned no text …` rather than stored as an empty string.

A model failure degrades gracefully: `aiNarrative` stays `null` and a note
explains why (`AI narrative failed …`, `… cancelled`, or
`AI narrative skipped: no model configured …`) while the stage findings are
still returned.

## Output

Both entry points write a phase artifact via `PhaseWriter`:
`03_Analyze/ariz_<slug>.json` (problem, parameters, principles, Su-Field,
stage findings, notes).

## Tests

`src/test/suite/ariz.test.ts` (27 tests) covers the engine (matrix lookup,
keyword fallback, empty-cell fallback, parameter validation and the repeated
pair, partial and explicit Su-Field classes, the named physical contradiction,
the first experiment, separation set, plan/ideality findings, empty-input
notes), the tool's AI paths (grounded findings, blank narrative, failure,
cancellability, zod boundary) and the `/ariz` slash command. Run with:

```
npm run compile && npm run test:tools
```
