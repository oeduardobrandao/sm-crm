import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../store', () => ({
  updateWorkflowEtapa: vi.fn(),
  getWorkflowEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { WorkflowCard } from '../WorkflowCard';
import type { BoardCard } from '../hooks/useEntregasData';
import type { Membro } from '../../../../store';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

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

const ana: Membro = {
  id: 7,
  nome: 'Ana Lima',
  cargo: '',
  tipo: 'clt',
  custo_mensal: null,
  avatar_url: 'https://x.test/a.jpg',
};
const bruno: Membro = { ...ana, id: 8, nome: 'Bruno Souza', avatar_url: null };

function cardWith(membro: Membro): BoardCard {
  return { ...makeCard(1), membro } as BoardCard;
}

describe('WorkflowCard assignee avatar', () => {
  it('WorkflowCard shows the assignee photo', () => {
    const { container } = render(
      <MemoryRouter>
        <WorkflowCard card={cardWith(ana)} membros={[ana, bruno]} />
      </MemoryRouter>,
    );
    const photos = container.querySelectorAll<HTMLImageElement>('img.avatar--photo');
    // The card's assignee chip plus Ana's row in the reassign menu.
    expect(photos).toHaveLength(2);
    expect(photos[0]).toHaveAttribute('src', 'https://x.test/a.jpg');
    expect(photos[0].style.width).toBe('20px');
    expect(photos[1].style.width).toBe('16px');
  });

  it('WorkflowCard shows initials without a photo', () => {
    const { container } = render(
      <MemoryRouter>
        <WorkflowCard card={cardWith(bruno)} />
      </MemoryRouter>,
    );
    expect(container.querySelector('img.avatar--photo')).toBeNull();
    const avatar = container.querySelector<HTMLElement>('.avatar')!;
    expect(avatar).toHaveTextContent('BS');
    expect(avatar.style.width).toBe('20px');
  });
});
