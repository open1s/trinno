import { Agent, BrainOS } from '@open1s/ezbos';
import { getAgentFactory, initAgentFactory } from '../agent-factory.js';
import { streamAgent } from '../ai/streaming.js';
import { CachedSearchService } from '../search/cached_search.js';
import { SearchResult } from '../../domain/solution/search_port.js';
import { Milestone } from '../../domain/s_curve/value_objects.js';
import { LocaleConfig, DEFAULT_LOCALE, getLanguagePrompt } from '../../domain/shared/i18n.js';

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
  rawResponse?: string;
  searchSnippets?: Array<{ title: string; snippet: string; url: string; date: string }>;
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
    const builder = factory.create({
      name: 'triz-scurve-data-extractor',
      systemPrompt: `${langPrefix}You are a TRIZ S-Curve data extraction expert. Your task is to provide historical performance data and KEY REAL-WORLD MILESTONES that cover the FULL technology lifecycle.

Given a technology name and performance metric, provide realistic historical data points and MILESTONES that span from the technology's INVENTION to the PRESENT DAY.

CRITICAL REQUIREMENTS FOR DATA POINTS:
- 8-12 data points covering ALL S-curve stages: INFANCY → GROWTH → MATURITY → DECLINE
- First point should be from the technology's invention year
- Show clear S-shaped growth pattern (slow start → rapid acceleration → slowing → plateau)

CRITICAL REQUIREMENTS FOR MILESTONES:
- 4-8 key events, each MUST reference a SPECIFIC, REAL, IMPACTFUL tech/market event
- Good examples: "RSA algorithm published", "Tesla Model S launch", "CRISPR-Cas9 gene editing demonstrated", "iPhone released", "AlphaGo defeats Lee Sedol", "5G NR standard frozen by 3GPP"
- Bad examples: "First Prototype", "Initial Research", "Commercial Launch" (too generic)
- Each milestone must identify a concrete event with a specific year, recognizable name, and real market/technology impact
- Cover invention, major breakthroughs, first product, standard adoption, peak, and replacement signs

Return ONLY a JSON object with:
{
  "dataPoints": [{"x": year, "y": performance_value, "stage": "infancy|growth|maturity|decline"}],
  "milestones": [
    {"year": number, "label": "short specific name (e.g., 'RSA published' or 'Model S launch')", "description": "1-2 sentence impact description", "type": "invention|breakthrough|commercialization|standardization|peak|decline"}
  ],
  "sources": ["list of typical sources for this data"],
  "reasoning": "brief explanation of data sources, accuracy, and lifecycle coverage",
  "lifecycleInfo": {
    "inventionYear": number,
    "growthStartYear": number,
    "maturityStartYear": number,
    "currentYear": number
  }
}

Provide 8-12 data points and 4-8 key milestones spanning the FULL lifecycle from invention to present. Be realistic with numbers. The data should show a clear S-shaped curve pattern.`,
      temperature: 0.1,
    });

    this.agent = await builder.start();
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
      : 'No search results available. Use your domain knowledge to provide realistic data points.';

    const rawSnippets = searchResults.length > 0
      ? searchResults.map(r => ({
          title: r.title,
          snippet: r.snippet,
          url: r.url,
          date: r.publishedDate || 'unknown',
        }))
      : [];

    const prompt = `Extract or estimate historical performance data points for ${technologyName} measured in ${performanceMetric}.

IMPORTANT: Provide data covering the FULL technology lifecycle from INVENTION to PRESENT (2026).
Include data points for: Infancy (early slow growth) → Growth (rapid acceleration) → Maturity (slowing) → Decline (near ceiling).

Also identify 4-8 KEY REAL-WORLD MILESTONES in the technology's history. Each milestone MUST reference a SPECIFIC, RECOGNIZABLE event:
- A famous paper/algorithm published (e.g., "RSA paper published", "Transformer architecture paper")
- A major product launch (e.g., "iPhone released", "Tesla Model S delivery")
- A standard adoption (e.g., "HTML5 W3C Recommendation", "5G NR Rel-15 frozen")
- A record-breaking achievement (e.g., "AlphaGo defeats Lee Sedol")
- A regulatory event (e.g., "GDPR enforcement begins")

Each milestone MUST have a concrete year, specific recognizable name, and describe the real market/technology impact in 1-2 sentences.

Search results:
${snippets}

Return JSON with:
- dataPoints: 8-12 points spanning full lifecycle (x=year, y=performance value, stage="infancy|growth|maturity|decline")
- milestones: 4-8 key events (year, label, description, type="invention|breakthrough|commercialization|standardization|peak|decline")
- sources: list of typical sources
- reasoning: explanation of data and lifecycle coverage
- lifecycleInfo: {inventionYear, growthStartYear, maturityStartYear, currentYear}

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
    } catch {
    }

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
        s => s.snippet.toLowerCase().includes(label.toLowerCase().split(' ')[0]) ||
             s.title.toLowerCase().includes(label.toLowerCase().split(' ')[0]),
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
    const now = new Date().getFullYear();
    return {
      dataPoints: [
        { x: now - 30, y: 10, source: 'estimated' },
        { x: now - 25, y: 20, source: 'estimated' },
        { x: now - 20, y: 40, source: 'estimated' },
        { x: now - 15, y: 80, source: 'estimated' },
        { x: now - 10, y: 150, source: 'estimated' },
        { x: now - 5, y: 220, source: 'estimated' },
        { x: now - 2, y: 280, source: 'estimated' },
        { x: now, y: 300, source: 'estimated' },
      ],
      milestones: [
        { year: now - 30, label: 'Fundamental discovery', description: 'Core principles established through pioneering research', type: 'invention' },
        { year: now - 20, label: 'Proof-of-concept demonstration', description: 'First working prototype validates the approach', type: 'breakthrough' },
        { year: now - 10, label: 'First market product', description: 'Initial commercial release begins market adoption', type: 'commercialization' },
        { year: now - 5, label: 'Industry standard adopted', description: 'Major standards bodies ratify specifications', type: 'standardization' },
        { year: now, label: 'Performance plateau', description: 'Growth decelerating as technology matures', type: 'peak' },
      ],
      sources: searchResults.map(r => r.url),
      reasoning: 'Default lifecycle-spanning data points (AI-estimated). Covers infancy → growth → maturity stages.',
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
