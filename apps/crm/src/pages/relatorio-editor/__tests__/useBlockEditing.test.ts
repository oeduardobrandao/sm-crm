import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateLayout, type ReportLayout } from '@mesaas/report-blocks/types';
import { useBlockEditing } from '../useBlockEditing';

vi.mock('sonner', () => ({ toast: vi.fn() }));

const sectioned = (): ReportLayout => ({
  version: 1,
  blocks: [
    { id: 'g', type: 'section', size: 'full' },
    { id: 'ig', type: 'section', size: 'full', config: { platform: 'instagram' } },
    { id: 'r', type: 'kpi_reach', size: 'third' },
    { id: 'tt', type: 'section', size: 'full', config: { platform: 'tiktok' } },
    { id: 'tv', type: 'tiktok_kpi_views', size: 'third' },
  ],
});

function setup(initial: ReportLayout) {
  const layoutRef = { current: initial };
  const applyLayout = vi.fn((next: ReportLayout) => {
    layoutRef.current = next;
  });
  const hook = renderHook(() => useBlockEditing(layoutRef, applyLayout));
  return { ...hook, layoutRef, applyLayout };
}

afterEach(() => vi.useRealTimers());

describe('useBlockEditing: alvo de inserção por seção', () => {
  it('openWidgetDrawer guarda o alvo e abre o drawer; o insert cai na seção', () => {
    const { result, layoutRef } = setup(sectioned());
    act(() => result.current.openWidgetDrawer({ sectionId: 'tt' }));
    expect(result.current.drawerOpen).toBe(true);
    expect(result.current.insertTarget).toEqual({ sectionId: 'tt' });
    act(() => result.current.handleInsert('tiktok_kpi_likes'));
    const ids = layoutRef.current.blocks.map((b) => b.type);
    expect(ids).toEqual([
      'section',
      'section',
      'kpi_reach',
      'section',
      'tiktok_kpi_views',
      'tiktok_kpi_likes',
    ]);
    expect(validateLayout(layoutRef.current)).toMatchObject({ ok: true });
    expect(result.current.highlightId).toBe(layoutRef.current.blocks[5].id);
  });

  it('position insere no índice dentro da seção', () => {
    const { result, layoutRef } = setup(sectioned());
    act(() => result.current.openWidgetDrawer({ sectionId: 'ig', position: 0 }));
    act(() => result.current.handleInsert('kpi_saves'));
    expect(layoutRef.current.blocks[2].type).toBe('kpi_saves');
  });

  it('alvo que a seção não aceita: nada é aplicado nem destacado', () => {
    const { result, applyLayout } = setup(sectioned());
    act(() => result.current.openWidgetDrawer({ sectionId: 'g' }));
    act(() => result.current.handleInsert('kpi_reach'));
    expect(applyLayout).not.toHaveBeenCalled();
    expect(result.current.highlightId).toBeNull();
  });

  it('alvo null: fim da última seção que aceita o tipo', () => {
    const { result, layoutRef } = setup(sectioned());
    act(() => result.current.openWidgetDrawer(null));
    expect(result.current.insertTarget).toBeNull();
    act(() => result.current.handleInsert('kpi_saves'));
    expect(layoutRef.current.blocks.map((b) => b.id).slice(0, 3)).toEqual(['g', 'ig', 'r']);
    expect(layoutRef.current.blocks[3].type).toBe('kpi_saves');
  });
});

describe('useBlockEditing: excluir', () => {
  it('id de marcador de seção não remove nada', () => {
    const { result, applyLayout } = setup(sectioned());
    act(() => result.current.handleRemoveBlock('ig'));
    expect(applyLayout).not.toHaveBeenCalled();
  });

  it('bloco de conteúdo sai e o layout segue válido', () => {
    const { result, layoutRef } = setup(sectioned());
    act(() => result.current.handleRemoveBlock('r'));
    expect(layoutRef.current.blocks.map((b) => b.id)).toEqual(['g', 'ig', 'tt', 'tv']);
    expect(validateLayout(layoutRef.current)).toMatchObject({ ok: true });
  });
});
