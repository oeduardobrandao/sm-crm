import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ptHubLinha from '../../../../../packages/i18n/locales/pt/hubLinha.json';
import enHubLinha from '../../../../../packages/i18n/locales/en/hubLinha.json';
import { HubContext } from '../../HubContext';
import type { HubLinha, HubLinhaItem } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchLinhas: vi.fn(),
  submitLinhaAcao: vi.fn(),
  fetchInstagramFeed: vi.fn(),
  submitApproval: vi.fn(),
  submitEditSuggestion: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));

import { fetchLinhas, fetchPosts, submitLinhaAcao } from '../../api';
import { AprovacoesPage } from '../AprovacoesPage';

const mockedFetchPosts = vi.mocked(fetchPosts);
const mockedFetchLinhas = vi.mocked(fetchLinhas);
const mockedSubmit = vi.mocked(submitLinhaAcao);

const BASE = '/mesaas/hub/token-publico/aprovacoes';

function hubValue(over: { linha?: boolean; pauta?: boolean } = {}) {
  return {
    bootstrap: {
      workspace: { name: 'Agência Azul', logo_url: '', brand_color: '#0f766e' },
      cliente_nome: 'Clínica',
      is_active: true,
      cliente_id: 14,
      feature_linha_editorial: over.linha ?? true,
      feature_hub_pauta: over.pauta ?? false,
    },
    token: 'token-publico',
    workspace: 'mesaas',
  } as never;
}

function item(id: string, data: string | null, over: Partial<HubLinhaItem> = {}): HubLinhaItem {
  return {
    id,
    data,
    tipo: 'feed',
    titulo: `Post ${id}`,
    direcao: `Direção ${id}`,
    valores: {},
    ...over,
  };
}

function linha(over: Partial<HubLinha> = {}): HubLinha {
  return {
    id: 'linha-1',
    periodo: '2026-11-01',
    status: 'enviada',
    enviada_at: '2026-10-28T13:00:00.000Z',
    decidida_at: null,
    rodada: 1,
    itens: [
      item('i1', '2026-11-03', { valores: { c1: 'o1' } }),
      item('i2', '2026-11-10', { tipo: 'reels' }),
      item('i3', null),
    ],
    colunas: [
      {
        id: 'c1',
        nome: 'Pilar',
        tipo: 'select',
        config: { options: [{ id: 'o1', label: 'Educação', color: '#fff' }] },
        ordem: 1,
      },
    ],
    respostas: [],
    ...over,
  };
}

function renderPage(path: string, opts: { linha?: boolean; pauta?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue(opts)}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/:workspace/hub/:token/aprovacoes/:postId?" element={<AprovacoesPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

beforeAll(() => {
  i18n.addResourceBundle('pt', 'hubLinha', ptHubLinha, true, true);
  i18n.addResourceBundle('en', 'hubLinha', enHubLinha, true, true);
});

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date: the current month decides what sits under "Anteriores".
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
  mockedFetchPosts.mockResolvedValue({
    posts: [],
    postApprovals: [],
    propertyValues: [],
    workflowSelectOptions: [],
    instagramProfile: null,
  });
  mockedFetchLinhas.mockResolvedValue({ linhas: [linha()] });
  mockedSubmit.mockResolvedValue({ ok: true });
});

afterEach(() => vi.useRealTimers());

