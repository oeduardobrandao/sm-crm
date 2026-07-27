import { describe, expect, test } from 'vitest';
import { toTipTapDoc } from '../src/tiptap';

const ALLOWED_NODES = new Set(['doc', 'paragraph', 'text', 'bulletList', 'listItem']);
const ALLOWED_MARKS = new Set(['bold', 'italic', 'link']);

function collectTypes(node: any, nodes: Set<string>, marks: Set<string>) {
  nodes.add(node.type);
  for (const m of node.marks ?? []) marks.add(m.type);
  for (const c of node.content ?? []) collectTypes(c, nodes, marks);
}

describe('toTipTapDoc', () => {
  test('markdown-ish input: paragraphs, bullets, bold/italic/link', () => {
    const { doc, plain } = toTipTapDoc(
      'Primeira linha com **negrito** e *itálico*.\n\n- item um\n- [site](https://x.com)\n\nFim.',
    );
    const nodes = new Set<string>();
    const marks = new Set<string>();
    collectTypes(doc, nodes, marks);
    expect([...nodes].every((n) => ALLOWED_NODES.has(n))).toBe(true);
    expect([...marks].every((m) => ALLOWED_MARKS.has(m))).toBe(true);
    expect(marks.has('bold')).toBe(true);
    expect(marks.has('link')).toBe(true);
    expect(plain).toContain('negrito');
    expect(plain).toContain('item um');
  });

  test('empty input produces null doc', () => {
    expect(toTipTapDoc('   ')).toEqual({ doc: null, plain: '' });
  });

  test('plain text round-trips as single paragraph', () => {
    const { doc } = toTipTapDoc('só texto');
    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'só texto' }] }],
    });
  });
});
