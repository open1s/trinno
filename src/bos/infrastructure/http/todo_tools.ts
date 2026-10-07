import { defineTool, ok, err } from '@open1s/ezbos';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../logging/logger.js';

const log = createModuleLogger('todo-tools');

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
      log.warn({ err: err?.message }, 'todo load error');
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
  const todowrite = defineTool({
    name: 'todowrite',
    description:
      'Create and maintain a structured task list for the current session. Persists to disk at .bos/memory/todo-store.json — todos survive session restarts. Tracks progress, organizes multi-step work. Use proactively for 3+ distinct steps, non-trivial multi-step tasks, or when user provides multiple tasks. Update status in real time: exactly one "in_progress" at a time, mark "completed" only after verification.',
    parameters: z.object({
      todos: z
        .array(
          z
            .object({
              content: z.string().min(1),
              status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
              priority: z.enum(['high', 'medium', 'low']),
            })
            .loose(),
        )
        .describe(
          'Array of todo objects: { content: string, status: "pending"|"in_progress"|"completed"|"cancelled", priority: "high"|"medium"|"low" }. The full list replaces the current todos — include ALL todos (completed + pending + new), not just the ones you changed.',
        ),
    }),
    execute: ({ todos }) => {
      const inProgressCount = todos.filter(t => t.status === 'in_progress').length;
      if (inProgressCount > 1) {
        return err('Only one todo can be in_progress at a time. Mark the current one completed first.');
      }

      const store: TodoStore = { version: STORE_VERSION, todos: todos as TodoItem[], updatedAt: 0 };
      try {
        saveTodos(workspaceRoot, store);
      } catch (e) {
        return err(`Failed to save todos: ${e}`);
      }

      const completed = todos.filter(t => t.status === 'completed').length;
      return ok({ ok: true, count: todos.length, completed, todos });
    },
  });

  const todoread = defineTool({
    name: 'todoread',
    description:
      'Read the current todo list from disk. Use this at the start of a session to restore state, or to check progress without modifying todos.',
    parameters: z.object({}),
    execute: () => {
      const store = loadTodos(workspaceRoot);
      return ok({ ok: true, count: store.todos.length, todos: store.todos, updatedAt: store.updatedAt });
    },
  });

  return [todowrite, todoread];
}