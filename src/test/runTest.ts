import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { createModuleLogger } from '../bos/infrastructure/logging/logger';

const log = createModuleLogger('test-runner');

async function main() {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ['--disable-extensions']
		});
	} catch (err) {
		log.error({ err }, 'Failed to run tests');
		process.exit(1);
	}
}

main();
