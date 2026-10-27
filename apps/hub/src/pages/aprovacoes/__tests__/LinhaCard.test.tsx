import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ptHubLinha from '../../../../../../packages/i18n/locales/pt/hubLinha.json';
import enHubLinha from '../../../../../../packages/i18n/locales/en/hubLinha.json';
import { HubContext } from '../../../HubContext';
import type { HubLinha, HubLinhaItem, HubLinhaResposta } from '../../../types';

vi.mock('../../../api', () => ({
  submitLinhaAcao: vi.fn(),
}));

import { submitLinhaAcao } from '../../../api';
import { LinhaCard } from '../LinhaCard';

const mockedSubmit = vi.mocked(submitLinhaAcao);

function item(id: string, over: Partial<HubLinhaItem> = {}): HubLinhaItem {
  return {
    id,
    data: '2026-11-03',
    tipo: 'feed',
    titulo: `Post ${id}`,
    direcao: `Direção ${id}`,
    valores: {},
    aprovacao: null,
    ...over,
  };
}

function resposta(over: Partial<HubLinhaResposta> = {}): HubLinhaResposta {
  return {
    id: 'r1',
    item_id: 'i1',
    acao: 'comentario',
    comentario: 'Trocar o tema',
    is_workspace_user: false,
    created_at: '2026-10-29T12:00:00.000Z',
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
    titulo: null,
    itens: [item('i1'), item('i2'), item('i3')],
    colunas: [],
    respostas: [],
    ...over,
  };
}

function renderCard(l: HubLinha, opts: { pauta?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hub = {
    bootstrap: { feature_hub_pauta: opts.pauta ?? false },
    token: 'tok',
    workspace: 'mesaas',
  } as never;
  return render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hub}>
        <LinhaCard linha={l} token="tok" agencia="Agência Azul" floatingBar={false} />
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

function row(titulo: string): HTMLElement {
  return screen.getByText(titulo).closest('[data-linha-item]') as HTMLElement;
}

beforeAll(() => {
  i18n.addResourceBundle('pt', 'hubLinha', ptHubLinha, true, true);
  i18n.addResourceBundle('en', 'hubLinha', enHubLinha, true, true);
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedSubmit.mockResolvedValue({ ok: true });
});

describe('LinhaCard, heading', () => {
  it('shows the derived title under the month eyebrow without a custom title', () => {
    renderCard(linha());
    expect(
      screen.getByRole('heading', { level: 3, name: 'Linha editorial de novembro' }),
    ).toBeInTheDocument();
  });

  it('shows the custom title, keeping the month eyebrow', () => {
    renderCard(linha({ titulo: 'Campanha de Natal' }));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Campanha de Natal' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Linha editorial de novembro')).not.toBeInTheDocument();
    expect(screen.getByText('novembro')).toBeInTheDocument();
  });
});

