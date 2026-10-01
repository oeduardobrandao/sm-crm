import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
// Este repo não tem @testing-library/user-event instalado (ver outros testes
// de Dialog, ex. RelatorioEditorPage.test.tsx) — cliques via fireEvent.
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideContext, type GuideApi } from '../GuideContext';
import { GUIDE_TRAILS } from '../guideContent';
import GuideDialog from '../GuideDialog';

vi.mock('../../../lib/analytics', () => ({ captureEvent: vi.fn() }));

const videos = vi.hoisted(() => ({
  series: { data: undefined as unknown } as Record<string, unknown>,
  progressLoading: false,
  seriesHook: vi.fn(),
}));
vi.mock('../../../pages/ajuda/videos/useKbVideos', () => ({
  useKbVideoSeries: (...args: unknown[]) => {
    videos.seriesHook(...args);
    return videos.series;
  },
  useVideoProgress: () => ({
    progress: new Map(),
    save: vi.fn(),
    isLoading: videos.progressLoading,
  }),
}));

function v(id: number, slug: string, title: string, series_id: string) {
  return {
    id,
    series_id,
    title,
    slug,
    description: null,
    display_order: id,
    duration_seconds: 60,
    hls_url: `https://h/${id}.m3u8`,
    thumbnail_url: null,
    article: null,
  };
}

const SERIES = [
  {
    id: 's1',
    title: 'Primeiros Passos',
    slug: 'primeiros-passos',
    description: null,
    display_order: 1,
    videos: [
      v(1, 'primeiro-acesso', 'Primeiro acesso', 's1'),
      v(4, 'conectar-instagram', 'Instagram', 's1'),
    ],
  },
  {
    id: 's2',
    title: 'Indo Além',
    slug: 'indo-alem',
    description: null,
    display_order: 2,
    videos: [
      v(9, 'metricas-do-instagram', 'Métricas do Instagram', 's2'),
      v(10, 'automacoes', 'Automações', 's2'),
    ],
  },
];

function makeApi(overrides: Partial<GuideApi> = {}): GuideApi {
  return {
    trails: GUIDE_TRAILS,
    doneIds: new Set<string>(),
    totals: { done: 0, total: 15 },
    isConcluded: false,
    signalsSatisfied: false,
    progress: { pagesSeen: [], pagesDone: [], trailsCompleted: [] },
    markSeen: vi.fn(),
    setLastPage: vi.fn(),
    dismiss: vi.fn(),
    conclude: vi.fn(),
    recordAutoOpen: vi.fn(),
    recordTrailCompleted: vi.fn(),
    isOpen: true,
    autoOpen: 'no',
    currentPageId: null,
    latestClienteId: null,
    signalValues: {},
    showEntryPoint: true,
    open: vi.fn(),
    close: vi.fn(),
    closeForAction: vi.fn(),
    goTo: vi.fn(),
    concludeGuide: vi.fn(),
    ...overrides,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.pathname + loc.search}</span>;
}

function renderDialog(api: GuideApi) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <GuideContext.Provider value={api}>
        <GuideDialog />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </GuideContext.Provider>
    </MemoryRouter>,
  );
}

