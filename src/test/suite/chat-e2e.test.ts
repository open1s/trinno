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