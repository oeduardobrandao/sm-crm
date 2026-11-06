import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddWidgetDrawer, documentPlatforms, drawerWidgets } from '../AddWidgetDrawer';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '@mesaas/report-blocks/catalog';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import { BLOCK_TYPES, type SectionKind } from '@mesaas/report-blocks/types';

function renderDrawer(
  section: { kind: SectionKind } | null,
  { hasCover = true, onInsert = vi.fn(), onOpenChange = vi.fn() } = {},
) {
  render(
    <AddWidgetDrawer
      open
      onOpenChange={onOpenChange}
      onInsert={onInsert}
      section={section}
      hasCover={hasCover}
    />,
  );
  return { onInsert, onOpenChange };
}

const instagramOnly = WIDGET_CATALOG.filter((w) => w.platform === 'instagram');
const tiktokOnly = WIDGET_CATALOG.filter((w) => w.platform === 'tiktok');
const neutralNoCover = WIDGET_CATALOG.filter((w) => w.platform === null && w.type !== 'cover');

// Rótulos se repetem entre plataformas ("Visualizações" do Instagram e do
// TikTok): conta quantos botões o drawer deve mostrar por rótulo.
function expectListed(entries: typeof WIDGET_CATALOG) {
  for (const w of entries) {
    const sameLabel = entries.filter((x) => x.label === w.label).length;
    expect(screen.getAllByRole('button', { name: w.label })).toHaveLength(sameLabel);
  }
}

describe('AddWidgetDrawer: escopo da seção', () => {
  it('seção TikTok: widgets do TikTok e neutros, nada do Instagram, sem seletor', () => {
    renderDrawer({ kind: 'tiktok' });
    expect(screen.getByText('Na seção TikTok')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Visualizações' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lista de vídeos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alcance' })).not.toBeInTheDocument();
    expectListed([...tiktokOnly, ...neutralNoCover]);
  });

  it('seção Instagram: widgets do Instagram e neutros, nada do TikTok', () => {
    renderDrawer({ kind: 'instagram' });
    expect(screen.getByText('Na seção Instagram')).toBeInTheDocument();
    expectListed([...instagramOnly, ...neutralNoCover]);
    expect(screen.queryByRole('button', { name: 'Lista de vídeos' })).not.toBeInTheDocument();
  });

  it('seção Geral: só neutros, nenhum widget de plataforma', () => {
    renderDrawer({ kind: 'general' });
    expect(screen.getByText('Na seção Geral')).toBeInTheDocument();
    for (const w of [...instagramOnly, ...tiktokOnly]) {
      expect(screen.queryByRole('button', { name: w.label })).not.toBeInTheDocument();
    }
    expectListed(neutralNoCover);
  });

  it('seção Google Meu Negócio: os 14 widgets gbp_* e os neutros, nada de outra plataforma', () => {
    const widgets = drawerWidgets('google', true);
    const gbpTypes = BLOCK_TYPES.filter((t) => t.startsWith('gbp_'));
    expect(gbpTypes).toHaveLength(14);
    expect(
      widgets
        .filter((w) => w.platform === 'google')
        .map((w) => w.type)
        .sort(),
    ).toEqual([...gbpTypes].sort());
    expect(widgets.filter((w) => w.platform === null).map((w) => w.type)).toEqual(
      neutralNoCover.map((w) => w.type),
    );
    expect(widgets.every((w) => w.platform === null || w.platform === 'google')).toBe(true);
  });

  it('capa só na Geral e só enquanto o layout não tem capa', () => {
    expect(drawerWidgets('general', false).some((w) => w.type === 'cover')).toBe(true);
    expect(drawerWidgets('general', true).some((w) => w.type === 'cover')).toBe(false);
    expect(drawerWidgets('instagram', false).some((w) => w.type === 'cover')).toBe(false);
    expect(drawerWidgets('tiktok', false).some((w) => w.type === 'cover')).toBe(false);
    expect(drawerWidgets('google', false).some((w) => w.type === 'cover')).toBe(false);
  });

  it('nunca lista um tipo que a seção recusa', () => {
    for (const kind of ['general', 'instagram', 'tiktok', 'google'] as const) {
      for (const w of drawerWidgets(kind, false)) {
        expect(w.platform === null || w.platform === kind).toBe(true);
      }
    }
  });

  it('sem seção (fim do relatório): só neutros', () => {
    renderDrawer(null, { hasCover: false });
    expect(screen.queryByText(/Na seção/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alcance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lista de vídeos' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Texto livre' })).toBeInTheDocument();
    // A capa entraria na última seção, talvez de plataforma: só pela Geral.
    expect(screen.queryByRole('button', { name: 'Capa' })).not.toBeInTheDocument();
  });

  it('categoria sem widgets para a seção não mostra título vazio', () => {
    renderDrawer({ kind: 'tiktok' });
    expect(WIDGET_CATEGORIES).toContain('Audiência');
    expect(screen.queryByRole('heading', { name: 'Audiência' })).not.toBeInTheDocument();
    for (const cat of ['Texto', 'Mídia', 'Estrutura']) {
      expect(screen.getByRole('heading', { name: cat })).toBeInTheDocument();
    }
  });

  it('clicar num widget chama onInsert com o tipo e fecha o drawer', () => {
    const { onInsert, onOpenChange } = renderDrawer({ kind: 'tiktok' });
    fireEvent.click(screen.getByRole('button', { name: 'Lista de vídeos' }));
    expect(onInsert).toHaveBeenCalledWith('tiktok_post_list');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('fechado, nada renderizado', () => {
    render(
      <AddWidgetDrawer
        open={false}
        onOpenChange={() => {}}
        onInsert={() => {}}
        section={{ kind: 'instagram' }}
        hasCover
      />,
    );
    expect(screen.queryByText('Adicionar widget')).not.toBeInTheDocument();
  });
});

describe('documentPlatforms', () => {
  it('Instagram, TikTok e Google Meu Negócio quando o snapshot tem as três', () => {
    expect(documentPlatforms(makeSnapshotFixture())).toEqual(['instagram', 'tiktok', 'google']);
  });

  it('sem a seção google: sem Google Meu Negócio', () => {
    expect(documentPlatforms(makeSnapshotFixture({ google: null }))).toEqual([
      'instagram',
      'tiktok',
    ]);
  });

  it('só Instagram sem as seções TikTok e Google', () => {
    expect(documentPlatforms(makeSnapshotFixture({ tiktok: null, google: null }))).toEqual([
      'instagram',
    ]);
  });

  it('só TikTok quando o Instagram não está conectado e não há Google', () => {
    expect(
      documentPlatforms(makeSnapshotFixture({ instagram_connected: false, google: null })),
    ).toEqual(['tiktok']);
  });

  it('só Google Meu Negócio: Instagram desconectado e sem TikTok', () => {
    expect(
      documentPlatforms(makeSnapshotFixture({ instagram_connected: false, tiktok: null })),
    ).toEqual(['google']);
  });

  it('sem nenhuma conta com dados cai no Instagram, como a capa', () => {
    expect(
      documentPlatforms(
        makeSnapshotFixture({ instagram_connected: false, tiktok: null, google: null }),
      ),
    ).toEqual(['instagram']);
  });
});
