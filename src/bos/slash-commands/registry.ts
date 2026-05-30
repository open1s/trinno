import { TrizDeps } from '../infrastructure/config/di.js';

export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  execute: (args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) => Promise<void>;
}

export interface SlashCommandRegistry {
  commands: Map<string, SlashCommand>;
  aliases: Map<string, string>;
  register: (cmd: SlashCommand, aliases?: string[]) => void;
  get: (name: string) => SlashCommand | undefined;
  list: () => SlashCommand[];
  match: (input: string) => { command: SlashCommand; args: string } | null;
  suggest: (input: string, max?: number) => string[];
}

function parseArgs(raw: string): string {
  if (!raw) return '';
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return tokens.join(' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function createSlashCommandRegistry(): SlashCommandRegistry {
  const commands = new Map<string, SlashCommand>();
  const aliases = new Map<string, string>();

  function resolve(name: string): SlashCommand | undefined {
    const key = name.toLowerCase();
    const direct = commands.get(key);
    if (direct) return direct;
    const aliased = aliases.get(key);
    return aliased ? commands.get(aliased) : undefined;
  }

  return {
    commands,
    aliases,
    register(cmd, extraAliases) {
      const key = cmd.name.toLowerCase();
      if (commands.has(key)) {
        console.warn(`[slash-registry] duplicate command registration: /${cmd.name}`);
      }
      commands.set(key, cmd);
      if (extraAliases) {
        for (const a of extraAliases) {
          const aliasKey = a.toLowerCase();
          if (aliases.has(aliasKey)) {
            console.warn(`[slash-registry] duplicate alias registration: /${a}`);
            continue;
          }
          aliases.set(aliasKey, key);
        }
      }
    },
    get(name) {
      return resolve(name);
    },
    list() {
      return Array.from(commands.values());
    },
    match(input) {
      const trimmed = input.trim();
      if (!trimmed.startsWith('/')) return null;

      const spaceIdx = trimmed.indexOf(' ');
      const cmdToken = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).slice(1);
      const rawArgs = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

      const cmd = resolve(cmdToken);
      if (!cmd) return null;

      return { command: cmd, args: parseArgs(rawArgs) };
    },
    suggest(input, max = 3) {
      const trimmed = input.trim();
      if (!trimmed.startsWith('/')) return [];
      const cmdToken = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
      if (!cmdToken) return [];
      const candidates: string[] = [];
      for (const c of commands.keys()) candidates.push(c);
      for (const a of aliases.keys()) candidates.push(a);

      const ranked = candidates
        .map(name => {
          const dist = levenshtein(cmdToken, name);
          const startsWith = name.startsWith(cmdToken) ? -1 : 0;
          return { name, score: dist + startsWith };
        })
        .filter(c => c.score <= Math.max(2, Math.floor(cmdToken.length / 3)))
        .sort((a, b) => a.score - b.score)
        .slice(0, max)
        .map(c => c.name);
      return Array.from(new Set(ranked));
    },
  };
}

