import * as vscode from 'vscode';
import type { NotebookContext, CellInfo } from './messages';
import { getChatConfig } from './settings';

export function extractNotebookContext(): NotebookContext {
  const config = getChatConfig();
  const maxChars = config.context.maxCharsPerCell;

  const editor = vscode.window.activeNotebookEditor;
  if (!editor) {
    return { notebookName: null, cellCount: 0, cursorCell: null, cells: [] };
  }

  const notebook = editor.notebook;
  const cells: CellInfo[] = [];

  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    const rawContent = cell.document.getText();
    const content = rawContent.length > maxChars
      ? rawContent.slice(0, maxChars) + '...'
      : rawContent;

    cells.push({
      index: i,
      type: cell.document.languageId,
      content,
    });
  }

  const selection = editor.selection;
  const cursorCell = selection.start >= 0 && selection.start < notebook.cellCount
    ? selection.start
    : null;

  return {
    notebookName: notebook.uri.fsPath.split('/').pop() ?? null,
    cellCount: notebook.cellCount,
    cursorCell,
    cells,
  };
}

export function formatContextForPrompt(ctx: NotebookContext | null): string {
  if (!ctx) {
    return 'No notebook is currently open.';
  }

  let header = `Current notebook: ${ctx.notebookName} (${ctx.cellCount} cells)`;
  if (ctx.cursorCell !== null) {
    header += `, cursor at cell ${ctx.cursorCell}`;
  }
  header += '.';

  if (ctx.cells.length === 0) {
    return header + '\nNo cells.';
  }

  const cellLines = ctx.cells.map(c => {
    return `[${c.index}] ${c.type}: ${c.content}`;
  });

  return [header, 'Cells:', ...cellLines].join('\n');
}

export function getActiveCellIndex(): number | null {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) return null;
  const sel = editor.selection;
  if (sel.start < 0 || sel.start >= editor.notebook.cellCount) return null;
  return sel.start;
}

export async function insertCellAt(
  content: string,
  cellType: 'code' | 'markdown',
  position: 'cursor' | 'end' = 'cursor'
): Promise<{ notebookUri: string; cellIndex: number } | null> {
  const editor = vscode.window.activeNotebookEditor;
  if (!editor) return null;

  const notebook = editor.notebook;
  const targetIndex = position === 'cursor'
    ? getActiveCellIndex() ?? notebook.cellCount
    : notebook.cellCount;

  const languageId = cellType === 'code' ? 'python' : 'markdown';

  const newCellData = new vscode.NotebookCellData(
    cellType === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
    content,
    languageId
  );

  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.NotebookRange(targetIndex, targetIndex);
  const notebookEdit = new vscode.NotebookEdit(range, [newCellData]);
  edit.set(notebook.uri, [[notebookEdit, undefined]]);

  await vscode.workspace.applyEdit(edit);

  return {
    notebookUri: notebook.uri.toString(),
    cellIndex: targetIndex,
  };
}

export async function undoLastInsert(
  notebookUri: string,
  cellIndex: number
): Promise<boolean> {
  try {
    const targetNotebook = vscode.workspace.notebookDocuments.find(
      n => n.uri.toString() === notebookUri
    );
    if (!targetNotebook || cellIndex >= targetNotebook.cellCount) return false;

    const edit = new vscode.WorkspaceEdit();
    const range = new vscode.NotebookRange(cellIndex, cellIndex + 1);
    const notebookEdit = new vscode.NotebookEdit(range, []);
    edit.set(targetNotebook.uri, [[notebookEdit, undefined]]);
    await vscode.workspace.applyEdit(edit);
    return true;
  } catch {
    return false;
  }
}

export interface AttachmentContext {
  mode: 'inline' | 'reference';
  content: string;
  filePath: string;
  lineRange: string | null;
  startLine?: number;
  endLine?: number;
  language: string;
  truncated: boolean;
}

function getWorkspaceRelativePath(uri: vscode.Uri): string {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (workspaceFolder) {
    return vscode.workspace.asRelativePath(uri, false);
  }
  return uri.fsPath;
}

