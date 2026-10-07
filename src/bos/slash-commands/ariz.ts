import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';
import { ArizEngine, type ArizInput } from '../domain/ariz/engine.js';
import { getParameterByIndex } from '../domain/principle/parameters.js';

const USAGE = '/ariz <problem>   |   /ariz <improving> vs <worsening>: <problem>';

interface ParsedArizArgs {
  input: ArizInput;
  /** Set when the "vs" prefix had to be ignored (e.g. a parameter outside 1-39). */
  warning?: string;
}

/**
 * Parse "/ariz 1 vs 2: light but stiff frame" or plain "/ariz <problem>".
 *
 * The parameter pair is all-or-nothing: if either index falls outside 1-39 the
 * whole prefix is ignored and reported through `warning`, so the command never
 * renders an "#undefined" placeholder nor applies a misleading half-pair.
 */
function parseArizArgs(raw: string): ParsedArizArgs {
  const prefixed = raw.match(/^(\d{1,2})\s+vs\s+(\d{1,2})\s*[:\u2014-]\s*(.*)$/i);
  const bare = raw.match(/^(\d{1,2})\s+vs\s+(\d{1,2})$/i);
  const match = prefixed ?? bare;
  if (match) {
    const improving = clampParam(parseInt(match[1]!, 10));
    const worsening = clampParam(parseInt(match[2]!, 10));
    const tail = (match[3] ?? '').trim();
    if (improving === undefined || worsening === undefined) {
      return {
        input: { problem: tail || raw },
        warning: `Ignored the "${match[1]} vs ${match[2]}" prefix: TRIZ parameters must be in 1-39, so the text is treated as the problem statement.`,
      };
    }
    return {
      input: {
        problem: tail || `Improve parameter #${improving} without worsening #${worsening}`,
        improvingParameter: improving,
        worseningParameter: worsening,
      },
    };
  }
  return { input: { problem: raw } };
}

function clampParam(n: number): number | undefined {
  return Number.isFinite(n) && n >= 1 && n <= 39 ? n : undefined;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'problem';
}

export const arizCommand: SlashCommand = {
  name: 'ariz',
  description: 'Run the ARIZ-85C inventive problem-solving algorithm',
  usage: USAGE,
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal): Promise<void> {
    const raw = (args || '').trim();
    if (!raw) {
      emit('token', { tokenType: 'Text', text: `## ARIZ-85C analysis\n\nProvide a problem statement.\n\nUsage: ${USAGE}\n\nExample:\n\`/ariz 1 vs 2: light but stiff drone frame\`\n\nOptional inputs: to get a real contradiction-matrix lookup prefix with \`<improving> vs <worsening>\` (parameter numbers 1-39).\n` });
      emit('done', {});
      return;
    }

    const { input, warning } = parseArizArgs(raw);
    const engine = new ArizEngine(deps.principleEngine, deps.suFieldService);
    const result = engine.build(input);
    const notes = warning ? [warning, ...result.notes] : [...result.notes];

    emit('token', { tokenType: 'Text', text: `## ARIZ-85C analysis\n\n**Problem:** ${input.problem}\n\n` });
    if (input.improvingParameter !== undefined && input.worseningParameter !== undefined) {
      emit('token', { tokenType: 'Text', text: `**Contradiction:** parameter #${input.improvingParameter} vs #${input.worseningParameter}\n\n` });
    }

    // Stream the stages. An abort stops the walk, but every exit path below
    // still reaches emit('done') so the chat UI never hangs in the generating
    // state (sendSlashRequest has no timeout of its own).
    let cancelled = false;
    let aiNarrative: string | null = null;

    for (const stage of result.stages) {
      if (signal.aborted) {
        cancelled = true;
        break;
      }
      emit('token', { tokenType: 'Text', text: `### ${stage.title}\n\n` });
      for (const finding of stage.findings) {
        emit('token', { tokenType: 'Text', text: `- ${finding}\n` });
      }
      emit('token', { tokenType: 'Text', text: '\n' });
    }

    if (!cancelled) {
      if (result.principles.length > 0) {
        emit('token', { tokenType: 'Text', text: '### Candidate principles\n\n' });
        for (const p of result.principles) {
          emit('token', { tokenType: 'Text', text: `- **#${p.index} ${p.name}** — ${p.description} _(${p.rationale})_\n` });
        }
        emit('token', { tokenType: 'Text', text: '\n' });
      }

      if (result.suField) {
        emit('token', { tokenType: 'Text', text: `### Su-Field — ${result.suField.type}\n\n${result.suField.diagnosis}\n\n${result.suField.recommendedAction}\n\n` });
        for (const s of result.suField.standardSolutions.slice(0, 5)) {
          emit('token', { tokenType: 'Text', text: `- ${s}\n` });
        }
        emit('token', { tokenType: 'Text', text: '\n' });
      }

      if (notes.length > 0) {
        emit('token', { tokenType: 'Text', text: '### Notes\n\n' });
        for (const note of notes) {
          emit('token', { tokenType: 'Text', text: `- ${note}\n` });
        }
        emit('token', { tokenType: 'Text', text: '\n' });
      }

      // ARIZ always involves the model when one is configured; a model failure
      // degrades to the deterministic stages instead of losing the analysis.
      if (deps.aiAgent) {
        const arizOptions: { system?: string; improvingName?: string; worseningName?: string; principleHints: string[] } = {
          principleHints: result.principles.map(p => `#${p.index} ${p.name}`),
        };
        const improvingName = input.improvingParameter !== undefined ? getParameterByIndex(input.improvingParameter)?.name : undefined;
        const worseningName = input.worseningParameter !== undefined ? getParameterByIndex(input.worseningParameter)?.name : undefined;
        if (improvingName) arizOptions.improvingName = improvingName;
        if (worseningName) arizOptions.worseningName = worseningName;
        try {
          const narrative = await deps.aiAgent.analyzeAriz(input.problem, arizOptions);
          if (signal.aborted) {
            cancelled = true;
          } else {
            aiNarrative = narrative;
            emit('token', { tokenType: 'Text', text: `### AI narrative\n\n${aiNarrative}\n\n` });
          }
        } catch (e: unknown) {
          emit('token', { tokenType: 'Text', text: `_AI narrative unavailable: ${e instanceof Error ? e.message : String(e)}\n\n_` });
        }
      } else {
        emit('token', { tokenType: 'Text', text: '_AI narrative skipped: no model configured (deterministic ARIZ stages only)._\n\n' });
      }
    }

    if (cancelled) {
      emit('token', { tokenType: 'Text', text: '_Analysis cancelled._\n\n' });
    } else {
      const saved = deps.phaseWriter.write({
        phase: '03_Analyze',
        name: `ariz_${slug(input.problem)}`,
        suffix: 'ariz',
        data: {
          problem: input.problem,
          improvingParameter: input.improvingParameter ?? null,
          worseningParameter: input.worseningParameter ?? null,
          principles: result.principles,
          suField: result.suField ?? null,
          stages: result.stages.map(s => ({ id: s.id, title: s.title, findings: s.findings })),
          notes,
          aiNarrative,
        },
      });
      if (saved) {
        emit('token', { tokenType: 'Text', text: `\n_Saved to \`${saved.filePath}\`_\n` });
      }
    }

    emit('done', {});
  },
};
