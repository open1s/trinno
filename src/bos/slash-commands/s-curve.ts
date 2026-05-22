import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';
import type { TRLLevel } from '../domain/s_curve/value_objects.js';

export const sCurveCommand: SlashCommand = {
  name: 's-curve',
  description: 'Analyze technology maturity using S-curve analysis with TRL assessment',
  usage: '/s-curve <technology name> <performance metric> [TRL <level>]',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const trlMatch = args.match(/TRL\s*(\d+)/i);
    const trlOverride: TRLLevel | undefined = trlMatch ? (parseInt(trlMatch[1], 10) as TRLLevel) : undefined;

    const baseArgs = args.replace(/TRL\s*\d+/i, '').trim();
    const parts = baseArgs.split(/\s+/);

    if (parts.length < 2) {
      emit('token', { tokenType: 'Text', text: 'Please provide technology name and performance metric.\n\nUsage: /s-curve <technology> <metric> [TRL <level>]\n\nExample: /s-curve "Lithium-ion Batteries" Wh/kg\nExample: /s-curve "Solid State Batteries" Wh/kg TRL 6\nExample: /s-curve "Internal Combustion Engines" HP/liter' });
      emit('done', {});
      return;
    }

    const metric = parts.pop()!;
    const techName = parts.join(' ');

    emit('token', { tokenType: 'Text', text: `## S-Curve Analysis\n\n**Technology:** ${techName}\n**Metric:** ${metric}\n${trlOverride ? `**TRL Override:** ${trlOverride}/9\n` : ''}\n---\n\n` });

    try {
      emit('token', { tokenType: 'ReasoningContent', text: `Extracting data for ${techName} (${metric})...\n` });

      const extracted = await deps.aiSCurveDataExtractor.extractData(techName, metric);

      if (signal.aborted) throw new Error('Cancelled');

      emit('token', { tokenType: 'ReasoningContent', text: `Found ${extracted.dataPoints.length} data points.\n` });

      if (extracted.dataPoints.length === 0) {
        emit('token', { tokenType: 'Text', text: '_No historical data found for this technology. The AI could not extract performance data points._\n\n' });
        emit('done', {});
        return;
      }

      const result = await deps.sCurveHandler.execute({
        technologyName: techName,
        performanceMetric: metric,
        dataPoints: extracted.dataPoints,
        milestones: extracted.milestones,
        trl: trlOverride,
      });

      emit('token', { tokenType: 'Text', text: result.analysis });

      if (result.unicodeChart) {
        emit('token', { tokenType: 'Text', text: `\n\n### S-Curve Preview\n\n\`\`\`\n${result.unicodeChart}\n\`\`\`\n` });
      }

      if (result.svg) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const sanitizedName = techName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
        emit('token', { tokenType: 'Text', text: `\n\nSVG chart will be saved to \`output/scurve_${sanitizedName}_${timestamp}.svg\`` });
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
