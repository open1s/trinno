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
        const result = await loadRemoteSkill(workspaceRoot, name, registry);
        if (result.ok) {
          return ok({name, content: result.content, cacheDir: result.cacheDir});
        }
        const payload: Record<string, unknown> = {name, error: result.error || 'load failed'};
        if (result.cacheDir) payload.cacheDir = result.cacheDir;
        if (result.subdirs && result.subdirs.length > 0) {
          payload.subdirs = result.subdirs;
          payload.hint = 'These are subdirectories at the target path. The address is the parent folder of a SKILL.md file.';
        }
        return err(JSON.stringify(payload));
      } catch (e: any) {
        return err(e.message || String(e));
      }
    });

  return [findRemoteSkill, loadRemoteSkillTool];
}
