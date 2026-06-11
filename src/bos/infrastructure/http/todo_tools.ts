import { defineTool, ok } from '@open1s/ezbos';
import * as fs from 'fs';
import * as path from 'path';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

interface TodoStore {
  version: number;
  todos: TodoItem[];
  updatedAt: number;
}

const STORE_VERSION = 1;

function getTodoStorePath(baseDir: string): string {
  return path.join(baseDir, '.bos', 'memory', 'todo-store.json');
}

function loadTodos(baseDir: string): TodoStore {
  const filePath = getTodoStorePath(baseDir);
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.todos)) {
      return parsed as TodoStore;
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn('[todo] load error:', err?.message);
    }
  }
  return { version: STORE_VERSION, todos: [], updatedAt: 0 };
}

function saveTodos(baseDir: string, store: TodoStore): void {
  const dir = path.dirname(getTodoStorePath(baseDir));
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getTodoStorePath(baseDir);
  const tmpPath = filePath + '.tmp';
  store.updatedAt = Date.now();
  const data = JSON.stringify(store, null, 2);
  fs.writeFileSync(tmpPath, data, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function createTodoTools(workspaceRoot: string) {
  const validStatuses = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
  const validPriorities = new Set(['high', 'medium', 'low']);

  const todowrite = defineTool(
    'todowrite',
    'Create and maintain a structured task list for the current session. Persists to disk at .bos/memory/todo-store.json — todos survive session restarts. Tracks progress, organizes multi-step work. Use proactively for 3+ distinct steps, non-trivial multi-step tasks, or when user provides multiple tasks. Update status in real time: exactly one "in_progress" at a time, mark "completed" only after verification.',
  )
    .required('todos', 'array', 'Array of todo objects: { content: string, status: "pending"|"in_progress"|"completed"|"cancelled", priority: "high"|"medium"|"low" }. The full list replaces the current todos — include ALL todos (completed + pending + new), not just the ones you changed.')
    .handle((args: any) => {
      const todos: TodoItem[] = Array.isArray(args.todos) ? args.todos : [];
      const inProgressCount = todos.filter((t: TodoItem) => t?.status === 'in_progress').length;

      if (inProgressCount > 1) {
        return { ok: false, error: 'Only one todo can be in_progress at a time. Mark the current one completed first.' };
      }

      for (const t of todos) {
        if (!t || typeof t.content !== 'string' || !t.content.trim()) {
          return { ok: false, error: 'Each todo must have a non-empty "content" string.' };
        }
        if (!validStatuses.has(t.status)) {
          return { ok: false, error: `Invalid status "${t.status}". Use: pending, in_progress, completed, cancelled.` };
        }
        if (!validPriorities.has(t.priority)) {
          return { ok: false, error: `Invalid priority "${t.priority}". Use: high, medium, low.` };
        }
      }

      const store: TodoStore = { version: STORE_VERSION, todos, updatedAt: 0 };
      try {
        saveTodos(workspaceRoot, store);
      } catch (err) {
        return { ok: false, error: `Failed to save todos: ${err}` };
      }

      const completed = todos.filter(t => t.status === 'completed').length;
      const total = todos.length;
      return ok({ ok: true, count: total, completed, todos });
    });

  const todoread = defineTool(
    'todoread',
    'Read the current todo list from disk. Use this at the start of a session to restore state, or to check progress without modifying todos.',
  )
    .handle((_args: any) => {
      const store = loadTodos(workspaceRoot);
      return ok({ ok: true, count: store.todos.length, todos: store.todos, updatedAt: store.updatedAt });
    });

  return [todowrite, todoread];
}