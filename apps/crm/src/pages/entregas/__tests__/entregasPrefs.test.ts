import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLastMode, persistLastMode } from '../entregasPrefs';

describe('entregasPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to entregas when the key is unset', () => {
    expect(loadLastMode('conta-1')).toBe('entregas');
  });

  it('persists and reloads publicacoes', () => {
    persistLastMode('conta-1', 'publicacoes');
    expect(loadLastMode('conta-1')).toBe('publicacoes');
    expect(localStorage.getItem('entregas_last_mode_conta-1')).toBe('publicacoes');
  });

  it('keys the preference per conta', () => {
    persistLastMode('conta-1', 'publicacoes');
    expect(loadLastMode('conta-2')).toBe('entregas');
  });

  it('falls back to entregas for a malformed stored value', () => {
    localStorage.setItem('entregas_last_mode_conta-1', 'garbage');
    expect(loadLastMode('conta-1')).toBe('entregas');
  });

  it('does not throw when localStorage.getItem fails', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadLastMode('conta-1')).toBe('entregas');
    spy.mockRestore();
  });

  it('does not throw when localStorage.setItem fails', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => persistLastMode('conta-1', 'publicacoes')).not.toThrow();
    spy.mockRestore();
  });
});
