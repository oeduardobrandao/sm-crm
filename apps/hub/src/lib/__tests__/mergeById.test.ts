import { describe, expect, it } from 'vitest';
import { mergeById } from '../mergeById';

describe('mergeById', () => {
  it('keeps the primary copy on duplicate ids and appends unseen extras in order', () => {
    const primary = [
      { id: 1, v: 'shell' },
      { id: 2, v: 'shell' },
    ];
    const extra = [
      { id: 2, v: 'page' },
      { id: 3, v: 'page' },
      { id: 3, v: 'dup' },
    ];
    expect(mergeById(primary, extra)).toEqual([
      { id: 1, v: 'shell' },
      { id: 2, v: 'shell' },
      { id: 3, v: 'page' },
    ]);
  });

  it('returns the primary array itself when there is nothing extra', () => {
    const primary = [{ id: 1 }];
    expect(mergeById(primary, [])).toBe(primary);
  });
});
