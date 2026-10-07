import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { createModuleLogger } from '../bos/infrastructure/logging/logger';

const log = createModuleLogger('test-runner');

async function main() {
	try {
		// Some hosts export ELECTRON_RUN_AS_NODE=1, which forces the downloaded
		// VS Code binary into plain-Node mode ("bad option: --disable-extensions").
		// The extension-host runner must launch the real GUI Electron runtime.
		delete process.env.ELECTRON_RUN_AS_NODE;
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
