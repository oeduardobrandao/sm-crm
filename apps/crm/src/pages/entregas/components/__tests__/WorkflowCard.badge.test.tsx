import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../store', () => ({
  updateWorkflowEtapa: vi.fn(),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { WorkflowCard } from '../WorkflowCard';
import type { BoardCard } from '../hooks/useEntregasData';

const etapas = [
  {
    id: 1,
    workflow_id: 1,
    ordem: 0,
    nome: 'Aprovação',
    status: 'concluido' as const,
    tipo: 'aprovacao_cliente' as const,
    prazo_dias: 3,
    tipo_prazo: 'corridos' as const,
  },
  {
    id: 2,
    workflow_id: 1,
    ordem: 1,
    nome: 'Design',
    status: 'ativo' as const,
    tipo: 'padrao' as const,
    prazo_dias: 5,
    tipo_prazo: 'corridos' as const,
  },
];

function makeCard(currentEtapaOrdem: number): BoardCard {
  const etapa = etapas.find((e) => e.ordem === currentEtapaOrdem)!;
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo: 'Campanha',
      status: 'ativo',
      etapa_atual: currentEtapaOrdem,
      recorrente: false,
    },
    etapa,
    allEtapas: etapas,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 5, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: etapas.length,
    etapaIdx: currentEtapaOrdem,
  } as unknown as BoardCard;
}

describe('WorkflowCard awaiting-client badge', () => {
  it('shows the awaiting-client badge in an etapa after the approval etapa', () => {
    render(
      <MemoryRouter>
        <WorkflowCard card={makeCard(1)} awaitingClienteCount={2} postsCount={5} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/2 posts com o cliente/i)).toBeInTheDocument();
  });

  it('hides the badge when awaitingClienteCount is 0', () => {
    render(
      <MemoryRouter>
        <WorkflowCard card={makeCard(1)} awaitingClienteCount={0} postsCount={5} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/posts com o cliente/i)).not.toBeInTheDocument();
  });

  it('does not show the post-approval-etapa badge while still in the approval etapa', () => {
    // ordem 0 == approval etapa itself; the count badge must NOT render here
    // (the in-stage "Aguardando aprovação do cliente" branch handles that case).
    render(
      <MemoryRouter>
        <WorkflowCard card={makeCard(0)} awaitingClienteCount={2} postsCount={5} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/2 posts com o cliente/i)).not.toBeInTheDocument();
  });
});

describe('WorkflowCard client-approval badge', () => {
  // makeCard(0) is the aprovacao_cliente etapa, so the approval badge renders.
  it('flips to "Aprovado pelo cliente" when every post has cleared client approval', () => {
    // 1 aprovado_cliente + 2 already scheduled/posted → all 3 have cleared,
    // even though only 1 is literally aprovado_cliente.
    render(
      <MemoryRouter>
        <WorkflowCard
          card={makeCard(0)}
          postsCount={3}
          approvedPostsCount={1}
          clearedClienteCount={3}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Aprovado pelo cliente/i)).toBeInTheDocument();
    expect(screen.queryByText(/Aguardando aprovação do cliente/i)).not.toBeInTheDocument();
  });

  it('stays "Aguardando aprovação do cliente" when some posts are still behind approval', () => {
    render(
      <MemoryRouter>
        <WorkflowCard
          card={makeCard(0)}
          postsCount={3}
          approvedPostsCount={1}
          clearedClienteCount={2}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Aguardando aprovação do cliente/i)).toBeInTheDocument();
    expect(screen.queryByText(/Aprovado pelo cliente/i)).not.toBeInTheDocument();
  });
});

