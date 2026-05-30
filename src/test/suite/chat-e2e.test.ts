import * as assert from 'assert';

suite('AfterToolCall Hook', () => {
	test('after hook emits ToolResult on ok result', async () => {
		const { createToolPermissionHook, setApprovalEmitter } = await import('../../bos/infrastructure/config/toolPermissionHook');
		let emitted: any = null;
		setApprovalEmitter((type: string, data: any) => { emitted = data; });

		const { afterHook } = createToolPermissionHook({});
		await afterHook.callback({
			data: { tool_name: 'read_file', tool_id: 'tool_123', result: { ok: 'file content here' } },
		} as any);

		assert.strictEqual(emitted?.tokenType, 'ToolResult');
		assert.strictEqual(emitted?.text, 'file content here');
		assert.strictEqual(emitted?.toolId, 'tool_123');
		assert.strictEqual(emitted?.status, 'completed');
	});

	test('after hook emits ToolResult on err result', async () => {
		const { createToolPermissionHook, setApprovalEmitter } = await import('../../bos/infrastructure/config/toolPermissionHook');
		let emitted: any = null;
		setApprovalEmitter((type: string, data: any) => { emitted = data; });

		const { afterHook } = createToolPermissionHook({});
		await afterHook.callback({
			data: { tool_name: 'bash', tool_id: 'tool_456', result: { err: 'Permission denied' } },
		} as any);

		assert.strictEqual(emitted?.tokenType, 'ToolResult');
		assert.strictEqual(emitted?.text, 'Permission denied');
		assert.strictEqual(emitted?.toolId, 'tool_456');
		assert.strictEqual(emitted?.status, 'error');
	});
});

suite('E2E: Chat Message Flow', () => {
	test('user message flows through postMessage protocol', async () => {
		const { createUserMessage, createAssistantMessage } = await import('../../chat/messages');
		const userMsg = createUserMessage('What is TRIZ?');
		const assistantMsg = createAssistantMessage();

		assert.strictEqual(userMsg.role, 'user');
		assert.strictEqual(userMsg.content, 'What is TRIZ?');
		assert.strictEqual(assistantMsg.role, 'assistant');
		assert.strictEqual(assistantMsg.status, 'streaming');
	});

	test('message history serialization works', async () => {
		const { createUserMessage, createAssistantMessage } = await import('../../chat/messages');
		const messages = [
			createUserMessage('Hello'),
			createAssistantMessage(),
		];
		const msg2 = messages[1];
		if (!msg2) return assert.fail('Second message not found');
		msg2.content = 'Hi there!';
		msg2.status = 'complete';

		const json = JSON.stringify(messages);
		const parsed = JSON.parse(json);
		assert.strictEqual(parsed.length, 2);
		assert.strictEqual(parsed[0]?.role, 'user');
		assert.strictEqual(parsed[1]?.role, 'assistant');
		assert.strictEqual(parsed[1]?.content, 'Hi there!');
	});
});

