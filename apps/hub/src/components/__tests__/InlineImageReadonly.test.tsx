import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { richTextExtensions } from '../RichTextContent';

// `InlineImageReadonly.renderHTML` builds an inline `style` attribute and an `<img src>`
// straight out of a persisted ProseMirror document -- content an agency member can craft
// (or that could be tampered with) and that the client portal then renders verbatim. Both
// values must be sanitized: `displayWidth` coerced to a safe number (never spliced raw
// into the style string) and `src` run through the same `sanitizeExternalUrl` allowlist
// the legacy `image` page block already uses.
//
// Built from the real `richTextExtensions()` set (not just the node in isolation) so the
// schema has the `doc`/`text` top nodes the node needs to serialize -- same approach as
// RichTextContent.test.tsx.

function renderInlineImage(attrs: Record<string, unknown>) {
  const schema = getSchema(richTextExtensions(false));
  const node = schema.nodes.inlineImage.create(attrs);
  const serializer = DOMSerializer.fromSchema(schema);
  const dom = serializer.serializeNode(node) as HTMLElement;
  return dom.querySelector('img') as HTMLImageElement;
}

// jsdom normalizes a `style` attribute string (trailing `;`, spacing) when it round-trips
// through `getAttribute`, so compare individual declarations via the CSSStyleDeclaration
// instead of the raw attribute string.
function styleDeclarations(img: HTMLImageElement): string[] {
  return Array.from(img.style).map((prop) => `${prop}: ${img.style.getPropertyValue(prop)}`);
}

describe('InlineImageReadonly sanitization', () => {
  it('rejects a crafted displayWidth that tries to inject extra CSS declarations', () => {
    const img = renderInlineImage({
      src: 'https://cdn.example.com/photo.jpg',
      displayWidth: '100px; background: url(https://attacker.example/leak)',
    });

    const style = img.getAttribute('style') ?? '';
    expect(style).not.toContain('attacker.example');
    expect(style).not.toContain('background');
    expect(img.style.width).toBe('');
    expect(styleDeclarations(img)).toEqual([
      'max-width: 100%',
      'border-radius: 8px',
      'display: block',
    ]);
  });

  it('keeps a valid numeric displayWidth', () => {
    const img = renderInlineImage({
      src: 'https://cdn.example.com/photo.jpg',
      displayWidth: 320,
    });

    expect(styleDeclarations(img)).toEqual([
      'width: 320px',
      'max-width: 100%',
      'border-radius: 8px',
      'display: block',
    ]);
  });

  it('drops a non-finite or non-positive displayWidth', () => {
    for (const value of [null, undefined, 0, -50, 'not-a-number']) {
      const img = renderInlineImage({
        src: 'https://cdn.example.com/photo.jpg',
        displayWidth: value,
      });
      expect(img.style.width).toBe('');
      expect(styleDeclarations(img)).toEqual([
        'max-width: 100%',
        'border-radius: 8px',
        'display: block',
      ]);
    }
  });

  it('blocks a javascript: src the same way sanitizeExternalUrl blocks page-block images', () => {
    const img = renderInlineImage({ src: 'javascript:alert(1)' });
    expect(img.getAttribute('src')).toBe('#');
  });

  it('allows a credential-free https src through untouched', () => {
    const img = renderInlineImage({ src: 'https://cdn.example.com/photo.jpg' });
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/photo.jpg');
  });
});
