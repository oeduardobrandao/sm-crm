import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/supabase');

import { MinhaFilaView } from '../MinhaFilaView';
import { buildMinhaFila } from '../../minhaFila';
import { buildStatusRegistry } from '../../statusRegistry';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { ActivePost, Membro, WorkflowEtapa } from '../../../../store';

// jsdom's matchMedia reports false, so useIsDesktop() is false: the phone branch.

const NOW = new Date(2026, 8, 23, 10, 0, 0);
const ME = 7;
const OTHER = 9;
const registry = buildStatusRegistry([]);
const membros = [
  { id: ME, nome: 'Ana Souza' },
  { id: OTHER, nome: 'Bruno Lima' },
] as Membro[];

const day = (n: number, h = 9) => new Date(2026, 8, 23 + n, h, 0, 0);
const iso = (n: number, h = 9) => day(n, h).toISOString();
const ymd = (n: number) => {
  const d = day(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function post(id: number, over: Partial<ActivePost> = {}): ActivePost {
  return {
    id,
    workflow_id: null,
    cliente_id: 1,
    cliente_nome: 'Dra. Marina',
    workflow_titulo: null,
    titulo: `Post ${id}`,
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...over,
  } as ActivePost;
}

function card(opts: {
  wf: number;
  resp: number | null;
  nextResp?: number | null;
  dataLimiteDias: number | null;
  estourado?: boolean;
}): BoardCard {
  const mk = (ordem: number, nome: string, responsavel_id: number | null): WorkflowEtapa => ({
    id: opts.wf * 100 + ordem,
    workflow_id: opts.wf,
    ordem,
    nome,
    prazo_dias: 2,
    tipo_prazo: 'corridos',
    responsavel_id,
    tipo: 'padrao',
    status: ordem === 0 ? 'ativo' : 'pendente',
    iniciado_em: null,
    concluido_em: null,
    data_limite: ordem === 0 && opts.dataLimiteDias != null ? ymd(opts.dataLimiteDias) : null,
  });
  const ativa = mk(0, 'Design', opts.resp);
  const proxima = mk(1, 'Revisão', opts.nextResp ?? null);
  return {
    workflow: {
      id: opts.wf,
      titulo: `Fluxo ${opts.wf}`,
      cliente_id: 1,
      status: 'ativo',
      etapa_atual: 0,
    },
    etapa: ativa,
    cliente: { id: 1, nome: 'Dra. Marina' },
    membro: membros.find((m) => m.id === opts.resp),
    deadline: {
      diasRestantes: opts.estourado ? -1 : 2,
      horasRestantes: 0,
      estourado: opts.estourado ?? false,
      urgente: false,
    },
    totalEtapas: 2,
    etapaIdx: 0,
    allEtapas: [ativa, proxima],
  } as unknown as BoardCard;
}

/** Atrasado: fluxo 1 (2 posts) · Hoje: avulso responsável · Próximos 7: fluxo 3 ·
 *  Chegando: fluxo 4 (2 posts) + nada mais. */
function fixture() {
  return buildMinhaFila(
    {
      cards: [
        card({ wf: 1, resp: ME, dataLimiteDias: -1, estourado: true }),
        card({ wf: 3, resp: ME, dataLimiteDias: 3 }),
        card({ wf: 4, resp: OTHER, nextResp: ME, dataLimiteDias: 2 }),
      ],
      posts: [
        // Etapa do fluxo 1 venceu ontem: post 11 publica ontem (margem 0 = "sem
        // margem"), post 12 publica amanhã (margem 1d: etapa vencida conta de hoje).
        post(11, { workflow_id: 1, titulo: 'Carrossel dia das mães', scheduled_at: iso(-1, 14) }),
        post(12, { workflow_id: 1, titulo: 'Reels bastidores', scheduled_at: iso(1, 10) }),
        post(20, { titulo: 'Post avulso X', responsavel_id: ME, scheduled_at: iso(0, 18) }),
        post(31, { workflow_id: 3, titulo: 'Stories evento', scheduled_at: iso(5) }),
        post(41, { workflow_id: 4, titulo: 'Chegando A', scheduled_at: iso(6) }),
        post(42, { workflow_id: 4, titulo: 'Chegando B' }),
      ],
      postEntities: [],
    },
    ME,
    NOW,
  );
}

function renderView(over: Partial<React.ComponentProps<typeof MinhaFilaView>> = {}) {
  const props = {
    fila: fixture(),
    membros: [...membros, { id: 5, nome: 'Débora Reis' } as Membro],
    membroId: ME,
    currentMembroId: ME,
    registry,
    isLoading: false,
    isError: false,
    onPostClick: vi.fn(),
    onFluxoClick: vi.fn(),
    onMembroChange: vi.fn(),
    onOrdemChange: vi.fn(),
    ...over,
  };
  return {
    ...render(
      <MemoryRouter>
        <MinhaFilaView {...props} />
      </MemoryRouter>,
    ),
    props,
  };
}

const section = (container: HTMLElement, bucket: string) =>
  container.querySelector(`section[data-bucket="${bucket}"]`) as HTMLElement;

describe('MinhaFilaView (phone)', () => {
  it('renders the four counters and the "Comece por aqui" card, which opens the top post', () => {
    const { props } = renderView();
    const summary = screen.getByTestId('fila-summary');
    expect(within(summary).getByText('Atrasados')).toBeInTheDocument();
    expect(within(summary).getByText('Vencem hoje')).toBeInTheDocument();
    expect(within(summary).getByText('Esta semana')).toBeInTheDocument();
    expect(within(summary).getByText('Chegando')).toBeInTheDocument();
    const top = screen.getByTestId('fila-top');
    expect(top).toHaveTextContent('Comece por aqui');
    expect(top).toHaveTextContent('Carrossel dia das mães');
    fireEvent.click(top);
    expect(props.onPostClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, titulo: 'Carrossel dia das mães' }),
    );
  });

  it('keeps the desktop expand/collapse state per section and opens rows and fluxos', () => {
    const { container, props } = renderView();
    const atrasado = section(container, 'atrasado');
    const head = within(atrasado).getByRole('button', { expanded: true });
    expect(head).toHaveTextContent('Atrasado · 2');
    // Fluxo header row opens the fluxo; a post row opens the post.
    fireEvent.click(within(atrasado).getByRole('button', { name: /Fluxo 1/ }));
    expect(props.onFluxoClick).toHaveBeenCalledWith(1);
    fireEvent.click(within(atrasado).getByRole('button', { name: /Reels bastidores/ }));
    expect(props.onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(within(atrasado).queryByText('Reels bastidores')).not.toBeInTheDocument();
    // Próximos 7 dias starts collapsed, as on desktop.
    const prox = section(container, 'proximos7');
    const proxHead = within(prox).getByRole('button', { expanded: false });
    fireEvent.click(proxHead);
    expect(within(prox).getByText('Stories evento')).toBeInTheDocument();
  });

  it('shows Chegando with its fluxo group collapsed until tapped', () => {
    const { props } = renderView();
    const chegando = screen.getByTestId('fila-chegando');
    expect(chegando).toHaveTextContent('ainda não é sua vez');
    expect(within(chegando).queryByText('Chegando A')).not.toBeInTheDocument();
    fireEvent.click(within(chegando).getByRole('button', { expanded: false }));
    fireEvent.click(within(chegando).getByRole('button', { name: /Chegando A/ }));
    expect(props.onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 41 }));
  });

  it('moves the "Fila de" picker into the view: members sorted pt-BR, self as "(você)"', () => {
    const { props } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Fila de:.*Ana Souza \(você\)/ }));
    const sheet = screen.getByRole('dialog', { name: 'Fila de' });
    const names = within(sheet)
      .getAllByRole('button', { pressed: undefined })
      .map((b) => b.textContent)
      .filter((t) => t && /Souza|Lima|Reis/.test(t));
    expect(names).toEqual(['Ana Souza (você)', 'Bruno Lima', 'Débora Reis']);
    expect(within(sheet).getByRole('button', { name: 'Ana Souza (você)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Bruno Lima' }));
    expect(props.onMembroChange).toHaveBeenCalledWith(OTHER);
  });

  it('choosing yourself passes null, exactly like FilaMembroPicker', () => {
    const { props } = renderView({ membroId: OTHER });
    fireEvent.click(screen.getByRole('button', { name: /Fila de:.*Bruno Lima/ }));
    const sheet = screen.getByRole('dialog', { name: 'Fila de' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ana Souza (você)' }));
    expect(props.onMembroChange).toHaveBeenCalledWith(null);
  });

  it('re-picking the current member changes nothing', () => {
    const { props } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /Fila de:/ }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Fila de' })).getByRole('button', {
        name: 'Ana Souza (você)',
      }),
    );
    expect(props.onMembroChange).not.toHaveBeenCalled();
  });

  it('moves the "Ordenar" picker into the view', () => {
    const { props } = renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar fila por: Prazo da etapa' }));
    const sheet = screen.getByRole('dialog', { name: 'Ordenar fila por' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Prazo da etapa/ }));
    expect(props.onOrdemChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar fila por: Prazo da etapa' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Ordenar fila por' })).getByRole('button', {
        name: 'Data de publicação',
      }),
    );
    expect(props.onOrdemChange).toHaveBeenCalledWith('publicacao');
  });

  it('shows no pickers when the page does not pass the change handlers', () => {
    renderView({ onMembroChange: undefined, onOrdemChange: undefined });
    expect(screen.queryByRole('button', { name: /Fila de:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ordenar fila por/ })).not.toBeInTheDocument();
  });

  it('keeps the loading, error, unlinked and empty states', () => {
    const { unmount } = renderView({ isError: true });
    expect(screen.getByText(/Não foi possível carregar a fila/)).toBeInTheDocument();
    unmount();
    const r2 = renderView({ membroId: null });
    expect(screen.getByText(/ainda não está vinculado a um membro/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fila de:.*Escolha um membro/ })).toBeInTheDocument();
    r2.unmount();
    renderView({ fila: buildMinhaFila({ cards: [], posts: [], postEntities: [] }, ME, NOW) });
    expect(screen.getByText(/Nada na sua fila/)).toBeInTheDocument();
  });
});
