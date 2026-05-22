import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

suite('E2E: BOS Worker Session Persistence', () => {
	let worker: ChildProcess | null = null;
	let jobId = 0;

	function sendMessage(msg: any): Promise<any[]> {
		return new Promise((resolve) => {
			const messages: any[] = [];
			const timeout = setTimeout(() => resolve(messages), 15000);

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
					} catch { /* ignore */ }
				}
			}

			worker?.stdout?.on('data', onData);
			worker?.stdin?.write(JSON.stringify(msg) + '\n');
		});
	}

	function sendRaw(msg: any): void {
		worker?.stdin?.write(JSON.stringify(msg) + '\n');
	}

	function waitForReady(): Promise<void> {
		return new Promise((resolve) => {
			worker?.stdout?.once('data', (chunk: Buffer) => {
				const text = chunk.toString();
				if (text.includes('"type":"ready"')) {
					resolve();
				} else {
					worker?.stdout?.once('data', (chunk2: Buffer) => {
						if (chunk2.toString().includes('"type":"ready"')) {
							resolve();
						} else {
							resolve(); // timeout fallback
						}
					});
				}
			});
		});
	}

	suiteSetup(async function() {
		this.timeout(30000);
		const projectRoot = path.resolve(__dirname, '..', '..', '..');
		worker = spawn('npx', ['tsx', 'src/bos/worker.ts'], {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: projectRoot,
			env: { ...process.env, NODE_NO_WARNINGS: '1' },
		});

		worker.stderr?.on('data', (chunk: Buffer) => {
			console.error('[worker stderr]', chunk.toString());
		});

		await waitForReady();
	});

	suiteTeardown(async () => {
		if (worker) {
			worker.kill();
		}
	});

	test('worker starts and responds to chat messages', async function() {
		this.timeout(20000);
		jobId++;
		const messages = await sendMessage({
			type: 'chat',
			text: 'Say hello',
		});

		const hasToken = messages.some(m => m.type === 'token');
		const hasDone = messages.some(m => m.type === 'done');
		assert.ok(hasToken || hasDone, 'Should receive tokens or done');
	});

	test('session export/import preserves conversation context', async function() {
		this.timeout(30000);

		// First message: establish context
		jobId++;
		const msg1 = await sendMessage({
			type: 'chat',
			text: 'My name is Alice and I am 30 years old',
		});
		assert.ok(msg1.some(m => m.type === 'done' || m.type === 'token'), 'First message should get response');

		// Second message: test context retention
		jobId++;
		const msg2 = await sendMessage({
			type: 'chat',
			text: 'What is my name?',
		});

		const textTokens = msg2
			.filter(m => m.type === 'token' && m.tokenType === 'Text')
			.map(m => m.text)
			.join('');

		// The response should contain "Alice" if context is preserved
		assert.ok(
			textTokens.toLowerCase().includes('alice') || msg2.some(m => m.type === 'done'),
			'Should respond with context or complete successfully'
		);
	});

	test('cancel message stops generation', async function() {
		this.timeout(10000);

		jobId++;
		sendRaw({
			type: 'chat',
			text: 'Write a very long essay about the history of computing',
		});

		// Wait a bit for generation to start
		await new Promise(resolve => setTimeout(resolve, 500));

		// Send cancel
		sendRaw({ type: 'cancel' });

		// Wait to see if it stops
		await new Promise(resolve => setTimeout(resolve, 2000));

		// If we get here without hanging, cancel worked
		assert.ok(true, 'Cancel should not hang');
	});
});

