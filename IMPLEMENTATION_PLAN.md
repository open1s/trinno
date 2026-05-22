# Implementation Plan: Typst Cell Support

## Project Structure

```
vscode-jupyter-typst/           # Extension root
├── src/
│   ├── extension.ts              # Main entry point
│   ├── commands/
│   │   └── typstCommands.ts      # VS Code commands registration
│   ├── cells/
│   │   ├── typstCellController.ts    # Cell lifecycle management
│   │   ├── typstCellDecoration.ts    # Editor decorations (syntax, gutters)
│   │   └── typstCellOutput.ts        # Output management
│   ├── compiler/
│   │   ├── typstCompiler.ts          # Compiles Typst to SVG
│   │   ├── typstInstaller.ts         # Detects/manages typst-cli
│   │   └── typstProcess.ts           # Process spawning utilities
│   ├── renderer/
│   │   ├── renderer.ts               # Notebook output renderer entry
│   │   ├── rendererReact.tsx         # React component for SVG display
│   │   └── styles.css                # Renderer styles
│   └── types/
│       └── typst.ts                  # TypeScript interfaces
├── resources/
│   └── icon.png                     # Cell type icon
├── package.json                     # Extension manifest
├── tsconfig.json                    # TypeScript config
├── webpack.config.js               # Bundling config for renderer
└── README.md                       # Setup instructions

```

---

## Phase 1: Project Scaffold (Day 1)

### 1.1 Initialize Extension Project

**File: `package.json`**
```json
{
  "name": "vscode-jupyter-typst",
  "displayName": "Typst Cells for Jupyter",
  "description": "Add Typst markup cells to Jupyter notebooks with live preview",
  "version": "0.1.0",
  "engines": { "vscode": "^1.75.0" },
  "categories": ["Other", "Notebook"],
  "contributes": {
    "notebookRenderer": [
      {
        "id": "typst-renderer",
        "displayName": "Typst Renderer",
        "mimeTypes": ["text/typst", "image/svg+xml"]
      }
    ],
    "languages": [
      {
        "id": "typst",
        "aliases": ["Typst"],
        "extensions": [".typ"]
      }
    ],
    "notebookCellMetadata": [
      {
        "cellType": "markup",
        "languages": ["typst"]
      }
    ]
  }
}
```

### 1.2 Core Dependencies

Install required packages:
```bash
npm install @types/vscode-notebook
npm install @types/node
npm install typescript
npm install webpack webpack-cli ts-loader
```

### 1.3 Basic Extension Entry

**File: `src/extension.ts`**
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Typst Cells extension activated');

    // Register commands, controllers, and renderers
    registerTypstCommands(context);
    registerTypstCellController(context);
}

export function deactivate() {}
```

---

## Phase 2: Typst Language Registration (Day 1)

### 2.1 Register Typst Language

**File: `src/languages/typstLanguage.ts`**
```typescript
export function registerTypstLanguage() {
    const disposables: vscode.Disposable[] = [];

    // Register language configuration for syntax highlighting
    disposables.push(
        vscode.languages.setLanguageConfiguration('typst', {
            wordPattern: /#[\w]+|\$\$?|\w+|\S/g,
            indentationRules: {
                increaseIndentPattern: /\{[^}]*$/,
                decreaseIndentPattern: /^\s*\}/
            }
        })
    );

    return vscode.Disposable.from(...disposables);
}
```

---

## Phase 3: Typst Compiler Module (Day 2)

### 3.1 Process Spawner

**File: `src/compiler/typstProcess.ts`**
```typescript
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface CompileResult {
    success: boolean;
    outputPath?: string;
    error?: string;
}

