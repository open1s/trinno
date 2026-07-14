import { SlashCommand } from './registry.js';
import { initAgentFactory, getAgentFactory } from '../infrastructure/agent-factory.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CHARS_PER_TOKEN = 4;

const LOREM = [
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium totam rem aperiam eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
  "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est qui dolorem ipsum quia dolor sit amet consectetur adipisci velit sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.",
  "Ut enim ad minima veniam quis nostrum exercitationem ullam corporis suscipit laboriosam nisi ut aliquid ex ea commodi consequatur. Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur vel illum qui dolorem eum fugiat quo voluptas nulla pariatur.",
  "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident similique sunt in culpa qui officia deserunt mollitia animi id est laborum et dolorum fuga.",
  "Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus omnis voluptas assumenda est omnis dolor repellendus. Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae molestiae non recusandae.",
  "Itaque earum rerum hic tenetur a sapiente delectus ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat. Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium totam rem aperiam eaque ipsa quae ab illo.",
  "Inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt neque porro quisquam est qui dolorem ipsum quia dolor sit amet consectetur.",
  "Adipisci velit sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem ut enim ad minima veniam quis nostrum exercitationem ullam corporis suscipit laboriosam nisi ut aliquid ex ea commodi consequatur quis autem vel eum iure reprehenderit qui in ea voluptate.",
  "Velit esse quam nihil molestiae consequatur vel illum qui dolorem eum fugiat quo voluptas nulla pariatur at vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.",
  "Similique sunt in culpa qui officia deserunt mollitia animi id est laborum et dolorum fuga et harum quidem rerum facilis est et expedita distinctio nam libero tempore cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus omnis voluptas assumenda est.",
];

function generatePadding(targetChars: number): string {
  let result = '';
  let i = 0;
  while (result.length < targetChars) {
    result += LOREM[i % LOREM.length] + '\n\n';
    i++;
  }
  return result.slice(0, targetChars);
}

interface ModelProfile {
  maxInput?: number;
  maxOutput?: number;
  workingLimit?: number;
  probedAt?: number;
}

