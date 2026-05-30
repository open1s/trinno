import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

type SourceKey = 'patents' | 'papers' | 'tech';
type SearchHitLike = { title: string; url: string; publishedDate?: string; authors?: string[] };

function formatHits(label: string, hits: SearchHitLike[]): string {
  if (hits.length === 0) {
    return `### ${label} (0 found)\n\n_No results._\n\n`;
  }
  const lines: string[] = [`### ${label} (${hits.length} found)\n\n`];
  for (const h of hits) {
    const authors = h.authors?.length ? h.authors.slice(0, 3).join(', ') + (h.authors.length > 3 ? ' et al' : '') : 'N/A';
    const date = h.publishedDate || 'n.d.';
    lines.push(`- **${h.title}**\n  ${authors} | ${date}\n  ${h.url}\n\n`);
  }
  return lines.join('');
}

export const searchCommand: SlashCommand = {
  name: 'search',
  description: 'Search patents, papers, and technical solutions from real databases',
  usage: '/search [patents|papers|tech|all] <search query> [limit N]',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    let searchType: SourceKey | 'all' = 'all';
    let query = args;
    let limit = DEFAULT_LIMIT;

    const tokens = args.split(/\s+/);
    if (tokens.length > 0) {
      const first = tokens[0]?.toLowerCase();
      if (first === 'patents' || first === 'papers' || first === 'tech' || first === 'all') {
        searchType = first as SourceKey | 'all';
        query = tokens.slice(1).join(' ');
      }
    }

    const limitMatch = query.match(/\s+limit\s+(\d+)\s*$/i);
    if (limitMatch) {
      const parsed = parseInt(limitMatch[1] ?? '0', 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(MAX_LIMIT, parsed);
      }
      query = query.replace(limitMatch[0], '').trim();
    }

    if (!query) {
      emit('token', { tokenType: 'Text', text: 'Please provide a search query.\n\nUsage: /search [patents|papers|tech|all] <query> [limit N]\n\nExample: /search patents lithium ion battery\nExample: /search papers TRIZ inventive principles\nExample: /search all electric vehicle efficiency limit 10' });
      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: `## Search Results\n\n**Query:** ${query}\n**Type:** ${searchType}\n**Limit:** ${limit} per source\n\n---\n\n` });

    const sourceOrder: SourceKey[] = searchType === 'all' ? ['patents', 'papers', 'tech'] : [searchType];

    const tasks: Record<SourceKey, Promise<SearchHitLike[]>> = {
      patents: deps.searchService.searchPatents(query, limit).catch(err => { throw wrapSearchError('patents', err); }),
      papers: deps.searchService.searchPapers(query, limit).catch(err => { throw wrapSearchError('papers', err); }),
      tech: deps.searchService.searchTechSolutions(query, limit).catch(err => { throw wrapSearchError('tech', err); }),
    };

    const settled = await Promise.allSettled([
      tasks.patents,
      tasks.papers,
      tasks.tech,
    ]);

    if (signal.aborted) {
      emit('token', { tokenType: 'Text', text: '\n\n_Search cancelled._' });
      emit('done', {});
      return;
    }

    const labels: Record<SourceKey, string> = { patents: 'Patents', papers: 'Papers', tech: 'Technical Solutions' };

    for (let i = 0; i < sourceOrder.length; i++) {
      const source = sourceOrder[i]!;
      const result = settled[i]!;
      if (result.status === 'fulfilled') {
        emit('token', { tokenType: 'Text', text: formatHits(labels[source], result.value) });
      } else {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        emit('token', { tokenType: 'Text', text: `### ${labels[source]} (error)\n\n_${reason}_\n\n` });
      }
    }

    const saved = deps.phaseWriter.write({
      phase: '06_References',
      name: `search_${searchType}`,
      suffix: query.slice(0, 40),
      data: {
        query,
        type: searchType,
        limit,
        results: {
          patents: settled[0]?.status === 'fulfilled' ? settled[0].value : [],
          papers: settled[1]?.status === 'fulfilled' ? settled[1].value : [],
          tech: settled[2]?.status === 'fulfilled' ? settled[2].value : [],
        },
        errors: {
          patents: settled[0]?.status === 'rejected' ? String(settled[0].reason) : null,
          papers: settled[1]?.status === 'rejected' ? String(settled[1].reason) : null,
          tech: settled[2]?.status === 'rejected' ? String(settled[2].reason) : null,
        },
      },
    });
    if (saved) {
      emit('token', { tokenType: 'Text', text: `\n_Saved to \`${saved.filePath}\`_\n` });
    }

    emit('done', {});
  },
};

function wrapSearchError(source: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(`${source} search failed: ${msg}`);
}
