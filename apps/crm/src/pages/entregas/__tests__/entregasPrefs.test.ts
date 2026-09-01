import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadLastMode,
  persistLastMode,
  loadBoardColumnSorts,
  persistBoardColumnSort,
} from '../entregasPrefs';

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

describe('board column sort prefs', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per conta and column', () => {
    persistBoardColumnSort('conta-1', 'rascunho', 'recentes');
    persistBoardColumnSort('conta-1', 'custom:abc', 'data');
    expect(loadBoardColumnSorts('conta-1')).toEqual({ rascunho: 'recentes', 'custom:abc': 'data' });
    expect(loadBoardColumnSorts('conta-2')).toEqual({});
  });

  it('drops junk values on load', () => {
    localStorage.setItem('entregas_board_sorts_conta-1', '{"rascunho":"whatever","x":3}');
    expect(loadBoardColumnSorts('conta-1')).toEqual({});
  });

  it('survives storage failures silently', () => {
    // jsdom: force a throw
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('full');
    };
    expect(() => persistBoardColumnSort('conta-1', 'rascunho', 'manual')).not.toThrow();
    Storage.prototype.setItem = orig;
  });
});
