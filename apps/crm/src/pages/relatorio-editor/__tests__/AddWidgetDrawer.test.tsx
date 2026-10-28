import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddWidgetDrawer, documentPlatforms } from '../AddWidgetDrawer';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '@mesaas/report-blocks/catalog';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';

type Platforms = Parameters<typeof AddWidgetDrawer>[0]['platforms'];

function renderDrawer(platforms: Platforms, onInsert = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <AddWidgetDrawer open onOpenChange={onOpenChange} onInsert={onInsert} platforms={platforms} />,
  );
  return { onInsert, onOpenChange };
}

const instagramOnly = WIDGET_CATALOG.filter((w) => w.platform === 'instagram');
const tiktokOnly = WIDGET_CATALOG.filter((w) => w.platform === 'tiktok');
const neutral = WIDGET_CATALOG.filter((w) => w.platform === null);

// Rótulos se repetem entre plataformas ("Novos seguidores" do Instagram e do
// TikTok): conta quantos botões o drawer deve mostrar por rótulo.
function expectListed(entries: typeof WIDGET_CATALOG) {
  for (const w of entries) {
    const sameLabel = entries.filter((x) => x.label === w.label).length;
    expect(screen.getAllByRole('button', { name: w.label })).toHaveLength(sameLabel);
  }
}

function expectAbsent(entries: typeof WIDGET_CATALOG, shown: typeof WIDGET_CATALOG) {
  const shownLabels = new Set(shown.map((w) => w.label));
  for (const w of entries) {
    if (!shownLabels.has(w.label)) {
      expect(screen.queryByRole('button', { name: w.label })).not.toBeInTheDocument();
    }
  }
}

describe('AddWidgetDrawer', () => {
  it('um doc só Instagram: sem seletor, widgets do Instagram e neutros, nada de TikTok', () => {
    renderDrawer(['instagram']);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expectListed([...instagramOnly, ...neutral]);
    expectAbsent(tiktokOnly, [...instagramOnly, ...neutral]);
    expect(screen.queryByRole('button', { name: 'Lista de vídeos' })).not.toBeInTheDocument();
  });

  it('um doc só TikTok: sem seletor, widgets do TikTok e neutros, nada do Instagram', () => {
    renderDrawer(['tiktok']);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expectListed([...tiktokOnly, ...neutral]);
    expectAbsent(instagramOnly, [...tiktokOnly, ...neutral]);
    expect(screen.queryByRole('button', { name: 'Alcance' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lista de vídeos' })).toBeInTheDocument();
  });

  it('as duas plataformas: seletor Instagram | TikTok; só ao escolher TikTok aparecem os widgets dele', () => {
    renderDrawer(['instagram', 'tiktok']);
    const group = screen.getByRole('radiogroup', { name: 'Plataforma' });
    const instagram = within(group).getByRole('radio', { name: 'Instagram' });
    const tiktok = within(group).getByRole('radio', { name: 'TikTok' });
    expect(instagram).toBeChecked();
    expect(tiktok).not.toBeChecked();
    // Instagram selecionado: nada do TikTok.
    expect(screen.queryByRole('button', { name: 'Lista de vídeos' })).not.toBeInTheDocument();
    expectListed([...instagramOnly, ...neutral]);

    fireEvent.click(tiktok);
    expect(tiktok).toBeChecked();
    expect(screen.getByRole('button', { name: 'Lista de vídeos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alcance' })).not.toBeInTheDocument();
    expectListed([...tiktokOnly, ...neutral]);
    expectAbsent(instagramOnly, [...tiktokOnly, ...neutral]);
  });

  it('o seletor é navegável por teclado: rádios nativos do mesmo grupo', () => {
    renderDrawer(['instagram', 'tiktok']);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute('name', radios[1].getAttribute('name'));
  });

  it('categorias neutras (Texto, Mídia, Estrutura) aparecem para qualquer plataforma', () => {
    renderDrawer(['instagram', 'tiktok']);
    fireEvent.click(screen.getByRole('radio', { name: 'TikTok' }));
    for (const cat of ['Texto', 'Mídia', 'Estrutura']) {
      expect(screen.getByRole('heading', { name: cat })).toBeInTheDocument();
    }
  });

  it('categoria sem widgets para a plataforma escolhida não mostra título vazio', () => {
    renderDrawer(['tiktok']);
    // Audiência é só do Instagram.
    expect(WIDGET_CATEGORIES).toContain('Audiência');
    expect(screen.queryByRole('heading', { name: 'Audiência' })).not.toBeInTheDocument();
  });

  it('clicar num widget chama onInsert com o tipo e fecha o drawer', () => {
    const { onInsert, onOpenChange } = renderDrawer(['instagram']);
    fireEvent.click(screen.getByRole('button', { name: 'Top publicações' }));
    expect(onInsert).toHaveBeenCalledWith('top_posts');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('inserir o widget TikTok escolhido envia o tipo tiktok_*', () => {
    const { onInsert } = renderDrawer(['instagram', 'tiktok']);
    fireEvent.click(screen.getByRole('radio', { name: 'TikTok' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lista de vídeos' }));
    expect(onInsert).toHaveBeenCalledWith('tiktok_post_list');
  });

  it('fechado, nada renderizado', () => {
    render(
      <AddWidgetDrawer
        open={false}
        onOpenChange={() => {}}
        onInsert={() => {}}
        platforms={['instagram']}
      />,
    );
    expect(screen.queryByText('Adicionar widget')).not.toBeInTheDocument();
  });
});

describe('documentPlatforms', () => {
  it('Instagram e TikTok quando o snapshot tem as duas', () => {
    expect(documentPlatforms(makeSnapshotFixture())).toEqual(['instagram', 'tiktok']);
  });

  it('só Instagram sem a seção TikTok', () => {
    expect(documentPlatforms(makeSnapshotFixture({ tiktok: null }))).toEqual(['instagram']);
  });

  it('só TikTok quando o Instagram não está conectado', () => {
    expect(documentPlatforms(makeSnapshotFixture({ instagram_connected: false }))).toEqual([
      'tiktok',
    ]);
  });

  it('sem nenhuma conta com dados cai no Instagram, como a capa', () => {
    expect(
      documentPlatforms(makeSnapshotFixture({ instagram_connected: false, tiktok: null })),
    ).toEqual(['instagram']);
  });
});
