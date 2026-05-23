# ADR-001: Hybrid Attachment Strategy — Inline Content vs File References

**Date**: 2026-05-23  
**Status**: Proposed

## Context

Trinno Chat lets users attach code context to LLM messages via "Send Selection", "Send Current File", and "Choose File". The current implementation always inlines full content as markdown code blocks, truncated at `maxCharsPerAttachment` (default 5000 chars).

This has problems:
- Token waste when the LLM doesn't need all the content
- Stale content — the LLM reasons about a snapshot, not current code
- Truncation loses information silently

## Decision

Use a **hybrid strategy**:

1. **Content ≤ `maxCharsPerAttachment` (default 2000)**: inline full content as a markdown code block (unchanged from current behavior).
2. **Content > threshold**: send a **file reference** — workspace-relative path, line range, and a short preview (~200 chars / 3-5 lines) — with an explicit tool hint: `Use read_file("path", startLine=N, endLine=M) for full content.`
3. **Whole notebooks**: always send as reference with cell-headers preview (no inline, regardless of size).
4. **Session history**: stores reference + preview, not full content.

The BOS worker already has a `read_file` tool (`coding_tools.ts`) accepting `filePath`, `startLine`, `endLine`.

## Rationale

### Why hybrid (not pure inline or pure reference)
- Pure inline burns tokens on content the LLM may not need.
- Pure reference wastes a round-trip for small snippets the LLM could answer from immediately.
- The threshold at ~2000 chars catches the common case (a ~30-line function) where inline is worthwhile, while large files and datasets get the lightweight treatment.

### Why references over inline for large content
- The LLM reads **current** file state, not a stale snapshot.
- Messages stay lightweight → faster API calls, lower cost, less context window pressure.
- The `read_file` tool already exists and is trusted (workspace-relative, sandboxed to workspace root).

### Why cell-headers preview for notebooks
- Notebooks are structural — knowing which cells exist is often enough context.
- Inlining even small notebooks balloons quickly (many cells × code per cell).
- The LLM can `read_file` specific cells of interest.

### Why no snapshot/drift detection
- Standard tool-use semantics: the LLM reads what's there now.
- Tools like Cursor and Aider follow this pattern.
- Adding snapshot fallback increases complexity without clear benefit.

## Consequences

### Positive
- Reduced token usage for large attachments.
- LLM always works with current file state.
- UI chips distinguish inline vs reference attachments (clarity for users).

### Negative
- Extra round-trip when LLM needs to read referenced files → slower first response.
- File drift between send-time and read-time could confuse the LLM (e.g., lines shifted after edit).
- Changing `maxCharsPerAttachment` default from 5000 to 2000 is a behavior change for existing users.

### Neutral
- `maxCharsPerAttachment` configuration key repurposed from "truncation cap" to "inline-vs-reference threshold".
- New format string added to the codebase for file reference messages.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Pure inline (status quo) | Wastes tokens, content goes stale, truncation is lossy |
| Pure references | Adds round-trip even for trivial snippets |
| Reference + snapshot fallback | Adds complexity; file drift is rare and acceptable |
| Hash/version-based drift detection | Over-engineered for the problem; adds state tracking |