export function extractNotebookCellSelection(maxChars: number): AttachmentContext | null {
  const textEditor = vscode.window.activeTextEditor;
  if (!textEditor) return null;

  const sel = textEditor.selection;
  if (sel.isEmpty) return null;

  const content = textEditor.document.getText(sel);
  if (!content.trim()) return null;

  const truncated = content.length > maxChars;
  const finalContent = truncated ? content.slice(0, maxChars) + '\n\n... (truncated)' : content;

  const nbEditor = vscode.window.activeNotebookEditor;
  if (!nbEditor) return null;

  const notebookName = nbEditor.notebook.uri.fsPath.split('/').pop() ?? 'notebook';
  const cellIdx = nbEditor.selection.start;
  const startLine = sel.start.line + 1;
  const endLine = sel.end.line + 1;
  const filePath = `${notebookName}[cell ${cellIdx + 1}, lines ${startLine}-${endLine}]`;
  const language = textEditor.document.languageId;

  return { mode: 'inline', content: finalContent, filePath, lineRange: `${startLine}-${endLine}`, language, truncated };
}

export function extractEditorSelection(maxChars: number): AttachmentContext | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const selection = editor.selection;
  const isSelection = !selection.isEmpty;
  const document = editor.document;

  const range = isSelection ? selection : new vscode.Range(0, 0, document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
  const content = document.getText(range);

  if (!content.trim()) return null;

  const isOversized = content.length > maxChars;
  
  let finalContent: string;
  let mode: 'inline' | 'reference' = 'inline';
  let startLine: number | undefined;
  let endLine: number | undefined;
  let filePath = document.uri.fsPath;

  if (isOversized) {
    mode = 'reference';
    filePath = getWorkspaceRelativePath(document.uri);
    startLine = range.start.line + 1;
    endLine = range.end.line + 1;
    
    // Preview: first 5 lines or 200 chars
    const previewLines = content.split('\n').slice(0, 5).join('\n');
    finalContent = previewLines.length > 200 ? previewLines.slice(0, 200) + '...' : previewLines;
  } else {
    finalContent = content;
  }

  const lineRange = isSelection
    ? `${selection.start.line + 1}-${selection.end.line + 1}`
    : null;
  const language = document.languageId;

  const result: AttachmentContext = { 
    mode,
    content: finalContent, 
    filePath, 
    lineRange, 
    language, 
    truncated: isOversized 
  };
  
  if (startLine !== undefined) result.startLine = startLine;
  if (endLine !== undefined) result.endLine = endLine;
  
  return result;
}

export async function extractWholeNotebook(uri: vscode.Uri, _maxChars: number): Promise<AttachmentContext | null> {
  const notebook = vscode.workspace.notebookDocuments.find(n => n.uri.toString() === uri.toString());
  if (!notebook) return null;

  const cells: string[] = [];
  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    const lang = cell.document.languageId;
    cells.push(`- Cell ${i + 1} (${lang})`);
  }

  const fullContent = cells.join('\n');
  if (!fullContent.trim()) return null;

  const filePath = getWorkspaceRelativePath(uri);
  const language = 'notebook';

  return { mode: 'reference', content: fullContent, filePath, lineRange: null, language, truncated: true };
}

export async function extractWholeFile(uri: vscode.Uri, maxChars: number): Promise<AttachmentContext | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = new TextDecoder('utf-8').decode(bytes);

    if (!content.trim()) return null;

    const isOversized = content.length > maxChars;
    let finalContent: string;
    let mode: 'inline' | 'reference' = 'inline';
    let filePath = uri.fsPath;
    let endLine: number | undefined;

    if (isOversized) {
      mode = 'reference';
      filePath = getWorkspaceRelativePath(uri);
      
      const lines = content.split('\n');
      endLine = lines.length;
      
      // Preview: first 5 lines or 200 chars
      const previewLines = lines.slice(0, 5).join('\n');
      finalContent = previewLines.length > 200 ? previewLines.slice(0, 200) + '...' : previewLines;
    } else {
      finalContent = content;
    }

    const ext = filePath.split('.').pop() ?? '';
    const languageMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', md: 'markdown', json: 'json', typ: 'typst',
      html: 'html', css: 'css', scss: 'scss', less: 'less',
      rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
      rb: 'ruby', php: 'php', swift: 'swift',
      yaml: 'yaml', yml: 'yaml', xml: 'xml', toml: 'toml',
      sh: 'shell', bash: 'shell', zsh: 'shell',
      sql: 'sql', graphql: 'graphql',
    };
    const language = languageMap[ext] || ext || 'text';

    const result: AttachmentContext = { 
      mode,
      content: finalContent, 
      filePath, 
      lineRange: null, 
      language, 
      truncated: isOversized 
    };
    
    if (endLine !== undefined) {
      result.startLine = 1;
      result.endLine = endLine;
    }
    
    return result;
  } catch {
    return null;
  }
}

