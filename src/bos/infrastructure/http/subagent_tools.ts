import { defineTool, ok, err } from '@open1s/ezbos';
import { SubagentManager } from '../subagent-manager.js';

export function createSubagentTools(manager: SubagentManager) {
  const spawn = defineTool(
    'spawn_subagent',
    'Spawn a subagent to work on a task in the background. The subagent gets the full tool set and runs independently. It uses a skill as its system prompt. Monitor with list_subagents or get_subagent_result. Cancel with stop_subagent.',
  )
    .required('name', 'string', 'A short name for this subagent instance (used in status display)')
    .required('skill_name', 'string', 'Name of the skill to load as the subagent\'s system prompt (e.g. "research", "patent-writer"). Skills live in ~/.bos/skills/ or ~/.agents/skills/.')
    .required('goal', 'string', 'The task or objective for the subagent to accomplish')
    .param('timeout_seconds', 'number', 'Max runtime in seconds (default 300). The subagent is killed and marked failed if it exceeds this.')
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
          hint: `Subagent "${result.name}" started (${result.jobId}). Use list_subagents to check status, get_subagent_result("${result.jobId}") when done.`,
        });
      } catch (e: any) {
        return err(e.message || String(e));
      }
    });

  const list = defineTool(
    'list_subagents',
    'List all subagents and their status.',
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
    'Get the result of a completed subagent. Returns current output even if still running.',
  )
    .required('jobId', 'string', 'The job ID returned by spawn_subagent')
    .handle((args) => {
      const result = manager.getResult(args.jobId as string);
      if (!result) {
        return err(`No subagent found with jobId "${args.jobId}". Use list_subagents to see active subagents.`);
      }
      return ok(result);
    });

  const stop = defineTool(
    'stop_subagent',
    'Stop a running subagent. It will be marked as cancelled.',
  )
    .required('jobId', 'string', 'The job ID returned by spawn_subagent')
    .handle((args) => {
      const ok_result = manager.stop(args.jobId as string);
      if (!ok_result) {
        return err(`No running subagent found with jobId "${args.jobId}". Use list_subagents to see active subagents.`);
      }
      return ok({ jobId: args.jobId, status: 'cancelled' });
    });

  return [spawn, list, getResult, stop];
}
