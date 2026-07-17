import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createInlineImageExtension } from '../../entregas/components/InlineImageExtension';

const dummyUpload = async () => ({ r2Key: '', src: '', width: 0, height: 0 });

function imgNode(src: string) {
  return {
    type: 'inlineImage',
    attrs: { r2Key: null, src, alt: 'Tela de exemplo', width: 1440, height: 900 },
  };
}

describe('inlineImage in article schema', () => {
  it('survives a round-trip nested inside an ordered listItem', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 1 },
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Acesse Post Express' }] },
                imgNode('https://example.test/a.png'),
              ],
            },
          ],
        },
      ],
    };

    const editor = new Editor({
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        createInlineImageExtension(dummyUpload),
      ],
      content: doc,
    });

    const out = JSON.stringify(editor.getJSON());
    expect(out).toContain('inlineImage');
    expect(out).toContain('https://example.test/a.png');
    editor.destroy();
  });

  it('preserves r2Key null so the node never routes through sign-r2-urls', () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        createInlineImageExtension(dummyUpload),
      ],
      content: { type: 'doc', content: [imgNode('https://example.test/b.png')] },
    });

    const json = editor.getJSON() as any;
    expect(json.content[0].attrs.r2Key).toBeNull();
    editor.destroy();
  });
});