describe('Aprovações, Linha editorial tab', () => {
  it('tabs hidden when flag off', async () => {
    renderPage(`${BASE}?aba=linha`, { linha: false });
    expect(await screen.findByText('Tudo em dia. Nenhum post aguardando aprovação.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText(/Este é o plano do mês/)).toBeNull();
    expect(mockedFetchLinhas).not.toHaveBeenCalled();
  });

  it('shows the Posts tab by default and counts enviada linhas', async () => {
    renderPage(BASE);
    const posts = await screen.findByRole('tab', { name: 'Posts · 0' });
    expect(posts.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('tab', { name: 'Linha editorial · 1' })).toBeTruthy();
    expect(screen.queryByText(/Este é o plano do mês/)).toBeNull();
  });

  it('aba=linha selects tab', async () => {
    renderPage(`${BASE}?aba=linha`);
    const tab = await screen.findByRole('tab', { name: 'Linha editorial · 1' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText(/Este é o plano do mês/)).toBeTruthy();
    expect(screen.getByText('Linha editorial de novembro')).toBeTruthy();
    expect(screen.getByText(/3 posts planejados por Agência Azul/)).toBeTruthy();
    // Week groups, undated last, visible column value and the row copy.
    expect(screen.getByText('Semana de 1 a 7 de novembro')).toBeTruthy();
    expect(screen.getByText('Semana de 8 a 14 de novembro')).toBeTruthy();
    expect(screen.getByText('Sem data')).toBeTruthy();
    expect(screen.getByText('Post i1')).toBeTruthy();
    expect(screen.getByText('Direção i1')).toBeTruthy();
    expect(screen.getByText('Educação')).toBeTruthy();
  });

  it('clicking the tab switches the view', async () => {
    renderPage(BASE);
    fireEvent.click(await screen.findByRole('tab', { name: 'Linha editorial · 1' }));
    expect(await screen.findByText(/Este é o plano do mês/)).toBeTruthy();
  });

  it('shows the empty state when nothing was sent', async () => {
    mockedFetchLinhas.mockResolvedValue({ linhas: [] });
    renderPage(`${BASE}?aba=linha`);
    expect(await screen.findByText('Nenhuma linha editorial para aprovar.')).toBeTruthy();
  });

  it('Comentar posts acao comentario with item_id', async () => {
    renderPage(`${BASE}?aba=linha`);
    const row = (await screen.findByText('Post i2')).closest('[data-linha-item]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Comentar' }));
    fireEvent.change(within(row).getByLabelText('Seu comentário'), {
      target: { value: 'Trocar para quinta' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvar comentário' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('token-publico', {
        linha_id: 'linha-1',
        acao: 'comentario',
        item_id: 'i2',
        comentario: 'Trocar para quinta',
      }),
    );
    // The list is refetched so the comment shows.
    await waitFor(() => expect(mockedFetchLinhas).toHaveBeenCalledTimes(2));
  });

  it('keeps the draft in the textarea when saving a comment fails', async () => {
    mockedSubmit.mockRejectedValue(new Error('Não foi possível concluir. Tente novamente.'));
    renderPage(`${BASE}?aba=linha`);
    const row = (await screen.findByText('Post i2')).closest('[data-linha-item]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Comentar' }));
    fireEvent.change(within(row).getByLabelText('Seu comentário'), {
      target: { value: 'Trocar para quinta' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvar comentário' }));
    expect((await within(row).findByRole('alert')).textContent).toMatch(/Tente novamente/);
    expect((within(row).getByLabelText('Seu comentário') as HTMLTextAreaElement).value).toBe(
      'Trocar para quinta',
    );
  });

  it('shows client comments and team replies, and counts the client ones', async () => {
    mockedFetchLinhas.mockResolvedValue({
      linhas: [
        linha({
          respostas: [
            {
              id: 'r1',
              item_id: 'i1',
              acao: 'comentario',
              comentario: 'Gostei da ideia',
              is_workspace_user: false,
              created_at: '2026-10-29T12:00:00.000Z',
            },
            {
              id: 'r2',
              item_id: 'i1',
              acao: 'comentario',
              comentario: 'Combinado, obrigado',
              is_workspace_user: true,
              created_at: '2026-10-29T13:00:00.000Z',
            },
          ],
        }),
      ],
    });
    renderPage(`${BASE}?aba=linha`);
    expect(await screen.findByText('Gostei da ideia')).toBeTruthy();
    expect(screen.getByText('Combinado, obrigado')).toBeTruthy();
    expect(screen.getByText('1 comentário na linha')).toBeTruthy();
  });

  it('Pedir ajustes without comments requires text', async () => {
    renderPage(`${BASE}?aba=linha`);
    expect(await screen.findByText('0 comentários na linha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pedir ajustes' }));
    const box = screen.getByLabelText('O que precisa mudar');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido de ajustes' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Conte o que precisa mudar.');
    expect(mockedSubmit).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: 'Mais posts de bastidores' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pedido de ajustes' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('token-publico', {
        linha_id: 'linha-1',
        acao: 'ajustes',
        comentario: 'Mais posts de bastidores',
      }),
    );
  });

  it('Pedir ajustes with comments sends the decision straight away', async () => {
    mockedFetchLinhas.mockResolvedValue({
      linhas: [
        linha({
          respostas: [
            {
              id: 'r1',
              item_id: 'i1',
              acao: 'comentario',
              comentario: 'Trocar o tema',
              is_workspace_user: false,
              created_at: '2026-10-29T12:00:00.000Z',
            },
          ],
        }),
      ],
    });
    renderPage(`${BASE}?aba=linha`);
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajustes' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('token-publico', {
        linha_id: 'linha-1',
        acao: 'ajustes',
      }),
    );
  });

  it('Aprovar posts acao aprovado and shows Aprovada em', async () => {
    renderPage(`${BASE}?aba=linha`);
    const approve = await screen.findByRole('button', { name: 'Aprovar linha editorial' });
    mockedFetchLinhas.mockResolvedValue({
      linhas: [linha({ status: 'aprovada', decidida_at: '2026-11-10T15:00:00.000Z' })],
    });
    fireEvent.click(approve);
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('token-publico', {
        linha_id: 'linha-1',
        acao: 'aprovado',
      }),
    );
    expect(await screen.findByText('Aprovada em 10 de novembro')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar linha editorial' })).toBeNull();
  });

  it('shows an actionable error and keeps the linha editable when the decision fails', async () => {
    mockedSubmit.mockRejectedValue(new Error('Não foi possível concluir. Tente novamente.'));
    renderPage(`${BASE}?aba=linha`);
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar linha editorial' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Tente novamente/);
    expect(screen.getByRole('button', { name: 'Aprovar linha editorial' })).toBeTruthy();
  });

  it('decided linha is read-only', async () => {
    mockedFetchLinhas.mockResolvedValue({
      linhas: [linha({ status: 'ajustes', decidida_at: '2026-11-09T15:00:00.000Z' })],
    });
    renderPage(`${BASE}?aba=linha`);
    expect(await screen.findByText('Ajustes pedidos em 9 de novembro')).toBeTruthy();
    expect(screen.getByText('Post i1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Comentar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pedir ajustes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aprovar linha editorial' })).toBeNull();
    // Not counted as waiting for the client.
    expect(screen.getByRole('tab', { name: 'Linha editorial · 0' })).toBeTruthy();
  });

  it('collapses decided linhas of past months under Anteriores', async () => {
    mockedFetchLinhas.mockResolvedValue({
      linhas: [
        linha({ id: 'nov', periodo: '2026-11-01' }),
        linha({
          id: 'out',
          periodo: '2026-10-01',
          status: 'aprovada',
          decidida_at: '2026-10-05T15:00:00.000Z',
          itens: [item('o1', '2026-10-12', { titulo: 'Post de outubro' })],
        }),
      ],
    });
    renderPage(`${BASE}?aba=linha`);
    const toggle = await screen.findByRole('button', { name: /Anteriores/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Post de outubro')).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText('Post de outubro')).toBeTruthy();
    expect(screen.getByText('Aprovada em 5 de outubro')).toBeTruthy();
  });

  it('pauta look renders', async () => {
    renderPage(`${BASE}?aba=linha`, { pauta: true });
    const approve = await screen.findByRole('button', { name: 'Aprovar linha editorial' });
    expect(approve.className).toContain('hub-btn-primary');
    expect(screen.getByRole('button', { name: 'Pedir ajustes' }).className).toContain(
      'hub-btn-secondary',
    );
    expect(document.querySelector('.hub-card')).not.toBeNull();
    expect(screen.getByText('Semana de 1 a 7 de novembro').className).toContain('hub-eyebrow');
  });
});
