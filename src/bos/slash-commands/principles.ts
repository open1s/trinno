import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

export const principlesCommand: SlashCommand = {
  name: 'principles',
  description: 'List or search the 40 TRIZ inventive principles',
  usage: '/principles [search <keyword>] | [list] | [<number>]',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const trimmed = args.trim();

    if (!trimmed || trimmed === 'list') {
      emit('token', { tokenType: 'Text', text: `## All 40 TRIZ Inventive Principles\n\n` });

      const allPrinciples = deps.principleEngine.getAllPrinciples();
      for (const p of allPrinciples) {
        emit('token', { tokenType: 'Text', text: `${p.index}. **${p.name}** - ${p.description.slice(0, 100)}...\n` });
      }

      emit('token', { tokenType: 'Text', text: `\n*Use /principles search <keyword> to find specific principles, or /principles <number> for details.*` });
      emit('done', {});
      return;
    }

    const searchMatch = trimmed.match(/^search\s+(.+)$/i);
    const numberMatch = trimmed.match(/^(\d+)$/);

    if (searchMatch) {
      const keyword = searchMatch[1]!.trim();
      emit('token', { tokenType: 'Text', text: `## Principles matching "${keyword}"\n\n` });

      const results = deps.principleEngine.searchPrinciplesScored(keyword, { limit: 10 });
      if (results.length === 0) {
        emit('token', { tokenType: 'Text', text: '_No principles found matching this keyword._\n\n' });
      } else {
        for (const { principle: p, relevance, matchedTokens } of results) {
          const tokenNote = matchedTokens.length > 0 ? ` _(matched: ${matchedTokens.join(', ')}, score ${relevance})_` : '';
          emit('token', { tokenType: 'Text', text: `### #${p.index} ${p.name}${tokenNote}\n\n${p.description}\n\n` });
          if (p.examples.length > 0) {
            emit('token', { tokenType: 'Text', text: `**Examples:** ${p.examples.join(', ')}\n\n` });
          }
        }
      }
      emit('done', {});
      return;
    }

    if (numberMatch) {
      const num = parseInt(numberMatch[1]!, 10);
      const principle = deps.principleEngine.getPrinciple(num);

      if (!principle) {
        emit('token', { tokenType: 'Text', text: `Principle #${num} not found. Please use a number between 1 and 40.\n` });
        emit('done', {});
        return;
      }

      emit('token', { tokenType: 'Text', text: `## Principle #${principle.index}: ${principle.name}\n\n${principle.description}\n\n` });

      if (principle.examples.length > 0) {
        emit('token', { tokenType: 'Text', text: `### Examples\n\n` });
        for (const ex of principle.examples) {
          emit('token', { tokenType: 'Text', text: `- ${ex}\n` });
        }
        emit('token', { tokenType: 'Text', text: '\n' });
      }

      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: 'Usage: /principles [search <keyword>] | [list] | [<number>]\n\nExample: /principles list\nExample: /principles search segmentation\nExample: /principles 1' });
    emit('done', {});
  },
};
