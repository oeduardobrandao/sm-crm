import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from 'i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ptHubMaterial from '../../../../../../packages/i18n/locales/pt/hubMaterial.json';
import enHubMaterial from '../../../../../../packages/i18n/locales/en/hubMaterial.json';
import { HubContext } from '../../../HubContext';
import {
  makePostReferencesStub,
  makeReferenceItem,
} from '../../../hooks/__tests__/postReferencesStub';
import type { PostReferencesState } from '../../../hooks/usePostReferences';
import { HUB_MATERIAL_KEY } from '../../../queries';
import type { HubMaterialRequest } from '../../../services/materialRequests';
import { MaterialTab } from '../MaterialTab';

vi.mock('../../../services/materialRequests', () => ({
  fetchMaterialRequests: vi.fn(),
  closeMaterialRequest: vi.fn(),
}));
const refsState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../../hooks/usePostReferences', async (orig) => ({
  ...(await orig<typeof import('../../../hooks/usePostReferences')>()),
  usePostReferences: () => refsState.current,
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: toastMock }));
import { closeMaterialRequest, fetchMaterialRequests } from '../../../services/materialRequests';

let lastQc: QueryClient;

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="location">{loc.search}</span>;
}

/** Files on every item, so the per-post list says all three are done. */
function allItemsSent(): PostReferencesState {
  return makePostReferencesStub({
    items: [10, 11, 12].map((id) => makeReferenceItem(id, { material_item_id: id })),
  });
}

function req(over: Partial<HubMaterialRequest> = {}): HubMaterialRequest {
  const labels = ['Vídeo do Dr. Paulo', 'Foto do consultório', 'Lista de exames'];
  return {
    post_id: 1,
    titulo: 'Novembro Azul',
    tipo: 'carrossel',
    scheduled_at: '2026-11-14T15:00:00.000Z',
    platform: 'instagram',
    client_visible: false,
    files_by_item: {},
    request: {
      id: 1,
      post_id: 1,
      status: 'aberto',
      closed_by: null,
      closed_at: null,
      opened_by: null,
      opened_at: '2026-11-01T10:00:00.000Z',
      items: labels.map((label, i) => ({
        id: 10 + i,
        label,
        detail: null,
        position: i,
        file_count: i === 0 ? 2 : 0,
        done: i === 0,
      })),
    },
    ...over,
  };
}

function renderTab(onOpen = vi.fn(), url = '/?aba=material') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQc = qc;
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={{ token: 'tok', workspace: 'ws', bootstrap: {} } as never}>
        <MemoryRouter initialEntries={[url]}>
          <MaterialTab onOpen={onOpen} />
          <LocationProbe />
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
  return onOpen;
}

