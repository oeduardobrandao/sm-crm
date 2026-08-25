import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
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
    postCovers: [
      {
        id: 1,
        post_id: 1,
        conta_id: 'c',
        r2_key: 'img/1.png',
        thumbnail_r2_key: null,
        kind: 'image',
        mime_type: 'image/png',
        size_bytes: 1000,
        original_filename: 'lost.png',
        width: 1080,
        height: 1080,
        duration_seconds: null,
        is_cover: true,
        sort_order: 0,
        uploaded_by: null,
        created_at: '2026-01-01T00:00:00Z',
        url: null,
        thumbnail_url: null,
        media_lost_at: '2026-08-14T03:00:00.000Z',
      },
    ],
  } as unknown as BoardCard;
}

describe('WorkflowCard post covers', () => {
  it('shows the unavailable placeholder instead of a broken image for a permanently lost cover', () => {
    const { container } = render(
      <MemoryRouter>
        <WorkflowCard card={makeCard()} />
      </MemoryRouter>,
    );
    // The kanban cover circle is a genuinely tight 32px space, so it renders
    // MediaUnavailable in "compact" mode — icon only, no visible text label
    // (unlike the gallery tile and lightbox, which use "full"). lucide-react
    // renders each icon with a `lucide-<name>` class, which is what this
    // asserts instead of the (absent-by-design) text.
    expect(container.querySelector('.lucide-image-off')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });
});
