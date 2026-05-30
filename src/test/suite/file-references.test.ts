import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveCommandFileReference } from '../../chat/fileReferences';

suite('Chat file references', () => {
  let tempRoot: string;

  setup(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-file-ref-'));
    fs.mkdirSync(path.join(tempRoot, 'demo'));
    fs.writeFileSync(path.join(tempRoot, 'demo', 'README.md'), '# Demo\n', 'utf-8');
  });

  teardown(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('routes slash command output to @file directory', () => {
    const result = resolveCommandFileReference('/trp status @file:demo', tempRoot);

    assert.ok(result);
    assert.strictEqual(result.text, '/trp status');
    assert.strictEqual(result.workspaceRoot, path.join(tempRoot, 'demo'));
    assert.strictEqual(result.referencePath, 'demo');
  });

  test('routes slash command output to containing directory for @file file', () => {
    const result = resolveCommandFileReference('/trp @file:demo/README.md', tempRoot);

    assert.ok(result);
    assert.strictEqual(result.text, '/trp');
    assert.strictEqual(result.workspaceRoot, path.join(tempRoot, 'demo'));
  });

  test('ignores @file in regular chat text', () => {
    const result = resolveCommandFileReference('summarize @file:demo', tempRoot);
    assert.strictEqual(result, null);
  });

  test('ignores paths outside workspace root', () => {
    const result = resolveCommandFileReference('/trp status @file:../demo', tempRoot);
    assert.strictEqual(result, null);
  });
});
