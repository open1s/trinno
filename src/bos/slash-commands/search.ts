import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

export const searchCommand: SlashCommand = {
  name: 'search',
  description: 'Search patents, papers, and technical solutions from real databases',
  usage: '/search [patents|papers|tech|all] <search query>',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const typeMatch = args.match(/^(patents|papers|tech|all)\s+(.+)$/i);
    let searchType = 'all';
    let query = args;

    if (typeMatch) {
      searchType = typeMatch[1].toLowerCase();
      query = typeMatch[2].trim();
    }

    if (!query) {
      emit('token', { tokenType: 'Text', text: 'Please provide a search query.\n\nUsage: /search [patents|papers|tech|all] <query>\n\nExample: /search patents lithium ion battery\nExample: /search papers TRIZ inventive principles\nExample: /search all electric vehicle efficiency' });
      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: `## Search Results\n\n**Query:** ${query}\n**Type:** ${searchType}\n\n---\n\n` });

    try {
      const types = searchType === 'all' ? ['patents', 'papers', 'tech'] : [searchType];

      for (const type of types) {
        if (signal.aborted) throw new Error('Cancelled');
        if (type === 'patents') {
          const patents = await deps.searchService.searchPatents(query, 5);
          emit('token', { tokenType: 'Text', text: `### Patents (${patents.length} found)\n\n` });
          if (patents.length === 0) {
            emit('token', { tokenType: 'Text', text: '_No patents found._\n\n' });
          } else {
            for (const p of patents) {
              emit('token', { tokenType: 'Text', text: `- **${p.title}**\n  ${p.authors?.join(', ') || 'N/A'} | ${p.publishedDate || 'N/A'}\n  ${p.url}\n\n` });
            }
          }
        } else if (type === 'papers') {
          const papers = await deps.searchService.searchPapers(query, 5);
          emit('token', { tokenType: 'Text', text: `### Papers (${papers.length} found)\n\n` });
          if (papers.length === 0) {
            emit('token', { tokenType: 'Text', text: '_No papers found._\n\n' });
          } else {
            for (const p of papers) {
              emit('token', { tokenType: 'Text', text: `- **${p.title}**\n  ${p.authors?.join(', ') || 'N/A'} | ${p.publishedDate || 'N/A'}\n  ${p.url}\n\n` });
            }
          }
        } else if (type === 'tech') {
          const tech = await deps.searchService.searchTechSolutions(query, 5);
          emit('token', { tokenType: 'Text', text: `### Technical Solutions (${tech.length} found)\n\n` });
          if (tech.length === 0) {
            emit('token', { tokenType: 'Text', text: '_No technical solutions found._\n\n' });
          } else {
            for (const t of tech) {
              emit('token', { tokenType: 'Text', text: `- **${t.title}**\n  ${t.publishedDate || 'N/A'}\n  ${t.url}\n\n` });
            }
          }
        }
      }
    } catch (err) {
      if (signal.aborted) {
        emit('token', { tokenType: 'Text', text: '\n\n_Search cancelled._' });
      } else {
        emit('token', { tokenType: 'Text', text: `\n\n Error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    emit('done', {});
  },
};
