import { SlashCommand } from './registry.js';
import { TrizDeps } from '../infrastructure/config/di.js';
import { initAgentFactory, getAgentFactory } from '../infrastructure/agent-factory.js';
import { getModelConfig } from '../infrastructure/config/model-config.js';

function resolveParameter(deps: TrizDeps, input: string): number | null {
  const num = parseInt(input, 10);
  if (!isNaN(num) && num >= 1 && num <= 39) return num;

  const allParams = deps.analysisService.getAllParameters();
  const lower = input.toLowerCase().trim();
  const cleaned = lower
    .replace(/^\d+[\.\)\-]\s*/, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  for (const p of allParams) {
    if (p.name.toLowerCase() === cleaned) return p.index;
  }
  for (const p of allParams) {
    if (p.name.toLowerCase().includes(cleaned)) return p.index;
  }
  for (const p of allParams) {
    if (cleaned.includes(p.name.toLowerCase())) return p.index;
  }

  const keywordMap: Record<string, number> = {
    'weight of moving': 1, 'weight of stationary': 2,
    'length of moving': 3, 'length of stationary': 4,
    'area of moving': 5, 'area of stationary': 6,
    'volume of moving': 7, 'volume of stationary': 8,
    'speed': 9, 'velocity': 9, 'range': 9,
    'force': 10, 'stress': 11, 'pressure': 11,
    'shape': 12, 'stability': 13, 'strength': 14,
    'durability of moving': 15, 'durability of stationary': 16,
    'temperature': 17, 'heat': 17, 'brightness': 18,
    'energy spent by moving': 19, 'energy spent by stationary': 20,
    'fuel': 19, 'fuel consumption': 19, 'power': 21,
    'loss of energy': 22, 'waste': 22, 'friction': 22,
    'loss of substance': 23, 'loss of information': 24,
    'loss of time': 25, 'time': 25, 'duration': 25,
    'amount of substance': 26, 'density': 26, 'capacity': 26,
    'reliability': 27, 'safety': 27, 'accuracy': 28,
    'precision': 29, 'manufacturing': 32, 'ease of manufacturing': 32,
    'ease of operation': 33, 'ease of repair': 34, 'repair': 34,
    'adaptability': 35, 'adapt': 35, 'complexity': 36,
    'device complexity': 36, 'detection': 37, 'difficulty of detection': 37,
    'automation': 38, 'control': 38, 'productivity': 39,
    'efficiency': 39, 'cost': 39, 'noise': 31,
    'vibration': 18, 'wear': 15, 'damage': 30,
    'harm': 31, 'pollution': 31, 'external harm': 30,
  };

  for (const [keyword, index] of Object.entries(keywordMap)) {
    if (cleaned.includes(keyword)) return index;
  }
  return null;
}

