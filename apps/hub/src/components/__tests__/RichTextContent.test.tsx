import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { richTextExtensions } from '../RichTextContent';

// The hub reads post `conteudo` (TipTap JSON) by feeding it into an editor built from
// `richTextExtensions`. If that schema is missing a mark/node type present in the JSON,
// TipTap drops the WHOLE document (it logs a warning instead of throwing, so the
// conteudo_plain fallback never kicks in) and the body renders blank in the portal.
//
// We assert at the schema level via getSchema + Node.fromJSON: this exercises the exact
// extension set the component uses, reproduces the real failure (RangeError: "There is no
// mark type ... in this schema"), and avoids the jsdom-only plugin collision that building
// a full editor view triggers.

describe('hub rich-text schema (richTextExtensions)', () => {
  it('parses body text that carries a CRM commentHighlight mark', () => {
    // Exactly what the CRM editor persists into `conteudo` when an agent leaves a comment
    // on post text (setCommentHighlight -> setMark).
    const commentedRichDoc = {
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

    const schema = getSchema(richTextExtensions(false));
    const doc = PMNode.fromJSON(schema, commentedRichDoc);

    expect(doc.textContent).toContain('CENA 1 do roteiro');
  });

  it('parses a doc containing a mention node for every entity type', () => {
    // Exactly what the CRM editor persists into `conteudo` when an @-mention chip is
    // inserted (Task 4's suggestion dropdown). If the hub schema doesn't register the
    // `mention` node, Node.fromJSON throws ("There is no node type ... in this schema")
    // and the whole document fails to load, not just the mention.
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

    const schema = getSchema(richTextExtensions(false));
    const doc = PMNode.fromJSON(schema, mentionDoc);

    const found: unknown[] = [];
    doc.descendants((node) => {
      if (node.type.name === 'mention') found.push(node.attrs);
    });

    // Attrs must round-trip exactly through the JSON persistence path (this IS how
    // `conteudo` is stored -- ProseMirror JSON, not HTML), proving parseHTML/renderHTML
    // aren't the only fidelity path and the JSON schema itself preserves every attr.
    expect(found).toEqual(mentionAttrs);
  });
});