function loadCache(): Record<string, ModelProfile> {
  const cachePath = path.join(os.homedir(), '.trinno', 'model-profiles.json');
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, ModelProfile>): void {
  const cacheDir = path.join(os.homedir(), '.trinno');
  const cachePath = path.join(cacheDir, 'model-profiles.json');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function parseLimitFromError(error: string): number | null {
  const patterns = [
    /maximum\s+context\s+length\s+(?:is|of)\s+(\d+)/i,
    /maximum\s+allowed\s+(?:context\s+)?(?:length\s+)?(?:is|of)\s+(\d+)/i,
    /context\s+length\s+(?:is|of)\s+(\d+)/i,
    /limit\s+(?:is|of)\s+(\d+)/i,
    /cannot\s+exceed\s+(\d+)/i,
    /maximum\s+(?:is|:)\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = error.match(p);
    if (m) return parseInt(m[1]!, 10);
  }
  const numbers = error.match(/\b(\d{4,})\b/g)?.map(Number) ?? [];
  if (numbers.length >= 2) {
    return Math.min(...numbers);
  }
  return null;
}

async function runProbe(
  deps: any,
  model: string | undefined,
  baseUrl: string | undefined,
  apiKey: string | undefined,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  signal: AbortSignal,
  cancelOn?: { pong?: boolean; reasoning?: boolean; minTextChars?: number },
): Promise<{ ok: boolean; response: string; error: string; outputTokens: number; earlyCancelled: boolean }> {
  initAgentFactory(deps.brain, { defaultTools: deps.tools ?? [] });
  const factory = getAgentFactory();
  const builder = factory.create({
    name: 'ping-probe',
    systemPrompt,
    temperature: 0,
    maxTokens,
    timeoutSecs: 120,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
  const started = await builder.start();
  return new Promise((resolve) => {
    const parts: string[] = [];
    let resolved = false;
    const finish = (ok: boolean, error: string, outputTokens: number, earlyCancelled = false) => {
      if (resolved) return;
      resolved = true;
      started.close().catch(() => {});
      resolve({ ok, response: parts.join(''), error, outputTokens, earlyCancelled });
    };
    try {
      started.stream(userMessage, (token: any) => {
        if (signal.aborted) { finish(false, 'cancelled', 0); return; }
        if (token.type === 'Text') {
          parts.push(token.text);
          const all = parts.join('');
          if (cancelOn?.pong && all.trim() === 'PONG') { finish(true, '', 0, true); return; }
          if (cancelOn?.minTextChars && all.length >= cancelOn.minTextChars) { finish(true, '', 0, true); return; }
        } else if (token.type === 'ReasoningContent') {
          if (cancelOn?.reasoning) { finish(true, '', 0, true); return; }
        } else if (token.type === 'Error') {
          finish(false, token.error || token.text || '', 0);
        } else if (token.type === 'Done') {
          const metrics = started.metrics;
          const ot = metrics?.totalOutputTokens ?? 0;
          finish(true, '', ot);
        }
      });
    } catch (e) {
      finish(false, e instanceof Error ? e.message : String(e), 0);
    }
  });
}

async function probeHardLimit(
  deps: any,
  model: string | undefined,
  baseUrl: string | undefined,
  apiKey: string | undefined,
  emit: (type: string, data: any) => void,
  signal: AbortSignal,
  cachedMax?: number,
): Promise<number> {
  const SYSTEM = 'Respond with exactly "PONG" and nothing else.';
  const MAX_LIMIT = 2000000;

  const baseToken = (cachedMax && cachedMax > 0) ? Math.round(cachedMax * 0.9) : 64000;
  if (cachedMax && cachedMax > 0) {
    emit('token', { tokenType: 'Text', text: `  Cached limit: ${cachedMax.toLocaleString()} — verifying at ${Math.round(cachedMax * 0.9).toLocaleString()}...\n` });
  }

  let lastGood = 0;
  let lastBad = MAX_LIMIT;

  let probeTokens = baseToken;
  while (probeTokens < MAX_LIMIT) {
    emit('token', { tokenType: 'Text', text: `  Probing ${probeTokens.toLocaleString()} tokens... ` });

    const padding = generatePadding(probeTokens * CHARS_PER_TOKEN);
    const result = await runProbe(deps, model, baseUrl, apiKey, SYSTEM, padding, 10, signal, { pong: true });

    if (signal.aborted) {
      emit('token', { tokenType: 'Text', text: `cancelled\n` });
      return Math.max(lastGood, 4096);
    }

    if (result.ok) {
      lastGood = probeTokens;
      emit('token', { tokenType: 'Text', text: `success\n` });
      probeTokens = Math.round(probeTokens * 1.8);
    } else {
      emit('token', { tokenType: 'Text', text: `overflow\n` });
      if (result.error) {
        emit('token', { tokenType: 'Text', text: `  Error: ${result.error.slice(0, 250)}\n` });
      }
      const parsed = parseLimitFromError(result.error || '');
      if (parsed) {
        emit('token', { tokenType: 'Text', text: `  → Parsed limit: ${parsed.toLocaleString()} tokens\n` });
        return parsed;
      }
      lastBad = probeTokens;
      break;
    }
  }

  if (lastBad === MAX_LIMIT) {
    emit('token', { tokenType: 'Text', text: `  → Limit exceeds 2M tokens\n` });
    return lastGood;
  }

  if (lastGood === 0) {
    emit('token', { tokenType: 'Text', text: `  → Even ${baseToken.toLocaleString()} overflowed — limit is very low\n` });
    return baseToken;
  }

  emit('token', { tokenType: 'Text', text: `  Binary searching between ${lastGood.toLocaleString()} and ${lastBad.toLocaleString()}...\n` });

  while (lastBad - lastGood > 500) {
    const mid = Math.round((lastGood + lastBad) / 2);
    emit('token', { tokenType: 'Text', text: `  → ${mid.toLocaleString()}... ` });

    const padding = generatePadding(mid * CHARS_PER_TOKEN);
    const result = await runProbe(deps, model, baseUrl, apiKey, SYSTEM, padding, 10, signal, { pong: true });

    if (signal.aborted) return lastGood;

    if (result.ok) {
      lastGood = mid;
      emit('token', { tokenType: 'Text', text: `success\n` });
    } else {
      lastBad = mid;
      emit('token', { tokenType: 'Text', text: `overflow\n` });
      const parsed = parseLimitFromError(result.error || '');
      if (parsed) {
        emit('token', { tokenType: 'Text', text: `  → Parsed limit: ${parsed.toLocaleString()} tokens\n` });
        return parsed;
      }
    }
  }

  return lastGood;
}

async function probeWorkingLimit(
  deps: any,
  model: string | undefined,
  baseUrl: string | undefined,
  apiKey: string | undefined,
  hardLimit: number,
  emit: (type: string, data: any) => void,
  signal: AbortSignal,
): Promise<number> {
  const levels = [0.8, 0.7, 0.6, 0.5, 0.4];

  for (const fraction of levels) {
    const probeSize = Math.round(hardLimit * fraction);
    emit('token', { tokenType: 'Text', text: `  Probing quality at ${probeSize.toLocaleString()} tokens (${Math.round(fraction * 100)}%)... ` });

    const padding = generatePadding(probeSize * CHARS_PER_TOKEN);
    const question = '\n\nIgnore all the above text. Write a detailed analysis of the three main causes of the French Revolution, covering economic, social, and political factors with specific examples.';

    const result = await runProbe(
      deps, model, baseUrl, apiKey,
      'You are a helpful historian.',
      padding + question,
      2000,
      signal,
      { reasoning: true, minTextChars: 50 },
    );

    if (signal.aborted) return Math.round(hardLimit * 0.5);

    const responseTokens = result.outputTokens || Math.round(result.response.length / CHARS_PER_TOKEN);
    const pass = result.earlyCancelled || responseTokens >= 100;

    emit('token', { tokenType: 'Text', text: `${result.earlyCancelled ? 'early (model engaged)' : `response: ${responseTokens} tokens ${pass ? '✓' : '⚠'}`}\n` });

    if (pass) {
      emit('token', { tokenType: 'Text', text: `  → Reliable at ${Math.round(fraction * 100)}% of max context (${probeSize.toLocaleString()} tokens)\n` });
      return probeSize;
    }
  }

  emit('token', { tokenType: 'Text', text: `  → Quality degraded even at 40% — reporting 40% as minimum working limit\n` });
  return Math.round(hardLimit * 0.4);
}

export const pingCommand: SlashCommand = {
  name: 'ping',
  description: 'Probe LLM model token limits (context window, max output, working limit)',
  usage: '/ping',
  execute: async (args, deps, emit, signal) => {
    const modelConfig = (globalThis as any).__TRP_MODEL_CONFIG || {};
    const model: string | undefined = modelConfig.model;
    const baseUrl: string | undefined = modelConfig.baseUrl;
    const apiKey: string | undefined = modelConfig.apiKey;

    if (!model) {
      emit('token', { tokenType: 'Text', text: 'No model configured. Set a model in Trinno settings first.\n' });
      emit('done', {});
      return;
    }

    emit('token', { tokenType: 'Text', text: `## /ping: Probing ${model}\n\n` });
    emit('token', { tokenType: 'Text', text: `_This uses real API calls and consumes tokens from your account._\n\n` });
    emit('token', { tokenType: 'Text', text: `---\n\n` });

    const cache = loadCache();
    const cachedProfile = cache[model] || {};

    emit('token', { tokenType: 'Text', text: `### Phase 1: Hard Context Limit\n` });
    const maxInput = await probeHardLimit(deps, model, baseUrl, apiKey, emit, signal, cachedProfile.maxInput);
    if (signal.aborted) { emit('token', { tokenType: 'Text', text: `\n_Cancelled._\n` }); emit('done', {}); return; }

    emit('token', { tokenType: 'Text', text: `\n### Phase 2: Working Quality Limit\n` });
    const workingLimit = await probeWorkingLimit(deps, model, baseUrl, apiKey, maxInput, emit, signal);
    if (signal.aborted) { emit('done', {}); return; }

    const workingFraction = Math.round((workingLimit / maxInput) * 100);

    cache[model] = {
      maxInput,
      workingLimit,
      probedAt: Date.now(),
    };
    saveCache(cache);

    emit('token', { tokenType: 'Text', text: `\n---\n\n### Results for ${model}\n\n` });
    emit('token', {
      tokenType: 'Text',
      text: [
        `| Metric | Value |`,
        `|--------|-------|`,
        `| **Max Input Context** | ${maxInput.toLocaleString()} tokens |`,
        `| **Recommended Working** | ${workingLimit.toLocaleString()} tokens (${workingFraction}%) |`,
        ``,
        `_Profile cached to ~/.trinno/model-profiles.json_`,
        `_Run /ping again later to re-verify or probe a different model._`,
      ].join('\n'),
    });
    emit('done', {});
  },
};
