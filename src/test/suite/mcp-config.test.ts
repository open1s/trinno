import * as assert from 'assert';
import { ConfigLoader } from '@open1s/jsbos';
import { McpServerConfig } from '../../bos/infrastructure/config/toolPermissions';

suite('MCP Config Loading', () => {
	test('ConfigLoader reads mcp.servers from app.toml', () => {
		const loader = new ConfigLoader();
		loader.discover();
		const configJson = loader.loadSync();
		const config = JSON.parse(configJson);

		const servers: McpServerConfig[] = config?.mcp?.servers || [];

		assert.ok(Array.isArray(servers), 'mcp.servers should be an array');
		assert.ok(servers.length > 0, 'mcp.servers should not be empty');
	});

	test('MCP server has required fields', () => {
		const loader = new ConfigLoader();
		loader.discover();
		const configJson = loader.loadSync();
		const config = JSON.parse(configJson);

		const servers: McpServerConfig[] = config?.mcp?.servers || [];
		const server = servers[0];

		assert.ok(server, 'First server should exist');
		assert.strictEqual(server.name, 'filesystem');
		assert.strictEqual(server.type, 'stdio');
		assert.strictEqual(server.command, 'npx');
		assert.ok(Array.isArray(server.args), 'args should be an array');
		assert.ok(server.args.length > 0, 'args should not be empty');
	});

	test('MCP server args are correct', () => {
		const loader = new ConfigLoader();
		loader.discover();
		const configJson = loader.loadSync();
		const config = JSON.parse(configJson);

		const servers: McpServerConfig[] = config?.mcp?.servers || [];
		const server = servers[0];
		assert.ok(server, 'First server should exist');

		assert.deepStrictEqual(server.args, [
			'-y',
			'@modelcontextprotocol/server-filesystem',
			'/Users/gaosg'
		]);
	});
});