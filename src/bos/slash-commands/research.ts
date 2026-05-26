import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

export const researchCommand: SlashCommand = {
  name: 'research',
  description: 'Full TRIZ research: contradiction analysis + prior art search + S-curve + TRL assessment',
  usage: '/research <problem description> [improving: <param>] [worsening: <param>] [tech: <name>] [metric: <unit>]',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const improvingMatch = args.match(/improving:\s*(.+?)(?=worsening:|tech:|metric:|$)/i);
    const worseningMatch = args.match(/worsening:\s*(.+?)(?=improving:|tech:|metric:|$)/i);
    const techMatch = args.match(/tech:\s*(.+?)(?=improving:|worsening:|metric:|$)/i);
    const metricMatch = args.match(/metric:\s*(.+?)(?=improving:|worsening:|tech:|$)/i);

    const problemDesc = args
      .replace(/improving:\s*.+?(?=worsening:|tech:|metric:|$)/gi, '')
      .replace(/worsening:\s*.+?(?=improving:|tech:|metric:|$)/gi, '')
      .replace(/tech:\s*.+?(?=improving:|worsening:|metric:|$)/gi, '')
      .replace(/metric:\s*.+?(?=improving:|worsening:|tech:|$)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!problemDesc) {
      emit('token', { tokenType: 'Text', text: 'Please provide a problem description.\n\nUsage: /research <problem> [improving: <param>] [worsening: <param>] [tech: <name>] [metric: <unit>]\n\nExample: /research make the car faster improving: speed worsening: fuel consumption tech: Internal Combustion Engines metric: HP/liter' });
      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: `## TRIZ Research Report\n\n**Problem:** ${problemDesc}\n` });

    if (improvingMatch && worseningMatch) {
      emit('token', { tokenType: 'Text', text: `\n**Improving:** ${improvingMatch[1].trim()}\n**Worsening:** ${worseningMatch[1].trim()}\n` });
    }
    if (techMatch) {
      emit('token', { tokenType: 'Text', text: `\n**Technology:** ${techMatch[1].trim()}` });
      if (metricMatch) {
        emit('token', { tokenType: 'Text', text: ` | **Metric:** ${metricMatch[1].trim()}\n` });
      } else {
        emit('token', { tokenType: 'Text', text: '\n' });
      }
    }

    emit('token', { tokenType: 'Text', text: '\n---\n\n' });

    try {
      const phaseIcons: Record<string, string> = {
        search: '🔍',
        contradiction: '⚖️',
        s_curve: '📈',
        analysis: '🧠',
        report: '📄',
      };

      const result = await deps.unifiedResearch.research({
        problemDescription: problemDesc,
        improvingParameter: improvingMatch ? improvingMatch[1].trim() : undefined,
        worseningParameter: worseningMatch ? worseningMatch[1].trim() : undefined,
        technologyName: techMatch ? techMatch[1].trim() : undefined,
        performanceMetric: metricMatch ? metricMatch[1].trim() : undefined,
        maxSearchResults: 5,
        onProgress: (step, msg) => {
          if (signal.aborted) throw new Error('Cancelled');
          const icon = phaseIcons[step] || '•';
          emit('token', { tokenType: 'Text', text: `${icon} ${msg}\n` });
          emit('token', { tokenType: 'ReasoningContent', text: `[${step}] ${msg}\n` });
        },
      });

      emit('token', { tokenType: 'Text', text: result.summary });

      if (result.errors.length > 0) {
        emit('token', { tokenType: 'Text', text: '\n\n### Warnings\n\n' });
        for (const err of result.errors) {
          emit('token', { tokenType: 'Text', text: `-  ${err.message}\n` });
        }
      }
    } catch (err) {
      if (signal.aborted) {
        emit('token', { tokenType: 'Text', text: '\n\n_Research cancelled._' });
      } else {
        emit('token', { tokenType: 'Text', text: `\n\n Error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    emit('done', {});
  },
};
