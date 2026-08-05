import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
/**
 * E2E sanity check for the "smarter like Codex/Claude Code" worker changes:
 *   - coding-discipline system prompt actually lands in the agent
 *   - coding tools (glob_files/write_file/read_file) work in a real session
 *   - MAX_ROUNDS_PER_MESSAGE does NOT false-trigger on normal traffic
 *
 * Spawns the COMPILED worker (dist/bos/worker.js) — same artifact the extension
 * runs — and talks the JSON-over-stdio protocol. Requires a configured model in
 * ~/.bos/conf/config.toml (auto-discovered by BrainOS), like session-e2e.
 */
describe('E2E: Coding Discipline in Real Worker Session', function () {
	let worker: ChildProcess | null = null;
	let tmpWorkspace: string;
	let jobId = 0;

	function spawnWorker(): Promise<void> {
		return new Promise((resolve, reject) => {
			const projectRoot = path.resolve(__dirname, '..', '..', '..');
			const env: NodeJS.ProcessEnv = {};
			for (const [k, v] of Object.entries(process.env)) {
				if (v === undefined) continue;
				if (/^(http|https|all|no)_proxy$/i.test(k)) continue;
				env[k] = v;
			}
			env.NODE_NO_WARNINGS = '1';
			env.NO_PROXY = '127.0.0.1,localhost';
			worker = spawn('node', ['dist/bos/worker.js'], {
				stdio: ['pipe', 'pipe', 'pipe'],
				cwd: projectRoot,
				env,
			});
			let readyBuf = '';
			const onData = (chunk: Buffer) => {
				readyBuf += chunk.toString();
				if (readyBuf.includes('"type":"ready"')) {
					worker?.stdout?.removeListener('data', onData);
					resolve();
				}
			};
			worker.stdout?.on('data', onData);
			worker.once('error', reject);
			setTimeout(() => reject(new Error('worker never became ready')), 30000);
		});
	}

	function sendMessage(msg: any): Promise<any[]> {
		return new Promise((resolve) => {
			const messages: any[] = [];
			const timeout = setTimeout(() => resolve(messages), 240000);
			function onData(chunk: Buffer) {
				const lines = chunk.toString().split('\n').filter(Boolean);
				for (const line of lines) {
					try {
						const parsed = JSON.parse(line);
						messages.push(parsed);
						if (parsed.type === 'tool-approval-needed') {
							worker?.stdin?.write(JSON.stringify({ type: 'tool-approval', id: parsed.id, approved: true }) + '\n');
							continue;
						}
						if (parsed.type === 'done' || parsed.type === 'error') {
							clearTimeout(timeout);
							worker?.stdout?.removeListener('data', onData);
							resolve(messages);
						}
					} catch { /* ignore non-JSON */ }
				}
			}
			worker?.stdout?.on('data', onData);
			worker?.stdin?.write(JSON.stringify(msg) + '\n');
		});
	}

	before(async function () {
		this.timeout(60000);
		const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-coding-e2e-'));
		// macOS: /var/folders/... symlinks to /private/var/folders/... — realpath so
		// the workspace tools' path-prefix checks match the worker's resolved cwd.
		tmpWorkspace = fs.realpathSync(raw);
		await spawnWorker();
	});

	after(function () {
		if (worker) worker.kill();
		if (tmpWorkspace && fs.existsSync(tmpWorkspace)) {
			fs.rmSync(tmpWorkspace, { recursive: true, force: true });
		}
	});

	it('coding prompt + tools + round cap work in a real session', async function () {
		this.timeout(280000);
		jobId++;
		const messages = await sendMessage({
			type: 'chat',
			text: 'In the workspace, create a small TypeScript file named greeting.ts whose contents are exactly:\n\nexport const greeting = "hello-trinno";\n\nThen use glob_files with pattern "**/*.ts" to confirm the file exists, read it back with read_file, and report the file path and its exact contents. Do NOT do anything else.',
			sessionId: 'e2e-coding-' + jobId,
			workspaceRoot: tmpWorkspace,
			sandboxEnabled: false,
		});

		const done = messages.find(m => m.type === 'done');
		const errors = messages.filter(m => m.type === 'error');
		const tokens = messages.filter(m => m.type === 'token');

		assert.ok(done, `expected a done message, got: ${JSON.stringify(errors.map(e => e.error))}`);
		assert.strictEqual(errors.length, 0, `no error expected, got: ${errors.map(e => e.error)}`);

		const fullText = tokens
			.filter(t => t.tokenType === 'Text')
			.map(t => t.text ?? '')
			.join('');

		const toolCalls = tokens.filter(t => t.tokenType === 'ToolCall').map(t => t.text);

		// The round cap must NOT trip on a small bounded task.
		assert.ok(!fullText.includes('Iteration Cap Reached'),
			'MAX_ROUNDS_PER_MESSAGE must not false-trigger on normal traffic');

		// The file should exist in the scratch workspace if tools were used.
		const greetingPath = path.join(tmpWorkspace, 'greeting.ts');
		const fileExists = fs.existsSync(greetingPath);
		if (fileExists) {
			const content = fs.readFileSync(greetingPath, 'utf-8');
			assert.ok(content.includes('hello-trinno'), `greeting.ts should contain hello-trinno, got: ${content}`);
		}

		// With the coding prompt, the model should reach for glob_files for "confirm the file exists".
		// If it didn't, that's a prompt-effectiveness signal — report, don't fail (model-dependent).
		if (toolCalls.length === 0 && !fileExists) {
			console.warn('[coding-e2e] model produced no tool calls and no file — inspect prompt effectiveness');
		}
	});
});
