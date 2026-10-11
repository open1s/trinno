# ADR-002: Pasted-Image Transport — Separate Channel, Inline Base64

**Date**: 2026-10-11
**Status**: Accepted

## Context

The chat input accepts pasted images (screenshots, copied figures) alongside
the text attachments covered by ADR-001. Two things constrain the design:

- **ezbos can send multimodal turns, but only as task content.**
  `agent.stream/ask/run/react/task` take `string | JsContent[]`; there is no
  attachment or image parameter on any of them. An image can only reach the
  model as an inline part of the task content for a round.
- **ADR-001 owns the text-attachment path.** `getAttachmentText()` folds text
  attachments into the message string (inline or as a `read_file` reference).
  Images have no string representation, so folding them anywhere near that
  logic would put ADR-001 regression risk on a pure formatting change.

## Decision

1. **Images travel in their own `images` array** on the `userMessage` frame,
   parallel to the existing `attachments: string[]` — not through
   `getAttachmentText()`. The text path is byte-identical to before.
2. **The contract lives in `src/bos/chat_image.ts`**: `ChatImage { name,
   dataUrl }`, `normalizeChatImages()` (validates untyped stdin JSON — image
   mime only, local data URLs only, size and count caps) and
   `buildChatContent()` (returns the plain string when there are no usable
   images, otherwise one text part plus one `binary` part per image).
3. **Only round zero of a turn carries images.** Tool-feedback rounds stay
   plain text — the model has already seen the pixels.
4. **Every layer re-validates.** The webview enforces budgets while the user
   types; the panel and the worker both run `normalizeChatImages()` again
   because the queue and the JSON-over-stdin payload are untyped.

## Rationale

- A separate channel keeps the ADR-001 hybrid logic and its tests untouched.
- `binary` parts with an `image/*` content type are exactly what ezbos emits
  for images, so the worker hands the model a shape the runtime already
  produces — no adapter, no guessing.
- Images are dropped rather than rejected: one oversized or malformed paste
  must never take down the turn, and a text-only fallback is always valid.

## Consequences

- Images are **in-memory only**: not written to `06_References/`, not saved
  in session history, lost on reload. A future revision can persist them to
  disk and reference them by path once the model side reads files.
- A text-only model rejects image parts at the API. The failure surfaces as
  a normal turn error, not a silent drop.
- Budgets (4 images, ~1.5 MB data URL each) are mirrored in the webview
  purely as a UX guard; the worker values are the source of truth.
