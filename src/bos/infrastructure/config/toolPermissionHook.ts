import { defineHook, HookEvent, HookDecision } from '@open1s/ezbos';
import * as fs from 'fs';
import * as path from 'path';
import { ToolPermissionConfig, getToolMetadata, getBashIntent } from './toolPermissions.js';
import { createModuleLogger } from '../logging/logger.js';

const log = createModuleLogger('tool-permission');

let approvalCounter = 0;
let approvalPublisher: any = null;
let approvalSubscriber: any = null;
let busInitialized = false;

const pendingApprovals = new Map<string, { resolve: (v: boolean) => void; timeout?: NodeJS.Timeout; id: string; toolName: string }>();
const rememberedApprovals = new Set<string>();

function wsToolKey(toolName: string): string {
  const ws = (globalThis as any).__TRP_WORKSPACE_ROOT || '';
  return `${ws}::${toolName}`;
}

const HIDDEN_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'load_skill',
  'list_dir', 'grep_search', 'glob_files', 'ast_grep', 'ast_edit', 'apply_patch',
  'todoread','todowrite', 'memory_search', 'memory_store',
]);

let onEmit: ((type: string, data: any) => void) | null = null;

function shouldEmitTool(name: string, context: 'call' | 'result'): boolean {
  return !HIDDEN_TOOLS.has(name.trim());
}

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

function tryParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

