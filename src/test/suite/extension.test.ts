import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Trinno Chat', () => {
	test('chat commands are registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('trinno-chat.open'), 'trinno-chat.open should be registered');
		assert.ok(commands.includes('trinno-chat.undoInsert'), 'trinno-chat.undoInsert should be registered');
		assert.ok(commands.includes('trinno-chat.clearHistory'), 'trinno-chat.clearHistory should be registered');
	});

	test('chat settings are accessible', async () => {
		const config = vscode.workspace.getConfiguration('chat');
		assert.strictEqual(config.get('model.provider'), 'openai');
	});
});
