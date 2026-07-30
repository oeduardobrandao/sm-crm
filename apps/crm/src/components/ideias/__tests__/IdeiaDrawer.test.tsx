import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ideiaMedia', () => ({
  listIdeiaImages: vi.fn().mockResolvedValue([]),
  uploadIdeiaImage: vi.fn(),
  removeIdeiaImage: vi.fn(),
}));
vi.mock('@/store', () => ({
  updateIdeiaStatus: vi.fn(),
  upsertIdeiaComentario: vi.fn(),
  toggleIdeiaReaction: vi.fn(),
  getMembros: vi.fn().mockResolvedValue([]),
  getClientes: vi.fn().mockResolvedValue([]),
  getTarefaTags: vi.fn().mockResolvedValue([]),
  setTarefaTags: vi.fn(),
  convertSolicitacaoEmTarefa: vi.fn(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1' } }) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IdeiaDrawer } from '../IdeiaDrawer';

function renderDrawer(ideia: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IdeiaDrawer ideia={ideia as never} queryKey={['x']} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BASE = {
  id: 'i1',
  workspace_id: 'w1',
  cliente_id: 7,
  titulo: 'Trocar arte',
  descricao: 'desc',
  links: [],
  comentario_agencia: null,
  comentario_autor_id: null,
  comentario_at: null,
  created_at: '2026-07-30T12:00:00Z',
  updated_at: '2026-07-30T12:00:00Z',
  clientes: { nome: 'Cliente Sete' },
  comentario_autor: null,
  ideia_reactions: [],
  image_count: 0,
};

describe('IdeiaDrawer conversion UI', () => {
  it('shows the convert button for an eligible solicitacao', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'nova', tarefa_id: null });
    expect(screen.getByRole('button', { name: /converter em tarefa/i })).toBeInTheDocument();
  });

  it('hides the convert button for tipo=ideia', () => {
    renderDrawer({ ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null });
    expect(screen.queryByRole('button', { name: /converter em tarefa/i })).not.toBeInTheDocument();
  });

  it('locks manual status and links to the task once converted', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'convertida', tarefa_id: 42 });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /ver tarefa/i });
    expect(link).toHaveAttribute('href', '/tarefas?tarefa=42');
  });

  it('reopens manual status for an orphaned converted solicitacao', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'convertida', tarefa_id: null });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
