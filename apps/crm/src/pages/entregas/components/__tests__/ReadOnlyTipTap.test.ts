import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { readOnlyTipTapExtensions } from '../ReadOnlyTipTap';

// ReadOnlyTipTap renders `conteudo` wherever the CRM shows a post read-only (approvals,
// history, etc). Its extension list must register every node/mark the editable PostEditor
// can persist, or TipTap silently drops the whole document on read -- same invariant as the
// hub's richTextExtensions (apps/hub/src/components/__tests__/RichTextContent.test.tsx).
describe('ReadOnlyTipTap extensions (readOnlyTipTapExtensions)', () => {
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
