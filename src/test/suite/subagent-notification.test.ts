import * as assert from 'assert';
import { SubagentManager, SubagentNotification } from '../../bos/infrastructure/subagent-manager.js';

describe('Subagent notification pipeline', () => {

  it('drainNotifications returns empty array when no notifications', () => {
    const manager = new SubagentManager();
    const drained = manager.drainNotifications();
    assert.strictEqual(drained.length, 0);
  });

  it('drainNotifications returns all pending notifications', () => {
    const pending: SubagentNotification[] = [];
    const manager = new SubagentManager({ pendingNotificationsRef: pending });

    manager.drainNotifications(); // clears any startup noise
    pending.push({
      name: 'agent1',
      jobId: 'sa_001',
      skillName: 'find-skills',
      goal: 'find a skill for X',
      status: 'completed',
      output: 'Found skill Y',
      elapsedMs: 1500,
    });
    pending.push({
      name: 'agent2',
      jobId: 'sa_002',
      skillName: 'research',
      goal: 'research topic Z',
      status: 'failed',
      error: 'timeout',
      elapsedMs: 30000,
    });

    const drained = manager.drainNotifications();
    assert.strictEqual(drained.length, 2);
    assert.strictEqual(drained[0]!.name, 'agent1');
    assert.strictEqual(drained[0]!.jobId, 'sa_001');
    assert.strictEqual(drained[1]!.name, 'agent2');
    assert.strictEqual(drained[1]!.error, 'timeout');
  });

  it('drainNotifications clears the queue', () => {
    const pending: SubagentNotification[] = [];
    const manager = new SubagentManager({ pendingNotificationsRef: pending });
    manager.drainNotifications();
    pending.push({
      name: 'a', jobId: '1', skillName: 's', goal: 'g',
      status: 'completed', elapsedMs: 100,
    });

    manager.drainNotifications();
    const second = manager.drainNotifications();
    assert.strictEqual(second.length, 0);
  });

  it('notification contains all required fields', () => {
    const n: SubagentNotification = {
      name: 'helper',
      jobId: 'sa_123',
      skillName: 'find-skills',
      goal: 'search for testing skill',
      status: 'completed',
      elapsedMs: 2500,
    };

    assert.strictEqual(typeof n.name, 'string');
    assert.strictEqual(typeof n.jobId, 'string');
    assert.strictEqual(typeof n.skillName, 'string');
    assert.strictEqual(typeof n.goal, 'string');
    assert.strictEqual(typeof n.status, 'string');
    assert.strictEqual(typeof n.elapsedMs, 'number');
  });

  it('notification carries optional error and output', () => {
    const completed: SubagentNotification = {
      name: 'a', jobId: '1', skillName: 's', goal: 'g',
      status: 'completed', output: 'result text', elapsedMs: 100,
    };
    assert.strictEqual(completed.output, 'result text');
    assert.strictEqual(completed.error, undefined);

    const failed: SubagentNotification = {
      name: 'b', jobId: '2', skillName: 's', goal: 'g',
      status: 'failed', error: 'something broke', elapsedMs: 200,
    };
    assert.strictEqual(failed.error, 'something broke');
    assert.strictEqual(failed.output, undefined);
  });

  it('completed notification includes goal and skillName', () => {
    const pending: SubagentNotification[] = [];
    const manager = new SubagentManager({ pendingNotificationsRef: pending });
    manager.drainNotifications();

    pending.push({
      name: 'helper',
      jobId: 'sa_456',
      skillName: 'find-skills',
      goal: 'search for X',
      status: 'completed',
      output: 'Here is the result',
      elapsedMs: 3200,
    });

    const drained = manager.drainNotifications();
    assert.strictEqual(drained.length, 1);
    assert.strictEqual(drained[0]!.skillName, 'find-skills');
    assert.strictEqual(drained[0]!.goal, 'search for X');
    assert.strictEqual(drained[0]!.output, 'Here is the result');
  });

  it('failed notification includes error', () => {
    const pending: SubagentNotification[] = [];
    const manager = new SubagentManager({ pendingNotificationsRef: pending });
    manager.drainNotifications();

    pending.push({
      name: 'helper',
      jobId: 'sa_789',
      skillName: 'find-skills',
      goal: 'search',
      status: 'failed',
      error: 'subagent returned no output — model may have failed silently or skill instructions are incompatible',
      elapsedMs: 5000,
    });

    const drained = manager.drainNotifications();
    assert.strictEqual(drained[0]!.status, 'failed');
    assert.strictEqual(drained[0]!.error!.includes('no output'), true);
  });

  it('stop preserves accumulated output in notification', () => {
    const pending: SubagentNotification[] = [];
    const manager = new SubagentManager({ pendingNotificationsRef: pending });

    const subagents: Map<string, any> = (Reflect as any).get(manager, 'subagents');
    const outputs: Map<string, string> = (Reflect as any).get(manager, 'outputs');
    const aborts: Map<string, AbortController> = (Reflect as any).get(manager, 'abortControllers');

    const jobId = 'sa_stop_test';
    const abortCtrl = new AbortController();
    subagents.set(jobId, {
      jobId,
      name: 'tester',
      skillName: 'find-skills',
      goal: 'find skill',
      status: 'running',
      startedAt: Date.now() - 5000,
      elapsedMs: 0,
      output: '',
    });
    outputs.set(jobId, 'partial output accumulated during streaming');
    aborts.set(jobId, abortCtrl);

    manager.drainNotifications();
    const result = manager.stop(jobId);
    assert.strictEqual(result, true);

    // Notification from stop should be in pending
    const after = manager.drainNotifications();
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0]!.jobId, jobId);
    assert.strictEqual(after[0]!.status, 'cancelled');
    assert.strictEqual(after[0]!.output, 'partial output accumulated during streaming');
    assert.strictEqual(after[0]!.skillName, 'find-skills');
    assert.strictEqual(after[0]!.goal, 'find skill');
  });

  it('stop with no accumulated output still creates notification', () => {
    const pending: SubagentNotification[] = [];
    const manager = new SubagentManager({ pendingNotificationsRef: pending });

    const subagents: Map<string, any> = (Reflect as any).get(manager, 'subagents');
    const outputs: Map<string, string> = (Reflect as any).get(manager, 'outputs');
    const aborts: Map<string, AbortController> = (Reflect as any).get(manager, 'abortControllers');

    const jobId = 'sa_stop_empty';
    subagents.set(jobId, {
      jobId,
      name: 'tester',
      skillName: 'find-skills',
      goal: 'find',
      status: 'running',
      startedAt: Date.now() - 2000,
      elapsedMs: 0,
      output: '',
    });
    outputs.set(jobId, '');
    aborts.set(jobId, new AbortController());

    manager.drainNotifications();
    manager.stop(jobId);
    const drained = manager.drainNotifications();
    assert.strictEqual(drained.length, 1);
    assert.strictEqual(drained[0]!.output, '');
  });

  it('stop on non-running agent returns false', () => {
    const pending: SubagentNotification[] = [];
    const manager = new SubagentManager({ pendingNotificationsRef: pending });

    const subagents: Map<string, any> = (Reflect as any).get(manager, 'subagents');
    const jobId = 'sa_not_running';
    subagents.set(jobId, {
      jobId, name: 'x', skillName: 's', goal: 'g',
      status: 'completed', startedAt: Date.now(), elapsedMs: 100,
      output: 'done',
    });

    const result = manager.stop(jobId);
    assert.strictEqual(result, false);
  });
});