export async function spawnTypst(
    args: string[],
    timeout: number = 30000
): Promise<CompileResult> {
    return new Promise((resolve) => {
        const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'typst-'));
        const inputPath = path.join(tempDir, 'input.typ');
        const outputPath = path.join(tempDir, 'output.svg');

        const process = spawn('typst', ['compile', inputPath, outputPath], {
            cwd: tempDir
        });

        const timer = setTimeout(() => {
            process.kill();
            resolve({ success: false, error: 'Compilation timed out' });
        }, timeout);

        process.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0 && fs.existsSync(outputPath)) {
                resolve({ success: true, outputPath });
            } else {
                resolve({ success: false, error: `Process exited with code ${code}` });
            }
        });
    });
}
```

### 3.2 Compiler Logic

**File: `src/compiler/typstCompiler.ts`**
```typescript
import { spawnTypst, CompileResult } from './typstProcess';
import * as fs from 'fs';
import * as path from 'path';

export class TypstCompiler {
    private cache: Map<string, string> = new Map();

    async compile(source: string): Promise<{ svg: string } | { error: string }> {
        const hash = this.hashSource(source);
        if (this.cache.has(hash)) {
            return { svg: this.cache.get(hash)! };
        }

        const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'typst-'));
        const inputPath = path.join(tempDir, 'input.typ');
        const outputPath = path.join(tempDir, 'output.svg');

        fs.writeFileSync(inputPath, source);

        const result: CompileResult = await spawnTypst(
            ['compile', inputPath, outputPath],
            30000
        );

        if (!result.success || !result.outputPath) {
            return { error: result.error || 'Unknown compilation error' };
        }

        const svg = fs.readFileSync(result.outputPath, 'utf-8');
        this.cache.set(hash, svg);

        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });

        return { svg };
    }

    private hashSource(source: string): string {
        // Simple hash for cache key
        let hash = 0;
        for (let i = 0; i < source.length; i++) {
            const char = source.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    clearCache(): void {
        this.cache.clear();
    }
}
```

### 3.3 Installer

**File: `src/compiler/typstInstaller.ts`**
```typescript
import * as vscode from 'vscode';
import { exec } from 'child_process';

export async function isTypstInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
        exec('which typst', (error) => {
            resolve(!error);
        });
    });
}

export async function ensureTypstInstalled(): Promise<boolean> {
    const installed = await isTypstInstalled();
    if (installed) return true;

    const choice = await vscode.window.showWarningMessage(
        'Typst is not installed. Install from https://typst.app/',
        'Open Website',
        'Dismiss'
    );

    if (choice === 'Open Website') {
        vscode.env.openExternal(vscode.Uri.parse('https://typst.app/'));
    }

    return false;
}
```

---

## Phase 4: Cell Controller (Day 2-3)

### 4.1 Cell Controller

**File: `src/cells/typstCellController.ts`**
```typescript
import * as vscode from 'vscode';
import { TypstCompiler } from '../compiler/typstCompiler';
import { ensureTypstInstalled } from '../compiler/typstInstaller';

export class TypstCellController {
    private compiler: TypstCompiler;
    private pendingCompilations: Map<string, vscode.CancellationTokenSource> = new Map();

    constructor() {
        this.compiler = new TypstCompiler();
    }