export const contradictionCommand: SlashCommand = {
  name: 'contradiction',
  description: 'Analyze technical contradictions using the TRIZ contradiction matrix',
  usage: '/contradiction <improving> vs <worsening>  OR  /contradiction <topic>',
  async execute(args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) {
    const vsMatch = args.match(/^(.+?)\s+vs\s+(.+)$/i);

    if (vsMatch) {
      const improvingStr = vsMatch[1]!.trim();
      const worseningStr = vsMatch[2]!.trim();

      const improving = resolveParameter(deps, improvingStr);
      const worsening = resolveParameter(deps, worseningStr);

      if (!improving || !worsening) {
        const missing: string[] = [];
        if (!improving) missing.push(`"${improvingStr}"`);
        if (!worsening) missing.push(`"${worseningStr}"`);
        emit('token', { tokenType: 'Text', text: `Could not resolve: ${missing.join(', ')}.\n\n` });
        emit('token', { tokenType: 'Text', text: 'Available parameters (1-39):\n\n' });
        const allParams = deps.analysisService.getAllParameters();
        for (const p of allParams) {
          emit('token', { tokenType: 'Text', text: `${p.index}. ${p.name}\n` });
        }
        emit('done', {});
        return;
      }

      emit('token', { tokenType: 'Text', text: `## Contradiction Analysis\n\n**Improving:** ${improvingStr} (#${improving})\n**Worsening:** ${worseningStr} (#${worsening})\n\n---\n\n` });

      try {
        const result = deps.analysisService.analyze(
          improving,
          worsening,
          `Improve "${improvingStr}" but worsens "${worseningStr}"`,
        );

        emit('token', { tokenType: 'Text', text: `### Recommended TRIZ Principles\n\n` });
        for (let i = 0; i < result.principles.length; i++) {
          const p = result.principles[i]!;
          emit('token', { tokenType: 'Text', text: `${i + 1}. **Principle #${p.index}: ${p.name}**\n   ${p.description}\n\n` });
        }
        emit('token', { tokenType: 'Text', text: `*${result.principles.length} principles from the contradiction matrix.*` });

        const saved = deps.phaseWriter.write({
          phase: '03_Analyze',
          name: `contradiction_${improving}_vs_${worsening}`,
          suffix: improvingStr.slice(0, 20),
          data: {
            improving: { input: improvingStr, index: improving },
            worsening: { input: worseningStr, index: worsening },
            principles: result.principles.map((p: any) => ({ index: p.index, name: p.name, description: p.description })),
          },
        });
        if (saved) {
          emit('token', { tokenType: 'Text', text: `\n_Saved to \`${saved.filePath}\`_\n` });
        }
      } catch (err) {
        emit('token', { tokenType: 'Text', text: `\n\n Error: ${err instanceof Error ? err.message : String(err)}` });
      }
      emit('done', {});
      return;
    }

    const topic = args.trim();
    if (!topic) {
      emit('token', { tokenType: 'Text', text: 'Usage:\n- `/contradiction <improving> vs <worsening>` - Direct matrix lookup\n- `/contradiction <topic>` - AI analyzes contradictions for the topic\n\nExample: `/contradiction speed vs fuel consumption`' });
      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: `## Contradiction Analysis: ${topic}\n\n_Analyzing key technical contradictions..._\n\n---\n\n` });

    let started: any = null;
try {
        initAgentFactory(deps.brain, { defaultTools: deps.tools });
        const factory = getAgentFactory();
        const mc = getModelConfig();
        const agent = factory.create({
          name: 'triz-contradiction',
          systemPrompt: `You are Research Master — a self-directed, tool-first TRIZ expert operating in the Analyze phase of a 7-phase pipeline (Problem→Context→Evidence→Modeling→TRIZ→Validation→Execution), producing copy-ready contradiction artifacts using TRIZ/PRISMA/SWOT/PEST/5W1H/PICO with importance-weighted KPIs and evidence scoring.

Task: identify 2–3 key technical contradictions for the topic. For each:
1. State improving vs worsening parameter (root cause)
2. Map to TRIZ parameters (1–39) and look up the contradiction matrix
3. List recommended inventive principles with rationale
4. Score weight × relevance (0–1) and evidence confidence (0–1)
5. Surface decision factors and risks
6. Suggest ≤3-day executable experiment per contradiction

Use websearch + triz_search to verify when uncertain. Ask user only when essential info is missing.

Format (≤4 lines per contradiction):
### Contradiction: [improving] vs [worsening]
- **Improving:** [parameter name] / weight: 0-1
- **Worsening:** [parameter name] / confidence: 0-1
- **Principles:** #N [name], #N [name]... (rationale: short)
- **Decision factors:** short list
- **Risks:** short list
- **Next experiment (≤3d):** concrete task

Be concise. Think step by step, break into smaller parts.`,
          temperature: 0.3,
          ...(mc.model ? { model: mc.model } : {}),
          ...(mc.baseUrl ? { baseUrl: mc.baseUrl } : {}),
          ...(mc.apiKey ? { apiKey: mc.apiKey } : {}),
        });

        started = await agent.start();
      await new Promise<void>((resolve) => {
        started.stream(`Identify key technical contradictions for: ${topic}`, (token: any) => {
          if (signal.aborted) {
            started.close().catch(() => {});
            resolve();
            return;
          }
          if (token.type === 'Text') emit('token', { tokenType: 'Text', text: token.text });
          else if (token.type === 'ReasoningContent') emit('token', { tokenType: 'ReasoningContent', text: token.text });
          else if (token.type === 'Done') { started.close().catch(() => {}); resolve(); }
          else if (token.type === 'Error') { started.close().catch(() => {}); emit('token', { tokenType: 'Text', text: `\n\n Error: ${token.error}` }); resolve(); }
        });
      });
    } catch (err) {
      try { started.close().catch(() => {}); } catch { }
      if (signal.aborted) {
        emit('token', { tokenType: 'Text', text: '\n\n_Analysis cancelled._' });
      } else {
        emit('token', { tokenType: 'Text', text: `\n\n Error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    emit('done', {});
  },
};
