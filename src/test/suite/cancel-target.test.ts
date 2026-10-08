import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isStaleCancel } from '../../bos/cancel_target.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Minimal 'vscode' surface for the modules chat/agent loads outside the host. */
const vscodeStub = {
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback, has: () => false, update: async () => undefined }),
    workspaceFolders: undefined,
    notebookDocuments: [],
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
  },
  window: {
    activeNotebookEditor: undefined,
    activeTextEditor: undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    createOutputChannel: () => ({ appendLine: () => undefined, append: () => undefined, show: () => undefined, dispose: () => undefined }),
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file', toString: () => p }) },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  NotebookCellKind: { Code: 1, Markup: 2 },
};

describe('Cancel targeting: superseded generations', () => {
  it('a cancel naming an older generation is stale', () => {
    assert.strictEqual(isStaleCancel('genA', 'genB'), true);
  });

  it('a cancel naming the current generation is not stale', () => {
    assert.strictEqual(isStaleCancel('genA', 'genA'), false);
  });

  it('a cancel without a target is never stale (legacy "stop whatever runs")', () => {
    assert.strictEqual(isStaleCancel(undefined, 'genA'), false);
    assert.strictEqual(isStaleCancel(null, 'genA'), false);
  });

  it('a cancel arriving when nothing is tracked is not stale', () => {
    assert.strictEqual(isStaleCancel('genA', null), false);
  });
});

/**
 * Transport-level proof of the queue force-execute path: a message that was
 * queued is forced to the LLM while an earlier turn is still streaming.
 *
 * Runs against the mock worker (dist/bos/mock-worker.js) whose cancel handling
 * mirrors the real worker's generation guard, and records what it received.
 */
describe('Force-execute transport (queued message forced to the LLM)', function () {
  this.timeout(30_000);

  let sendMessage: (...args: any[]) => Promise<void>;
  let cancelGeneration: (messageId?: string) => void;
  let killOrphanedWorkers: () => void;
  let logFile: string;

  const readLog = (): string => {
    try { return fs.readFileSync(logFile, 'utf-8'); } catch { return ''; }
  };

  let restoreLoad: (() => void) | null = null;

  before(function () {
    logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-force-')), 'worker.log');
    process.env.TRINNO_WORKER_PATH = path.resolve(__dirname, '..', '..', '..', 'dist', 'bos', 'mock-worker.js');
    process.env.TRINNO_MOCK_WORKER_LOG = logFile;
    // chat/agent pulls in chat/settings, which requires 'vscode' at load time.
    // This suite runs outside the extension host, so serve a minimal stub.
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function (request: string, parent: unknown, isMain: boolean) {
      if (request === 'vscode') return vscodeStub;
      return originalLoad.call(this, request, parent, isMain);
    };
    restoreLoad = () => { Module._load = originalLoad; };
    for (const modKey of Object.keys(require.cache)) {
      if (modKey.includes('chat/agent')) delete require.cache[modKey];
    }
    const agent = require('../../chat/agent');
    sendMessage = agent.sendMessage;
    cancelGeneration = agent.cancelGeneration;
    killOrphanedWorkers = agent.killOrphanedWorkers;
  });

  after(() => {
    delete process.env.TRINNO_WORKER_PATH;
    delete process.env.TRINNO_MOCK_WORKER_LOG;
    if (restoreLoad) restoreLoad();
  });

  it('cancel-then-send (the force path) delivers the forced message and aborts the old turn', async () => {
    killOrphanedWorkers();
    const eventsB: any[] = [];

    // Turn A is streaming (SLOW keeps it open so the force lands mid-turn).
    const doneA = new Promise<string>(res => {
      sendMessage('genA', 'SLOW: turn already streaming', () => {}, () => res('done'), (e: string) => res('error:' + e))
        .catch((e: Error) => res('rejected:' + e.message));
    });
    await sleep(150);

    // forceExecuteQueueItem(): stop the in-flight item, then dispatch the forced one.
    cancelGeneration('genA');
    const doneB = new Promise<string>(res => {
      sendMessage('genB', 'SLOW: the forced message', (m: any) => eventsB.push(m), () => res('done'), (e: string) => res('error:' + e))
        .catch((e: Error) => res('rejected:' + e.message));
    });

    assert.strictEqual(await doneB, 'done', 'the forced message must reach the worker and complete');
    const log = readLog();
    assert.ok(log.includes('chat genA'), 'turn A reached the worker:\n' + log);
    assert.ok(log.includes('chat genB'), 'the FORCED message reached the worker:\n' + log);
    assert.ok(log.includes('cancel genA current=genA stale=false'), 'the cancel targeted the in-flight turn:\n' + log);
    assert.ok(log.includes('aborted genA'), 'the superseded turn was actually aborted:\n' + log);
    assert.ok(
      eventsB.some((m: any) => m.type === 'token' && String(m.text ?? '').includes('msgId=genB')),
      'the forced turn produced its own tokens',
    );
    assert.ok(
      eventsB.every((m: any) => !String(m.text ?? '').includes('genA')),
      'no output from the superseded turn leaked into the forced turn',
    );
    void doneA;
  });

  it('a late cancel for a superseded turn does not touch the turn that replaced it', async () => {
    // Reuse the worker from the previous test: killing it here would race the
    // respawn and the first send could bail out before the worker reports ready.
    const before = readLog().length;

    // genC is a turn the PANEL still believes is current — it has already
    // finished here. genD is running when the stale cancel for genC arrives,
    // which is the click/stuck-UI ordering that used to tear down the new turn.
    const doneOld = new Promise<string>(res => {
      sendMessage('genC', 'a turn that already finished', () => {}, () => res('done'), (e: string) => res('error:' + e))
        .catch(() => res('rejected'));
    });
    assert.strictEqual(await doneOld, 'done');

    const eventsNew: any[] = [];
    const doneNew = new Promise<string>(res => {
      sendMessage('genD', 'SLOW: new turn', (m: any) => eventsNew.push(m), () => res('done'), (e: string) => res('error:' + e))
        .catch((e: Error) => res('rejected:' + e.message));
    });
    await sleep(100);
    cancelGeneration('genC');

    assert.strictEqual(await doneNew, 'done', 'the newer turn must survive a stale cancel');
    const log = readLog().slice(before);
    assert.ok(log.includes('chat genC') && log.includes('chat genD'), 'both turns reached the worker:\n' + log);
    assert.ok(!log.includes('cancel genC'), 'a stale cancel is never forwarded:\n' + log);
    assert.ok(!log.includes('aborted genD'), 'the newer turn was never aborted:\n' + log);
    assert.ok(eventsNew.length > 0, 'the newer turn produced output');
  });
});