describe('LinhaCard, per-row approval', () => {
  it('Aprovar on a row sends aprovado with the item_id', async () => {
    renderCard(linha());
    fireEvent.click(within(row('Post i2')).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('tok', {
        linha_id: 'linha-1',
        acao: 'aprovado',
        item_id: 'i2',
      }),
    );
  });

  it('an approved row shows the pill and Desfazer sends pendente', async () => {
    renderCard(linha({ itens: [item('i1', { aprovacao: 'aprovado' }), item('i2')] }));
    const r = row('Post i1');
    expect(within(r).getByText('Aprovado')).toBeTruthy();
    expect(within(r).queryByRole('button', { name: 'Aprovar' })).toBeNull();
    fireEvent.click(within(r).getByRole('button', { name: 'Desfazer' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('tok', {
        linha_id: 'linha-1',
        acao: 'pendente',
        item_id: 'i1',
      }),
    );
  });

  it('a row in ajuste shows Ajuste pedido and Desfazer', () => {
    renderCard(linha({ itens: [item('i1', { aprovacao: 'ajustes' })], respostas: [resposta()] }));
    const r = row('Post i1');
    expect(within(r).getByText('Ajuste pedido')).toBeTruthy();
    expect(within(r).getByText('Trocar o tema')).toBeTruthy();
    expect(within(r).getByRole('button', { name: 'Desfazer' })).toBeTruthy();
  });

  it('Pedir ajuste needs text when the row has no client comment', async () => {
    renderCard(
      linha({
        // A team reply on the row does not satisfy the rule.
        respostas: [resposta({ item_id: 'i2', is_workspace_user: true, comentario: 'Ok' })],
      }),
    );
    const r = row('Post i2');
    fireEvent.click(within(r).getByRole('button', { name: 'Pedir ajuste' }));
    const box = within(r).getByLabelText('O que precisa mudar?');
    fireEvent.click(within(r).getByRole('button', { name: 'Pedir ajuste' }));
    expect((await within(r).findByRole('alert')).textContent).toBe(
      'Conte o que precisa mudar neste post.',
    );
    expect(mockedSubmit).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: 'Trocar a foto' } });
    fireEvent.click(within(r).getByRole('button', { name: 'Pedir ajuste' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('tok', {
        linha_id: 'linha-1',
        acao: 'ajustes',
        item_id: 'i2',
        comentario: 'Trocar a foto',
      }),
    );
  });

  it('Pedir ajuste submits without text when the client already commented on the row', async () => {
    renderCard(linha({ respostas: [resposta({ item_id: 'i2' })] }));
    const r = row('Post i2');
    fireEvent.click(within(r).getByRole('button', { name: 'Pedir ajuste' }));
    fireEvent.click(within(r).getByRole('button', { name: 'Pedir ajuste' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('tok', {
        linha_id: 'linha-1',
        acao: 'ajustes',
        item_id: 'i2',
      }),
    );
  });

  it('bar shows progress, helper text and the approve actions when no row has an ajuste', () => {
    renderCard(linha({ itens: [item('i1', { aprovacao: 'aprovado' }), item('i2'), item('i3')] }));
    expect(screen.getByText('1 de 3 aprovados')).toBeTruthy();
    expect(screen.getByText('Os posts ainda sem resposta também serão aprovados.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aprovar linha editorial' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pedir ajustes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enviar ajustes' })).toBeNull();
  });

  it('bar hides the helper text when every row is approved', () => {
    renderCard(linha({ itens: [item('i1', { aprovacao: 'aprovado' })] }));
    expect(screen.getByText('1 de 1 aprovados')).toBeTruthy();
    expect(screen.queryByText('Os posts ainda sem resposta também serão aprovados.')).toBeNull();
  });

  it('bar offers only Enviar ajustes when a row is in ajuste, finishing with ajustes', async () => {
    renderCard(
      linha({
        itens: [item('i1', { aprovacao: 'aprovado' }), item('i2', { aprovacao: 'ajustes' })],
        respostas: [resposta({ item_id: 'i2' })],
      }),
    );
    expect(screen.getByText('1 de 2 aprovados · 1 com ajuste')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprovar linha editorial' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pedir ajustes' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar ajustes' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('tok', { linha_id: 'linha-1', acao: 'ajustes' }),
    );
  });

  it('a 409 itens_com_ajustes on the finish shows the refresh message', async () => {
    mockedSubmit.mockRejectedValue(
      Object.assign(new Error('Não foi possível concluir. Tente novamente.'), {
        status: 409,
        code: 'itens_com_ajustes',
      }),
    );
    renderCard(linha());
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar linha editorial' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Um post tem pedido de ajuste. Atualize a página.',
    );
  });

  it('other failures on the finish show the generic error', async () => {
    mockedSubmit.mockRejectedValue(
      Object.assign(new Error('x'), { status: 409, code: 'status_invalido' }),
    );
    renderCard(linha());
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar linha editorial' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível enviar agora. Tente novamente.',
    );
  });

  it('a failed row decision shows the error on that row', async () => {
    mockedSubmit.mockRejectedValue(new Error('x'));
    renderCard(linha());
    const r = row('Post i1');
    fireEvent.click(within(r).getByRole('button', { name: 'Aprovar' }));
    expect((await within(r).findByRole('alert')).textContent).toBe(
      'Não foi possível enviar agora. Tente novamente.',
    );
  });

  it('a finished linha keeps the row pills read-only, with no buttons', () => {
    renderCard(
      linha({
        status: 'ajustes',
        decidida_at: '2026-11-09T15:00:00.000Z',
        itens: [
          item('i1', { aprovacao: 'aprovado' }),
          item('i2', { aprovacao: 'ajustes' }),
          item('i3'),
        ],
      }),
    );
    expect(within(row('Post i1')).getByText('Aprovado')).toBeTruthy();
    expect(within(row('Post i2')).getByText('Ajuste pedido')).toBeTruthy();
    expect(within(row('Post i3')).queryByText('Aprovado')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/aprovados/)).toBeNull();
  });

  it('a client ajustes resposta with text counts as a comment for Pedir ajustes', async () => {
    renderCard(
      linha({
        respostas: [resposta({ item_id: null, acao: 'ajustes', comentario: 'Mais vídeo' })],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Pedir ajustes' }));
    await waitFor(() =>
      expect(mockedSubmit).toHaveBeenCalledWith('tok', { linha_id: 'linha-1', acao: 'ajustes' }),
    );
  });

  it('pauta look renders the row buttons and pills', () => {
    renderCard(linha({ itens: [item('i1', { aprovacao: 'aprovado' }), item('i2')] }), {
      pauta: true,
    });
    expect(within(row('Post i1')).getByText('Aprovado').className).toContain('hub-pill-st-ok');
    const aprovar = within(row('Post i2')).getByRole('button', { name: 'Aprovar' });
    expect(aprovar.className).toContain('hub-btn-primary');
    expect(aprovar.className).toContain('min-h-[44px]');
  });
});