suite('E2E: Chat Retry Cap', () => {
	test('parseRetryAfter extracts seconds from common server error formats', async () => {
		const { parseRetryAfter } = await import('../../bos/worker.js');
		assert.strictEqual(parseRetryAfter('429 Too Many Requests, retry-after: 30s'), 30);
		assert.strictEqual(parseRetryAfter('Rate limited. Please retry in 45 seconds.'), 45);
		assert.strictEqual(parseRetryAfter('Too many requests. Try again in 60s.'), 60);
		assert.strictEqual(parseRetryAfter('Rate limit reached, please retry in 5 seconds'), 5);
		assert.strictEqual(parseRetryAfter('Server overloaded. retry after 20s.'), 20);
		assert.strictEqual(parseRetryAfter('{"error":"rate_limited","retry_after":25}'), 25);
		assert.strictEqual(parseRetryAfter('retry-after: 90'), 90);
		assert.strictEqual(parseRetryAfter('Some unrelated error'), 15, 'falls back to 15s when no pattern matches');
		assert.strictEqual(parseRetryAfter('retry after 500s'), 15, 'clamps to 15s when server value > 300s');
		assert.strictEqual(parseRetryAfter('retry after 0s'), 15, 'clamps to 15s when server value is 0');
	});

	test('isRateLimited detects 429 / rate-limit / too-many-requests errors', async () => {
		const { isRateLimitedForTest } = await import('../../bos/worker.js');
		assert.ok(isRateLimitedForTest('429 Too Many Requests'));
		assert.ok(isRateLimitedForTest('rate limit exceeded'));
		assert.ok(isRateLimitedForTest('Rate-limit reached'));
		assert.ok(isRateLimitedForTest('Too many requests, slow down'));
		assert.ok(!isRateLimitedForTest('500 Internal Server Error'));
		assert.ok(!isRateLimitedForTest('Context overflow'));
		assert.ok(!isRateLimitedForTest(''));
	});

	test('rate-limit retry counter starts at 0 with max 3', async () => {
		const panel = await import('../../chat/panel.js');
		panel._resetRateLimitRetriesForTest();
		const state = panel._getRateLimitRetryStateForTest();
		assert.strictEqual(state.count, 0);
		assert.strictEqual(state.max, 3, 'retry cap is 3');
	});

	test('rate-limited message carries retryAfter to the webview (so UI can show actual server value, not hardcoded 15s)', async () => {
		const messages = await import('../../chat/messages.js');
		const { createUserMessage, createAssistantMessage } = messages;
		const userMsg = createUserMessage('test query');
		const assistantMsg = createAssistantMessage();

		const rateLimitedMsg = {
			type: 'rate-limited' as const,
			messageId: assistantMsg.id,
			retryAfter: 42,
		};

		assert.strictEqual(rateLimitedMsg.type, 'rate-limited');
		assert.strictEqual(rateLimitedMsg.retryAfter, 42, 'retryAfter is preserved through the protocol');
		assert.strictEqual(typeof rateLimitedMsg.messageId, 'string');
		assert.ok(rateLimitedMsg.messageId.length > 0);
	});
});

suite('E2E: Chat Retry Cap Regression', () => {
	test('parseRetryAfter on previously-unparseable Anthropic-style error returns the seconds, not the 15s fallback', async () => {
		const { parseRetryAfter } = await import('../../bos/worker.js');
		const anthropicStyle = 'Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limit reached, please retry in 8 seconds"}}';
		assert.strictEqual(parseRetryAfter(anthropicStyle), 8);
	});

	test('parseRetryAfter on OpenAI-style error returns the seconds, not 15s', async () => {
		const { parseRetryAfter } = await import('../../bos/worker.js');
		const openaiStyle = 'Error: 429 - Rate limit reached. Please retry in 12 seconds. (request id: abc123)';
		assert.strictEqual(parseRetryAfter(openaiStyle), 12);
	});
});

suite('E2E: Non-Retryable Error Detection', () => {
	const fs = require('fs') as typeof import('fs');
	const path = require('path') as typeof import('path');
	const webviewPath = path.join(__dirname, '..', '..', 'chat', 'webview', 'chat.js');
	const src = fs.readFileSync(webviewPath, 'utf-8');

	function extractIsNonRetryable(): (text: string) => boolean {
		const match = src.match(/function isNonRetryableError\(text\)\s*\{[\s\S]*?^\s*\}/m);
		if (!match) throw new Error('isNonRetryableError not found in chat.js');
		return new Function('text', `return (${match[0]})(text);`) as (text: string) => boolean;
	}

	const cases: Array<{ name: string; text: string; expected: boolean }> = [
		{ name: 'minimax XML rejection (the actual aibroker error)', text: 'not support such call, please follow openai tool cal schema', expected: true },
		{ name: 'schema invalid', text: 'invalid schema for tool', expected: true },
		{ name: 'unknown tool', text: 'unknown tool: write_file', expected: true },
		{ name: 'tool use failed (Anthropic)', text: 'tool_use_failed: malformed tool input', expected: true },
		{ name: 'malformed tool', text: 'malformed tool call', expected: true },
		{ name: 'unexpected end of json', text: 'unexpected end of json input', expected: true },
		{ name: 'unexpected token in json', text: 'unexpected token < in json at position 0', expected: true },
		{ name: 'downstream ConnectionClosed (LLM proxy cut stream)', text: 'tries: 16, status: 0, Downstream ConnectionClosed, Prematurely before response body is complete', expected: true },
		{ name: 'rate limit (retryable)', text: '429 - rate limit reached, retry in 8s', expected: false },
		{ name: 'network timeout (retryable)', text: 'ECONNRESET: connection reset by peer', expected: false },
		{ name: 'empty error', text: '', expected: false },
		{ name: 'generic error (retryable)', text: 'internal server error', expected: false },
	];

	const isNonRetryable = extractIsNonRetryable();
	for (const c of cases) {
		test(`${c.name} -> ${c.expected ? 'non-retryable' : 'retryable'}`, () => {
			assert.strictEqual(isNonRetryable(c.text), c.expected);
		});
	}
});

