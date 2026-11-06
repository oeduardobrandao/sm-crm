import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EquipeDetalhesSheet } from '../EquipeDetalhesSheet';
import type { EquipeConversa } from '@/store';

const { mockGetMembers, mockGetParticipantes, mockManage, toastError } = vi.hoisted(() => ({
  mockGetMembers: vi.fn(),
  mockGetParticipantes: vi.fn(),
  mockManage: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/store', () => ({
  getEquipeChatMembers: mockGetMembers,
  getEquipeConversaParticipantes: mockGetParticipantes,
  manageEquipeConversa: mockManage,
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
}));

// `role` is included alongside `workspaceRole` in every fixture below purely
// to prove the component ignores it — it comes from `profiles` and goes
// stale on workspace switch (see AuthContext.tsx), so the management gate
// must read `workspaceRole` (workspace_members for the ACTIVE workspace)
// instead, mirroring nav-data.ts's Financeiro/Contratos gate.
let mockAuth: {
  user: { id: string };
  role: 'owner' | 'admin' | 'agent';
  workspaceRole: 'owner' | 'admin' | 'agent' | null;
} = {
  user: { id: 'user-1' },
  role: 'admin',
  workspaceRole: 'admin',
};
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const MEMBERS = [
  { user_id: 'user-1', nome: 'Eu Mesmo', avatar_url: null, role: 'admin' },
  { user_id: 'user-2', nome: 'Ana Silva', avatar_url: null, role: 'owner' },
  { user_id: 'user-3', nome: 'Bruno Costa', avatar_url: null, role: 'agent' },
];

const GRUPO: EquipeConversa = {
  conversa_id: 42,
  tipo: 'grupo',
  nome: 'Time de Design',
  display_nome: 'Time de Design',
  avatar_url: null,
  participantes_count: 2,
  last_author_name: null,
  last_content: null,
  last_has_anexo: false,
  last_created_at: null,
  last_message_id: null,
  unread_count: 0,
};

const DM: EquipeConversa = {
  conversa_id: 7,
  tipo: 'dm',
  nome: null,
  display_nome: 'Ana Silva',
  avatar_url: null,
  participantes_count: 2,
  last_author_name: null,
  last_content: null,
  last_has_anexo: false,
  last_created_at: null,
  last_message_id: null,
  unread_count: 0,
};

function renderSheet(conversa: EquipeConversa) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onLeft = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <EquipeDetalhesSheet conversa={conversa} onClose={onClose} onLeft={onLeft} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onLeft, qc };
}

beforeEach(() => {
  mockAuth = { user: { id: 'user-1' }, role: 'admin', workspaceRole: 'admin' };
  mockGetMembers.mockResolvedValue(MEMBERS);
  mockGetParticipantes.mockResolvedValue(['user-1', 'user-2']);
  mockManage.mockResolvedValue(undefined);
});

describe('EquipeDetalhesSheet', () => {
  it('lista participantes cruzando getEquipeConversaParticipantes + getEquipeChatMembers, com papel', async () => {
    renderSheet(GRUPO);
    expect(await screen.findByText('Eu Mesmo')).toBeInTheDocument();
    expect(screen.getByText('Ana Silva')).toBeInTheDocument();
    // Bruno (user-3) is not a participant, so he must not have a row — he's
    // still legitimately findable as an <option> in the "adicionar
    // participante" select below, so assert on the row testid, not text.
    expect(screen.queryByTestId('participante-user-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('participante-user-2')).toHaveTextContent('Dono');
  });

  it('admin: renomear chama manageEquipeConversa(id, rename, {nome})', async () => {
    renderSheet(GRUPO);
    await screen.findByText('Ana Silva');

    fireEvent.click(screen.getByRole('button', { name: /Renomear/i }));
    fireEvent.change(screen.getByLabelText('Nome do grupo'), {
      target: { value: 'Novo Nome' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(mockManage).toHaveBeenCalledWith(42, 'rename', { nome: 'Novo Nome' }),
    );
  });

  it('admin: remover participante chama manageEquipeConversa(id, remove, {userId})', async () => {
    renderSheet(GRUPO);
    await screen.findByText('Ana Silva');

    fireEvent.click(screen.getByRole('button', { name: 'Remover Ana Silva' }));

    await waitFor(() =>
      expect(mockManage).toHaveBeenCalledWith(42, 'remove', { userId: 'user-2' }),
    );
  });

  it('admin: adicionar participante chama manageEquipeConversa(id, add, {userId})', async () => {
    renderSheet(GRUPO);
    await screen.findByText('Ana Silva');

    fireEvent.change(screen.getByLabelText('Adicionar participante'), {
      target: { value: 'user-3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockManage).toHaveBeenCalledWith(42, 'add', { userId: 'user-3' }));
  });

  it('workspaceRole agent: so ve o botao Sair do grupo (sem renomear/adicionar/remover)', async () => {
    mockAuth = { user: { id: 'user-1' }, role: 'agent', workspaceRole: 'agent' };
    renderSheet(GRUPO);
    await screen.findByText('Ana Silva');

    expect(screen.queryByRole('button', { name: /Renomear/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adicionar participante')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover Ana Silva' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sair do grupo/i })).toBeInTheDocument();
  });

  it('role desatualizado (admin) com workspaceRole agent NAO mostra gestao (regressao de stale role)', async () => {
    // Mesmo cenario da NovaConversaDialog: profiles.role nunca e reescrito
    // por switchWorkspace, entao `role` pode ficar "admin" enquanto
    // `workspaceRole` (workspace_members do workspace ATIVO) diz "agent" --
    // so o segundo deve valer para o gate de gestao.
    mockAuth = { user: { id: 'user-1' }, role: 'admin', workspaceRole: 'agent' };
    renderSheet(GRUPO);
    await screen.findByText('Ana Silva');

    expect(screen.queryByRole('button', { name: /Renomear/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adicionar participante')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover Ana Silva' })).not.toBeInTheDocument();
  });

  it('sair do grupo chama manageEquipeConversa(id, leave) e depois onLeft()', async () => {
    const { onLeft } = renderSheet(GRUPO);
    await screen.findByText('Ana Silva');

    fireEvent.click(screen.getByRole('button', { name: /Sair do grupo/i }));

    await waitFor(() => expect(mockManage).toHaveBeenCalledWith(42, 'leave'));
    await waitFor(() => expect(onLeft).toHaveBeenCalled());
  });

  it('dm: nao renderiza controles de gestao, so o colega', async () => {
    mockGetParticipantes.mockResolvedValue(['user-1', 'user-2']);
    renderSheet(DM);

    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(screen.queryByText('Eu Mesmo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Renomear/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adicionar participante')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover Ana Silva' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sair do grupo/i })).not.toBeInTheDocument();
  });
});
