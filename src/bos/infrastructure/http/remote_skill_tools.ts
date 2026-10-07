import { defineTool, ok, err } from '@open1s/ezbos';
import { z } from 'zod';
import {
  loadRemoteSkill,
  searchRemoteSkills,
  loadRemoteSkillsFromBosConfig,
  buildRemoteSkillIndex,
  searchLocalSkills,
  loadLocalSkill,
} from '../remote_skills.js';

export function createRemoteSkillTools(workspaceRoot: string) {
  const findRemoteSkill = defineTool({
    name: 'find_skill',
    description:
      'Discover skills by keyword across both local skill directories and remote skill repos. Local: ~/.bos/skills/ and ~/.agents/skills/. Remote: cloned from bos.config.json: skills_registry.skills. Each result\'s "name" is the skill folder/file name — use load_offline_skill to load it. First remote call may clone repos (network); subsequent calls use cache.',
    parameters: z.object({
      query: z.string().describe('Search query — keywords or tags'),
      limit: z.number().optional().describe('Max hits to return (1-20, default 10)'),
    }),
    execute: async ({ query, limit: rawLimit }) => {
      try {
        const limit = Math.min(Math.max(rawLimit ?? 10, 1), 20);
        const localHits = searchLocalSkills(query, limit);
        const results: any[] = localHits.map(h => ({
          name: h.name,
          description: h.description,
          source: 'local',
          score: NaN,
          usage: `load_offline_skill("${h.name}")`,
        }));
        const registry = loadRemoteSkillsFromBosConfig();
        if (registry.length > 0) {
          const index = await buildRemoteSkillIndex(workspaceRoot, registry);
          const remoteHits = await searchRemoteSkills(query, index, limit);
          for (const h of remoteHits) {
            results.push({
              name: h.name,
              description: h.description,
              ...(h.ref !== undefined ? { ref: h.ref } : {}),
              ...(h.tags !== undefined ? { tags: h.tags } : {}),
              source: 'remote',
              score: h.score,
              usage: `load_offline_skill({ name: ${JSON.stringify(h.name)} })`,
            });
          }
        }
        return ok({
          query,
          count: results.length,
          results,
          hint: results.length === 0
            ? 'No skills found. Try different keywords, or check that skills are installed in ~/.bos/skills/ or configured in bos.config.json.'
            : undefined,
        });
      } catch (e: any) {
        return err(e.message || String(e));
      }
    },
  });
  const loadRemoteSkillTool = defineTool({
    name: 'load_offline_skill',
    description:
      'Load a skill by name. Tries local skill directories first (~/.bos/skills/, ~/.agents/skills/), then falls back to remote repos cloned from bos.config.json. Name is the skill folder/file name (e.g. "find-skills").',
    parameters: z.object({
      name: z.string().describe('Skill name (e.g. "find-skills", "paper-writer")'),
    }),
    execute: async ({ name }) => {
      try {
        const local = loadLocalSkill(name);
        if (local) {
          return ok({ name, filePath: local.filePath, source: 'local', content: local.content });
        }
        const registry = loadRemoteSkillsFromBosConfig();
        if (registry.length === 0) {
          return err(`Skill "${name}" not found locally and no remote skill registries configured. Check ~/.bos/skills/ or configure bos.config.json.`);
        }
        const result = await loadRemoteSkill(workspaceRoot, name, registry);
        if (result.ok) {
          return ok({
            name,
            filePath: result.filePath,
            cacheDir: result.cacheDir,
            source: 'remote',
            content: result.content,
          });
        }
        let msg = `Cannot load skill "${name}": ${result.error || 'load failed'}`;
        if (result.cacheDir) msg += ` (cached at ${result.cacheDir})`;
        if (result.subdirs && result.subdirs.length > 0) {
          msg += `. Subdirectories found: ${result.subdirs.slice(0, 10).join(', ')}. Use one of these as the address (e.g. "${name}/<subdir>").`;
        }
        return err(msg);
      } catch (e: any) {
        return err(e.message || String(e));
      }
    },
  });

  const loadBestRemoteSkill = defineTool({
    name: 'load_best_skill',
    description:
      'Find and load the best matching skill in one step. Searches local skill directories (~/.bos/skills/, ~/.agents/skills/) and remote repos, picks the highest-scoring match, returns its content. Use this instead of the two-step find → load process.',
    parameters: z.object({
      query: z.string().describe('Search keywords to find the most relevant skill'),
    }),
    execute: async ({ query }) => {
      try {
        if (!query || query.trim().length === 0) {
          return err('Query is required');
        }
        const localHits = searchLocalSkills(query, 1);
        if (localHits.length > 0) {
          const best = localHits[0]!;
          const local = loadLocalSkill(best.name);
          if (local) {
            return ok({
              found: true,
              name: best.name,
              description: best.description,
              source: 'local',
              filePath: local.filePath,
              content: local.content,
            });
          }
        }
        const registry = loadRemoteSkillsFromBosConfig();
        if (registry.length > 0) {
          const index = await buildRemoteSkillIndex(workspaceRoot, registry);
          const remoteHits = await searchRemoteSkills(query, index, 1);
          if (remoteHits.length > 0) {
            const best = remoteHits[0]!;
            const result = await loadRemoteSkill(workspaceRoot, best.name, registry);
            if (result.ok) {
              return ok({
                found: true,
                name: best.name,
                description: best.description,
                source: 'remote',
                score: best.score,
                filePath: result.filePath,
                cacheDir: result.cacheDir,
                content: result.content,
              });
            }
            return err(`Found remote skill "${best.name}" but failed to load: ${result.error || 'unknown error'}`);
          }
        }
        return ok({
          found: false,
          query,
          hint: `No skills found matching "${query}". Try different keywords, or use find_skill to browse.`,
        });
      } catch (e: any) {
        return err(e.message || String(e));
      }
    },
  });

  return [findRemoteSkill, loadRemoteSkillTool, loadBestRemoteSkill];
}

