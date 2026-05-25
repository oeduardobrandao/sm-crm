import { describe, expect, it } from 'vitest';
import { computeTipTapDiff } from '../tiptapDiff';

function doc(...content: Record<string, unknown>[]): Record<string, unknown> {
  return { type: 'doc', content };
}

function p(...text: string[]): Record<string, unknown> {
  return {
    type: 'paragraph',
    content: text.map(t => ({ type: 'text', text: t })),
  };
}

function heading(text: string, level = 2): Record<string, unknown> {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

function bulletList(...items: string[]): Record<string, unknown> {
  return {
    type: 'bulletList',
    content: items.map(text => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  };
}

describe('computeTipTapDiff', () => {
  it('returns unchanged document when content is identical', () => {
    const original = doc(p('Hello world'));
    const result = computeTipTapDiff(original, original);
    expect(result).toEqual(original);
  });

  it('marks text changes within a paragraph', () => {
    const original = doc(p('Suco de caixinha'));
    const suggested = doc(p('Refrigerante com açúcar'));
    const result = computeTipTapDiff(original, suggested) as any;

    const content = result.content[0].content;
    const hasDelete = content.some((n: any) =>
      n.marks?.some((m: any) => m.type === 'strike')
    );
    const hasInsert = content.some((n: any) =>
      n.marks?.some((m: any) => m.type === 'highlight')
    );
    expect(hasDelete).toBe(true);
    expect(hasInsert).toBe(true);
  });

  it('preserves heading structure', () => {
    const original = doc(heading('EVITE'), p('Item antigo'));
    const suggested = doc(heading('EVITE'), p('Item novo'));
    const result = computeTipTapDiff(original, suggested) as any;

    expect(result.content[0].type).toBe('heading');
    expect(result.content[0].content[0].text).toBe('EVITE');
    // paragraph should have diff marks
    const paraContent = result.content[1].content;
    expect(paraContent.length).toBeGreaterThan(1);
  });

  it('preserves bullet list structure with diffs inside items', () => {
    const original = doc(bulletList('Iogurte integral', 'Granola'));
    const suggested = doc(bulletList('Iogurte desnatado', 'Granola'));
    const result = computeTipTapDiff(original, suggested) as any;

    expect(result.content[0].type).toBe('bulletList');
    const firstItem = result.content[0].content[0];
    expect(firstItem.type).toBe('listItem');
    const firstItemText = firstItem.content[0].content;
    const hasDelete = firstItemText.some((n: any) =>
      n.marks?.some((m: any) => m.type === 'strike')
    );
    expect(hasDelete).toBe(true);

    // second item unchanged
    const secondItem = result.content[0].content[1];
    const secondText = secondItem.content[0].content;
    expect(secondText).toHaveLength(1);
    expect(secondText[0].text).toBe('Granola');
    expect(secondText[0].marks).toBeUndefined();
  });

  it('handles added blocks as insertions', () => {
    const original = doc(p('Parágrafo 1'));
    const suggested = doc(p('Parágrafo 1'), p('Parágrafo novo'));
    const result = computeTipTapDiff(original, suggested) as any;

    expect(result.content).toHaveLength(2);
    const addedBlock = result.content[1];
    const hasInsertMark = addedBlock.content.some((n: any) =>
      n.marks?.some((m: any) => m.type === 'highlight')
    );
    expect(hasInsertMark).toBe(true);
  });

  it('handles removed blocks as deletions', () => {
    const original = doc(p('Parágrafo 1'), p('Parágrafo 2'));
    const suggested = doc(p('Parágrafo 1'));
    const result = computeTipTapDiff(original, suggested) as any;

    expect(result.content).toHaveLength(2);
    const deletedBlock = result.content[1];
    const hasStrike = deletedBlock.content.some((n: any) =>
      n.marks?.some((m: any) => m.type === 'strike')
    );
    expect(hasStrike).toBe(true);
  });

  it('handles empty paragraphs', () => {
    const original = doc({ type: 'paragraph' });
    const suggested = doc(p('Novo texto'));
    const result = computeTipTapDiff(original, suggested) as any;

    expect(result.content[0].type).toBe('paragraph');
    const hasInsert = result.content[0].content.some((n: any) =>
      n.marks?.some((m: any) => m.type === 'highlight')
    );
    expect(hasInsert).toBe(true);
  });

  it('uses red color and strikethrough for deletions', () => {
    const original = doc(p('remover isto'));
    const suggested = doc(p(''));
    const result = computeTipTapDiff(original, suggested) as any;

    const deleted = result.content[0].content.find((n: any) =>
      n.marks?.some((m: any) => m.type === 'strike')
    );
    expect(deleted).toBeDefined();
    const colorMark = deleted.marks.find((m: any) => m.type === 'textStyle');
    expect(colorMark?.attrs?.color).toBe('#be123c');
  });

  it('uses green highlight for insertions', () => {
    const original = doc(p(''));
    const suggested = doc(p('inserir isto'));
    const result = computeTipTapDiff(original, suggested) as any;

    const inserted = result.content[0].content.find((n: any) =>
      n.marks?.some((m: any) => m.type === 'highlight')
    );
    expect(inserted).toBeDefined();
    const highlightMark = inserted.marks.find((m: any) => m.type === 'highlight');
    expect(highlightMark?.attrs?.color).toBe('#bbf7d0');
  });
});
