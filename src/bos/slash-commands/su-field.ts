import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

export const suFieldCommand: SlashCommand = {
  name: 'su-field',
  description: 'Analyze Substance-Field models for technical problems',
  usage: '/su-field <substance1> <substance2> <field> [harmful|insufficient]',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const parts = args.trim().split(/\s+/);

    if (parts.length < 3) {
      emit('token', { tokenType: 'Text', text: 'Please specify at least two substances and a field.\n\nUsage: /su-field <S1> <S2> <Field> [harmful|insufficient]\n\nExample: /su-field drill_bit workpiece mechanical_force\nExample: /su-field lens light optical harmful\nExample: /su-field battery motor electrical insufficient' });
      emit('done', {});
      return;
    }

    const s1 = parts[0]!;
    const s2 = parts[1]!;
    const field = parts[2]!;
    const mode = parts[3]?.toLowerCase();

    emit('token', { tokenType: 'Text', text: `## Substance-Field Analysis\n\n**Substance 1 (Tool):** ${s1}\n**Substance 2 (Object):** ${s2}\n**Field:** ${field}\n---\n\n` });

    try {
      let result;
      if (mode === 'harmful') {
        result = deps.suFieldService.analyzeHarmful(s1, s2, field);
      } else if (mode === 'insufficient') {
        result = deps.suFieldService.analyzeInsufficient(s1, s2, field);
      } else if (mode === 'excessive') {
        result = deps.suFieldService.analyzeExcessive(s1, s2, field);
      } else {
        result = deps.suFieldService.analyze({ substance1: s1, substance2: s2, field });
      }

      emit('token', { tokenType: 'Text', text: `### Model Type: ${result.type.toUpperCase()}\n\n${result.diagnosis}\n\n` });

      emit('token', { tokenType: 'Text', text: `### Recommended Action\n\n${result.recommendedAction}\n\n` });

      if (result.solutions.length > 0) {
        const grouped = new Map<string, typeof result.solutions>();
        for (const s of result.solutions) {
          const key = s.class;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(s);
        }
        emit('token', { tokenType: 'Text', text: `### Standard Solutions (from the 76)\n\n` });
        for (const [cls, items] of grouped) {
          emit('token', { tokenType: 'Text', text: `**${cls}**\n` });
          for (const s of items) {
            emit('token', { tokenType: 'Text', text: `- **${s.number}** — _${s.title}_\n  ${s.description}\n` });
          }
          emit('token', { tokenType: 'Text', text: '\n' });
        }
      }

      const saved = deps.phaseWriter.write({
        phase: '03_Analyze',
        name: `su_field_${s1}_${s2}_${field}`,
        suffix: mode ?? 'default',
        data: {
          substances: { s1, s2 },
          field,
          mode: mode ?? 'default',
          result,
        },
      });
      if (saved) {
        emit('token', { tokenType: 'Text', text: `\n_Saved to \`${saved.filePath}\`_\n` });
      }
    } catch (err) {
      if (signal.aborted) {
        emit('token', { tokenType: 'Text', text: '\n\n_Analysis cancelled._' });
      } else {
        emit('token', { tokenType: 'Text', text: `\n\n Error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    emit('done', {});
  },
};
