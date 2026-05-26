import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 30000
	});

	const testsRoot = path.resolve(__dirname, '.');
	mocha.addFile(path.resolve(testsRoot, 'extension.test.js'));
	mocha.addFile(path.resolve(testsRoot, 'chat-e2e.test.js'));
	mocha.addFile(path.resolve(testsRoot, 'mcp-config.test.js'));
	mocha.addFile(path.resolve(testsRoot, 'workspace-root-e2e.test.js'));

	return new Promise<void>((resolve, reject) => {
		mocha.run((failures: number) => {
			if (failures > 0) {
				reject(new Error(`${failures} tests failed.`));
			} else {
				resolve();
			}
		});
	});
}
