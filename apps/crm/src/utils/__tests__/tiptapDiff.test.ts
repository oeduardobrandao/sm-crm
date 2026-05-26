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

  it('handles trailing empty paragraph added by TipTap normalization', () => {
    const original = doc(
      heading('EVITE'),
      bulletList('Iogurte integral', 'Granola com açúca'),
      heading('PREFIRA'),
      bulletList('Iogurte desnatado', 'Farelo de aveia'),
    );
    const suggested = doc(
      heading('EVITE'),
      bulletList('Iogurte integral', 'Granola com açúca'),
      heading('PREFIRA'),
      bulletList('Iogurte desnatado', 'Farelo de aveia e mel'),
      { type: 'paragraph' },
    );
    const result = computeTipTapDiff(original, suggested) as any;

    // The heading blocks should be unchanged
    expect(result.content[0].content[0].text).toBe('EVITE');
    expect(result.content[0].content[0].marks).toBeUndefined();
    expect(result.content[2].content[0].text).toBe('PREFIRA');
    expect(result.content[2].content[0].marks).toBeUndefined();

    // First bullet list unchanged
    const firstBulletItems = result.content[1].content;
    const firstItemText = firstBulletItems[0].content[0].content;
    expect(firstItemText).toHaveLength(1);
    expect(firstItemText[0].marks).toBeUndefined();

    // Second bullet list: only "Farelo de aveia" → "Farelo de aveia e mel" should show diff
    const secondBulletItems = result.content[3].content;
    const changedItemText = secondBulletItems[1].content[0].content;
    const hasInsert = changedItemText.some((n: any) =>
      n.marks?.some((m: any) => m.type === 'highlight')
    );
    expect(hasInsert).toBe(true);
  });

  it('aligns blocks correctly when middle block is removed in suggestion', () => {
    const original = doc(p('A'), p('B'), p('C'), p('D'));
    const suggested = doc(p('A'), p('C'), p('D changed'));
    const result = computeTipTapDiff(original, suggested) as any;

    // A should be unchanged
    expect(result.content[0].content[0].text).toBe('A');
    expect(result.content[0].content[0].marks).toBeUndefined();
    // B should appear as deleted
    const deletedB = result.content.find((n: any) => {
      if (!n.content) return false;
      return n.content.some((c: any) => c.text === 'B' && c.marks?.some((m: any) => m.type === 'strike'));
    });
    expect(deletedB).toBeDefined();
    // C should be unchanged
    const unchangedC = result.content.find((n: any) => {
      if (!n.content) return false;
      return n.content.some((c: any) => c.text === 'C' && !c.marks);
    });
    expect(unchangedC).toBeDefined();
  });

  it('aligns blocks when new block is inserted in the middle', () => {
    const original = doc(p('First'), p('Last'));
    const suggested = doc(p('First'), p('Middle'), p('Last'));
    const result = computeTipTapDiff(original, suggested) as any;

    // First should be unchanged
    expect(result.content[0].content[0].text).toBe('First');
    expect(result.content[0].content[0].marks).toBeUndefined();
    // Middle should be marked as inserted
    const middleBlock = result.content.find((n: any) => {
      if (!n.content) return false;
      return n.content.some((c: any) => c.text === 'Middle');
    });
    expect(middleBlock).toBeDefined();
    const middleHasInsert = middleBlock.content.some((c: any) =>
      c.marks?.some((m: any) => m.type === 'highlight')
    );
    expect(middleHasInsert).toBe(true);
    // Last should be unchanged
    const lastIdx = result.content.length - 1;
    const lastBlock = result.content[lastIdx];
    expect(lastBlock.content[0].text).toBe('Last');
    expect(lastBlock.content[0].marks).toBeUndefined();
  });
});
