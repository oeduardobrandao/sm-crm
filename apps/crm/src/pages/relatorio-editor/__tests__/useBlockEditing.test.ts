import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { validateLayout, type ReportLayout } from '@mesaas/report-blocks/types';
import { addSection, removeSection } from '../layoutOps';
import { useBlockEditing } from '../useBlockEditing';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { info: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));

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

function setup(initial: ReportLayout, opts: { tiktokEnabled?: boolean } = {}) {
  const layoutRef = { current: initial };
  const applyLayout = vi.fn((next: ReportLayout) => {
    layoutRef.current = next;
  });
  const hook = renderHook(() => useBlockEditing(layoutRef, applyLayout, opts));
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

type ToastAction = { action: { label: string; onClick: () => void } };
const lastToastAction = () => {
  const calls = vi.mocked(toast).mock.calls;
  return (calls[calls.length - 1][1] as unknown as ToastAction).action;
};

describe('useBlockEditing: desfazer exclusão de bloco', () => {
  beforeEach(() => vi.mocked(toast.info).mockClear());

  it('"Desfazer" devolve o bloco no mesmo lugar', () => {
    const original = sectioned();
    const { result, layoutRef } = setup(original);
    act(() => result.current.handleRemoveBlock('r'));
    act(() => lastToastAction().onClick());
    expect(layoutRef.current).toEqual(original);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('posição que agora é de outra seção: avisa em vez de não fazer nada', () => {
    const { result, layoutRef, applyLayout } = setup(sectioned());
    act(() => result.current.handleRemoveBlock('r'));
    const undo = lastToastAction();
    // A seção do Instagram sai antes do desfazer: o índice cai na do TikTok.
    layoutRef.current = removeSection(layoutRef.current, 'ig');
    applyLayout.mockClear();
    act(() => undo.onClick());
    expect(applyLayout).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      'Não deu para desfazer: o widget não cabe mais nessa posição.',
    );
  });

  it('bloco já de volta (Ctrl+Z antes do toast): nada aplicado, sem aviso', () => {
    const original = sectioned();
    const { result, layoutRef, applyLayout } = setup(original);
    act(() => result.current.handleRemoveBlock('r'));
    const undo = lastToastAction();
    layoutRef.current = original;
    applyLayout.mockClear();
    act(() => undo.onClick());
    expect(applyLayout).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});

describe('useBlockEditing: remover seção com desfazer', () => {
  it('remove a seção e os blocos; "Desfazer" devolve no mesmo lugar (deep-equal)', () => {
    const original = sectioned();
    const { result, layoutRef } = setup(original);
    act(() => result.current.handleRemoveSection('ig'));
    expect(layoutRef.current.blocks.map((b) => b.id)).toEqual(['g', 'tt', 'tv']);
    expect(validateLayout(layoutRef.current)).toMatchObject({ ok: true });
    expect(toast).toHaveBeenCalledWith(
      'Seção removida.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Desfazer' }) }),
    );
    act(() => lastToastAction().onClick());
    expect(layoutRef.current).toEqual(original);
  });

  it('desfazer depois de recriar a mesma plataforma: avisa em vez de não fazer nada', () => {
    const { result, layoutRef, applyLayout } = setup(sectioned());
    act(() => result.current.handleRemoveSection('tt'));
    const undo = lastToastAction();
    // Outra seção do TikTok entra antes do desfazer.
    layoutRef.current = addSection(layoutRef.current, 'tiktok', null);
    applyLayout.mockClear();
    act(() => undo.onClick());
    expect(applyLayout).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      'Não deu para desfazer: já existe uma seção do TikTok.',
    );
  });

  it('id desconhecido ou de bloco: nada acontece', () => {
    const { result, applyLayout } = setup(sectioned());
    act(() => result.current.handleRemoveSection('r'));
    act(() => result.current.handleRemoveSection('nope'));
    expect(applyLayout).not.toHaveBeenCalled();
  });
});