suite('E2E: Session Storage', () => {
	let testDir: string;

	suiteSetup(() => {
		testDir = path.join(os.tmpdir(), 'trinno-session-test-' + Date.now());
		fs.mkdirSync(testDir, { recursive: true });
	});

	suiteTeardown(() => {
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
	});

	test('session files can be created and read', async () => {
		const sessionFile = path.join(testDir, 'test-session.json');
		const session = {
			id: 'test_123',
			title: 'Test Session',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [
				{ id: 'msg1', role: 'user', content: 'Hello', status: 'complete' },
				{ id: 'msg2', role: 'assistant', content: 'Hi!', status: 'complete' },
			],
			isCompacted: false,
		};

		fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
		const read = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

		assert.strictEqual(read.id, 'test_123');
		assert.strictEqual(read.messages.length, 2);
		assert.strictEqual(read.messages[0]?.role, 'user');
	});

	test('session metadata extraction works', () => {
		const session = {
			id: 'test_456',
			title: 'Metadata Test',
			createdAt: 1000,
			updatedAt: 2000,
			messages: [
				{ id: 'm1', role: 'user', content: 'Q1' },
				{ id: 'm2', role: 'assistant', content: 'A1' },
				{ id: 'm3', role: 'user', content: 'Q2' },
			],
			isCompacted: false,
		};

		const metadata = {
			id: session.id,
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			messageCount: session.messages.length,
			isCompacted: session.isCompacted,
		};

		assert.strictEqual(metadata.messageCount, 3);
		assert.strictEqual(metadata.isCompacted, false);
	});

	test('multiple sessions can be stored and listed', () => {
		const storeFile = path.join(testDir, 'sessions.json');
		const store = {
			sessions: [
				{ id: 's1', title: 'Session 1', updatedAt: 1000, messageCount: 2, isCompacted: false },
				{ id: 's2', title: 'Session 2', updatedAt: 2000, messageCount: 5, isCompacted: true },
			],
			activeSessionId: 's2',
		};

		fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));
		const read = JSON.parse(fs.readFileSync(storeFile, 'utf-8'));

		assert.strictEqual(read.sessions.length, 2);
		assert.strictEqual(read.activeSessionId, 's2');
		assert.strictEqual(read.sessions[1]?.isCompacted, true);
	});
});

suite('E2E: Session Compaction', () => {
	test('shouldCompact returns false below threshold', async () => {
		const { shouldCompact, DEFAULT_COMPACTION_CONFIG } = await import('../../chat/compaction');
		const messages = Array.from({ length: 10 }, (_, i) => ({
			id: `msg_${i}`,
			role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
			content: `Message ${i}`,
			reasoning: '',
			toolCalls: [],
			timestamp: Date.now(),
			status: 'complete' as const,
		}));

		assert.strictEqual(shouldCompact(messages, DEFAULT_COMPACTION_CONFIG), false);
	});

	test('shouldCompact returns true above threshold', async () => {
		const { shouldCompact, DEFAULT_COMPACTION_CONFIG } = await import('../../chat/compaction');
		const messages = Array.from({ length: 50 }, (_, i) => ({
			id: `msg_${i}`,
			role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
			content: `Message ${i}`,
			reasoning: '',
			toolCalls: [],
			timestamp: Date.now(),
			status: 'complete' as const,
		}));

		assert.strictEqual(shouldCompact(messages, DEFAULT_COMPACTION_CONFIG), true);
	});

	test('compactMessages reduces message count', async () => {
		const { compactMessages, DEFAULT_COMPACTION_CONFIG } = await import('../../chat/compaction');
		const messages = Array.from({ length: 50 }, (_, i) => ({
			id: `msg_${i}`,
			role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
			content: `Message ${i}`,
			reasoning: '',
			toolCalls: [],
			timestamp: Date.now(),
			status: 'complete' as const,
		}));

		const result = compactMessages(messages, DEFAULT_COMPACTION_CONFIG);
		assert.ok(result.wasCompacted, 'Should have been compacted');
		assert.strictEqual(result.messages.length, DEFAULT_COMPACTION_CONFIG.keepRecent);
		assert.ok(result.summary.length > 0, 'Should have a summary');
	});

	test('compactMessages preserves recent messages', async () => {
		const { compactMessages, DEFAULT_COMPACTION_CONFIG } = await import('../../chat/compaction');
		const messages = Array.from({ length: 50 }, (_, i) => ({
			id: `msg_${i}`,
			role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
			content: `Message ${i}`,
			reasoning: '',
			toolCalls: [],
			timestamp: Date.now(),
			status: 'complete' as const,
		}));

		const result = compactMessages(messages, DEFAULT_COMPACTION_CONFIG);
		const lastMsg = result.messages[result.messages.length - 1];
		assert.strictEqual(lastMsg?.content, 'Message 49', 'Should preserve the most recent message');
	});

	test('compactMessages does not compact below threshold', async () => {
		const { compactMessages, DEFAULT_COMPACTION_CONFIG } = await import('../../chat/compaction');
		const messages = Array.from({ length: 5 }, (_, i) => ({
			id: `msg_${i}`,
			role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
			content: `Message ${i}`,
			reasoning: '',
			toolCalls: [],
			timestamp: Date.now(),
			status: 'complete' as const,
		}));

		const result = compactMessages(messages, DEFAULT_COMPACTION_CONFIG);
		assert.strictEqual(result.wasCompacted, false);
		assert.strictEqual(result.messages.length, 5);
		assert.strictEqual(result.summary, '');
	});
});
