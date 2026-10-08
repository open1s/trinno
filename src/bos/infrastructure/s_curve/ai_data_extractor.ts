import { Agent, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { getModelConfig } from '../config/model-config.js';
import { streamAgent } from '../ai/streaming.js';
import { createModuleLogger } from '../logging/logger.js';
import { CachedSearchService } from '../search/cached_search.js';
import { SearchResult } from '../../domain/solution/search_port.js';
import { Milestone } from '../../domain/s_curve/value_objects.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt } from '../../domain/shared/i18n.js';
import { buildSCurveDataExtractorPrompt } from '../../prompts/index.js';

const log = createModuleLogger('ai-scurve-data-extractor');

export interface ExtractedDataPoint {
  x: number;
  y: number;
  source?: string;
}

export interface AiSCurveDataResult {
  dataPoints: ExtractedDataPoint[];
  milestones: Milestone[];
  sources: string[];
  reasoning: string;
  rawResponse?: string | undefined;
  searchSnippets?: Array<{ title: string; snippet: string; url: string; date: string }> | undefined;
}

export class AiSCurveDataExtractor {
  private agent: Agent | null = null;
  private brain: BrainOS | null = null;
  private searchService: CachedSearchService;
  private locale: LocaleConfig;

  constructor(searchService: CachedSearchService, brain?: BrainOS, locale?: LocaleConfig) {
    this.searchService = searchService;
    this.brain = brain || null;
    this.locale = locale || DEFAULT_LOCALE;
  }

async initialize(): Promise<void> {
    if (!this.brain) {
      this.brain = new BrainOS();
      await this.brain.start();
    }

    const langPrefix = this.locale.language === 'zh'
      ? '【中文模式】你必须用中文进行所有思考、推理和输出。\n\n'
      : '';

    initAgentFactory(this.brain);

    const factory = getAgentFactory();
    const mc = getModelConfig();
    const builder = factory.create({
      name: 'triz-scurve-data-extractor',
      systemPrompt: buildSCurveDataExtractorPrompt(langPrefix),
      temperature: 0.1,
      ...(mc.model ? { model: mc.model } : {}),
      ...(mc.baseUrl ? { baseUrl: mc.baseUrl } : {}),
      ...(mc.apiKey ? { apiKey: mc.apiKey } : {}),
      ...(mc.apiMode ? { apiMode: mc.apiMode } : {}),
      ...(mc.reasoningEffort ? { reasoningEffort: mc.reasoningEffort } : {}),
    });

    this.agent = await builder.start();
  }

  async dispose(): Promise<void> {
    if (this.agent) {
      try { await this.agent.stop(); } catch { }
      this.agent = null;
    }
  }

  async extractData(
    technologyName: string,
    performanceMetric: string,
  ): Promise<AiSCurveDataResult> {
    if (!this.agent) await this.initialize();

    const searchQuery = `${technologyName} ${performanceMetric} historical data performance evolution`;

    const searchResults = await this.searchService.searchTechSolutions(searchQuery, 10);

    const snippets = searchResults.length > 0
      ? searchResults
          .map(r => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.url}\nDate: ${r.publishedDate || 'unknown'}`)
          .join('\n\n')
      : 'No search results available. Return empty dataPoints and milestones.';

    const rawSnippets = searchResults.length > 0
      ? searchResults.map(r => ({
          title: r.title,
          snippet: r.snippet,
          url: r.url,
          date: r.publishedDate || 'unknown',
        }))
      : [];

    const prompt = `Extract real historical performance data points for ${technologyName} measured in ${performanceMetric} from the search results below.

RULES — STRICTLY ENFORCED:
1. ONLY extract data explicitly stated in search results. Do NOT fabricate or estimate.
2. If no search results contain usable performance data (year + numeric value pairs), return empty dataPoints and milestones.
3. Do NOT generate "realistic" or "plausible" data from your training knowledge.
4. Milestones must be directly referenced in search results.
5. Quantity does not matter — 0 data points is an acceptable valid answer.

Search results:
${snippets}

Return JSON with:
- dataPoints: only from search results (x=year, y=performance value, stage optional)
- milestones: only from search results (year, label, description, type)
- sources: URLs from search results
- reasoning: describe what was found and what was missing
- lifecycleInfo: {inventionYear: number|null, growthStartYear: number|null, maturityStartYear: number|null, currentYear: 2026}

${getLanguagePrompt(this.locale.language)}`;

    const response = await streamAgent(this.agent!, prompt);
    return this.parseResponse(response, searchResults, rawSnippets);
  }

  private parseResponse(response: string, searchResults: SearchResult[], rawSnippets?: AiSCurveDataResult['searchSnippets']): AiSCurveDataResult {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const dataPoints = (parsed.dataPoints || []).map((dp: any) => ({
          x: typeof dp.x === 'number' && !isNaN(dp.x) ? dp.x : Number(dp.x),
          y: typeof dp.y === 'number' && !isNaN(dp.y) ? dp.y : Number(dp.y),
          source: dp.source,
        })).filter((dp: { x: number; y: number }) => !isNaN(dp.x) && !isNaN(dp.y));

        const milestones: Milestone[] = (parsed.milestones || []).map((m: any) => ({
          year: typeof m.year === 'number' && !isNaN(m.year) ? m.year : Number(m.year),
          label: String(m.label || ''),
          description: String(m.description || ''),
          type: m.type as Milestone['type'],
          rawFact: this.buildMilestoneFact(m, rawSnippets),
        })).filter((m: Milestone) => !isNaN(m.year));

        // If no data points returned, generate lifecycle-spanning defaults
        if (dataPoints.length === 0) {
          return this.generateLifecycleDefaults(searchResults, response);
        }

        return {
          dataPoints,
          milestones,
          sources: parsed.sources || searchResults.map(r => r.url),
          reasoning: parsed.reasoning || 'AI extracted data points with full lifecycle coverage',
          rawResponse: response,
          searchSnippets: rawSnippets,
        };
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'S-curve data extractor: model output was not valid JSON, using fallback');
      return this.generateLifecycleDefaults(searchResults, response);
    }

    log.warn('S-curve data extractor: model returned no JSON object, using fallback');
    return this.generateLifecycleDefaults(searchResults, response);
  }

  private buildMilestoneFact(m: any, rawSnippets?: AiSCurveDataResult['searchSnippets']): string {
    const facts: string[] = [];
    const label = String(m.label || '');
    const desc = String(m.description || '');

    facts.push(`Milestone: ${label}`);
    facts.push(`Description: ${desc}`);

    if (rawSnippets && rawSnippets.length > 0) {
      const relevantSnippets = rawSnippets.filter(
        s => s.snippet.toLowerCase().includes(label.toLowerCase().split(' ')[0] ?? '') ||
             s.title.toLowerCase().includes(label.toLowerCase().split(' ')[0] ?? ''),
      );
      if (relevantSnippets.length > 0) {
        facts.push(`\nSupporting Search Evidence:`);
        relevantSnippets.slice(0, 3).forEach(s => {
          facts.push(`  - [${s.title}](${s.url}) (${s.date})`);
          facts.push(`    "${s.snippet.substring(0, 200)}"`);
        });
      }
    }

    return facts.join('\n');
  }

  private generateLifecycleDefaults(searchResults: SearchResult[], rawResponse?: string): AiSCurveDataResult {
    return {
      dataPoints: [],
      milestones: [],
      sources: searchResults.map(r => r.url),
      reasoning: 'FALLBACK: S-curve data extraction failed. No real data points or milestones available. Provide specific performance data (year + performance value pairs) for accurate S-curve analysis.',
      rawResponse,
    };
  }

  async close(): Promise<void> {
    if (this.agent) {
      await this.agent.close();
      this.agent = null;
    }
  }
}
