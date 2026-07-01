import { defineTool, ok, err } from '@open1s/ezbos';
import {
  loadRemoteSkill,
  searchRemoteSkills,
  loadRemoteSkillsFromBosConfig,
  buildRemoteSkillIndex,
} from '../remote_skills.js';

export function createRemoteSkillTools(workspaceRoot: string) {
  const findRemoteSkill = defineTool(
    'find_remote_skill',
    'Discover remote skills by keyword. Clones and scans registered skill repos (from bos.config.json: skills_registry.skills) for SKILL.md files with frontmatter. Each result\'s "name" is the parent folder of a SKILL.md — use it with load_remote_skill to load the content. First call may clone repos (network); subsequent calls use cache.',
  )
    .required('query', 'string', 'Search query — keywords or tags')
    .param('limit', 'number', 'Max hits to return (1-20, default 10)')
    .handle(async (args) => {
      try {
        const limit = Math.min(Math.max(args.limit ?? 10, 1), 20);
        const registry = loadRemoteSkillsFromBosConfig();
        if (registry.length === 0) {
          return ok({
            query: args.query,
            count: 0,
            scannedRepos: 0,
            totalSkills: 0,
            results: [],
            hint: 'No remote skill registries configured (bos.config.json missing or empty). Use load_skill for local skills, or ask the user to configure remote skill repos.',
          });
        }
        const index = await buildRemoteSkillIndex(workspaceRoot, registry);
        const hits = await searchRemoteSkills(args.query as string, index, limit);
        return ok({
          query: args.query,
          count: hits.length,
          scannedRepos: registry.length,
          totalSkills: index.length,
          results: hits.map(h => ({
            name: h.name,
            description: h.description,
            ...(h.ref !== undefined ? { ref: h.ref } : {}),
            ...(h.tags !== undefined ? { tags: h.tags } : {}),
            score: h.score,
            usage: `load_remote_skill({ name: ${JSON.stringify(h.name)} })`,
          })),
        });
      } catch (e: any) {
        return err(e.message || String(e));
      }
    });

  const loadRemoteSkillTool = defineTool(
    'load_remote_skill',
    'Load a remote skill by address. Clones the parent repo (if not cached) and reads SKILL.md from the target folder. Address is the "name" field returned by find_remote_skill — either "repo-name" for root skills or "repo-name/sub/path" for sub-skills.',
  )
    .required('name', 'string', 'Skill address from find_remote_skill results (e.g. "repo-name" or "repo-name/sub-folder")')
    .handle(async (args) => {
      try {
        const name = args.name as string;
        const registry = loadRemoteSkillsFromBosConfig();
        if (registry.length === 0) {
          return err(`No remote skill registries configured. Cannot load "${name}". Ask the user to set up bos.config.json with skills_registry.skills, or use load_skill for local skills.`);
        }
        const result = await loadRemoteSkill(workspaceRoot, name, registry);
        if (result.ok) {
          return ok({
            name,
            filePath: result.filePath,
            cacheDir: result.cacheDir,
            content: result.content,
          });
        }
        let msg = `Cannot load skill "${name}": ${result.error || 'load failed'}`;
        if (result.cacheDir) msg += ` (cached at ${result.cacheDir})`;
        if (result.subdirs && result.subdirs.length > 0) {
          msg += `. Subdirectories found: ${result.subdirs.slice(0, 10).join(', ')}. The address must point to the parent folder of a SKILL.md file — use one of these subdirectory names as part of the address (e.g. "${name}/<subdir>").`;
        }
        return err(msg);
      } catch (e: any) {
        return err(e.message || String(e));
      }
    });

  const loadBestRemoteSkill = defineTool(
    'load_best_remote_skill',
    'Find and load the best matching remote skill in one step. Searches registered skill repos by keyword, picks the highest-scoring match, loads its SKILL.md content, and returns it. Use this when you want to get skill instructions directly — avoiding the two-step find → load process.',
  )
    .required('query', 'string', 'Search keywords to find the most relevant skill')
    .handle(async (args) => {
      try {
        const query = args.query as string;
        if (!query || query.trim().length === 0) {
          return err('Query is required');
        }
        const registry = loadRemoteSkillsFromBosConfig();
        if (registry.length === 0) {
          return err('No remote skill registries configured. Use load_skill for local skills, or ask the user to configure bos.config.json with skills_registry.skills.');
        }
        const index = await buildRemoteSkillIndex(workspaceRoot, registry);
        const hits = await searchRemoteSkills(query, index, 1);
        if (hits.length === 0) {
          return ok({
            found: false,
            query,
            hint: `No skills found matching "${query}". Try different keywords, or use find_remote_skill to browse available skills.`,
          });
        }
        const best = hits[0]!;
        const result = await loadRemoteSkill(workspaceRoot, best.name, registry);
        if (result.ok) {
          return ok({
            found: true,
            name: best.name,
            description: best.description,
            score: best.score,
            filePath: result.filePath,
            cacheDir: result.cacheDir,
            content: result.content,
          });
        }
        return err(`Found skill "${best.name}" but failed to load: ${result.error || 'unknown error'}`);
      } catch (e: any) {
        return err(e.message || String(e));
      }
    });

  return [findRemoteSkill, loadRemoteSkillTool, loadBestRemoteSkill];
}
