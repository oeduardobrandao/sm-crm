import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { readOnlyTipTapExtensions } from '../ReadOnlyTipTap';

// ReadOnlyTipTap renders `conteudo` wherever the CRM shows a post read-only (approvals,
// history, etc). Its extension list must register every node/mark the editable PostEditor
// can persist, or TipTap silently drops the whole document on read -- same invariant as the
// hub's richTextExtensions (apps/hub/src/components/__tests__/RichTextContent.test.tsx).
describe('ReadOnlyTipTap extensions (readOnlyTipTapExtensions)', () => {
  it('parses body text that carries a commentHighlight mark', () => {
    // Exactly what PostEditor persists into `conteudo` when an agent leaves a comment on
    // post text (setCommentHighlight -> setMark). Without the mark registered, TipTap drops
    // the WHOLE document, which is what left "Sugestão do cliente" rendering blank.
    const commentedDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'CENA 1 do roteiro',
              marks: [{ type: 'commentHighlight', attrs: { threadId: 7, resolved: false } }],
            },
          ],
        },
      ],
    };

    const schema = getSchema(readOnlyTipTapExtensions);
    const doc = PMNode.fromJSON(schema, commentedDoc);

    expect(doc.textContent).toContain('CENA 1 do roteiro');
  });

  it('parses a doc containing an inlineImage node', () => {
    // Exactly what PostEditor persists into `conteudo` when an image is pasted/dropped into
    // the body (createInlineImageExtension -> insertInlineImage).
    const imageDoc = {
      type: 'doc',
      content: [
        {
          type: 'inlineImage',
          attrs: { r2Key: 'posts/123/img.png', src: 'https://example.com/img.png', width: 800 },
        },
      ],
    };

    const schema = getSchema(readOnlyTipTapExtensions);
    const doc = PMNode.fromJSON(schema, imageDoc);

    const found: unknown[] = [];
    doc.descendants((node) => {
      if (node.type.name === 'inlineImage') found.push(node.attrs);
    });

    expect(found).toHaveLength(1);
  });

  it('parses a doc containing a mention node for every entity type', () => {
    const mentionAttrs = [
      { entityType: 'membro', id: 1, label: 'Ana', parentId: null },
      { entityType: 'post', id: 2, label: 'Post de lançamento', parentId: 42 },
      { entityType: 'cliente', id: 3, label: 'Clínica X', parentId: null },
      { entityType: 'tarefa', id: 4, label: 'Revisar copy', parentId: null },
    ];
    const mentionDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: mentionAttrs.map((attrs) => ({ type: 'mention', attrs })),
        },
      ],
    };

    const schema = getSchema(readOnlyTipTapExtensions);
    const doc = PMNode.fromJSON(schema, mentionDoc);

    const found: unknown[] = [];
    doc.descendants((node) => {
      if (node.type.name === 'mention') found.push(node.attrs);
    });

    expect(found).toEqual(mentionAttrs);
  });
});
