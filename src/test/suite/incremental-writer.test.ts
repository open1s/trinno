import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapFile,
  readFileTail,
  readFullFile,
  buildBootstrapPrompt,
  buildContinuePrompt,
  isComplete,
  detectDoneInText,
  hasAnchor,
  isWriteType,
  LLM_ANCHOR,
  COMPLETE_MARKER_PAPER,
  COMPLETE_MARKER_PATENT,
} from '../../chat/incremental_writer';

suite('incremental_writer', () => {
  let tempRoot: string;

  setup(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trinno-incr-'));
  });

  teardown(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('bootstrapFile writes title + anchor', async () => {
    const filePath = path.join(tempRoot, 'paper.md');
    await bootstrapFile(
      { type: 'paper', title: 'AI Test', writePath: 'paper.md' },
      tempRoot
    );
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.startsWith('# AI Test'));
    assert.ok(content.includes(LLM_ANCHOR));
  });

  test('bootstrapFile creates parent dirs', async () => {
    const filePath = path.join(tempRoot, 'a', 'b', 'c.md');
    await bootstrapFile(
      { type: 'patent', title: 'P', writePath: 'a/b/c.md' },
      tempRoot
    );
    assert.ok(fs.existsSync(filePath));
  });

  test('readFileTail returns last N chars', async () => {
    const filePath = path.join(tempRoot, 'p.md');
    fs.writeFileSync(filePath, 'A'.repeat(2000) + 'TAIL', 'utf-8');
    const tail = await readFileTail(filePath, 50);
    assert.ok(tail.endsWith('TAIL'));
    assert.ok(tail.length <= 50);
  });

  test('readFullFile returns whole content', async () => {
    const filePath = path.join(tempRoot, 'p.md');
    fs.writeFileSync(filePath, 'hello world', 'utf-8');
    const all = await readFullFile(filePath);
    assert.strictEqual(all, 'hello world');
  });

  test('isComplete detects paper marker', () => {
    assert.ok(isComplete(`# T\n\n${COMPLETE_MARKER_PAPER}`, 'paper'));
    assert.ok(!isComplete(`# T\n\n${LLM_ANCHOR}`, 'paper'));
  });

  test('isComplete detects patent marker', () => {
    assert.ok(isComplete(`# T\n\n${COMPLETE_MARKER_PATENT}`, 'patent'));
    assert.ok(!isComplete(`# T\n\n${LLM_ANCHOR}`, 'patent'));
  });

  test('detectDoneInText catches Chinese completion phrases', () => {
    assert.ok(detectDoneInText('论文撰写完成。'));
    assert.ok(detectDoneInText('专利撰写完毕。'));
    assert.ok(detectDoneInText('All done, paper is finished.'));
    assert.ok(!detectDoneInText('继续写'));
  });

  test('hasAnchor finds the marker', () => {
    assert.ok(hasAnchor(`# T\n\n${LLM_ANCHOR}\n`));
    assert.ok(!hasAnchor('# T\n\nno marker here'));
  });

  test('buildBootstrapPrompt mentions title and anchor', () => {
    const p = buildBootstrapPrompt({
      type: 'paper',
      title: 'X',
      writePath: 'paper.md',
    });
    assert.ok(p.includes('X'));
    assert.ok(p.includes(LLM_ANCHOR));
  });

  test('buildContinuePrompt asks for next section', () => {
    const p = buildContinuePrompt(
      { type: 'paper', title: 'X', writePath: 'paper.md' },
      '# X\n\n## 摘要\nbody\n'
    );
    assert.ok(p.includes(LLM_ANCHOR));
    assert.ok(p.includes('继续') || p.includes('下一节') || p.includes('append'));
  });

  test('buildContinuePrompt interpolates the completion marker (V&V)', () => {
    const paper = buildContinuePrompt(
      { type: 'paper', title: 'X', writePath: 'paper.md' },
      ''
    );
    assert.ok(paper.includes(COMPLETE_MARKER_PAPER), 'paper prompt must contain PAPER_COMPLETE marker');
    assert.ok(!paper.includes('${completeMarkerFor'), 'marker must not remain as literal template text');
    assert.ok(paper.includes(COMPLETE_MARKER_PAPER + '`'), 'marker must be delimited as code');

    const patent = buildContinuePrompt(
      { type: 'patent', title: 'Y', writePath: 'patent.md' },
      ''
    );
    assert.ok(patent.includes(COMPLETE_MARKER_PATENT), 'patent prompt must contain PATENT_COMPLETE marker');
  });

  test('isWriteType validates values', () => {
    assert.ok(isWriteType('paper'));
    assert.ok(isWriteType('patent'));
    assert.ok(!isWriteType('other'));
  });

  test('bootstrapFile preserves file with existing anchor (resume)', async () => {
    const filePath = path.join(tempRoot, 'paper.md');
    const existing = `# AI Test\n\n## 摘要\nold body\n\n${LLM_ANCHOR}\n`;
    fs.writeFileSync(filePath, existing, 'utf-8');
    await bootstrapFile(
      { type: 'paper', title: 'AI Test', writePath: 'paper.md' },
      tempRoot
    );
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.strictEqual(content, existing, 'file unchanged when anchor present');
  });

  test('bootstrapFile backs up existing content with non-anchor before overwriting', async () => {
    const filePath = path.join(tempRoot, 'paper.md');
    const existing = '# AI Test\n\n## 摘要\nlots of work the LLM did\n';
    fs.writeFileSync(filePath, existing, 'utf-8');
    await bootstrapFile(
      { type: 'paper', title: 'AI Test', writePath: 'paper.md' },
      tempRoot
    );
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes(LLM_ANCHOR), 'file now has anchor');
    const files = fs.readdirSync(tempRoot);
    const bak = files.find(f => f.endsWith('.bak'));
    assert.ok(bak, 'a .bak file was created');
    const bakContent = fs.readFileSync(path.join(tempRoot, bak!), 'utf-8');
    assert.strictEqual(bakContent, existing, 'backup preserves original');
  });

  test('bootstrapFile does not back up empty file', async () => {
    const filePath = path.join(tempRoot, 'paper.md');
    fs.writeFileSync(filePath, '', 'utf-8');
    await bootstrapFile(
      { type: 'paper', title: 'Fresh', writePath: 'paper.md' },
      tempRoot
    );
    const files = fs.readdirSync(tempRoot);
    const bak = files.find(f => f.endsWith('.bak'));
    assert.ok(!bak, 'no .bak file for empty file');
  });
});
