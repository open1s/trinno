import { TrizDeps } from '../infrastructure/config/di.js';

export interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  execute: (args: string, deps: TrizDeps, emit: (type: string, data: any) => void, signal: AbortSignal) => Promise<void>;
}

export interface SlashCommandRegistry {
  commands: Map<string, SlashCommand>;
  register: (cmd: SlashCommand) => void;
  get: (name: string) => SlashCommand | undefined;
  list: () => SlashCommand[];
  match: (input: string) => { command: SlashCommand; args: string } | null;
}

export function createSlashCommandRegistry(): SlashCommandRegistry {
  const commands = new Map<string, SlashCommand>();

  return {
    commands,
    register(cmd: SlashCommand) {
      commands.set(cmd.name, cmd);
    },
    get(name: string) {
      return commands.get(name);
    },
    list() {
      return Array.from(commands.values());
    },
    match(input: string) {
      const trimmed = input.trim();
      if (!trimmed.startsWith('/')) return null;

      const parts = trimmed.split(/\s+/);
      const cmdName = parts[0].slice(1); // remove leading /
      const cmd = commands.get(cmdName);
      if (!cmd) return null;

      const args = parts.slice(1).join(' ');
      return { command: cmd, args };
    },
  };
}
