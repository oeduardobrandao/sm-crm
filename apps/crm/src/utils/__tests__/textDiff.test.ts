import { describe, expect, it } from 'vitest';
import { computeWordDiff } from '../textDiff';

describe('computeWordDiff', () => {
  it('returns a single equal segment for identical strings', () => {
    const result = computeWordDiff('hello world', 'hello world');
    expect(result).toEqual([{ type: 'equal', text: 'hello world' }]);
  });

  it('detects inserted text', () => {
    const result = computeWordDiff('hello', 'hello world');
    const insert = result.find((s) => s.type === 'insert');
    expect(insert).toBeDefined();
    expect(insert!.text).toContain('world');
  });

  it('detects deleted text', () => {
    const result = computeWordDiff('hello world', 'hello');
    const del = result.find((s) => s.type === 'delete');
    expect(del).toBeDefined();
    expect(del!.text).toContain('world');
  });

  it('detects replacements as delete + insert', () => {
    const result = computeWordDiff('gato preto', 'gato branco');
    const types = result.map((s) => s.type);
    expect(types).toContain('delete');
    expect(types).toContain('insert');
    expect(result.find((s) => s.type === 'equal')?.text).toContain('gato');
  });

  it('handles empty original', () => {
    const result = computeWordDiff('', 'novo texto');
    expect(result).toEqual([{ type: 'insert', text: 'novo texto' }]);
  });

  it('handles empty suggested', () => {
    const result = computeWordDiff('texto antigo', '');
    expect(result).toEqual([{ type: 'delete', text: 'texto antigo' }]);
  });

  it('handles both empty', () => {
    const result = computeWordDiff('', '');
    expect(result).toEqual([]);
  });
});
