import { defineTool, ok, err } from '@open1s/ezbos';
import { SubagentManager } from '../subagent-manager.js';

export function createSubagentTools(manager: SubagentManager) {
  const spawn = defineTool(
    'spawn_subagent',
    'Spawn a background subagent with a skill. Use list_subagents / get_subagent_result / stop_subagent to manage.',
  )
    .required('name', 'string', 'Short display name')
    .required('skill_name', 'string', 'Skill name from ~/.bos/skills/')
    .required('goal', 'string', 'Task to complete')
    .param('timeout_seconds', 'number', 'Max seconds (default 300)')
    .handle(async (args) => {
      try {
        const result = await manager.spawn(
          args.name as string,
          args.skill_name as string,
          args.goal as string,
          args.timeout_seconds as number | undefined,
        );
        return ok({
          jobId: result.jobId,
          name: result.name,
          skillName: result.skillName,
          status: result.status,
          startedAt: result.startedAt,
          hint: `"${result.name}" started. Use list_subagents or get_subagent_result("${result.jobId}") to check.`,
        });
      } catch (e: any) {
        return err(e.message || String(e));
      }
    });

  const list = defineTool(
    'list_subagents',
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
    'get_subagent_result',
    'Get subagent output and status (works for running too).',
  )
    .required('jobId', 'string', 'ID from spawn_subagent')
    .handle((args) => {
      const result = manager.getResult(args.jobId as string);
      if (!result) {
        return err(`No subagent "${args.jobId}". Use list_subagents.`);
      }
      return ok(result);
    });

  const stop = defineTool(
    'stop_subagent',
    'Cancel a running subagent.',
  )
    .required('jobId', 'string', 'ID from spawn_subagent')
    .handle((args) => {
      const ok_result = manager.stop(args.jobId as string);
      if (!ok_result) {
        return err(`Not found or not running: "${args.jobId}". Use list_subagents.`);
      }
      return ok({ jobId: args.jobId, status: 'cancelled' });
    });

  return [spawn, list, getResult, stop];
}
