import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { createModuleLogger } from '../../bos/infrastructure/logging/logger';

const log = createModuleLogger('test-workspace-root');

suite('Workspace Root Flow', () => {
  let worker: ChildProcess | null = null;
  let jobId = 0;

  function sendMessage(msg: any): Promise<any[]> {
    return new Promise((resolve) => {
      const messages: any[] = [];
      const timeout = setTimeout(() => resolve(messages), 30000);

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
          } catch { /* ignore non-JSON lines */ }
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

  suiteSetup(async function () {
    this.timeout(30000);
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

  suiteTeardown(async () => {
    if (worker) {
      worker.kill();
    }
  });

  test('/trp init --fast creates project files under workspaceRoot from message', async function () {
    this.timeout(60000);
    const testDir = path.join(os.tmpdir(), 'trinno-workspace-root-' + Date.now());

    // Send a regular message that also sets workspaceRoot for subsequent commands
    jobId++;
    await sendMessage({
      type: 'chat',
      text: 'Hello',
      workspaceRoot: testDir,
    });

    // Verify the global was set by checking /trp init --fast output
    jobId++;
    const slashResult = await sendMessage({
      type: 'chat',
      text: '/trp init --fast test research topic',
    });

    const errorMsg = slashResult.find(m => m.type === 'error');
    if (errorMsg) {
      log.warn({ error: errorMsg.error }, 'slash error');
    }

    // Check files were created under the custom workspaceRoot
    const readmePath = path.join(testDir, 'README.md');
    const surveyDir = path.join(testDir, '01_Survey');
    assert.ok(fs.existsSync(readmePath), `README.md should exist at ${readmePath}`);
    assert.ok(fs.existsSync(surveyDir), `01_Survey dir should exist at ${surveyDir}`);

    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('/trp init output references custom workspaceRoot', async function () {
    this.timeout(30000);
    const testDir = path.join(os.tmpdir(), 'trinno-workspace-root-out-' + Date.now());

    jobId++;
    await sendMessage({
      type: 'chat',
      text: 'Hello',
      workspaceRoot: testDir,
    });

    jobId++;
    const slashResult = await sendMessage({
      type: 'chat',
      text: '/trp init --fast my-project test topic',
    });

    const textTokens = slashResult
      .filter(m => m.type === 'token' && m.tokenType === 'Text')
      .map(m => m.text)
      .join('');

    // The output should mention the custom root dir basename (the temp dir name)
    const dirName = path.basename(testDir);
    assert.ok(
      textTokens.includes(dirName),
      `Output should reference custom root dir name "${dirName}", got: ${textTokens.slice(0, 200)}`
    );

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('/trp status uses workspaceRoot from initial message', async function () {
    this.timeout(30000);
    const testDir = path.join(os.tmpdir(), 'trinno-workspace-root-st-' + Date.now());

    jobId++;
    await sendMessage({
      type: 'chat',
      text: 'Hello',
      workspaceRoot: testDir,
    });

    // Initialize a project
    jobId++;
    await sendMessage({
      type: 'chat',
      text: '/trp init --fast test-project topic',
    });

    // Now check status
    jobId++;
    const statusResult = await sendMessage({
      type: 'chat',
      text: '/trp status',
    });

    const statusText = statusResult
      .filter(m => m.type === 'token' && m.tokenType === 'Text')
      .map(m => m.text)
      .join('');

    const dirName = path.basename(testDir);
    assert.ok(
      statusText.includes(dirName),
      `Status should reference project root "${dirName}", got: ${statusText.slice(0, 200)}`
    );

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