describe('useBlockEditing: adicionar seção', () => {
  it('entra depois da âncora com os blocos dados e o cabeçalho é destacado', () => {
    const { result, layoutRef } = setup(sectioned());
    act(() =>
      result.current.handleAddSection('general', 'g', [{ id: 'tx', type: 'text', size: 'full' }]),
    );
    const blocks = layoutRef.current.blocks;
    expect(blocks[1].type).toBe('section');
    expect(blocks[2].id).toBe('tx');
    expect(result.current.highlightId).toBe(blocks[1].id);
    expect(validateLayout(layoutRef.current)).toMatchObject({ ok: true });
  });

  it('recusada (plataforma repetida): nada aplicado e um aviso', () => {
    const { result, applyLayout } = setup(sectioned());
    act(() => result.current.handleAddSection('tiktok', null, []));
    expect(applyLayout).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('useBlockEditing: layout vazio', () => {
  it('inserir sem alvo num layout vazio cria a seção Geral primeiro', () => {
    const { result, layoutRef } = setup({ version: 1, blocks: [] });
    act(() => result.current.openWidgetDrawer(null));
    act(() => result.current.handleInsert('text'));
    expect(layoutRef.current.blocks.map((b) => b.type)).toEqual(['section', 'text']);
    expect(validateLayout(layoutRef.current)).toMatchObject({ ok: true });
  });
});

describe('useBlockEditing: "Adicionar widget" sem alvo', () => {
  it('última seção é TikTok sem a flag: o widget entra na seção antes dela', () => {
    const { result, layoutRef } = setup(sectioned());
    act(() => result.current.openWidgetDrawer(null));
    act(() => result.current.handleInsert('text'));
    expect(layoutRef.current.blocks.map((b) => b.id).slice(0, 3)).toEqual(['g', 'ig', 'r']);
    expect(layoutRef.current.blocks[3].type).toBe('text');
    expect(layoutRef.current.blocks.slice(4).map((b) => b.id)).toEqual(['tt', 'tv']);
  });

  it('com feature_tiktok a última seção (TikTok) recebe o widget', () => {
    const { result, layoutRef } = setup(sectioned(), { tiktokEnabled: true });
    act(() => result.current.openWidgetDrawer(null));
    act(() => result.current.handleInsert('text'));
    expect(layoutRef.current.blocks.at(-1)?.type).toBe('text');
    expect(layoutRef.current.blocks.at(-2)?.id).toBe('tv');
  });

  it('só uma seção TikTok, sem a flag: uma Geral nova entra no fim e recebe o widget', () => {
    const { result, layoutRef } = setup({
      version: 1,
      blocks: [
        { id: 'tt', type: 'section', size: 'full', config: { platform: 'tiktok' } },
        { id: 'tv', type: 'tiktok_kpi_views', size: 'third' },
      ],
    });
    act(() => result.current.openWidgetDrawer(null));
    act(() => result.current.handleInsert('text'));
    expect(layoutRef.current.blocks.map((b) => b.type)).toEqual([
      'section',
      'tiktok_kpi_views',
      'section',
      'text',
    ]);
    expect(layoutRef.current.blocks[2].config).toBeUndefined();
    expect(validateLayout(layoutRef.current)).toMatchObject({ ok: true });
  });
});

describe('useBlockEditing: alvo cuja seção saiu', () => {
  it('remover a seção do alvo limpa o alvo', () => {
    const { result } = setup(sectioned());
    act(() => result.current.openWidgetDrawer({ sectionId: 'tt' }));
    act(() => result.current.setDrawerOpen(false));
    act(() => result.current.handleRemoveSection('tt'));
    expect(result.current.insertTarget).toBeNull();
  });

  it('remover outra seção mantém o alvo', () => {
    const { result } = setup(sectioned());
    act(() => result.current.openWidgetDrawer({ sectionId: 'tt' }));
    act(() => result.current.handleRemoveSection('ig'));
    expect(result.current.insertTarget).toEqual({ sectionId: 'tt' });
  });

  it('a seção sumiu por fora (desfazer): avisa, não aplica nada e limpa o alvo', () => {
    const { result, layoutRef, applyLayout } = setup(sectioned());
    act(() => result.current.openWidgetDrawer({ sectionId: 'tt' }));
    layoutRef.current = {
      ...layoutRef.current,
      blocks: layoutRef.current.blocks.filter((b) => b.id !== 'tt' && b.id !== 'tv'),
    };
    act(() => result.current.handleInsert('text'));
    expect(applyLayout).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'Essa seção não existe mais. Escolha de novo onde inserir o widget.',
    );
    expect(result.current.insertTarget).toBeNull();
  });
});