    register(): vscode.Disposable {
        const disposables: vscode.Disposable[] = [];

        // Listen for cell edits ending (blur)
        disposables.push(
            vscode.notebooks.onDidChangeCellEdit((e) => {
                if (e.cell.kind === vscode.NotebookCellKind.Markup &&
                    e.cell.document.languageId === 'typst') {
                    this.handleTypstCellEdit(e.cell, e);
                }
            })
        );

        // Also listen for active editor changing (another form of blur)
        disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    // Check if we left a Typst cell
                    this.checkAndCompileActiveTypstCell();
                }
            })
        );

        return vscode.Disposable.from(...disposables);
    }

    private async handleTypstCellEdit(
        cell: vscode.NotebookCell,
        event: vscode.NotebookCellEditEvent
    ): Promise<void> {
        // Cancel any pending compilation for this cell
        const pending = this.pendingCompilations.get(cell.document.uri.toString());
        if (pending) {
            pending.cancel();
            this.pendingCompilations.delete(cell.document.uri.toString());
        }

        // Show compiling state
        await cell.api.output.appendOutput({
            mime: 'text/plain',
            data: 'Compiling Typst...'
        });

        // Create new cancellation token
        const cts = new vscode.CancellationTokenSource();
        this.pendingCompilations.set(cell.document.uri.toString(), cts);

        try {
            const source = cell.document.getText();
            const result = await this.compiler.compile(source);

            if ('error' in result) {
                await cell.api.output.replaceOutput({
                    mime: 'text/plain',
                    data: `Typst Error: ${result.error}`
                });
            } else {
                await cell.api.output.replaceOutput({
                    mime: 'image/svg+xml',
                    data: result.svg
                });
            }
        } catch (error) {
            await cell.api.output.replaceOutput({
                mime: 'text/plain',
                data: `Compilation failed: ${error}`
            });
        } finally {
            cts.dispose();
            this.pendingCompilations.delete(cell.document.uri.toString());
        }
    }

    private async checkAndCompileActiveTypstCell(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        if (document.languageId !== 'typst') return;

        // Find the notebook cell for this document
        const notebook = vscode.notebooks.findNotebookEditorForDocument(document);
        if (!notebook) return;

        const cell = notebook.notebook.getCells().find(c => c.document === document);
        if (cell && cell.kind === vscode.NotebookCellKind.Markup) {
            await this.handleTypstCellEdit(cell, {} as any);
        }
    }
}
```

---

## Phase 5: Output Renderer (Day 3-4)

### 5.1 Renderer Entry Point

**File: `src/renderer/renderer.ts`**
```typescript
import * as vscode from 'vscode';
import { activate as activateRenderer } from './rendererReact';

export function activate(context: vscode.ExtensionContext) {
    // Register the renderer
    const renderer = vscode.notebook.createRenderer('typst-renderer', 'Typst Renderer');

    renderer.renderCell = (info: vscode.NotebookCellRendererInformation) => {
        activateRenderer(info);
    };

    return renderer;
}
```

### 5.2 React Renderer Component

**File: `src/renderer/rendererReact.tsx`**
```typescript
import * as React from 'react';
import * as vscode from 'vscode';

export function activate(info: vscode.NotebookCellRendererInformation) {
    const container = document.createElement('div');
    container.className = 'typst-renderer-container';

    const source = info.input();
    const mimeType = info.mime();

    if (mimeType === 'image/svg+xml') {
        renderSvg(container, source as string);
    } else if (mimeType === 'text/plain') {
        renderError(container, source as string);
    }

    info.element.appendChild(container);
}

function renderSvg(container: HTMLElement, svg: string) {
    const wrapper = document.createElement('div');
    wrapper.className = 'typst-svg-wrapper';
    wrapper.innerHTML = svg;

    const svgElement = wrapper.querySelector('svg');
    if (svgElement) {
        svgElement.style.maxWidth = '100%';
        svgElement.style.height = 'auto';
    }

    container.appendChild(wrapper);
}

function renderError(container: HTMLElement, error: string) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'typst-error';
    errorDiv.textContent = error;
    container.appendChild(errorDiv);
}
```

### 5.3 Renderer Styles

**File: `src/renderer/styles.css`**
```css
.typst-renderer-container {
    padding: 8px;
    background: #fafafa;
    border-radius: 4px;
}

.typst-svg-wrapper {
    overflow-x: auto;
    max-height: 500px;
}

.typst-svg-wrapper svg {
    display: block;
    margin: 0 auto;
}

.typst-error {
    color: #d32f2f;
    padding: 8px;
    background: #ffebee;
    border-radius: 4px;
    font-family: monospace;
    white-space: pre-wrap;
}
```

---

## Phase 6: Cell Type Selector Integration (Day 4)

### 6.1 Register Cell Type Options

**File: `src/cells/typstCellType.ts`**
```typescript
import * as vscode from 'vscode';

export function registerTypstCellType(): vscode.Disposable {
    // Add "Typst" to the cell type quick pick
    // This is handled by VS Code's built-in notebook UI
    // We just need to ensure 'typst' language is properly registered

    return vscode.Disposable.from();
}

