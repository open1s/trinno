import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

export const aiResearchCommand: SlashCommand = {
  name: 'ai-research',
  description: 'AI-driven research: auto-extracts keywords, searches prior art, summarizes, and generates TRIZ report',
  usage: '/ai-research <problem description>',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const problem = args.trim();

    if (!problem) {
      emit('token', { tokenType: 'Text', text: 'Please provide a problem description.\n\nUsage: /ai-research <problem>\n\nExample: /ai-research 我想让电动车电池续航更长，但这样会增加电池重量和成本' });
      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: `## AI Research Report\n\n**Problem:** ${problem}\n\n_Analyzing..._\n\n---\n\n` });

    try {
      const result = await deps.aiResearchOrchestrator.research(problem, {
        maxSearchResults: 5,
        showThinking: true,
        onProgress: (step, msg) => {
          if (signal.aborted) throw new Error('Cancelled');
          emit('token', { tokenType: 'ReasoningContent', text: `[${step}] ${msg}\n` });
        },
        onThinking: (text) => {
          if (signal.aborted) throw new Error('Cancelled');
          emit('token', { tokenType: 'ReasoningContent', text: text });
        },
      });

      if (signal.aborted) {
        emit('token', { tokenType: 'Text', text: '\n\n_Research cancelled._' });
        emit('done', {});
        return;
      }

      emit('token', { tokenType: 'Text', text: result.summary });

      if (result.metadata) {
        emit('token', { tokenType: 'Text', text: `\n\n### Research Metadata\n\n` });
        emit('token', { tokenType: 'Text', text: `- **Duration:** ${Math.round(result.metadata.durationMs / 1000)}s\n` });
        emit('token', { tokenType: 'Text', text: `- **Sources:** ${(result.metadata.sourcesUsed || []).join(', ') || 'none'}\n` });
        emit('token', { tokenType: 'Text', text: `- **AI calls:** ${result.metadata.aiCallsMade || 0}\n` });
        emit('token', { tokenType: 'Text', text: `- **Cache:** ${result.metadata.cacheHits || 0} hits, ${result.metadata.cacheMisses || 0} misses\n` });
      }

      if (result.errors.length > 0) {
        emit('token', { tokenType: 'Text', text: `\n\n### Warnings\n\n` });
        for (const err of result.errors) {
          const icon = err.severity === 'error' ? '❌' : '⚠️';
          emit('token', { tokenType: 'Text', text: `- ${icon} [${err.component}] ${err.message}\n` });
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
