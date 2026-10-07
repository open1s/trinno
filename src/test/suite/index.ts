import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
	// TRINNO_TEST_GREP=<pattern> narrows the run to matching describes/its,
	// so a single e2e file can be reproduced without the whole suite.
	const mocha = new Mocha({
		ui: 'bdd',
		color: true,
		timeout: 30000,
		...(process.env.TRINNO_TEST_GREP ? { grep: new RegExp(process.env.TRINNO_TEST_GREP) } : {})
	});

	const testsRoot = path.resolve(__dirname, '.');
	mocha.addFile(path.resolve(testsRoot, 'setup.js'));
	mocha.addFile(path.resolve(testsRoot, 'extension.test.js'));
	mocha.addFile(path.resolve(testsRoot, 'file-references.test.js'));
	mocha.addFile(path.resolve(testsRoot, 'write-paper.test.js'));
	mocha.addFile(path.resolve(testsRoot, 'rapid-input-e2e.test.js'));
	mocha.addFile(path.resolve(testsRoot, 'common-agent.test.js'));

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
