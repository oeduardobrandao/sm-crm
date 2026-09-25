import { act, fireEvent, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import {
  COALESCE_MS,
  configCoalesceKey,
  HISTORY_LIMIT,
  useLayoutHistory,
} from '../useLayoutHistory';

const L = (n: number): ReportLayout => ({
  version: 1,
  blocks: [{ id: `b${n}`, type: 'divider', size: 'full' }],
});

function setup(initial = L(0)) {
  const applySpy = vi.fn();
  const hook = renderHook(() => {
    const [layout, setLayout] = useState(initial);
    const history = useLayoutHistory(layout, (next) => {
      applySpy(next);
      setLayout(next);
    });
    return { layout, ...history };
  });
  return { ...hook, applySpy };
}

describe('useLayoutHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('commit empilha; undo e redo percorrem as versões', () => {
    const { result } = setup();
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.commit(L(1)));
    act(() => result.current.commit(L(2)));
    expect(result.current.layout.blocks[0].id).toBe('b2');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => result.current.undo());
    expect(result.current.layout.blocks[0].id).toBe('b1');
    act(() => result.current.undo());
    expect(result.current.layout.blocks[0].id).toBe('b0');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.layout.blocks[0].id).toBe('b1');
  });

  it('commit novo depois de desfazer descarta o refazer', () => {
    const { result } = setup();
    act(() => result.current.commit(L(1)));
    act(() => result.current.undo());
    act(() => result.current.commit(L(9)));
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.layout.blocks[0].id).toBe('b0');
  });

  it('mesma chave dentro da janela vira uma entrada só', () => {
    const { result } = setup();
    act(() => result.current.commit(L(1), 'text:t1'));
    act(() => vi.advanceTimersByTime(COALESCE_MS - 100));
    act(() => result.current.commit(L(2), 'text:t1'));
    act(() => result.current.undo());
    expect(result.current.layout.blocks[0].id).toBe('b0');
  });

  it('fora da janela, ou com outra chave, abre entrada nova', () => {
    const { result } = setup();
    act(() => result.current.commit(L(1), 'text:t1'));
    act(() => vi.advanceTimersByTime(COALESCE_MS + 1));
    act(() => result.current.commit(L(2), 'text:t1'));
    act(() => result.current.commit(L(3), 'config:c1'));
    act(() => result.current.undo());
    expect(result.current.layout.blocks[0].id).toBe('b2');
    act(() => result.current.undo());
    expect(result.current.layout.blocks[0].id).toBe('b1');
  });

  it('desfazer quebra o agrupamento da chave', () => {
    const { result } = setup();
    act(() => result.current.commit(L(1), 'k'));
    act(() => result.current.commit(L(2), 'k'));
    act(() => result.current.undo());
    act(() => result.current.commit(L(3), 'k'));
    act(() => result.current.undo());
    expect(result.current.layout.blocks[0].id).toBe('b0');
  });

  it('commit do mesmo layout não empilha nem salva', () => {
    const { result, applySpy } = setup();
    act(() => result.current.commit(result.current.layout));
    expect(result.current.canUndo).toBe(false);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it(`guarda no máximo ${HISTORY_LIMIT} entradas`, () => {
    const { result } = setup();
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) act(() => result.current.commit(L(i)));
    for (let i = 0; i < HISTORY_LIMIT; i++) act(() => result.current.undo());
    expect(result.current.canUndo).toBe(false);
    expect(result.current.layout.blocks[0].id).toBe('b5');
  });

  it('atalhos de teclado desfazem e refazem fora de campos de texto', () => {
    const { result } = setup();
    act(() => result.current.commit(L(1)));
    act(() => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true });
    });
    expect(result.current.layout.blocks[0].id).toBe('b0');
    act(() => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    });
    expect(result.current.layout.blocks[0].id).toBe('b1');
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    });
    expect(result.current.layout.blocks[0].id).toBe('b1');
  });

  it('atalho com foco num input fica com o desfazer nativo do campo', () => {
    const { result } = setup();
    act(() => result.current.commit(L(1)));
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      fireEvent.keyDown(input, { key: 'z', metaKey: true });
    });
    expect(result.current.layout.blocks[0].id).toBe('b1');
    input.remove();
  });

  it('configCoalesceKey separa campos do mesmo bloco', () => {
    expect(configCoalesceKey('c', { title: 'a' })).not.toBe(
      configCoalesceKey('c', { subtitle: 'a' }),
    );
    expect(configCoalesceKey('c', { title: 'a' })).toBe(configCoalesceKey('c', { title: 'ab' }));
    expect(configCoalesceKey('c', { title: 'a' })).not.toBe(configCoalesceKey('d', { title: 'a' }));
  });
});