describe('GuideDialog', () => {
  beforeEach(() => {
    videos.series = { data: SERIES };
    videos.progressLoading = false;
    videos.seriesHook.mockClear();
    HTMLMediaElement.prototype.canPlayType = vi.fn(() => 'probably') as unknown as (
      t: string,
    ) => CanPlayTypeResult;
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  });
  afterEach(() => {
    delete (HTMLMediaElement.prototype as { canPlayType?: unknown }).canPlayType;
  });

  it('home mostra as três trilhas e o contador geral', () => {
    renderDialog(makeApi());
    expect(screen.getByText('Bem-vindo ao Mesaas')).toBeInTheDocument();
    expect(screen.getByText('Adicionar seu primeiro cliente')).toBeInTheDocument();
    expect(screen.getByText('Montar sua equipe')).toBeInTheDocument();
    expect(screen.getByText('Criar suas entregas')).toBeInTheDocument();
    expect(screen.getByText('0 de 15 páginas')).toBeInTheDocument();
  });

  it('começar uma trilha navega para a primeira página dela', () => {
    const api = makeApi();
    renderDialog(api);
    fireEvent.click(screen.getAllByRole('button', { name: 'Começar' })[0]);
    expect(api.goTo).toHaveBeenCalledWith('t1p1');
  });

  it('página renderiza título, posição e markSeen dispara', () => {
    const api = makeApi({ currentPageId: 't1p1' });
    renderDialog(api);
    expect(screen.getByText('Tudo começa com um cliente')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 5')).toBeInTheDocument();
    expect(api.markSeen).toHaveBeenCalledWith('t1p1');
  });

  it('Fazer agora fecha sem dismissal, grava lastPage e navega', () => {
    const api = makeApi({ currentPageId: 't1p2' });
    renderDialog(api);
    fireEvent.click(screen.getByRole('button', { name: 'Fazer agora' }));
    expect(api.setLastPage).toHaveBeenCalledWith('t1p2');
    expect(api.closeForAction).toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/clientes?novo=1');
  });

  it('a última página da trilha 1 tem a ponte para a trilha 2', () => {
    const api = makeApi({ currentPageId: 't1p5' });
    renderDialog(api);
    fireEvent.click(screen.getByRole('button', { name: /Montar sua equipe/ }));
    expect(api.goTo).toHaveBeenCalledWith('t2p1');
  });

  it('a conclusão chama concludeGuide', () => {
    const api = makeApi({ currentPageId: 't3p6' });
    renderDialog(api);
    fireEvent.click(screen.getByRole('button', { name: 'Concluir guia' }));
    expect(api.concludeGuide).toHaveBeenCalled();
  });

  it('home mostra o vídeo em destaque', () => {
    renderDialog(makeApi());
    expect(
      screen.getByRole('button', { name: 'Assistir o vídeo Primeiro acesso' }),
    ).toBeInTheDocument();
  });

  it('página com vídeo publicado mostra o card', () => {
    renderDialog(makeApi({ currentPageId: 't1p3' }));
    expect(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' })).toBeInTheDocument();
  });

  it('slug sem vídeo publicado não mostra nada', () => {
    renderDialog(makeApi({ currentPageId: 't1p2' }));
    expect(screen.queryByRole('button', { name: /o vídeo/ })).not.toBeInTheDocument();
  });

  it('carregando: sem card', () => {
    videos.series = { data: undefined };
    renderDialog(makeApi({ currentPageId: 't1p3' }));
    expect(screen.queryByRole('button', { name: /o vídeo/ })).not.toBeInTheDocument();
  });

  it('progresso carregando: sem card até o progresso chegar', () => {
    videos.progressLoading = true;
    renderDialog(makeApi({ currentPageId: 't1p3' }));
    expect(screen.queryByRole('button', { name: /o vídeo/ })).not.toBeInTheDocument();
  });

  it('erro ao carregar a série: sem card', () => {
    videos.series = { data: undefined, isError: true };
    renderDialog(makeApi({ currentPageId: 't1p3' }));
    expect(screen.queryByRole('button', { name: /o vídeo/ })).not.toBeInTheDocument();
  });

  it('com o guia fechado, as queries de vídeo não rodam', () => {
    renderDialog(makeApi({ isOpen: false, currentPageId: 't1p3' }));
    expect(videos.seriesHook).not.toHaveBeenCalled();
  });

  it('Ver na Central de Ajuda sai do guia sem dismissal e abre o vídeo', () => {
    const api = makeApi({ currentPageId: 't1p3' });
    renderDialog(api);
    fireEvent.click(screen.getByRole('button', { name: 'Assistir o vídeo Instagram' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver na Central de Ajuda' }));
    expect(api.setLastPage).toHaveBeenCalledWith('t1p3');
    expect(api.closeForAction).toHaveBeenCalled();
    expect(api.dismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/ajuda/video/conectar-instagram');
  });

  it('fechamento sugere a série Indo Além', () => {
    const api = makeApi({ currentPageId: 't3p6' });
    renderDialog(api);
    expect(screen.getByText('Quando quiser ir além')).toBeInTheDocument();
    expect(screen.getByText('Métricas do Instagram')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver vídeos' }));
    expect(api.closeForAction).toHaveBeenCalled();
    expect(screen.getByTestId('loc').textContent).toBe('/ajuda/video/metricas-do-instagram');
  });

  it('fechamento sem a série publicada não mostra o bloco', () => {
    videos.series = { data: [SERIES[0]] };
    renderDialog(makeApi({ currentPageId: 't3p6' }));
    expect(screen.queryByText('Quando quiser ir além')).not.toBeInTheDocument();
  });
});
