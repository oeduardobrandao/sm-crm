import { describe, expect, it } from 'vitest';
import {
  reorderQuestionWithinSection,
  reorderSections,
  toDisplayOrderUpdates,
  applyReorderToCache,
} from '../briefingReorder';

// Build a briefing's questions in render/array order (= display_order order).
function q(id: string, section: string | null, display_order: number) {
  return { id, section, display_order };
}

describe('reorderQuestionWithinSection', () => {
  it('moves a question within its named section and returns the new order', () => {
    const questions = [q('q1', 'A', 0), q('q2', 'A', 1), q('q3', 'A', 2)];
    // Move q1 down to where q3 is.
    expect(reorderQuestionWithinSection(questions, 'A', 'q1', 'q3')).toEqual(['q2', 'q3', 'q1']);
  });

  it('reorders questions inside the unsectioned block', () => {
    const questions = [q('q1', null, 0), q('q2', null, 1)];
    expect(reorderQuestionWithinSection(questions, '', 'q2', 'q1')).toEqual(['q2', 'q1']);
  });

  it('keeps other sections in place when reordering one section', () => {
    const questions = [q('a1', 'A', 0), q('a2', 'A', 1), q('b1', 'B', 2), q('b2', 'B', 3)];
    // Swap within B; A stays first, B reordered.
    expect(reorderQuestionWithinSection(questions, 'B', 'b2', 'b1')).toEqual([
      'a1',
      'a2',
      'b2',
      'b1',
    ]);
  });

  it('returns null for a no-op move (fromId === toId)', () => {
    const questions = [q('q1', 'A', 0), q('q2', 'A', 1)];
    expect(reorderQuestionWithinSection(questions, 'A', 'q1', 'q1')).toBeNull();
  });

  it('returns null when from/to are in different sections (cross-section guard)', () => {
    const questions = [q('q1', 'A', 0), q('q2', 'B', 1)];
    expect(reorderQuestionWithinSection(questions, 'A', 'q1', 'q2')).toBeNull();
  });
});

describe('reorderSections', () => {
  it('moves a whole section block above another', () => {
    const questions = [q('a1', 'A', 0), q('a2', 'A', 1), q('b1', 'B', 2)];
    // Move B above A.
    expect(reorderSections(questions, 'B', 'A')).toEqual(['b1', 'a1', 'a2']);
  });

  it('keeps the unsectioned block pinned at the top', () => {
    const questions = [q('u1', null, 0), q('a1', 'A', 1), q('b1', 'B', 2)];
    expect(reorderSections(questions, 'B', 'A')).toEqual(['u1', 'b1', 'a1']);
  });

  it('returns null when moving a section onto itself', () => {
    const questions = [q('a1', 'A', 0), q('b1', 'B', 1)];
    expect(reorderSections(questions, 'A', 'A')).toBeNull();
  });

  it('normalizes non-contiguous input into a contiguous flat order', () => {
    // Section A is interleaved/non-contiguous: appears at display_order 0,1,10.
    const questions = [
      q('a1', 'A', 0),
      q('a2', 'A', 1),
      q('b1', 'B', 2),
      q('b2', 'B', 3),
      q('a3', 'A', 10),
    ];
    const order = reorderSections(questions, 'B', 'A');
    // B block first, then all of A (first-appearance grouping keeps a3 last in A).
    expect(order).toEqual(['b1', 'b2', 'a1', 'a2', 'a3']);
    // Persisted display_order is healed to contiguous 0..4.
    expect(toDisplayOrderUpdates(questions, order!)).toEqual([
      { id: 'b1', display_order: 0 },
      { id: 'b2', display_order: 1 },
      { id: 'a1', display_order: 2 },
      { id: 'a2', display_order: 3 },
      { id: 'a3', display_order: 4 },
    ]);
  });
});

describe('toDisplayOrderUpdates', () => {
  it('returns only the rows whose display_order changed', () => {
    const questions = [q('q1', 'A', 0), q('q2', 'A', 1), q('q3', 'A', 2)];
    // Swap q2 and q3; q1 keeps display_order 0 and must be excluded.
    expect(toDisplayOrderUpdates(questions, ['q1', 'q3', 'q2'])).toEqual([
      { id: 'q3', display_order: 1 },
      { id: 'q2', display_order: 2 },
    ]);
  });
});

describe('applyReorderToCache', () => {
  it('reorders the target briefing in the cache and leaves other briefings untouched', () => {
    const list = [
      { id: 'a1', briefing_id: 'A', display_order: 0 },
      { id: 'a2', briefing_id: 'A', display_order: 1 },
      { id: 'a3', briefing_id: 'A', display_order: 2 },
      { id: 'b1', briefing_id: 'B', display_order: 0 },
      { id: 'b2', briefing_id: 'B', display_order: 1 },
    ];
    const result = applyReorderToCache(list, ['a3', 'a1', 'a2']);
    expect(result).toEqual([
      { id: 'a3', briefing_id: 'A', display_order: 0 },
      { id: 'a1', briefing_id: 'A', display_order: 1 },
      { id: 'a2', briefing_id: 'A', display_order: 2 },
      { id: 'b1', briefing_id: 'B', display_order: 0 },
      { id: 'b2', briefing_id: 'B', display_order: 1 },
    ]);
  });
});
