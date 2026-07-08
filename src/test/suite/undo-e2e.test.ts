import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn, ChildProcess, execSync } from 'child_process';
import { createModuleLogger } from '../../bos/infrastructure/logging/logger';

const log = createModuleLogger('test-undo-e2e');

describe('E2E: /undo Slash Command', function () {
  let worker: ChildProcess | null = null;
  let testDir: string;
  let jobId = 0;

  function sendMessage(msg: any): Promise<any[]> {
    return new Promise((resolve) => {
      const messages: any[] = [];
      const timeout = setTimeout(() => resolve(messages), 90000);

      function onData(chunk: Buffer) {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            messages.push(parsed);
            if (parsed.type === 'done' || parsed.type === 'error') {
              clearTimeout(timeout);
              worker?.stdout?.removeListener('data', onData);
              resolve(messages);
            }
          } catch {
            /* ignore non-JSON lines */
          }
        }
      }

      worker?.stdout?.on('data', onData);
      worker?.stdin?.write(JSON.stringify(msg) + '\n');
    });
  }

  function waitForReady(): Promise<void> {
    return new Promise((resolve) => {
      worker?.stdout?.once('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes('"type":"ready"')) {
          resolve();
        } else {
          worker?.stdout?.once('data', () => resolve());
        }
      });
    });
  }

  before(async function () {
    this.timeout(30000);

    // Check if jj is available
    try {
      execSync('jj --version', { stdio: 'pipe' });
    } catch {
      log.warn('jj not installed — skipping /undo e2e tests');
      this.skip();
      return;
    }

    // Create temp dir with jj repo
    testDir = path.join(os.tmpdir(), 'trinno-undo-e2e-' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });

    execSync('jj git init', { cwd: testDir, stdio: 'pipe' });

    // Baseline file in the initial change
    fs.writeFileSync(path.join(testDir, 'baseline.txt'), 'baseline');
    execSync('jj describe -m "baseline"', { cwd: testDir, stdio: 'pipe' });

    const projectRoot = path.resolve(__dirname, '..', '..', '..');
    worker = spawn('npx', ['tsx', 'src/bos/worker.ts'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectRoot,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    worker.stderr?.on('data', (chunk: Buffer) => {
      log.warn({ stderr: chunk.toString() }, 'worker stderr');
    });

    await waitForReady();
  });

  after(async () => {
    if (worker) worker.kill();
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('/undo abandons @ and reverts files from the last prompt', async function () {
    this.timeout(180000);

    // Send /init as a slash command — this triggers takeSnapshot (jj new) then /init creates phase dirs
    jobId++;
    const initResult = await sendMessage({
      type: 'slash',
      text: '/init',
      workspaceRoot: testDir,
    });

    const initError = initResult.find(m => m.type === 'error');
    if (initError) {
      log.warn({ error: initError.error }, '/init warned but snapshot was already taken — undo should still work');
    }

    const phaseDirsCreated = fs.existsSync(path.join(testDir, '01_Discover'));

    // Send /undo
    jobId++;
    const undoResult = await sendMessage({
      type: 'slash',
      text: '/undo',
      workspaceRoot: testDir,
    });

    const undoError = undoResult.find(m => m.type === 'error');
    assert.ok(!undoError, `/undo should succeed, got: ${undoError?.error ?? 'none'}`);

    const textTokens = undoResult
      .filter(m => m.type === 'token' && m.tokenType === 'Text')
      .map(m => m.text)
      .join('');

    assert.ok(
      textTokens.includes('Undone'),
      `Undo output should mention "Undone", got: ${JSON.stringify(textTokens.slice(0, 200))}`,
    );

    // If /init created phase dirs, verify /undo reverted them
    if (phaseDirsCreated) {
      assert.ok(
        !fs.existsSync(path.join(testDir, '01_Discover')),
        '01_Discover should be gone after /undo (jj abandon @ reverted the change)',
      );
    }

    // Baseline file must never be touched by undo
    assert.ok(
      fs.existsSync(path.join(testDir, 'baseline.txt')),
      'baseline.txt must still exist after /undo',
    );
  });

  it('/undo says nothing to undo when no snapshot was taken', async function () {
    this.timeout(30000);

    jobId++;
    const result = await sendMessage({
      type: 'slash',
      text: '/undo',
      workspaceRoot: testDir,
    });

    const textTokens = result
      .filter(m => m.type === 'token' && m.tokenType === 'Text')
      .map(m => m.text)
      .join('');

    assert.ok(
      textTokens.includes('Nothing to undo'),
      `No-snapshot undo should say "Nothing to undo", got: ${JSON.stringify(textTokens.slice(0, 200))}`,
    );
  });

  it('chains multiple undos to walk back through AI prompt history', async function () {
    this.timeout(180000);

    // Prompt 1: /init creates phase dirs
    jobId++;
    await sendMessage({ type: 'slash', text: '/init', workspaceRoot: testDir });

    const dirsExist1 = fs.existsSync(path.join(testDir, '01_Discover'));
    assert.ok(dirsExist1, '/init should create phase dirs');

    // Prompt 2: /ping (triggers takeSnapshot, adds an AI commit on top)
    jobId++;
    await sendMessage({ type: 'slash', text: '/ping', workspaceRoot: testDir });

    // Undo 1: removes the /ping snapshot (empty commit)
    jobId++;
    const undo1 = await sendMessage({ type: 'slash', text: '/undo', workspaceRoot: testDir });
    const text1 = undo1.filter(m => m.type === 'token' && m.tokenType === 'Text').map(m => m.text).join('');
    assert.ok(text1.includes('Undone'), `Undo 1 should succeed, got: ${JSON.stringify(text1.slice(0, 200))}`);

    // Phase dirs from /init must still exist
    assert.ok(fs.existsSync(path.join(testDir, '01_Discover')), 'Phase dirs should survive undo 1');

    // Undo 2: removes the /init snapshot (phase dirs gone)
    jobId++;
    const undo2 = await sendMessage({ type: 'slash', text: '/undo', workspaceRoot: testDir });
    const text2 = undo2.filter(m => m.type === 'token' && m.tokenType === 'Text').map(m => m.text).join('');
    assert.ok(text2.includes('Undone'), `Undo 2 should succeed, got: ${JSON.stringify(text2.slice(0, 200))}`);

    // Phase dirs must be gone now
    assert.ok(!fs.existsSync(path.join(testDir, '01_Discover')), 'Phase dirs should be gone after undo 2');

    // Undo 3: nothing left
    jobId++;
    const undo3 = await sendMessage({ type: 'slash', text: '/undo', workspaceRoot: testDir });
    const text3 = undo3.filter(m => m.type === 'token' && m.tokenType === 'Text').map(m => m.text).join('');
    assert.ok(text3.includes('Nothing to undo'), `Undo 3 should say nothing, got: ${JSON.stringify(text3.slice(0, 200))}`);

    // Baseline untouched
    assert.ok(fs.existsSync(path.join(testDir, 'baseline.txt')), 'baseline.txt must survive all undos');
  });
});
