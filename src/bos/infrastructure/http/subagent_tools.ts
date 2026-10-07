import { defineTool, ok, err } from '@open1s/ezbos';
import { z } from 'zod';
import { SubagentManager } from '../subagent-manager.js';

export function createSubagentTools(manager: SubagentManager) {
  const spawn = defineTool({
    name: 'spawn_agent',
    description: 'Spawn a background subagent with a skill.',
    parameters: z.object({
      name: z.string().describe('Short display name'),
      skill_name: z.string().describe('Skill name from ~/.bos/skills/'),
      goal: z.string().describe('Task to complete'),
      timeout_seconds: z.number().optional().describe('between 600 and 3600 (clamped into this range)'),
    }),
    execute: async ({ name: rawName, skill_name: rawSkillName, goal: rawGoal, timeout_seconds }) => {
      const name = (rawName || '').trim();
      const skillName = (rawSkillName || '').trim();
      const goal = (rawGoal || '').trim();
      if (!name) return err('name is required');
      if (!skillName) return err('skill_name is required');
      if (!goal) return err('goal is required');
      let timeout = timeout_seconds;
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
    },
  });

  const list = defineTool({
    name: 'list_agents',
    description: 'List all subagents.',
    parameters: z.object({}),
    execute: () => {
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
    },
  });

  const getResult = defineTool({
    name: 'get_agent_result',
    description: 'Get subagent output and status.',
    parameters: z.object({
      jobId: z.string().describe('ID from spawn_agent'),
    }),
    execute: ({ jobId }) => {
      const result = manager.getResult(jobId);
      if (!result) {
        return err(`No subagent "${jobId}". Use list_agents.`);
      }
      return ok(result);
    },
  });

  const stop = defineTool({
    name: 'stop_subagent',
    description: 'Cancel a running subagent.',
    parameters: z.object({
      jobId: z.string().describe('ID from spawn_agent'),
    }),
    execute: ({ jobId }) => {
      const ok_result = manager.stop(jobId);
      if (!ok_result) {
        return err(`Not found or not running: "${jobId}". Use list_agents.`);
      }
      return ok({ jobId, status: 'cancelled' });
    },
  });

  return [spawn, list, getResult, stop];
}