// Add context menu to change cell type to typst
export function registerCellTypeContextMenu(): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
        vscode.commands.registerCommand(
            'jupyter-typst.changeCellToTypst',
            async () => {
                const editor = vscode.window.activeNotebookEditor;
                if (!editor) return;

                const cell = editor.selections[0];
                if (!cell) return;

                const cellData = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Markup,
                    '',
                    'typst'
                );

                await editor.edit.replaceCells(cell.index, cell.index + 1, [cellData]);
            }
        )
    );

    return vscode.Disposable.from(...disposables);
}
```

---

## Phase 7: Package.json Contribution Points (Day 4)

**File: `package.json` additions**
```json
{
  "contributes": {
    "commands": [
      {
        "command": "jupyter-typst.changeCellToTypst",
        "title": "Change Cell to Typst",
        "category": "Typst"
      }
    ],
    "menus": {
      "commandPalette": [
        {
          "command": "jupyter-typst.changeCellToTypst",
          "when": "notebookCellType == markdown || notebookCellType == code"
        }
      ]
    },
    "notebookRenderer": [
      {
        "id": "typst-renderer",
        "displayName": "Typst Renderer",
        "entrypoint": "./dist/renderer.js",
        "mimeTypes": ["image/svg+xml", "text/plain"]
      }
    ],
    "languages": [
      {
        "id": "typst",
        "aliases": ["Typst"],
        "extensions": [".typ"],
        "configuration": "./language-configuration.json"
      }
    ]
  }
}
```

---

## Phase 8: Testing (Day 5)

### 8.1 Unit Tests

**File: `src/test/typstCompiler.test.ts`**
```typescript
import * as assert from 'assert';
import { TypstCompiler } from '../compiler/typstCompiler';

suite('TypstCompiler', () => {
    test('compiles valid typst source', async () => {
        const compiler = new TypstCompiler();
        const result = await compiler.compile('Hello World');

        assert.ok('svg' in result, 'Should return SVG on success');
        assert.ok((result as any).svg.includes('<svg'), 'SVG should contain svg tag');
    });

    test('returns error for invalid typst', async () => {
        const compiler = new TypstCompiler();
        const result = await compiler.compile('#heading[}');

        assert.ok('error' in result, 'Should return error');
    });

    test('caches repeated compilations', async () => {
        const compiler = new TypstCompiler();
        const source = 'Test content';

        await compiler.compile(source);
        await compiler.compile(source);

        assert.equal(compiler.getCacheSize(), 1, 'Should cache result');
    });
});
```

### 8.2 Integration Test

**File: `src/test/typstCell.integration.test.ts`**
```typescript
import * as vscode from 'vscode';

suite('Typst Cell Integration', () => {
    test('creates and compiles typst cell', async () => {
        // Open a notebook or create one
        // Insert typst cell
        // Verify output appears
    });
});
```

---

## Task Dependencies

```
Day 1: Project Scaffold + Language Registration
├── Initialize npm project
├── Install dependencies
├── Set up tsconfig
├── Register 'typst' language

Day 2: Compiler Module
├── Implement typstProcess.ts
├── Implement typstCompiler.ts
├── Implement typstInstaller.ts
└── Unit tests

Day 3: Cell Controller
├── Implement typstCellController.ts
├── Wire up cell edit listeners
├── Handle compilation trigger
└── Error display

Day 4: Renderer + Integration
├── Implement renderer entry point
├── Build React component for SVG display
├── Add CSS styles
├── Register cell type commands
└── Update package.json

Day 5: Testing + Polish
├── Write unit tests
├── Integration tests
├── Error handling edge cases
└── Documentation
```

---

## Verification Checklist

- [ ] Typst cell type appears in cell type picker
- [ ] Typst syntax highlighting works
- [ ] Cell blur triggers compilation
- [ ] SVG output displays inline
- [ ] Errors display correctly
- [ ] Works with multiple Typst cells
- [ ] Notebook saves/loads correctly
- [ ] Extension activates without errors
- [ ] Typst not installed shows helpful message