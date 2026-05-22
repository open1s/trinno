import { defineHook, HookEvent, HookDecision } from '@open1s/ezbos';
import { ToolPermissionConfig } from './toolPermissions.js';

let approvalCounter = 0;
let approvalPublisher: any = null;
let approvalSubscriber: any = null;
let busInitialized = false;

export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

const pendingApprovals = new Map<string, { resolve: (v: boolean) => void; timeout: NodeJS.Timeout; id: string; toolName: string }>();

let onEmit: ((type: string, data: any) => void) | null = null;

export function setApprovalEmitter(emitFn: (type: string, data: any) => void): void {
  onEmit = emitFn;
}

export async function initApprovalBus(brain: any): Promise<void> {
  if (busInitialized) return;

  const requestTopic = 'trinno:tool-approval:request';
  const responseTopic = 'trinno:tool-approval:response';

  approvalPublisher = await brain.publisher(requestTopic);
  approvalSubscriber = await brain.subscriber(responseTopic);

  approvalSubscriber.runJson(async (msg: any) => {
    if (msg.id && pendingApprovals.has(msg.id)) {
      const entry = pendingApprovals.get(msg.id)!;
      clearTimeout(entry.timeout);
      pendingApprovals.delete(msg.id);
      entry.resolve(msg.approved === true);
    }
  }).catch(() => {});

  busInitialized = true;
}

export function createToolPermissionHook(permissions: ToolPermissionConfig) {
  return defineHook(HookEvent.BeforeToolCall, async (ctx: any) => {
    const data = ctx.data || {};
    const toolName = data.tool_name || data.toolName || '';
    let perm = permissions[toolName];
    if (perm === undefined && toolName.includes('__')) {
      perm = 'ask';
    }

    if (perm === 'deny') {
      const rejectMsg = `Tool "${toolName}" is blocked by permission policy`;
      if (onEmit) {
        onEmit('error', { error: rejectMsg });
      } else {
        process.stderr.write(`[tool-permission] ${rejectMsg}\n`);
      }
      return HookDecision.Abort;
    }

    if (perm === 'ask') {
      if (!busInitialized || !approvalPublisher || !approvalSubscriber) {
        const rejectMsg = `Tool "${toolName}" blocked: approval bus not available`;
        if (onEmit) {
          onEmit('error', { error: rejectMsg });
        } else {
          process.stderr.write(`[tool-permission] ${rejectMsg}\n`);
        }
        return HookDecision.Abort;
      }

      const id = `approval_${++approvalCounter}`;
      const args = data.args || {};

      await approvalPublisher.json({ id, toolName, args, type: 'request' });

      const emit = onEmit || ((type: string, data: any) => {
        process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
      });
      emit('tool-approval-needed', { id, toolName, args });

      const approved = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          const entry = pendingApprovals.get(id);
          pendingApprovals.delete(id);
          entry?.resolve(false);
        }, APPROVAL_TIMEOUT_MS);
        pendingApprovals.set(id, { resolve, timeout, id, toolName });
      });

      return approved ? HookDecision.Continue : HookDecision.Abort;
    }

    return HookDecision.Continue;
  });
}

export function wrapAllTools(tools: any[], _permissions: ToolPermissionConfig): any[] {
  return tools;
}

export function cancelPendingApproval(id: string): void {
  const entry = pendingApprovals.get(id);
  if (entry) {
    clearTimeout(entry.timeout);
    pendingApprovals.delete(id);
    entry.resolve(false);
  }
}

export function cancelAllPendingApprovals(): void {
  for (const [id] of pendingApprovals) {
    cancelPendingApproval(id);
  }
}

export async function sendApprovalResponse(id: string, approved: boolean): Promise<void> {
  const entry = pendingApprovals.get(id);
  if (entry) {
    clearTimeout(entry.timeout);
    pendingApprovals.delete(id);
    entry.resolve(approved);
  }
  if (approvalPublisher) {
    await approvalPublisher.json({ id, approved, type: 'response' });
  }
}

export function getPendingApproval(): { id: string; toolName: string; args: Record<string, unknown> } | null {
  for (const [, entry] of pendingApprovals) {
    return { id: entry.id, toolName: entry.toolName, args: {} };
  }
  return null;
}