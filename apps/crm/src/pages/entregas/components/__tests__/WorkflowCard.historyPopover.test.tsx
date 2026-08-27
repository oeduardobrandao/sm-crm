import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
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

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const etapa = {
  id: 1,
  workflow_id: 1,
  ordem: 0,
  nome: 'Design',
  status: 'ativo' as const,
  tipo: 'padrao' as const,
  prazo_dias: 5,
  tipo_prazo: 'corridos' as const,
};

function makeCard(): BoardCard {
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo: 'Campanha',
      status: 'ativo',
      etapa_atual: 0,
      recorrente: false,
    },
    etapa,
    allEtapas: [etapa],
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 5, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 1,
    etapaIdx: 0,
  } as unknown as BoardCard;
}

describe('WorkflowCard history popover trigger', () => {
  it('renders the "Histórico do fluxo" clock trigger in the action row', () => {
    render(
      <MemoryRouter>
        <WorkflowCard card={makeCard()} postsCount={0} />
      </MemoryRouter>,
    );
    expect(screen.getByTitle('Histórico do fluxo')).toBeInTheDocument();
  });
});
