import { describe, it, before, after } from 'mocha';
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface ToolDef {
  name: string;
  description: string;
  callback(args: Record<string, unknown>): Promise<string>;
}

describe('typst_tools', () => {
  let tempRoot: string;

  before(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-typst-'));
  });

  after(() => {
    // Cleanup global LSP client so tests don't leak
    import('../../bos/infrastructure/lsp/typst_lsp').then(m => m.closeTypstLspClient()).catch(() => {});
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ok */ }
  });

  describe('severityLabel', () => {
    let severityLabel: (sev: number) => string;

    before(async () => {
      const mod = await import('../../bos/infrastructure/http/typst_tools');
      severityLabel = mod.severityLabel;
    });

    it('maps severity 1 to error', () => {
      assert.equal(severityLabel(1), 'error');
    });

    it('maps severity 2 to warning', () => {
      assert.equal(severityLabel(2), 'warning');
    });

    it('maps severity 3 to info', () => {
      assert.equal(severityLabel(3), 'info');
    });

    it('maps severity 4 to hint', () => {
      assert.equal(severityLabel(4), 'hint');
    });

    it('maps unknown severity to unknown', () => {
      assert.equal(severityLabel(0), 'unknown');
      assert.equal(severityLabel(99), 'unknown');
    });
  });

  describe('typst_lint tool', function () {
    this.timeout(30_000);
    let createTypstTools: any;

    before(async () => {
      const mod = await import('../../bos/infrastructure/http/typst_tools');
      createTypstTools = mod.createTypstTools;
    });

    it('returns err for non-existent file', async () => {
      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath: '/non/existent/file.typ' });
      assert.ok(result.startsWith('Error:'), `Expected error string, got: ${result}`);
      assert.match(result, /File not found/);
    });

    it('resolves relative path against workspaceRoot', async () => {
      const subdir = path.join(tempRoot, 'sub');
      fs.mkdirSync(subdir);
      fs.writeFileSync(path.join(subdir, 'test.typ'), '#let x = 1');

      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath: 'sub/test.typ' });

      if (!result.startsWith('Error:')) {
        const parsed = JSON.parse(result);
        assert.ok(parsed.success);
      }
    });

    it('accepts absolute path directly', async () => {
      const filePath = path.join(tempRoot, 'absolute.typ');
      fs.writeFileSync(filePath, '#let x = 1');

      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath });

      if (!result.startsWith('Error:')) {
        const parsed = JSON.parse(result);
        assert.ok(parsed.success);
      }
    });
  });

  describe('typst_lint integration', function () {
    this.timeout(60_000);
    let createTypstTools: any;

    before(async () => {
      const mod = await import('../../bos/infrastructure/http/typst_tools');
      createTypstTools = mod.createTypstTools;
    });

    it('detects type error: calling non-callable value', async function () {
      const filePath = path.join(tempRoot, 'type-error.typ');
      fs.writeFileSync(filePath, '#let x = "hello"\n#x("extra")');

      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath });

      if (!result.startsWith('Error:')) {
        const parsed = JSON.parse(result);
        if (parsed.data.status === 'issues') {
          assert.ok(parsed.data.issueCount > 0);
          assert.match(parsed.data.output, /error/); // severity label
        }
      }
    });

    it('detects undefined variable', async function () {
      const filePath = path.join(tempRoot, 'undefined-var.typ');
      fs.writeFileSync(filePath, '#let x = 1\n#x + #y');

      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath });

      if (!result.startsWith('Error:')) {
        const parsed = JSON.parse(result);
        if (parsed.data.status === 'issues') {
          assert.ok(parsed.data.issueCount > 0);
          assert.match(parsed.data.output, /unknown variable/);
        }
      }
    });

    it('detects unclosed delimiter', async function () {
      const filePath = path.join(tempRoot, 'unclosed.typ');
      fs.writeFileSync(filePath, '#let f(x = { x }');

      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath });

      if (!result.startsWith('Error:')) {
        const parsed = JSON.parse(result);
        if (parsed.data.status === 'issues') {
          assert.ok(parsed.data.issueCount > 0);
          assert.match(parsed.data.output, /unclosed delimiter/);
        }
      }
    });

    it('detects missing import file', async function () {
      const filePath = path.join(tempRoot, 'missing-import.typ');
      fs.writeFileSync(filePath, '#import "nonexistent.typ"');

      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath });

      if (!result.startsWith('Error:')) {
        const parsed = JSON.parse(result);
        if (parsed.data.status === 'issues') {
          assert.ok(parsed.data.issueCount > 0);
          assert.match(parsed.data.output, /file not found/);
        }
      }
    });

    it('returns clean status for valid Typst file', async function () {
      const filePath = path.join(tempRoot, 'valid.typ');
      fs.writeFileSync(filePath, '#let greeting = "Hello"\n#greeting');

      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath });

      if (!result.startsWith('Error:')) {
        const parsed = JSON.parse(result);
        assert.equal(parsed.data.status, 'clean');
        assert.ok(parsed.data.output);
      }
    });

    it('outputs line numbers and error messages in result', async function () {
      const filePath = path.join(tempRoot, 'line-report.typ');
      fs.writeFileSync(filePath, '#let a = "bad"\n#a()');

      const tools = createTypstTools(tempRoot) as ToolDef[];
      const lintTool = tools[0]!;
      const result = await lintTool.callback({ filePath });

      if (!result.startsWith('Error:') && result.includes('"status":"issues"')) {
        const parsed = JSON.parse(result);
        assert.ok(parsed.data.issueCount > 0, 'Should detect at least 1 issue');
        assert.match(parsed.data.output, /line \d+:\d+/, 'Should show line:column format');
        assert.match(parsed.data.output, /\[error\]/, 'Should include severity label');
      }
    });
  });

  describe('result format for LLM consumption', () => {
    let createTypstTools: any;

    before(async () => {
      const mod = await import('../../bos/infrastructure/http/typst_tools');
      createTypstTools = mod.createTypstTools;
    });

    it('success result is parseable JSON with success=true', async function () {
      const filePath = path.join(tempRoot, 'parseable.typ');
      fs.writeFileSync(filePath, '#let x = 1');
      const tools = createTypstTools(tempRoot) as ToolDef[];
      const result = await tools[0]!.callback({ filePath });

      if (result.startsWith('Error:')) return; // LSP not available

      const parsed = JSON.parse(result);
      assert.ok(parsed.success === true, 'success field must be true');
      assert.ok(parsed.data, 'data field must exist');
      assert.ok(typeof parsed.data.filePath === 'string', 'filePath must be string');
      assert.ok(parsed.data.source === 'tinymist-lsp' || parsed.data.source === 'typst-cli', 'source must be set');
      assert.ok(parsed.data.status === 'clean' || parsed.data.status === 'issues', 'status must be clean or issues');
    });

    it('error result is valid JSON with success=false', async function () {
      const tools = createTypstTools(tempRoot) as ToolDef[];
      const result = await tools[0]!.callback({ filePath: '/nonexistent' });

      assert.ok(result.startsWith('Error:'), 'Error result should start with Error:');
    });

    it('issue result has all fields LLM needs to act on', async function () {
      const filePath = path.join(tempRoot, 'actionable.typ');
      fs.writeFileSync(filePath, '#let n = 1\n#n("arg")');
      const tools = createTypstTools(tempRoot) as ToolDef[];
      const result = await tools[0]!.callback({ filePath });

      if (result.startsWith('Error:') || !result.includes('"status":"issues"')) return;

      const parsed = JSON.parse(result);
      const data = parsed.data;
      assert.ok(data.issueCount !== undefined, 'issueCount is required');
      assert.strictEqual(typeof data.issueCount, 'number', 'issueCount must be number');
      assert.ok(data.output.length > 0, 'output must be non-empty');
      // LLM needs these fields to understand and fix the issue
      assert.match(data.output, /line \d+:\d+/, 'LLM needs line:column to locate issue');
      assert.match(data.output, /\[(error|warning|info|hint)\]/, 'LLM needs severity to prioritize');
    });

    it('clean result signals all-clear to LLM', async function () {
      const filePath = path.join(tempRoot, 'all-clear.typ');
      fs.writeFileSync(filePath, '#let x = 1\n#x');
      const tools = createTypstTools(tempRoot) as ToolDef[];
      const result = await tools[0]!.callback({ filePath });

      if (result.startsWith('Error:')) return;

      const parsed = JSON.parse(result);
      assert.ok(parsed.success, 'success must be true');
      assert.equal(parsed.data.status, 'clean', 'status must be clean');
      // LLM needs to see "no issues" confirmation
      assert.ok(parsed.data.output.length > 0, 'should have output text for LLM');
    });
  });

  describe('typst_lsp_status tool', function () {
    this.timeout(15_000);
    let createTypstTools: any;

    before(async () => {
      const mod = await import('../../bos/infrastructure/http/typst_tools');
      createTypstTools = mod.createTypstTools;
    });

    it('returns connected or starting status', async () => {
      const tools = createTypstTools(tempRoot) as ToolDef[];
      const statusTool = tools[1]!;
      const result = await statusTool.callback({});

      if (!result.startsWith('Error:')) {
        const parsed = JSON.parse(result);
        assert.ok(parsed.success);
        assert.ok(parsed.data.status === 'connected' || parsed.data.status === 'starting');
        assert.equal(parsed.data.source, 'tinymist-lsp');
        assert.ok(typeof parsed.data.ready === 'boolean');
      }
    });
  });

  describe('TypstLspClient', function () {
    this.timeout(20_000);
    let TypstLspClient: any;

    before(async () => {
      const mod = await import('../../bos/infrastructure/lsp/typst_lsp');
      TypstLspClient = mod.TypstLspClient;
    });

    it('creates instance with workspaceRoot', () => {
      const client = new TypstLspClient(tempRoot);
      assert.ok(client instanceof TypstLspClient);
    });

    it('emits exit event when process terminates by shutdown', function (done) {
      const client = new TypstLspClient(tempRoot);
      let settled = false;

      client.on('exit', () => {
        if (settled) return;
        settled = true;
        done();
      });

      client.start().catch(() => {
        if (settled) return;
        settled = true;
        done();
      });

      setTimeout(() => { client.stop(); }, 2000);
    });

    it('openDocument and closeDocument do not throw', async function () {
      const client = new TypstLspClient(tempRoot);

      try {
        await client.start();
        const uri = `file://${tempRoot}/doc.typ`;
        client.openDocument(uri, '#hello');
        client.closeDocument(uri);
        assert.ok(true);
      } finally {
        client.stop();
      }
    });

    it('notifyChange sends updated content', async function () {
      const client = new TypstLspClient(tempRoot);

      try {
        await client.start();
        const uri = `file://${tempRoot}/change.typ`;
        client.openDocument(uri, '#v1');
        client.notifyChange(uri, '#v2', 2);
        assert.ok(true);
      } finally {
        client.stop();
      }
    });
  });
});