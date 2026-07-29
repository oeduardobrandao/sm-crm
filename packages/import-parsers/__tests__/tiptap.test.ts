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

  test('link URL with balanced parentheses survives intact', () => {
    const { doc } = toTipTapDoc('[verbete](https://pt.wikipedia.org/wiki/Xisto_(rocha))');
    const nodes = new Set<string>();
    const marks = new Set<string>();
    collectTypes(doc, nodes, marks);
    expect([...nodes].every((n) => ALLOWED_NODES.has(n))).toBe(true);
    expect([...marks].every((m) => ALLOWED_MARKS.has(m))).toBe(true);

    const para = (doc as any).content[0];
    expect(para.content).toEqual([
      {
        type: 'text',
        text: 'verbete',
        marks: [{ type: 'link', attrs: { href: 'https://pt.wikipedia.org/wiki/Xisto_(rocha)' } }],
      },
    ]);
    // no stray trailing ")" left over as plain text
    expect(para.content.some((n: any) => n.text === ')' && !n.marks)).toBe(false);
  });

  test('two links on the same line both parse with distinct hrefs', () => {
    const { doc } = toTipTapDoc('[a](https://a.com) e [b](https://b.com)');
    const para = (doc as any).content[0];
    const linkNodes = para.content.filter((n: any) =>
      (n.marks ?? []).some((m: any) => m.type === 'link'),
    );
    expect(linkNodes).toHaveLength(2);
    expect(linkNodes[0].marks[0].attrs.href).toBe('https://a.com');
    expect(linkNodes[0].text).toBe('a');
    expect(linkNodes[1].marks[0].attrs.href).toBe('https://b.com');
    expect(linkNodes[1].text).toBe('b');
  });

  test('sentence period after a link stays out of the href', () => {
    const { doc } = toTipTapDoc('[x](https://a.com).');
    const para = (doc as any).content[0];
    const linkNode = para.content.find((n: any) =>
      (n.marks ?? []).some((m: any) => m.type === 'link'),
    );
    expect(linkNode.marks[0].attrs.href).toBe('https://a.com');
    const lastNode = para.content[para.content.length - 1];
    expect(lastNode.text).toBe('.');
    expect(lastNode.marks ?? []).toEqual([]);
  });

  test('unmatched [ and * stay literal and produce schema-valid output', () => {
    const { doc } = toTipTapDoc('texto com [ e * soltos');
    const nodes = new Set<string>();
    const marks = new Set<string>();
    collectTypes(doc, nodes, marks);
    expect([...nodes].every((n) => ALLOWED_NODES.has(n))).toBe(true);
    expect([...marks].every((m) => ALLOWED_MARKS.has(m))).toBe(true);

    const para = (doc as any).content[0];
    expect(para.content).toEqual([{ type: 'text', text: 'texto com [ e * soltos' }]);
  });
});
