import * as assert from 'assert';

import {
  buildChatContent,
  normalizeChatImages,
  MAX_IMAGES_PER_MESSAGE,
  MAX_IMAGE_DATA_URL_CHARS,
} from '../../bos/chat_image.js';

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

describe('chat_image', () => {
  describe('normalizeChatImages', () => {
    it('keeps a well-formed image data URL', () => {
      const out = normalizeChatImages([{ name: 'shot.png', dataUrl: PNG_1PX }]);
      assert.deepStrictEqual(out, [{ name: 'shot.png', dataUrl: PNG_1PX }]);
    });

    it('defaults the name when missing or blank', () => {
      const out = normalizeChatImages([{ dataUrl: PNG_1PX }, { name: '   ', dataUrl: JPEG_1PX }]);
      assert.deepStrictEqual(out.map(i => i.name), ['pasted-image', 'pasted-image']);
    });

    it('drops non-arrays, nulls and non-objects without throwing', () => {
      assert.deepStrictEqual(normalizeChatImages(undefined), []);
      assert.deepStrictEqual(normalizeChatImages(null), []);
      assert.deepStrictEqual(normalizeChatImages('data:image/png;base64,AAAA'), []);
      assert.deepStrictEqual(normalizeChatImages([null, 7, 'x', [], { dataUrl: PNG_1PX }]).length, 1);
    });

    it('drops non-image mimes and remote URLs', () => {
      const out = normalizeChatImages([
        { name: 'note', dataUrl: 'data:text/plain;base64,aGVsbG8=' },
        { name: 'remote', dataUrl: 'https://example.com/a.png' },
        { name: 'raw', dataUrl: 'iVBORw0KGgo=' },
        { name: 'js', dataUrl: 'data:text/javascript;base64,Zm9v' },
      ]);
      assert.deepStrictEqual(out, []);
    });

    it('caps the count per message', () => {
      const raw = Array.from({ length: 10 }, (_, i) => ({ name: `img${i}`, dataUrl: PNG_1PX }));
      assert.strictEqual(normalizeChatImages(raw).length, MAX_IMAGES_PER_MESSAGE);
    });

    it('drops oversized data URLs', () => {
      const huge = `data:image/png;base64,${'A'.repeat(MAX_IMAGE_DATA_URL_CHARS)}`;
      assert.deepStrictEqual(normalizeChatImages([{ dataUrl: huge }]), []);
    });

    it('keeps several images in order', () => {
      const out = normalizeChatImages([
        { name: 'a.png', dataUrl: PNG_1PX },
        { name: 'b.jpg', dataUrl: JPEG_1PX },
      ]);
      assert.deepStrictEqual(out.map(i => i.name), ['a.png', 'b.jpg']);
    });
  });

  describe('buildChatContent', () => {
    it('returns the text unchanged when there are no images', () => {
      assert.strictEqual(buildChatContent('hello', []), 'hello');
    });

    it('builds a text part plus one binary part per image', () => {
      const parts = buildChatContent('what is this?', normalizeChatImages([
        { name: 'shot.png', dataUrl: PNG_1PX },
      ]));
      assert.ok(Array.isArray(parts), 'expected a multimodal part list');
      const list = parts as { type: string; text?: string; contentType?: string; name?: string; base64?: string }[];
      assert.strictEqual(list.length, 2);
      assert.deepStrictEqual(list[0], { type: 'text', text: 'what is this?' });
      assert.deepStrictEqual(list[1], {
        type: 'binary',
        contentType: 'image/png',
        name: 'shot.png',
        base64: PNG_1PX.slice(PNG_1PX.indexOf(',') + 1),
      });
    });

    it('splits mime and payload for a jpeg', () => {
      const parts = buildChatContent('x', [{ name: 'b.jpg', dataUrl: JPEG_1PX }]) as { contentType?: string }[];
      assert.strictEqual(parts[1]?.contentType, 'image/jpeg');
    });

    it('falls back to the plain string when every image is unusable', () => {
      assert.strictEqual(buildChatContent('hi', [{ name: 'bad', dataUrl: 'nope' }]), 'hi');
    });

    it('drops unusable images but keeps the usable ones', () => {
      const parts = buildChatContent('hi', [
        { name: 'bad', dataUrl: 'nope' },
        { name: 'good.png', dataUrl: PNG_1PX },
      ]) as { type: string; name?: string }[];
      assert.strictEqual(parts.length, 2);
      assert.strictEqual(parts[1]?.name, 'good.png');
    });
  });
});
