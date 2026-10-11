/**
 * Pasted-image contract shared by the chat chain:
 * webview (chat.js) → panel → agent → worker → LLM.
 *
 * The webview captures a clipboard paste, downscales it, and ships a base64
 * `data:` URL. Every hop that re-reads this payload goes through
 * {@link normalizeChatImages}: the worker's stdin is untyped JSON, so a
 * malformed or oversized image must be dropped, never allowed to take the
 * whole chat turn down.
 */

/** An image the user pasted into the chat input, already downscaled. */
export interface ChatImage {
  readonly name: string;
  /** `data:image/png;base64,…` — never an http(s) URL. */
  readonly dataUrl: string;
}

/** Upper bound per message; mirrors the webview's chip limit. */
export const MAX_IMAGES_PER_MESSAGE = 4;

/** ~1.1 MB of raw image — the webview re-encodes past this. */
export const MAX_IMAGE_DATA_URL_CHARS = 1_500_000;

/** Inert — no mime sniffing, no remote fetch; the webview only sends `data:`. */
const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * Validate an untyped payload into ChatImage[], dropping anything malformed.
 * Never throws.
 */
export function normalizeChatImages(raw: unknown): ChatImage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatImage[] = [];
  for (const item of raw) {
    if (out.length >= MAX_IMAGES_PER_MESSAGE) break;
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as { name?: unknown; dataUrl?: unknown };
    if (typeof rec.dataUrl !== 'string') continue;
    if (rec.dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) continue;
    if (!DATA_URL_RE.test(rec.dataUrl)) continue;
    out.push({
      name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'pasted-image',
      dataUrl: rec.dataUrl,
    });
  }
  return out;
}

/** One multimodal part of a chat turn, as ezbos's `ask()`/`stream()` accepts it. */
export interface ChatContentPart {
  type: string;
  text?: string;
  contentType?: string;
  name?: string;
  base64?: string;
}

/**
 * Build the first-round content of a chat turn. Text-only turns stay a plain
 * string (zero change for the existing path); with images the turn becomes a
 * multimodal part list so the model sees the actual pixels.
 *
 * Follow-up rounds (tool feedback) stay plain text — the model already saw
 * the image on round one.
 */
export function buildChatContent(text: string, images: readonly ChatImage[]): string | ChatContentPart[] {
  if (images.length === 0) return text;
  const parts: ChatContentPart[] = [{ type: 'text', text }];
  for (const img of images) {
    const m = DATA_URL_RE.exec(img.dataUrl);
    if (!m) continue; // unreachable post-normalize; never build a broken part
    parts.push({
      type: 'binary',
      contentType: m[1] as string,
      name: img.name,
      base64: m[2] as string,
    });
  }
  // Only text would be worse than the plain-string path
  return parts.length > 1 ? parts : text;
}