// Re-arm regression: with two approval etapas the card can sit past the FIRST approval
// while a second approval cycle is running. The badge keys off the first approval's
// ordem, so it must keep rendering during the second cycle.
describe('WorkflowCard awaiting-client badge across two approval cycles', () => {
  const twoCycleEtapas = [
    {
      id: 1,
      workflow_id: 1,
      ordem: 0,
      nome: 'Briefing',
      status: 'concluido' as const,
      tipo: 'padrao' as const,
      prazo_dias: 1,
      tipo_prazo: 'corridos' as const,
    },
    {
      id: 2,
      workflow_id: 1,
      ordem: 1,
      nome: 'Aprovação do texto',
      status: 'concluido' as const,
      tipo: 'aprovacao_cliente' as const,
      prazo_dias: 2,
      tipo_prazo: 'corridos' as const,
    },
    {
      id: 3,
      workflow_id: 1,
      ordem: 2,
      nome: 'Design',
      status: 'concluido' as const,
      tipo: 'padrao' as const,
      prazo_dias: 3,
      tipo_prazo: 'corridos' as const,
    },
    {
      id: 4,
      workflow_id: 1,
      ordem: 3,
      nome: 'Aprovação da arte',
      status: 'ativo' as const,
      tipo: 'aprovacao_cliente' as const,
      prazo_dias: 2,
      tipo_prazo: 'corridos' as const,
    },
  ];

  function makeTwoCycleCard(currentEtapaOrdem: number): BoardCard {
    const etapa = twoCycleEtapas.find((e) => e.ordem === currentEtapaOrdem)!;
    return {
      workflow: {
        id: 1,
        cliente_id: 1,
        titulo: 'Campanha',
        status: 'ativo',
        etapa_atual: currentEtapaOrdem,
        recorrente: false,
      },
      etapa,
      allEtapas: twoCycleEtapas,
      cliente: undefined,
      membro: undefined,
      deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
      totalEtapas: twoCycleEtapas.length,
      etapaIdx: currentEtapaOrdem,
    } as unknown as BoardCard;
  }

  it('still shows the awaiting-client badge during the second approval cycle', () => {
    render(
      <MemoryRouter>
        <WorkflowCard card={makeTwoCycleCard(3)} awaitingClienteCount={2} postsCount={5} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/2 posts com o cliente/i)).toBeInTheDocument();
  });

  it('shows no badge before the first approval etapa', () => {
    render(
      <MemoryRouter>
        <WorkflowCard card={makeTwoCycleCard(0)} awaitingClienteCount={2} postsCount={5} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/posts com o cliente/i)).not.toBeInTheDocument();
  });
});

// The guided tour (see the entregas tour module) selects its steps by [data-tour]
// presence at runtime: a missing anchor silently drops that step instead of failing
// loudly. These assertions pin the three card anchors so a refactor that strips one
// breaks a test rather than quietly degrading onboarding.
describe('WorkflowCard tour anchors', () => {
  it('exposes the wf-card, wf-deadline and wf-posts anchors', () => {
    const { container } = render(
      <MemoryRouter>
        <WorkflowCard card={makeCard(1)} postsCount={5} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-tour="wf-card"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tour="wf-deadline"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tour="wf-posts"]')).toBeInTheDocument();
  });

  it('anchors sit on the elements the tour describes', () => {
    const { container } = render(
      <MemoryRouter>
        <WorkflowCard card={makeCard(1)} postsCount={5} />
      </MemoryRouter>,
    );
    // wf-deadline must be the pill showing the remaining time, not some other span.
    expect(container.querySelector('[data-tour="wf-deadline"]')).toHaveTextContent(/5d restantes/i);
    // wf-posts must be the Posts control, and it carries the count badge.
    expect(container.querySelector('[data-tour="wf-posts"]')).toHaveTextContent(/Posts/i);
    // wf-card is the card root, so it contains the other two anchors.
    const root = container.querySelector('[data-tour="wf-card"]')!;
    expect(root.querySelector('[data-tour="wf-deadline"]')).toBeInTheDocument();
    expect(root.querySelector('[data-tour="wf-posts"]')).toBeInTheDocument();
  });

  it('keeps the wf-posts anchor even when the card has no posts', () => {
    // The tour must be able to point at the Posts control on a brand-new workflow,
    // which is exactly the zero-posts case a first-time user sees.
    const { container } = render(
      <MemoryRouter>
        <WorkflowCard card={makeCard(1)} postsCount={0} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-tour="wf-posts"]')).toBeInTheDocument();
  });
});
