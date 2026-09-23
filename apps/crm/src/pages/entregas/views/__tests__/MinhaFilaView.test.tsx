import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/supabase');

// Radix Select needs pointer/portal machinery jsdom lacks; render it as a
// native select (same shim as NovaIdeiaDialog.test.tsx).
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="Fila de" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">Escolha um membro</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { MinhaFilaView } from '../MinhaFilaView';
import { buildMinhaFila, EMPTY_FILA } from '../../minhaFila';
import { buildStatusRegistry } from '../../statusRegistry';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { ActivePost, Membro, WorkflowEtapa } from '../../../../store';

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
        // margem"), post 12 publica amanhã (margem 2d).
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
    membros,
    membroId: ME,
    currentMembroId: ME,
    registry,
    isLoading: false,
    isError: false,
    onMembroChange: vi.fn(),
    onPostClick: vi.fn(),
    onFluxoClick: vi.fn(),
    ...over,
  };
  return { ...render(<MinhaFilaView {...props} />), props };
}

describe('MinhaFilaView', () => {
  it('renders the six sections with counts and expands only Atrasado, Hoje and Amanhã', () => {
    renderView();
    const heads = screen.getAllByRole('button', { name: /\(\d+\)$/ });
    expect(heads.map((h) => h.textContent)).toEqual([
      'Atrasado (2)',
      'Hoje (1)',
      'Amanhã (0)',
      'Próximos 7 dias (1)',
      'Depois (0)',
      'Sem prazo (0)',
    ]);
    expect(screen.getByRole('button', { name: 'Atrasado (2)' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Amanhã (0)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Collapsed by default: the row is not in the DOM until the header is clicked.
    expect(screen.queryByText('Stories evento')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próximos 7 dias (1)' }));
    expect(screen.getByText('Stories evento')).toBeInTheDocument();
  });

  it('shows the summary and the "Comece por aqui" card with the first item', () => {
    renderView();
    expect(screen.getByTestId('fila-summary')).toHaveTextContent('4 posts · 2 atrasados');
    const top = screen.getByTestId('fila-top');
    expect(within(top).getByText('Comece por aqui')).toBeInTheDocument();
    expect(within(top).getByText('Carrossel dia das mães')).toBeInTheDocument();
    expect(within(top).getByText('Dra. Marina · Fluxo 1 · Design')).toBeInTheDocument();
    expect(within(top).getByText('sem margem')).toBeInTheDocument();
  });

  it('groups fluxo posts under a clickable header and marks assignee rows', () => {
    const { props } = renderView();
    // The "Comece por aqui" card carries the same context string; the group
    // header is the one that also announces the post count.
    const header = screen.getByRole('button', { name: /Dra\. Marina · Fluxo 1 · Design.*2 posts/ });
    fireEvent.click(header);
    expect(props.onFluxoClick).toHaveBeenCalledWith(1);

    // Avulso row (origem responsavel): assignee tag + second line; fluxo rows: no tag.
    const avulso = screen.getByRole('button', { name: /Post avulso X/ });
    expect(within(avulso).getByText('responsável pelo post')).toBeInTheDocument();
    expect(within(avulso).getByText('Dra. Marina')).toBeInTheDocument();
    const wired = screen.getAllByRole('button', { name: /Reels bastidores/ })[0];
    expect(within(wired).queryByText('responsável pelo post')).not.toBeInTheDocument();
    expect(within(wired).getByText('margem 2d')).toBeInTheDocument();

    fireEvent.click(wired);
    expect(props.onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
  });

  it('groups Chegando by fluxo, collapsed, with the current etapa and the arrival date', () => {
    renderView();
    expect(screen.getByText('Chegando')).toBeInTheDocument();
    const head = screen.getByRole('button', { name: /Fluxo 4 · agora em Design \(Bruno Lima\)/ });
    expect(head).toHaveTextContent('2 posts');
    expect(head).toHaveTextContent(/chega ~/);
    expect(screen.queryByText('Chegando A')).not.toBeInTheDocument();
    fireEvent.click(head);
    expect(screen.getByText('Chegando A')).toBeInTheDocument();
    expect(screen.getByText('Chegando B')).toBeInTheDocument();
  });

  it('changes the member through the picker; picking yourself emits null', () => {
    const { props } = renderView();
    const select = screen.getByLabelText('Fila de');
    fireEvent.change(select, { target: { value: String(OTHER) } });
    expect(props.onMembroChange).toHaveBeenLastCalledWith(OTHER);
    fireEvent.change(select, { target: { value: String(ME) } });
    expect(props.onMembroChange).toHaveBeenLastCalledWith(null);
  });

  it('renders loading, error, no-membro and the two empty states', () => {
    const { unmount: u1, container } = renderView({ isLoading: true, fila: EMPTY_FILA });
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByText(/Nada na sua fila/)).not.toBeInTheDocument();
    u1();

    const { unmount: u2 } = renderView({ isError: true, fila: EMPTY_FILA });
    expect(
      screen.getByText('Não foi possível carregar a fila. Recarregue a página.'),
    ).toBeInTheDocument();
    u2();

    const { unmount: u3 } = renderView({ membroId: null, currentMembroId: null, fila: EMPTY_FILA });
    expect(screen.getByText(/ainda não está vinculado a um membro da equipe/)).toBeInTheDocument();
    expect(screen.getByLabelText('Fila de')).toHaveValue('');
    u3();

    const { unmount: u4 } = renderView({ fila: EMPTY_FILA });
    expect(screen.getByText(/^Nada na sua fila\./)).toBeInTheDocument();
    u4();

    renderView({ fila: EMPTY_FILA, membroId: OTHER });
    expect(screen.getByText('Nada na fila de Bruno Lima.')).toBeInTheDocument();
  });
});
