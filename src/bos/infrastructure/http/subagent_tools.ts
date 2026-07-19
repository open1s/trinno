import { defineTool, ok, err } from '@open1s/ezbos';
import { SubagentManager } from '../subagent-manager.js';

export function createSubagentTools(manager: SubagentManager) {
  const spawn = defineTool(
    'spawn_agent',
    'Spawn a background subagent with a skill.',
  )
    .required('name', 'string', 'Short display name')
    .required('skill_name', 'string', 'Skill name from ~/.bos/skills/')
    .required('goal', 'string', 'Task to complete')
    .param('timeout_seconds', 'number', 'between 600 and 3600', { min: 600, max: 3600 })
    .handle(async (args) => {
      const name = (args.name as string || '').trim();
      const skillName = (args.skill_name as string || '').trim();
      const goal = (args.goal as string || '').trim();
      if (!name) return err('name is required');
      if (!skillName) return err('skill_name is required');
      if (!goal) return err('goal is required');
      let timeout = args.timeout_seconds as number | undefined;
      if (timeout !== undefined) {
        if (timeout < 600) timeout = 600;
        if (timeout > 3600) timeout = 3600;
      }

      try {
        const result = await manager.spawn(name, skillName, goal, timeout);
        return ok({
          jobId: result.jobId,
          name: result.name,
          skillName: result.skillName,
          status: result.status,
          startedAt: result.startedAt,
          hint: `"${result.name}" started. Use list_agents or get_agent_result("${result.jobId}") to check.`,
        });
      } catch (e: unknown) {
        return err(e instanceof Error ? e.message : String(e));
      }
    });

  const list = defineTool(
    'list_agents',
    'List all subagents.',
  )
    .handle(() => {
      const agents = manager.list();
      return ok({
        count: agents.length,
        subagents: agents.map(a => ({
          jobId: a.jobId,
          name: a.name,
          skillName: a.skillName,
          status: a.status,
          elapsedMs: a.elapsedMs,
        })),
      });
    });

  const getResult = defineTool(
    'get_agent_result',
    'Get subagent output and status.',
  )
    .required('jobId', 'string', 'ID from spawn_agent')
    .handle((args) => {
      const result = manager.getResult(args.jobId as string);
      if (!result) {
        return err(`No subagent "${args.jobId}". Use list_agents.`);
      }
      return ok(result);
    });

  const stop = defineTool(
    'stop_subagent',
    'Cancel a running subagent.',
  )
    .required('jobId', 'string', 'ID from spawn_agent')
    .handle((args) => {
      const ok_result = manager.stop(args.jobId as string);
      if (!ok_result) {
        return err(`Not found or not running: "${args.jobId}". Use list_agents.`);
      }
      return ok({ jobId: args.jobId, status: 'cancelled' });
    });

  return [spawn, list, getResult, stop];
}
