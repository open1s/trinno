import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

export const idealityCommand: SlashCommand = {
  name: 'ideality',
  description: 'Evaluate system ideality using benefits, costs, and harms',
  usage: '/ideality benefits: <b1>, <b2>... costs: <c1>, <c2>... harms: <h1>, <h2>...',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const benefitsMatch = args.match(/benefits:\s*(.+?)(?=costs:|harms:|$)/i);
    const costsMatch = args.match(/costs:\s*(.+?)(?=benefits:|harms:|$)/i);
    const harmsMatch = args.match(/harms:\s*(.+?)(?=benefits:|costs:|$)/i);

    if (!benefitsMatch && !costsMatch && !harmsMatch) {
      emit('token', { tokenType: 'Text', text: 'Please specify benefits, costs, and/or harms.\n\nUsage: /ideality benefits: <list> costs: <list> harms: <list>\n\nExample: /ideality benefits: high speed, low weight costs: expensive manufacturing harms: noise pollution' });
      emit('done', {});
      return;
    }

    const benefits = benefitsMatch ? benefitsMatch[1]!.split(',').map(s => s.trim()).filter(Boolean) : [];
    const costs = costsMatch ? costsMatch[1]!.split(',').map(s => s.trim()).filter(Boolean) : [];
    const harms = harmsMatch ? harmsMatch[1]!.split(',').map(s => s.trim()).filter(Boolean) : [];

    emit('token', { tokenType: 'Text', text: `## Ideality Evaluation\n\n` });

    try {
      const result = await deps.idealityHandler.execute({
        problemId: 'user-input',
        benefits,
        costs,
        harms,
      });

      const { score, level, breakdown, confidence, dominant } = result.ideality;

      emit('token', { tokenType: 'Text', text: `**Ideality Score:** ${score}/100\n` });
      emit('token', { tokenType: 'Text', text: `**Level:** ${level.toUpperCase()}\n` });
      emit('token', { tokenType: 'Text', text: `**Dominant factor:** ${dominant}\n` });
      emit('token', { tokenType: 'Text', text: `**Confidence:** ${Math.round(confidence * 100)}%\n\n` });
      emit('token', { tokenType: 'Text', text: `### Breakdown\n\n` });
      emit('token', { tokenType: 'Text', text: `| Component | Score |\n|-----------|-------|\n` });
      emit('token', { tokenType: 'Text', text: `| Benefits | ${breakdown.benefits} |\n` });
      emit('token', { tokenType: 'Text', text: `| Costs | ${breakdown.costs} |\n` });
      emit('token', { tokenType: 'Text', text: `| Harms | ${breakdown.harms} |\n\n` });

      if (benefits.length > 0) {
        emit('token', { tokenType: 'Text', text: `**Benefits:** ${benefits.join(', ')}\n\n` });
      }
      if (costs.length > 0) {
        emit('token', { tokenType: 'Text', text: `**Costs:** ${costs.join(', ')}\n\n` });
      }
      if (harms.length > 0) {
        emit('token', { tokenType: 'Text', text: `**Harms:** ${harms.join(', ')}\n\n` });
      }

      if (result.ideality.recommendations.length > 0) {
        emit('token', { tokenType: 'Text', text: `### Recommendations\n\n` });
        for (const rec of result.ideality.recommendations) {
          emit('token', { tokenType: 'Text', text: `- ${rec}\n` });
        }
      }

      const saved = deps.phaseWriter.write({
        phase: '03_Analyze',
        name: 'ideality',
        suffix: `b${benefits.length}_c${costs.length}_h${harms.length}`,
        data: {
          inputs: { benefits, costs, harms },
          result: result.ideality,
        },
      });
      if (saved) {
        emit('token', { tokenType: 'Text', text: `\n_Saved to \`${saved.filePath}\`_\n` });
      }
    } catch (err) {
      if (signal.aborted) {
        emit('token', { tokenType: 'Text', text: '\n\n_Evaluation cancelled._' });
      } else {
        emit('token', { tokenType: 'Text', text: `\n\n Error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    emit('done', {});
  },
};
