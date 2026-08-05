import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('Coding tools — glob_files', function () {
  this.timeout(30000);

  let tmpDir: string;
  let tools: any;
  let globFiles: any;

  before(async function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'globtest-'));
    fs.mkdirSync(path.join(tmpDir, 'src/deep/nested'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/a.ts'), '// a');
    fs.writeFileSync(path.join(tmpDir, 'src/deep/b.ts'), '// b');
    fs.writeFileSync(path.join(tmpDir, 'src/deep/nested/c.ts'), '// c');
    fs.writeFileSync(path.join(tmpDir, 'lib/d.js'), '// d');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# readme');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
    fs.mkdirSync(path.join(tmpDir, 'node_modules/pkg'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'node_modules/pkg/x.ts'), '// ignored');

    const { createCodingTools } = await import('../../bos/infrastructure/http/coding_tools.js');
    tools = createCodingTools(tmpDir, false);
    globFiles = tools.find((t: any) => t?.name === 'glob_files');
  });

  after(async function () {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function glob(pattern: string): Promise<any> {
    const raw = await globFiles.callback({ pattern });
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed;
  }

  it('matches **/*.ts across nested directories', async function () {
    const res = await glob('**/*.ts');
    const files = res.data.files as string[];
    assert.ok(files.includes('src/a.ts'), `should include src/a.ts: ${JSON.stringify(files)}`);
    assert.ok(files.includes('src/deep/b.ts'), `should include src/deep/b.ts: ${JSON.stringify(files)}`);
    assert.ok(files.includes('src/deep/nested/c.ts'), `should include nested c.ts: ${JSON.stringify(files)}`);
  });

  it('respects .gitignore (node_modules excluded)', async function () {
    const res = await glob('**/*.ts');
    const files = res.data.files as string[];
    assert.ok(!files.some(f => f.includes('node_modules')),
      `node_modules must be excluded: ${JSON.stringify(files)}`);
  });

  it('supports brace alternation', async function () {
    const res = await glob('{*.ts,*.js}');
    const files = res.data.files as string[];
    assert.ok(files.includes('lib/d.js'), `should include lib/d.js: ${JSON.stringify(files)}`);
  });

  it('supports prefix-scoped globs', async function () {
    const res = await glob('src/**/*.ts');
    const files = res.data.files as string[];
    assert.ok(files.length >= 3, `should include src files: ${JSON.stringify(files)}`);
    assert.ok(!files.includes('lib/d.js'), 'should not include lib/d.js');
  });

  it('returns empty (not error) when no matches', async function () {
    const res = await glob('**/*.rs');
    assert.strictEqual(res.data.fileCount, 0);
    assert.deepStrictEqual(res.data.files, []);
  });
});
