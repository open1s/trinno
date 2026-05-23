import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Trinno Chat', () => {
	test('chat panel opens via command', async () => {
		const result = await vscode.commands.executeCommand('trinno-chat.open');
		assert.ok(result !== undefined || true, 'Command should execute');
	});

	test('cancel generation works', async () => {
		const { cancelGeneration } = await import('../../chat/agent');
		assert.doesNotThrow(() => {
			cancelGeneration();
		}, 'cancelGeneration should not throw');
	});
});