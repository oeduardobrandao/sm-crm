import { describe, expect, it } from 'vitest';
import { generateText, getSchema, type JSONContent } from '@tiptap/react';
import { richTextExtensions } from '../../components/RichTextTiptap';
import { BLOCK_NODES, INLINE_NODES, LEAF_NODES, MARKS, docPlainText } from '../richDoc';

// docPlainText reimplements TipTap's generateText so it can run without TipTap in the
// bundle. These tests hold it to the real thing: same schema, same output.
const schema = getSchema(richTextExtensions());

function tiptapText(doc: unknown): string | null {
  try {
    return generateText(doc as JSONContent, richTextExtensions()) || null;
  } catch {
    return null;
  }
}

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

const FIXTURES: Record<string, unknown> = {
  'paragraphs with every mark': doc(
    p(
      t('Negrito', [{ type: 'bold' }]),
      t(' itálico', [{ type: 'italic' }, { type: 'underline' }]),
      t(' link', [{ type: 'link', attrs: { href: 'https://mesaas.com' } }]),
    ),
    p(
      t('cor', [{ type: 'textStyle', attrs: { color: '#f00' } }]),
      t(' marca', [{ type: 'highlight', attrs: { color: '#ff0' } }]),
      t(' riscado', [{ type: 'strike' }, { type: 'code' }]),
      t(' comentário', [{ type: 'commentHighlight', attrs: { commentId: 'c1' } }]),
    ),
  ),
  'heading and hard breaks': doc(
    { type: 'heading', attrs: { level: 2 }, content: [t('Título')] },
    p(t('linha 1'), { type: 'hardBreak' }, t('linha 2'), { type: 'hardBreak' }),
  ),
  'nested lists': doc(
    p(t('Antes')),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(t('um'))] },
        {
          type: 'listItem',
          content: [
            p(t('dois')),
            {
              type: 'orderedList',
              attrs: { start: 3 },
              content: [{ type: 'listItem', content: [p(t('dois.a'))] }],
            },
          ],
        },
      ],
    },
    p(t('Depois')),
  ),
  'list first in the document': doc({
    type: 'bulletList',
    content: [{ type: 'listItem', content: [p(t('primeiro'))] }],
  }),
  'blockquote, code block and rule': doc(
    { type: 'blockquote', content: [p(t('citação'))] },
    { type: 'codeBlock', attrs: { language: null }, content: [t('const a = 1;\nconst b = 2;')] },
    { type: 'horizontalRule' },
    p(t('fim')),
  ),
  'inline image between paragraphs': doc(
    p(t('acima')),
    { type: 'inlineImage', attrs: { r2Key: 'contas/1/a.png', src: 'https://x/a.png' } },
    p(t('abaixo')),
  ),
  'image first': doc({ type: 'inlineImage', attrs: { r2Key: 'contas/1/a.png' } }, p(t('legenda'))),
  callout: doc({ type: 'callout', content: [p(t('atenção')), p(t('segunda'))] }, p(t('depois'))),
  mentions: doc(
    p(
      t('Fala '),
      { type: 'mention', attrs: { entityType: 'member', id: 3, label: 'Ana' } },
      t(' e '),
      { type: 'mention', attrs: { entityType: 'client', id: 4 } },
    ),
  ),
  'MCP text with single newlines': doc(p(t('linha um\nlinha dois\nlinha três'))),
  'empty paragraphs between text': doc(p(t('a')), p(), p(), p(t('b'))),
  'empty document': doc(),
  'document with one empty paragraph': doc(p()),
  'paragraph as the root': p(t('sem doc')),
  'unknown node type': doc(p(t('a')), { type: 'table', content: [] }),
  'unknown mark': doc(p(t('a', [{ type: 'subscript' }]))),
  'text node without text': doc(p({ type: 'text' } as JSONContent)),
  'empty text node': doc(p(t(''))),
  'content that is not an array': { type: 'doc', content: 'oops' },
  'marks that are not an array': doc(p({ type: 'text', text: 'a', marks: 'bold' } as never)),
  'no type': { content: [p(t('a'))] },
};

describe('docPlainText', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`matches TipTap's generateText: ${name}`, () => {
      expect(docPlainText(fixture)).toBe(tiptapText(fixture));
    });
  }

  it('returns null for non-objects', () => {
    expect(docPlainText(null)).toBeNull();
    expect(docPlainText('texto')).toBeNull();
  });
});

describe('richDoc schema sets match richTextExtensions()', () => {
  const nodeNames = Object.keys(schema.nodes);

  it('node names', () => {
    expect(new Set(nodeNames)).toEqual(new Set([...INLINE_NODES, ...BLOCK_NODES]));
  });

  it('inline nodes', () => {
    expect(new Set(nodeNames.filter((n) => schema.nodes[n].isInline))).toEqual(INLINE_NODES);
  });

  it('leaf nodes', () => {
    const leaves = nodeNames.filter((n) => schema.nodes[n].isLeaf && !schema.nodes[n].isText);
    expect(new Set(leaves)).toEqual(LEAF_NODES);
  });

  it('marks', () => {
    expect(new Set(Object.keys(schema.marks))).toEqual(MARKS);
  });

  it('only hardBreak and mention have a text serializer', () => {
    const serialized = nodeNames.filter((n) => schema.nodes[n].spec.toText);
    expect(new Set(serialized)).toEqual(new Set(['hardBreak', 'mention']));
  });

  // Node.fromJSON throws on a missing attribute that has no default; the walker doesn't
  // check attributes, so this must stay true for the two to agree.
  it('every node and mark attribute has a default', () => {
    const types = [...Object.values(schema.nodes), ...Object.values(schema.marks)];
    for (const type of types) {
      for (const [attr, spec] of Object.entries(type.spec.attrs ?? {})) {
        expect({ type: type.name, attr, hasDefault: 'default' in spec }).toEqual({
          type: type.name,
          attr,
          hasDefault: true,
        });
      }
    }
  });
});
