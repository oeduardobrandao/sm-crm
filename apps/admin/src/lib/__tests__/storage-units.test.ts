import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BYTES_PER_GB, bytesToGbInput, gbInputToBytes, useGbText } from '../storage-units';

describe('storage-units', () => {
  it('converts bytes to GB text', () => {
    expect(bytesToGbInput(10737418240)).toBe('10');
    expect(bytesToGbInput(524288000)).toBe('0.4883');
    expect(bytesToGbInput(null)).toBe('');
  });

  it('converts GB text to whole bytes, empty or invalid as unlimited', () => {
    expect(gbInputToBytes('10')).toBe(10737418240);
    expect(gbInputToBytes('1,5')).toBe(1.5 * BYTES_PER_GB);
    expect(gbInputToBytes('0.1')).toBe(Math.round(0.1 * BYTES_PER_GB));
    expect(gbInputToBytes('')).toBeNull();
    expect(gbInputToBytes('-1')).toBeNull();
  });

  it('keeps typed text that maps to the same bytes and follows outside changes', () => {
    const { result, rerender } = renderHook(({ bytes }) => useGbText(bytes), {
      initialProps: { bytes: 10737418240 as number | null },
    });
    expect(result.current[0]).toBe('10');
    act(() => result.current[1]('0.1'));
    rerender({ bytes: gbInputToBytes('0.1') });
    expect(result.current[0]).toBe('0.1');
    rerender({ bytes: 2 * BYTES_PER_GB });
    expect(result.current[0]).toBe('2');
  });
});