describe('MaterialTab', () => {
  beforeAll(() => {
    i18n.addResourceBundle('pt', 'hubMaterial', ptHubMaterial, true, true);
    i18n.addResourceBundle('en', 'hubMaterial', enHubMaterial, true, true);
  });
  beforeEach(() => {
    refsState.current = makePostReferencesStub();
    toastMock.mockReset();
    vi.mocked(closeMaterialRequest).mockReset();
    vi.mocked(fetchMaterialRequests).mockReset().mockResolvedValue([req()]);
  });

  async function refetchEmpty() {
    vi.mocked(fetchMaterialRequests).mockResolvedValue([]);
    await act(() => lastQc.invalidateQueries({ queryKey: [HUB_MATERIAL_KEY, 'tok'] }));
  }

  it('keeps the dialog open when the team closes the request, saying so and blocking uploads', async () => {
    renderTab(vi.fn(), '/?aba=material&pedido=1');
    await screen.findByText('A equipe precisa de 3 itens');
    await refetchEmpty();
    expect(await screen.findByText('Este pedido foi encerrado pela equipe.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Novembro Azul' })).toBeInTheDocument();
    for (const b of screen.getAllByRole('button', { name: /^Enviar arquivo para/ })) {
      expect(b).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: 'Enviei o que tenho' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('pedido=1');
  });

  it('says everything was sent when the request closes with every item filled', async () => {
    refsState.current = allItemsSent();
    renderTab(vi.fn(), '/?aba=material&pedido=1');
    await screen.findByText('A equipe precisa de 3 itens');
    await refetchEmpty();
    expect(await screen.findByText('Tudo enviado. A equipe foi avisada.')).toBeInTheDocument();
    expect(screen.queryByText('Este pedido foi encerrado pela equipe.')).not.toBeInTheDocument();
  });

  it('after Enviei o que tenho: closes the dialog, drops pedido and confirms with a toast', async () => {
    refsState.current = allItemsSent();
    vi.mocked(closeMaterialRequest).mockImplementation(async () => {
      vi.mocked(fetchMaterialRequests).mockResolvedValue([]);
    });
    renderTab(vi.fn(), '/?aba=material&pedido=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Enviei o que tenho' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Avisar a equipe' }));
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('pedido'));
    expect(screen.queryByRole('dialog', { name: 'Novembro Azul' })).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith('Pronto. A equipe foi avisada.');
  });

  it('drops a ?pedido= that is not an open request once the list loaded', async () => {
    renderTab(vi.fn(), '/?aba=material&pedido=99');
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('pedido'));
    expect(screen.getByTestId('location')).toHaveTextContent('aba=material');
  });

  it('renders the tile with progress, struck-through done items and the pill', async () => {
    renderTab();
    const tile = await screen.findByRole('button', { name: /Novembro Azul/ });
    expect(within(tile).getByText('Aguardando material')).toBeInTheDocument();
    expect(within(tile).getByText('1 de 3 itens enviados')).toBeInTheDocument();
    const bar = within(tile).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(within(tile).getByText('Vídeo do Dr. Paulo').parentElement).toHaveClass('line-through');
    expect(within(tile).getByText('Foto do consultório').parentElement).not.toHaveClass(
      'line-through',
    );
    expect(within(tile).getByText('Enviar')).toBeInTheDocument();
  });

  it('opens the request when the tile is clicked', async () => {
    const onOpen = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Novembro Azul/ }));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('lists all 10 items without clipping and exposes done/pending to screen readers', async () => {
    const base = req();
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: 100 + i,
      label: `Item ${i}`,
      detail: null,
      position: i,
      file_count: i === 0 ? 1 : 0,
      done: i === 0,
    }));
    vi.mocked(fetchMaterialRequests).mockResolvedValue([
      { ...base, request: { ...base.request, items } },
    ]);
    renderTab();
    const tile = await screen.findByRole('button', { name: /Novembro Azul/ });
    for (let i = 0; i < 10; i++) expect(within(tile).getByText(`Item ${i}`)).toBeInTheDocument();
    expect(within(tile).getByText(/Enviado:/)).toBeInTheDocument();
    expect(within(tile).getAllByText(/Pendente:/)).toHaveLength(9);
    expect(tile.querySelector('.overflow-hidden.flex-col')).toBeNull();
  });

  it('opens the request dialog for ?pedido=<postId> and closes it by dropping the param', async () => {
    renderTab(vi.fn(), '/?aba=material&pedido=1');
    expect(await screen.findByRole('dialog', { name: 'Novembro Azul' })).toBeInTheDocument();
    expect(screen.getByText('A equipe precisa de 3 itens')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar pedido de material' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Novembro Azul' })).not.toBeInTheDocument(),
    );
  });

  it('opens nothing for a ?pedido= that is not an open request', async () => {
    renderTab(vi.fn(), '/?aba=material&pedido=99');
    await screen.findByRole('button', { name: /Novembro Azul/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the error state when the fetch fails', async () => {
    vi.mocked(fetchMaterialRequests).mockRejectedValue(new Error('boom'));
    renderTab();
    expect(
      await screen.findByText('Não foi possível carregar os pedidos de material.'),
    ).toBeInTheDocument();
  });

  it('shows "Sem data" for a post without a date', async () => {
    vi.mocked(fetchMaterialRequests).mockResolvedValue([req({ scheduled_at: null })]);
    renderTab();
    expect(await screen.findByText(/· Sem data/)).toBeInTheDocument();
  });

  it('en bundle has the same keys as pt', () => {
    const keys = (o: Record<string, unknown>, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v ? keys(v as Record<string, unknown>, `${p}${k}.`) : [p + k],
      );
    expect(keys(enHubMaterial).sort()).toEqual(keys(ptHubMaterial).sort());
  });
});