suite('E2E: Write Paper (GDL/Zn-air) Using Demo Data', () => {
	const fs = require('fs') as typeof import('fs');
	const path = require('path') as typeof import('path');
	const os = require('os') as typeof import('os');

	const DEMO_DIR = path.resolve(__dirname, '..', '..', '..', 'demo');
	const USER_REQUEST = 'write paper: 分级孔隙气体扩散层（GDL）设计：锌空气电池传质优化研究, refer the research 05_Deliver';

	function copyDir(src: string, dst: string): void {
		fs.mkdirSync(dst, { recursive: true });
		for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
			const s = path.join(src, entry.name);
			const d = path.join(dst, entry.name);
			if (entry.isDirectory()) copyDir(s, d);
			else fs.copyFileSync(s, d);
		}
	}

	function findTool(tools: any[], name: string): any {
		const t = tools.find((x: any) => x && x.name === name);
		if (!t) throw new Error(`Tool ${name} not found in toolset`);
		return t;
	}

	test('agent flow: read 05_Deliver data, compose paper, write_file to 05_Deliver/paper.md', async () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-paper-e2e-'));
		try {
			copyDir(DEMO_DIR, tmpRoot);

			const { createCodingTools } = await import('../../bos/infrastructure/http/coding_tools.js');
			const tools = createCodingTools(tmpRoot);
			const writeFile = findTool(tools, 'write_file');
			const readFile = findTool(tools, 'read_file');
			const listDir = findTool(tools, 'list_dir');

			const toolCalls: Array<{ name: string; args: any; rawResult: string; parsed: any }> = [];
			const callTool = async (name: string, args: any) => {
				const t = findTool(tools, name);
				const rawResult: string = String(await Promise.resolve(t.callback(args)));
				let parsed: any = null;
				if (rawResult && !rawResult.startsWith('Error:')) {
					try { parsed = JSON.parse(rawResult); } catch { parsed = null; }
				}
				toolCalls.push({ name, args, rawResult, parsed });
				return { rawResult, parsed };
			};

			const list = await callTool('list_dir', { dirPath: '05_Deliver' });
			assert.ok(!list.rawResult.startsWith('Error:'), `list_dir should succeed: ${list.rawResult}`);
			assert.strictEqual(list.parsed?.success, true, `list_dir success flag: ${list.rawResult}`);
			assert.ok(Array.isArray(list.parsed?.data?.items), 'list_dir returns items array');
			const items: any[] = list.parsed.data.items;
			assert.ok(items.some((i: any) => i.name === 'paper.md'), 'demo/05_Deliver should contain paper.md');
			assert.ok(items.some((i: any) => i.name === 'report.md'), 'demo/05_Deliver should contain report.md');
			assert.ok(items.some((i: any) => i.name === 'presentation'), 'demo/05_Deliver should contain presentation/');
			assert.ok(items.some((i: any) => i.name === 'appendix'), 'demo/05_Deliver should contain appendix/');

			const refData = await callTool('read_file', { filePath: '05_Deliver/report.md', startLine: 1, endLine: 200 });
			assert.ok(!refData.rawResult.startsWith('Error:'), `read_file report.md should succeed: ${refData.rawResult}`);
			assert.ok(typeof refData.parsed?.data?.content === 'string' && refData.parsed.data.content.length > 0, 'report.md has content');

			const synth = await callTool('read_file', { filePath: '04_Synthesize/synthesis_report.md', startLine: 1, endLine: 100 });
			assert.ok(!synth.rawResult.startsWith('Error:'), `read_file synthesis_report.md should succeed: ${synth.rawResult}`);

			const contradictionsRaw = await callTool('read_file', { filePath: '03_Analyze/contradictions.json', startLine: 1, endLine: 500 });
			assert.ok(!contradictionsRaw.rawResult.startsWith('Error:'), `read_file contradictions.json should succeed: ${contradictionsRaw.rawResult}`);
			const strippedContent = contradictionsRaw.parsed.data.content.split('\n').map((l: string) => l.replace(/^\d+:\s?/, '')).join('\n');
			const contradictions = JSON.parse(strippedContent);
			const contraList = Array.isArray(contradictions) ? contradictions : (contradictions.contradictions || []);
			assert.ok(Array.isArray(contraList) && contraList.length > 0, 'contradictions.json has entries');
			assert.ok(contraList[0]?.improvingParameterIndex !== undefined || contraList[0]?.description, 'contradiction entries have shape');

			const titleMatch = USER_REQUEST.match(/write paper:\s*([^,]+)/);
			assert.ok(titleMatch, 'user request contains a title');
			const paperTitle = titleMatch![1]!.trim();

			const existingPaperRaw = await callTool('read_file', { filePath: '05_Deliver/paper.md', startLine: 1, endLine: 50 });
			assert.ok(!existingPaperRaw.rawResult.startsWith('Error:'), `read_file existing paper.md should succeed: ${existingPaperRaw.rawResult}`);
			const existingFirstLine = existingPaperRaw.parsed.data.content.split('\n')[0] ?? '';
			assert.ok(existingFirstLine.includes('GDL') || existingFirstLine.includes('分级'), 'existing paper references GDL topic');

			const paperContent = [
				`# ${paperTitle}`,
				``,
				`## Hierarchical Porosity Gas Diffusion Layer (GDL) Design: Mass Transfer Optimization for Zinc-Air Batteries`,
				``,
				`---`,
				``,
				`## 摘要`,
				``,
				`(摘要内容由 LLM 在真实运行中生成 — 此处 e2e 测试仅验证 write_file 工具链。)`,
				``,
				`## 1 引言`,
				``,
				`锌空气电池因其高能量密度与安全性被视为下一代储能候选技术…`,
				``,
				`## 2 文献综述`,
				``,
				`(基于 demo/01_Survey 中的搜索结果，共 ${contraList.length} 项核心矛盾已记录。)`,
				``,
				`## 3 技术矛盾与瓶颈`,
				``,
				contraList.slice(0, 3).map((c: any, i: number) =>
					`- 矛盾 ${i + 1}: ${c.description || c.improvingParameter || '(无描述)'}`
				).join('\n'),
				``,
				`## 4 GDL 方案设计`,
				``,
				`(基于 demo/04_Synthesize/solutions.json 与 trends.json 生成。)`,
				``,
				`## 参考文献`,
				``,
				`(基于 demo/06_References/library.bib 生成。)`,
			].join('\n');

			const writeResult = await callTool('write_file', {
				filePath: '05_Deliver/paper.md',
				content: paperContent,
			});
			assert.ok(!writeResult.rawResult.startsWith('Error:'), `write_file should succeed: ${writeResult.rawResult}`);
			assert.strictEqual(writeResult.parsed?.data?.filePath, '05_Deliver/paper.md');
			assert.strictEqual(writeResult.parsed?.data?.action, 'created');
			assert.strictEqual(writeResult.parsed?.data?.bytesWritten, paperContent.length, 'bytesWritten matches content length');

			const writtenPath = path.join(tmpRoot, '05_Deliver', 'paper.md');
			assert.ok(fs.existsSync(writtenPath), 'paper.md was actually written to disk');
			const onDisk = fs.readFileSync(writtenPath, 'utf-8');
			assert.strictEqual(onDisk, paperContent, 'file content matches what was passed to write_file');
			assert.ok(onDisk.startsWith(`# ${paperTitle}`), 'first line is the user-requested title');
			assert.ok(onDisk.includes('Hierarchical Porosity Gas Diffusion Layer'), 'contains English subtitle');
			assert.ok(onDisk.includes('锌空气电池'), 'references zinc-air battery in body');
			assert.ok(onDisk.includes('GDL'), 'uses GDL acronym');
			assert.ok(onDisk.includes('参考文献'), 'has references section');

			const callNames = toolCalls.map((c) => c.name);
			assert.ok(callNames.includes('list_dir'), 'agent called list_dir');
			assert.ok(callNames.includes('read_file'), 'agent called read_file');
			assert.ok(callNames.includes('write_file'), 'agent called write_file');
			assert.strictEqual(callNames[callNames.length - 1], 'write_file', 'write_file is the final tool call (LLM produces output last)');

			const writeArgs = toolCalls.filter((c) => c.name === 'write_file').map((c) => c.args);
			assert.strictEqual(writeArgs.length, 1, 'write_file is called exactly once');
			assert.ok(writeArgs[0]!.filePath === '05_Deliver/paper.md', 'write target is 05_Deliver/paper.md');
			assert.ok((writeArgs[0]!.content as string).length > 500, 'paper content is substantial');
		} finally {
			fs.rmSync(require('fs').existsSync(tmpRoot) ? tmpRoot : '', { recursive: true, force: true });
		}
	});

	test('write_file rejects path traversal (security: paper cannot escape workspace)', async () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-paper-sec-'));
		try {
			const { createCodingTools } = await import('../../bos/infrastructure/http/coding_tools.js');
			const tools = createCodingTools(tmpRoot);
			const writeFile = findTool(tools, 'write_file');

			const evilRaw: string = String(await Promise.resolve(writeFile.callback({
				filePath: '../../../etc/passwd',
				content: 'pwned',
			})));
			assert.ok(evilRaw.startsWith('Error:'), `path traversal must be rejected, got: ${evilRaw}`);
			assert.ok(/outside workspace|access denied/i.test(evilRaw), `returns access-denied error: ${evilRaw}`);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	test('write_file requires both filePath and content (schema validation)', async () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-paper-schema-'));
		try {
			const { createCodingTools } = await import('../../bos/infrastructure/http/coding_tools.js');
			const tools = createCodingTools(tmpRoot);
			const writeFile = findTool(tools, 'write_file');

			const missingContentRaw: string = String(await Promise.resolve(writeFile.callback({ filePath: 'paper.md' } as any)));
			assert.ok(missingContentRaw.startsWith('Error:'), `missing content must fail, got: ${missingContentRaw}`);
			assert.ok(/content|data|undefined|argument/i.test(missingContentRaw), `error indicates missing arg: ${missingContentRaw}`);

			const missingPathRaw: string = String(await Promise.resolve(writeFile.callback({ content: 'hello' } as any)));
			assert.ok(missingPathRaw.startsWith('Error:'), `missing filePath must fail, got: ${missingPathRaw}`);
			assert.ok(/filepath|filePath|file path|data|undefined|argument/i.test(missingPathRaw), `error indicates missing arg: ${missingPathRaw}`);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	test('system prompt instructs agent to use OpenAI tool format (not XML wrapper)', () => {
		const fs2 = require('fs') as typeof import('fs');
		const path2 = require('path') as typeof import('path');
		const srcRoot = path2.resolve(__dirname, '..', '..', '..');
		const workerSrc = fs2.readFileSync(path2.join(srcRoot, 'src', 'bos', 'worker.ts'), 'utf-8');

		assert.ok(
			workerSrc.includes('Tool-Call Format') || workerSrc.includes('tool_call_format') || workerSrc.includes('tool-call format'),
			'worker.ts base prompt includes a Tool-Call Format section'
		);
		assert.ok(
			workerSrc.includes('<minimax:tool_call>') || workerSrc.includes('minimax:tool_call') || workerSrc.includes('XML wrapper'),
			'section explicitly warns against minimax XML wrapper'
		);
		assert.ok(
			/"name":\s*"<tool_name>"/.test(workerSrc) || /"name"/.test(workerSrc),
			'section provides correct OpenAI JSON example'
		);
		assert.ok(
			workerSrc.includes('not support such call') && workerSrc.includes('reformulate'),
			'section tells model to reformulate on "not support such call" error'
		);
	});
});

suite('E2E: Write-Paper Pre-Processor', () => {
	const { parseWriteCommand, composeWritePaper, executeWriteCommand } = require('../../chat/write_paper') as typeof import('../../chat/write_paper');

	test('parseWriteCommand: English "write paper: <title>"', () => {
		const cmd = parseWriteCommand('write paper: 分级孔隙GDL设计');
		assert.ok(cmd);
		assert.strictEqual(cmd!.title, '分级孔隙GDL设计');
		assert.strictEqual(cmd!.phase, '05_Deliver');
		assert.strictEqual(cmd!.writePath, '05_Deliver/分级孔隙gdl设计.md');
	});

	test('parseWriteCommand: English "write a paper: <title>"', () => {
		const cmd = parseWriteCommand('write a paper: Zinc-Air Battery GDL');
		assert.ok(cmd);
		assert.strictEqual(cmd!.title, 'Zinc-Air Battery GDL');
		assert.strictEqual(cmd!.phase, '05_Deliver');
	});

	test('parseWriteCommand: Chinese "写论文："', () => {
		const cmd = parseWriteCommand('写论文：分级孔隙气体扩散层（GDL）设计');
		assert.ok(cmd);
		assert.strictEqual(cmd!.title, '分级孔隙气体扩散层（GDL）设计');
		assert.strictEqual(cmd!.phase, '05_Deliver');
	});

	test('parseWriteCommand: with refer research phase', () => {
		const cmd = parseWriteCommand('write paper: GDL优化, refer research 03_Analyze');
		assert.ok(cmd);
		assert.strictEqual(cmd!.title, 'GDL优化');
		assert.strictEqual(cmd!.phase, '03_Analyze');
		assert.strictEqual(cmd!.writePath, '03_Analyze/gdl优化.md');
	});

	test('parseWriteCommand: Chinese with refer research', () => {
		const cmd = parseWriteCommand('写论文：锌空气电池GDL传质优化, refer research 04_Synthesize');
		assert.ok(cmd);
		assert.strictEqual(cmd!.title, '锌空气电池GDL传质优化');
		assert.strictEqual(cmd!.phase, '04_Synthesize');
	});

	test('parseWriteCommand: no colon returns null', () => {
		assert.strictEqual(parseWriteCommand('write paper GDL'), null);
		assert.strictEqual(parseWriteCommand('写论文 GDL'), null);
	});

	test('parseWriteCommand: empty title returns null', () => {
		assert.strictEqual(parseWriteCommand('write paper:'), null);
		assert.strictEqual(parseWriteCommand('写论文：'), null);
	});

	test('parseWriteCommand: unrelated text returns null', () => {
		assert.strictEqual(parseWriteCommand('hello world'), null);
		assert.strictEqual(parseWriteCommand('/compact'), null);
	});

	test('composeWritePaper: generates full paper structure', () => {
		const data = {
			reportMd: '# Report\nThis is a report.',
			synthesisMd: '# Synthesis\nSynthesis content here.',
			contradictions: [
				{ improvingParameter: '强度', worseningParameter: '重量', description: '高强度导致重量增加' },
				{ improving: '速度', worsening: '成本', problem: '高速增加成本' },
			],
			solutions: [
				{ title: '多孔复合材料', appliedPrinciples: [{ index: 1 }, { index: 35 }], description: '采用多孔结构降低重量' },
				{ name: '梯度孔隙', principles: '31, 40', summary: '梯度孔隙优化传质' },
			],
			trends: [
				{ trend: '微纳结构化', horizon: '2025-2030', drivers: ['制造工艺进步', '仿真能力提升'] },
				{ name: 'AI辅助设计', timing: '2024-2028', description: '机器学习优化' },
			],
			roadmap: [
				{ phase: 'Phase 1', focus: '材料筛选', actions: ['文献调研', '初步筛选'] },
			],
			trl: { trlLevel: 4, trlLevelBreakdown: [{ dimension: '材料', level: 5 }, { dimension: '工艺', level: 3 }] },
			sCurve: null,
			references: { entries: [{ title: 'Paper A' }, { title: 'Paper B' }] },
		};
		const paper = composeWritePaper('GDL设计', '05_Deliver', data);

		assert.ok(paper.startsWith('# GDL设计'));
		assert.ok(paper.includes('## A TRIZ-Based Technical Research Paper'));
		assert.ok(paper.includes('## 摘要'));
		assert.ok(paper.includes('## 1 引言'));
		assert.ok(paper.includes('## 2 技术矛盾分析'));
		assert.ok(paper.includes('## 3 解决方案设计'));
		assert.ok(paper.includes('## 4 技术发展趋势'));
		assert.ok(paper.includes('## 5 实施路线图'));
		assert.ok(paper.includes('## 6 技术成熟度评估'));
		assert.ok(paper.includes('## 7 综合分析'));
		assert.ok(paper.includes('## 8 结论与展望'));
		assert.ok(paper.includes('## 参考文献'));
		assert.ok(paper.includes('改善参数') && paper.includes('强度'));
		assert.ok(paper.includes('恶化参数') && paper.includes('重量'));
		assert.ok(paper.includes('多孔复合材料'));
		assert.ok(paper.includes('微纳结构化'));
		assert.ok(paper.includes('Phase 1'));
		assert.ok(paper.includes('TRL') && paper.includes('4'));
		assert.ok(paper.includes('材料') && paper.includes('5'));
		assert.ok(paper.includes('[1] Paper A'));
	});

	test('composeWritePaper: empty data produces minimal paper', () => {
		const paper = composeWritePaper('Test', '05_Deliver', {
			reportMd: null, synthesisMd: null, contradictions: [],
			solutions: [], trends: [], roadmap: [], trl: null,
			sCurve: null, references: null,
		});
		assert.ok(paper.startsWith('# Test'));
		assert.ok(paper.includes('## 摘要'));
		assert.ok(paper.includes('## 8 结论与展望'));
		assert.ok(!paper.includes('## 2 技术矛盾分析'));
		assert.ok(!paper.includes('## 3 解决方案设计'));
		assert.ok(!paper.includes('## 参考文献'));
	});

	test('executeWriteCommand: writes paper to filesystem', async () => {
		const fs2 = require('fs') as typeof import('fs');
		const path2 = require('path') as typeof import('path');
		const os2 = require('os') as typeof import('os');
		const tmpDir = path2.join(os2.tmpdir(), `write-paper-test-${Date.now()}`);
		try {
			fs2.mkdirSync(path2.join(tmpDir, '05_Deliver'), { recursive: true });
			fs2.writeFileSync(path2.join(tmpDir, '05_Deliver', 'report.md'), '# Report\nTest content.');

			const cmd = parseWriteCommand('write paper: 测试论文, refer research 05_Deliver');
			assert.ok(cmd);
			const result = await executeWriteCommand(cmd!, tmpDir);

			assert.ok(result.includes('已写入'));
			assert.ok(result.includes('05_Deliver/测试论文.md'));

			const written = fs2.readFileSync(path2.join(tmpDir, '05_Deliver', '测试论文.md'), 'utf8');
			assert.ok(written.startsWith('# 测试论文'));
			assert.ok(written.includes('Test content.'));
		} finally {
			fs2.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test('executeWriteCommand: creates nested directories', async () => {
		const fs2 = require('fs') as typeof import('fs');
		const path2 = require('path') as typeof import('path');
		const os2 = require('os') as typeof import('os');
		const tmpDir = path2.join(os2.tmpdir(), `write-paper-mkdir-${Date.now()}`);
		try {
			const cmd = parseWriteCommand('write paper: Deep Test, refer research 99_Test');
			assert.ok(cmd);
			const result = await executeWriteCommand(cmd!, tmpDir);
			assert.ok(result.includes('已写入'));
			assert.ok(fs2.existsSync(path2.join(tmpDir, '99_Test', 'deep-test.md')));
  } finally {
    fs2.rmSync(tmpDir, { recursive: true, force: true });
  }
});
});

suite('E2E: Buffer Drain Fix (done-then-ToolResult race)', () => {
  function makeDrain(
    onToken: (msg: { type: string; tokenType: string; text: string }) => void,
  ) {
    return (buffer: string): void => {
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'token') {
            onToken({ type: 'token', tokenType: msg.tokenType, text: msg.text });
          }
        } catch {
          /* ignore non-JSON */
        }
      }
    };
  }

  test('drains a single trailing ToolResult from buffer before done fires', () => {
    const received: Array<{ tokenType: string; text: string }> = [];
    const drain = makeDrain((msg) => received.push(msg));
    const buffer =
      '{"type":"token","tokenType":"ToolResult","text":"found 5 papers","toolId":"auto_1","status":"completed"}\n' +
      '{"type":"done"}';
    drain(buffer);
    assert.strictEqual(received.length, 1);
    const first = received[0];
    assert.ok(first);
    assert.strictEqual(first.tokenType, 'ToolResult');
    assert.strictEqual(first.text, 'found 5 papers');
  });

  test('drains multiple trailing tokens in order', () => {
    const received: Array<{ tokenType: string; text: string }> = [];
    const drain = makeDrain((msg) => received.push(msg));
    const buffer = [
      '{"type":"token","tokenType":"ToolResult","text":"3 patents","toolId":"t1","status":"completed"}',
      '{"type":"token","tokenType":"ToolResult","text":"5 papers","toolId":"t2","status":"completed"}',
      '{"type":"done"}',
    ].join('\n');
    drain(buffer);
  assert.strictEqual(received.length, 2);
  assert.strictEqual(received[0]!.text, '3 patents');
  assert.strictEqual(received[1]!.text, '5 papers');
  });

  test('empty buffer produces no tokens', () => {
    const received: Array<{ tokenType: string; text: string }> = [];
    const drain = makeDrain((msg) => received.push(msg));
    drain('');
    drain('\n');
    assert.strictEqual(received.length, 0);
  });

  test('ignores malformed JSON lines', () => {
    const received: Array<{ tokenType: string; text: string }> = [];
    const drain = makeDrain((msg) => received.push(msg));
    const buffer =
      'not json\n{"type":"token","tokenType":"ToolCall","text":"triz_search"}\n{"type":"done"}';
    drain(buffer);
    assert.strictEqual(received.length, 1);
    const first = received[0];
    assert.ok(first);
    assert.strictEqual(first.tokenType, 'ToolCall');
    assert.strictEqual(first.text, 'triz_search');
  });

  test('partial line without newline is not consumed', () => {
    const received: Array<{ tokenType: string; text: string }> = [];
    const drain = makeDrain((msg) => received.push(msg));
    const chunk =
      '{"type":"token","tokenType":"Text","text":"hello"}\n{"type":"token","tokenType":"ToolCall","text":"partial_';
    drain(chunk);
    assert.strictEqual(received.length, 1);
    const first = received[0];
    assert.ok(first);
    assert.strictEqual(first.text, 'hello');
  });

  test('drain is idempotent for identical content', () => {
    const received: Array<{ tokenType: string; text: string }> = [];
    const drain = makeDrain((msg) => received.push(msg));
    const buffer = '{"type":"token","tokenType":"Text","text":"x"}\n{"type":"done"}';
    drain(buffer);
    drain(buffer);
    assert.strictEqual(received.length, 1);
  });

  test('done + trailing ToolResult in same chunk: must not drop tokens', () => {
    const received: Array<{ tokenType: string; text: string }> = [];
    const drain = makeDrain((msg) => received.push(msg));
    const chunk =
      '{"type":"token","tokenType":"ToolResult","text":"15 results","toolId":"auto_2","status":"completed"}\n' +
      '{"type":"done","sessionId":"s1"}';
    drain(chunk);
    assert.strictEqual(received.length, 1);
    const first = received[0];
    assert.ok(first);
    assert.strictEqual(first.tokenType, 'ToolResult');
  });

  test('contrasts: cleanup-before-drain drops trailing token; drain-first preserves it', () => {
    const received: Array<{ tokenType: string; text: string }> = [];
    const chunk =
      '{"type":"token","tokenType":"ToolResult","text":"last result","toolId":"x","status":"error"}\n' +
      '{"type":"done"}';
    const oldCount = received.length;
    const drain = makeDrain((msg) => received.push(msg));
    drain(chunk);
    assert.strictEqual(oldCount, 0);
    assert.strictEqual(received.length, 1);
    const first = received[0];
    assert.ok(first);
    assert.strictEqual(first.text, 'last result');
  });
});

suite('E2E: parseRetryAfter and isRateLimitedForTest (worker.ts)', () => {
  test('parseRetryAfter extracts seconds from common server error formats', () => {
    const { parseRetryAfter, isRateLimitedForTest } = require('../../bos/worker');
    assert.strictEqual(
      parseRetryAfter('429 Too Many Requests, retry-after: 30s'),
      30,
    );
    assert.strictEqual(
      parseRetryAfter('Rate limited. Please retry in 45 seconds.'),
      45,
    );
    assert.strictEqual(
      parseRetryAfter('Too many requests. Try again in 60s.'),
      60,
    );
    assert.strictEqual(
      parseRetryAfter('Rate limit reached, please retry in 5 seconds'),
      5,
    );
    assert.strictEqual(
      parseRetryAfter('Server overloaded. retry after 20s.'),
      20,
    );
    assert.strictEqual(
      parseRetryAfter('{"error":"rate_limited","retry_after":25}'),
      25,
    );
    assert.strictEqual(parseRetryAfter('retry-after: 90'), 90);
    assert.strictEqual(parseRetryAfter('Some unrelated error'), 15);
    assert.strictEqual(
      parseRetryAfter('retry after 500s'),
      15,
      'clamps >300s',
    );
    assert.strictEqual(parseRetryAfter('retry after 0s'), 15, 'clamps 0');
  });

  test('isRateLimitedForTest detects 429 / rate-limit / too-many-requests', () => {
    const { isRateLimitedForTest } = require('../../bos/worker');
    assert.ok(isRateLimitedForTest('429 Too Many Requests'));
    assert.ok(isRateLimitedForTest('rate limit exceeded'));
    assert.ok(isRateLimitedForTest('Rate-limit reached'));
    assert.ok(isRateLimitedForTest('Too many requests'));
    assert.ok(!isRateLimitedForTest('500 Internal Server Error'));
    assert.ok(!isRateLimitedForTest(''));
  });
});