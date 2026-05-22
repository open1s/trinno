# Inline Typst Cell Preview

**Status:** ready-for-agent

## Problem Statement

Typst cells in Jupyter notebooks show the source text with the SVG output rendered as a separate "output" section below the cell. This is standard Jupyter behavior, but for Typst cells the preview should be the primary visible content. The user wants the source replaced inline by the rendered SVG, with the source preserved and restorable on click.

## Solution

Modify `setCellSvgOutput` to replace the cell's content (not add output below). Store the original source in cell metadata so it persists through the replace. Update `handleNotebookSelection` to detect when a preview cell is clicked and restore source from metadata. Add a debounce layer for typing and a `justRestored` guard to prevent unwanted compile cycles.

## User Stories

1. As a user, I want my Typst source to be replaced by the SVG preview when I blur or change selection, so the rendered output is immediately visible without scrolling
2. As a user, I want the original source preserved in cell metadata, so switching to preview and back does not lose data
3. As a user, I want to click a preview cell to restore the source, so I can continue editing
4. As a user, I want preview to update automatically when I blur or change selection, so I see the rendered result of my changes
5. As a user, I want debounced compilation while typing, so the preview updates when I pause but does not lag during fast typing
6. As a user, I want to avoid a compile cycle immediately after restoring source, so I can type without the preview flickering or interfering
7. As a user, I want error messages to still be shown, so I know when my Typst code has a compilation error
8. As a user, I want the status bar item to reflect the current compilation state, so I know whenTypst is processing

## Implementation Decisions

### Metadata schema

Cells in preview mode carry this metadata:

```json
{
  "jupyter-typst": {
    "originalSource": "<typst source string>",
    "justRestored": true,
    "isPreview": true
  }
}
```

The `justRestored` flag is set by `handleNotebookSelection` when a preview cell is clicked and source is restored. It is cleared by `handleEditorChange` the first time a keystroke occurs, preventing a compile cycle during that first keystroke.

### `handleNotebookSelection` — two behaviors

When `currentCell.document.languageId === 'typst-cell'` (edit mode):
- If `activeCellKey` is set and different from the current cell, call `compileAndUpdate` on the previous cell
- Set `activeCellKey = currentKey`

When `currentCell.document.languageId === 'html'` (preview mode — cell content is SVG):
- Read `originalSource` from cell metadata
- Create a new `NotebookCellData` with `cell.kind`, `originalSource`, languageId `'typst-cell'`, and no outputs
- Replace the cell via `NotebookEdit.replaceCells`
- In the resulting cell, set `metadata['jupyter-typst'].justRestored = true`
- Set `activeCellKey = this.cellKey(restoredCell)` so the next blur will recompile

### `handleEditorChange` — `justRestored` guard

At the top of `handleEditorChange`, before any compile call:
- Find the cell by `activeCellKey`
- If found and cell has `metadata['jupyter-typst']?.justRestored === true`, clear the flag and **return early** (skip compile)
- Normal flow continues otherwise

### `compileAndUpdate` — inline preview instead of output

When `result.success`:
- Create `NotebookCellData` with:
  - `kind`: `cell.kind`
  - `value`: HTML string wrapping the SVG (`<html><body>{svg}</body></html>`)
  - `languageId`: `'html'`
  - `outputs`: empty (no output section — the HTML *is* the cell content)
- Read current source and store as `originalSource` in new cell's metadata
- Replace the cell with `NotebookEdit.replaceCells`
- Cache source in `cachedSource`

When `result.error`:
- Call `setCellErrorOutput` which adds error as a cell output below (unchanged behavior — error shows below source)

### Debounce on `handleEditorChange`

Use a 500ms debounce window around `compileAndUpdate` in `handleEditorChange`. When `handleNotebookSelection` fires (another cell selected), if there is a pending debounced compile for the previous cell, invoke it immediately (pass `immediate: true`).

### `executeTypstCell` — run button behavior

The notebook controller's `executeTypstCell` is triggered by the cell Run button. It currently calls `execution.replaceOutput` which adds SVG output below the source. This behavior is unchanged for now.

### `TypstCellState` type

The existing `TypstCellState` interface tracks `cellUri`, `lastSource`, `lastOutput`, `isCompiling`. Extend it to include `isPreview: boolean`. Add `originalSource: string` to allow restoring from any intermediate state.

### Cell controller registers `onDidChangeNotebookEditorSelection` with `{ fireOnChangedSelection: false }`

Ensure the selection-change event only fires on explicit selection changes, not on output changes that happen to move the cursor.

## Testing Decisions

Tests should verify external behavior, not implementation details. The test file already has good patterns using `vscode.workspace.openNotebookDocument` and `vscode.notebook.open`.

**Key behaviors to test:**

1. **Blur from Typst cell → source replaced by SVG content (not output below)**
   - Open notebook, add Typst cell with `= Hello, Typst!`
   - Set selection to another cell, wait for compile
   - Verify the cell's `document.getText()` returns HTML (not Typst source)
   - Verify `cell.outputs.length === 0` (no output section)

2. **Click preview cell → source restored**
   - Previous state: cell shows SVG (languageId `'html'`)
   - Set selection to that cell
   - Verify the resulting cell's `document.languageId === 'typst-cell'`
   - Verify `document.getText()` returns the original Typst source
   - Verify `outputs.length === 0`

3. **`justRestored` flag prevents compile on first keystroke**
   - Restore cell to source, then immediately simulate an editor change
   - Verify no compile occurs (status item unchanged)

4. **Debounce: rapid keystrokes do not trigger multiple compiles**
   - Type 5 characters with <100ms between each
   - Verify only one compile occurs (check `compileGenerations` map)

5. **Error output still appears below source**
   - Compile a cell with invalid Typst source
   - Verify `cell.outputs.length > 0` and output contains error text

6. **`executeTypstCell` run button behavior unchanged**
   - Run a cell, verify output appears below source (existing behavior)

**Prior art:** The existing test file at `src/test/suite/extension.test.ts` is the reference for notebook testing patterns.

## Out of Scope

- Modifying `executeTypstCell` to use inline preview (run button behavior unchanged)
- PDF/PNG output formats (only SVG for inline preview)
- Preview for standalone `.typ` files (only notebook cells)
- Converting existing notebooks with Typst output cells to the new inline format

## Further Notes

- The `activeCellKey` and `compileGenerations` mechanism already prevents stale compiles. The `justRestored` flag adds on top of this for the click-to-edit case.
- When `handleNotebookSelection` fires on a preview cell (click), the `activeCellKey` is updated to the restored cell, so the blur → compile flow continues to work naturally.
- The `statusItem` in `TypstCellController` provides feedback for all async compilation states (`sync~spin`, `check`, `error`).