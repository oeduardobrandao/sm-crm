import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTarefasCalendarioModo, persistTarefasCalendarioModo } from '../tarefasPrefs';

describe('tarefasPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to board when the key is unset', () => {
    expect(loadTarefasCalendarioModo('conta-1')).toBe('board');
  });

  it('persists and reloads mes', () => {
    persistTarefasCalendarioModo('conta-1', 'mes');
    expect(loadTarefasCalendarioModo('conta-1')).toBe('mes');
    expect(localStorage.getItem('tarefas_calendario_modo_conta-1')).toBe('mes');
  });

  it('keys the preference per conta', () => {
    persistTarefasCalendarioModo('conta-1', 'mes');
    expect(loadTarefasCalendarioModo('conta-2')).toBe('board');
  });

  it('falls back to board for a malformed stored value', () => {
    localStorage.setItem('tarefas_calendario_modo_conta-1', 'garbage');
    expect(loadTarefasCalendarioModo('conta-1')).toBe('board');
  });

  it('does not throw when localStorage.getItem fails', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadTarefasCalendarioModo('conta-1')).toBe('board');
    spy.mockRestore();
  });

  it('does not throw when localStorage.setItem fails', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => persistTarefasCalendarioModo('conta-1', 'mes')).not.toThrow();
    spy.mockRestore();
  });
});
