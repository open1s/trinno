import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

export const aiResearchCommand: SlashCommand = {
  name: 'ai-research',
  description: 'AI-driven research: auto-extracts keywords, searches prior art, summarizes, and generates TRIZ report',
  usage: '/ai-research <problem description> [--max=N] [--fast]',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    let problem = args.trim();

    // Parse options for better usability
    let maxResults = 5;
    let showThinking = true;
    let skillName = '';
    let skillContent = '';

    const maxMatch = problem.match(/--max=(\d+)/i);
    if (maxMatch) {
      maxResults = parseInt(maxMatch[1], 10);
      problem = problem.replace(maxMatch[0], '').trim();
    }

    if (problem.includes('--fast')) {
      showThinking = false;
      problem = problem.replace('--fast', '').trim();
    }

    problem = problem.replace(/\s+/g, ' ').trim();

    if (!problem) {
      emit('token', { tokenType: 'Text', text: 'Please provide a problem description.\n\nUsage: /ai-research <problem> [--max=N] [--fast] [--skill=name]\n\nExample: /ai-research 我想让电动车电池续航更长，但这样会增加电池重量和成本 --max=10 --fast --skill=clean-ddd-hexagonal' });
      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: `## AI Research Report\n\n**Problem:** ${problem}\n` });
    if (maxResults !== 5 || !showThinking || skillContent) {
      const settings = [];
      if (maxResults !== 5) settings.push(`Max Results: ${maxResults}`);
      if (!showThinking) settings.push(`Fast Mode`);
      if (skillContent) settings.push(`Skill: ${skillName}`);
      emit('token', { tokenType: 'Text', text: `*(Settings - ${settings.join(', ')})*\n` });
    }
    emit('token', { tokenType: 'Text', text: `\n---\n\n` });

    try {
      let lastStep = '';
      const stepLabels: Record<string, string> = {
        keywords: '🔑 Extracting Keywords',
        search: '🔍 Searching Prior Art',
        summarize: '📝 Analyzing & Summarizing',
        analyze: '🧠 Extracting TRIZ Parameters',
        triz: '⚙️ Running TRIZ Analysis',
      };

      const result = await deps.aiResearchOrchestrator.research(problem, {
        maxSearchResults: maxResults,
        showThinking: showThinking,
        skillContent: skillContent,
        onProgress: (step, msg) => {
          if (signal.aborted) throw new Error('Cancelled');
          
          // Emit internal logs to ReasoningContent
          emit('token', { tokenType: 'ReasoningContent', text: `[${step}] ${msg}\n` });
          
          // Emit major milestones to main Text to keep user engaged visually
          if (step !== lastStep) {
            const label = stepLabels[step] || `🔹 ${step}`;
            emit('token', { tokenType: 'Text', text: `> ${label}...\n\n` });
            lastStep = step;
          }
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

      // Stream the final summary for a better interactive UX
      emit('token', { tokenType: 'Text', text: '\n---\n\n' });
      
      const summary = result.summary || '';
      const chunkSize = 15;
      for (let i = 0; i < summary.length; i += chunkSize) {
        if (signal.aborted) break;
        emit('token', { tokenType: 'Text', text: summary.slice(i, i + chunkSize) });
        await new Promise(r => setTimeout(r, 10)); // 10ms delay creates a smooth typewriter effect
      }

      if (result.metadata) {
        let metaText = `\n\n### Research Metadata\n\n`;
        metaText += `- **Duration:** ${Math.round(result.metadata.durationMs / 1000)}s\n`;
        metaText += `- **Sources:** ${(result.metadata.sourcesUsed || []).join(', ') || 'none'}\n`;
        metaText += `- **AI calls:** ${result.metadata.aiCallsMade || 0}\n`;
        metaText += `- **Cache:** ${result.metadata.cacheHits || 0} hits, ${result.metadata.cacheMisses || 0} misses\n`;
        
        for (let i = 0; i < metaText.length; i += chunkSize) {
          if (signal.aborted) break;
          emit('token', { tokenType: 'Text', text: metaText.slice(i, i + chunkSize) });
          await new Promise(r => setTimeout(r, 5));
        }
      }

      if (result.errors.length > 0) {
        let errText = `\n\n### Warnings\n\n`;
        for (const err of result.errors) {
          const icon = err.severity === 'error' ? '❌' : '⚠️';
          errText += `- ${icon} [${err.component}] ${err.message}\n`;
        }
        for (let i = 0; i < errText.length; i += chunkSize) {
          if (signal.aborted) break;
          emit('token', { tokenType: 'Text', text: errText.slice(i, i + chunkSize) });
          await new Promise(r => setTimeout(r, 5));
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