export function createToolPermissionHook(permissions: ToolPermissionConfig) {
  const beforeHook = defineHook(HookEvent.BeforeToolCall, async (ctx: any) => {
    const data = ctx.data || {};
    const toolName = data.tool_name || data.toolName || '';
    let perm = permissions[toolName];
    if (perm === undefined && toolName.includes('__')) {
      perm = 'ask';
    }

    if (perm === 'deny') {
      const rejectMsg = `PERMISSION_DENIED: Tool "${toolName}" is blocked by permission policy`;
      if (onEmit) {
        onEmit('error', { error: rejectMsg });
        onEmit('token', { tokenType: 'ToolResult', text: rejectMsg, toolId: 'denied', status: 'error' });
      } else {
        log.warn({ toolName }, 'PERMISSION_DENIED');
      }
      return HookDecision.Abort;
    }

    if (perm === 'ask') {
      // Skip dialog if remembered for this project
      if (rememberedApprovals.has(wsToolKey(toolName))) {
        log.trace({ toolName }, 'remembered approval, auto-approving');
        return HookDecision.Continue;
      }

      log.trace({ toolName, busInitialized, hasPublisher: !!approvalPublisher, hasSubscriber: !!approvalSubscriber }, 'beforeHook: ask permission');
      if (!busInitialized || !approvalPublisher || !approvalSubscriber) {
        const rejectMsg = `Tool "${toolName}" blocked: approval bus not available`;
        if (onEmit) {
          onEmit('error', { error: rejectMsg });
        } else {
          log.warn({ toolName }, 'approval bus not available');
        }
        return HookDecision.Abort;
      }

      const originalId = data.tool_id || data.toolId || '';
      const id = originalId || `approval_${++approvalCounter}`;
      log.trace({ toolName, id, originalId }, 'tool-call (ask)');

      const rawArgs = data.tool_args || data.args || data.command || data.cmd || '';
      const args = typeof rawArgs === 'string' ? tryParseJson(rawArgs) : rawArgs;
      const metadata = getToolMetadata(toolName);
      const bashIntent = toolName === 'bash' ? getBashIntent(args) : null;

      if (onEmit) {
        onEmit('token', { tokenType: 'ToolCall', text: toolName, toolId: id, args });
      }

      await approvalPublisher.json({ id, toolName, args, metadata, bashIntent, type: 'request' });

      const emit = onEmit || ((type: string, data: any) => {
        process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
      });
      emit('tool-approval-needed', { id, toolName, args, metadata, bashIntent });

      log.trace({ id, toolName, pendingCount: pendingApprovals.size }, 'waiting for approval');
      const approved = await new Promise<boolean>((resolve) => {
        pendingApprovals.set(id, { resolve, timeout: undefined as unknown as NodeJS.Timeout, id, toolName });
      });
      log.trace({ id, approved }, 'got approval result');

      return approved ? HookDecision.Continue : HookDecision.Abort;
    }

const id = `auto_${++approvalCounter}`;
  log.trace({ toolName, id }, 'tool-call (auto)');
  ctx.data.toolId = id;
  const rawArgs2 = data.tool_args || data.args || data.command || data.cmd || '';
  const autoArgs = typeof rawArgs2 === 'string' ? tryParseJson(rawArgs2) : rawArgs2;
  if (onEmit && shouldEmitTool(toolName, 'call')) {
      onEmit('token', { tokenType: 'ToolCall', text: toolName, toolId: id, args: autoArgs });
    }

    return HookDecision.Continue;
  });

  const afterHook = defineHook(HookEvent.AfterToolCall, async (ctx: any) => {
    const data = ctx.data || {};
    const toolName = data.tool_name || data.toolName || '';
    const toolId = data.tool_id || data.toolId || '';
    const result = data.result;
    const error = data.error;

    let resultText = '';
    let isError = false;

    if (error) {
      resultText = typeof error === 'string' ? error : JSON.stringify(error);
      isError = true;
    } else if (result !== undefined && result !== null) {
      if (typeof result === 'object' && 'ok' in result) {
        const okVal = result.ok;
        if (typeof okVal === 'string') {
          resultText = okVal;
        } else if (okVal && typeof okVal === 'object' && typeof okVal.stdout === 'string') {
          resultText = okVal.stderr ? `${okVal.stdout}${okVal.stderr}` : okVal.stdout;
          if (typeof okVal.exitCode === 'number' && okVal.exitCode !== 0) {
            isError = true;
            if (okVal.stderr) resultText = `${resultText}\n[exit ${okVal.exitCode}]`;
          }
        } else {
          resultText = JSON.stringify(okVal);
        }
      } else if (typeof result === 'object' && 'err' in result) {
        resultText = typeof result.err === 'string' ? result.err : JSON.stringify(result.err);
        isError = true;
      } else {
        resultText = typeof result === 'string' ? result : JSON.stringify(result);
      }
    }

    if (onEmit && shouldEmitTool(toolName, 'result')) {
      onEmit('token', {
        tokenType: 'ToolResult',
        text: resultText,
        toolId,
        status: isError ? 'error' : 'completed',
      });
    }

    if (toolName === 'todowrite' && onEmit) {
      try {
        const wsRoot = (globalThis as any).__TRP_WORKSPACE_ROOT || process.cwd();
        const todoPath = path.join(wsRoot, '.bos', 'memory', 'todo-store.json');
        const todoContent = fs.readFileSync(todoPath, 'utf-8');
        const parsed = JSON.parse(todoContent);
        const todos = parsed && typeof parsed === 'object' && Array.isArray(parsed.todos) ? parsed.todos : [];
        onEmit('todo-update', { todos });
      } catch {
        onEmit('todo-update', { todos: [] });
      }
    }

    return '';
  });

  return { beforeHook, afterHook };
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

export async function sendApprovalResponse(id: string, approved: boolean, remember?: boolean): Promise<void> {
  log.trace({ id, approved, remember }, 'sendApprovalResponse called');
  const entry = pendingApprovals.get(id);
  if (entry) {
    log.trace({ id, approved }, 'found pending entry, resolving');
    clearTimeout(entry.timeout);
    pendingApprovals.delete(id);
    entry.resolve(approved);
    if (approved && remember) {
      rememberedApprovals.add(wsToolKey(entry.toolName));
      log.trace({ toolName: entry.toolName }, 'remembered for this workspace');
    }
  } else {
    log.warn({ id, pendingCount: pendingApprovals.size }, 'NO pending entry found');
  }
  if (approvalPublisher) {
    log.trace('publishing response to bus');
    await approvalPublisher.json({ id, approved, type: 'response' });
    log.trace('published');
  } else {
    log.warn({ id }, 'NO approvalPublisher available');
  }
}

export function getPendingApproval(): { id: string; toolName: string; args: Record<string, unknown> } | null {
  for (const [, entry] of pendingApprovals) {
    return { id: entry.id, toolName: entry.toolName, args: {} };
  }
  return null;
}