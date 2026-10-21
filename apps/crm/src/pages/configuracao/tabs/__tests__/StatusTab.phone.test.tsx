import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const viewport = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => viewport.desktop }));

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    getPostStatusDefinitions: vi.fn(async () => [] as unknown[]),
    createPostStatusDefinition: vi.fn(async () => ({})),
    updatePostStatusDefinition: vi.fn(async () => ({})),
    archivePostStatusDefinition: vi.fn(async () => {}),
    getPostStatusAutomations: vi.fn(async () => [] as unknown[]),
    createPostStatusAutomation: vi.fn(async () => ({})),
    updatePostStatusAutomation: vi.fn(async () => ({})),
    deletePostStatusAutomation: vi.fn(async () => {}),
    getMembros: vi.fn(async () => [] as unknown[]),
  },
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'me', conta_id: 'ws-1' } }),
}));
vi.mock('../../../../store', () => storeMock);
vi.mock('../../../../lib/entitlement-toast', () => ({
  handleEntitlementMutationError: vi.fn(() => false),
}));
// Plan gating has its own suite; here the feature is on.
vi.mock('@/components/paywall/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import { toast } from 'sonner';
import StatusTab from '../StatusTab';

const DEFS = [
  {
    id: 'd1',
    conta_id: 'ws-1',
    nome: 'Em design',
    cor: '#7c5cff',
    icone: 'pencil-line',
    behaves_as: 'rascunho',
    ordem: 0,
  },
  {
    id: 'd2',
    conta_id: 'ws-1',
    nome: 'Revisão do diretor',
    cor: '#0ea5b7',
    icone: null,
    behaves_as: 'revisao_interna',
    ordem: 1,
  },
];

const AUTOMATIONS = [
  {
    id: 'a1',
    conta_id: 'ws-1',
    trigger_status: 'correcao_cliente',
    trigger_custom_status_id: null,
    action_type: 'notify',
    config: { target: 'responsavel' },
    ativo: true,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'a2',
    conta_id: 'ws-1',
    trigger_status: null,
    trigger_custom_status_id: 'd2',
    action_type: 'assign_responsavel',
    config: { membro_id: 7 },
    ativo: false,
    created_at: '',
    updated_at: '',
  },
];

const MEMBROS = [
  { id: 7, nome: 'Bruno Ramos' },
  { id: 8, nome: 'Carla Lima' },
];

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StatusTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  viewport.desktop = false;
  storeMock.getPostStatusDefinitions.mockResolvedValue(DEFS);
  storeMock.getPostStatusAutomations.mockResolvedValue(AUTOMATIONS);
  storeMock.getMembros.mockResolvedValue(MEMBROS);
});

describe('StatusTab (phone): lists', () => {
  it('renders the title, the statuses with "Se comporta como" and the automations', async () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Status de posts');
    expect(screen.getByRole('button', { name: 'Novo status' })).toBeInTheDocument();

    const design = await screen.findByRole('button', { name: /^Em design/ });
    expect(design).toHaveTextContent('Se comporta como: Rascunho');
    expect(screen.getByRole('button', { name: /^Revisão do diretor/ })).toHaveTextContent(
      'Se comporta como: Em revisão',
    );
    expect(screen.getByRole('button', { name: 'Mais ações de Em design' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'O nome aparece só para a equipe. Toque e segure para mover para cima ou para baixo. Deslize para arquivar.',
      ),
    ).toBeInTheDocument();

    expect(
      await screen.findByRole('switch', { name: 'Automação: Correção solicitada' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Notificar o responsável do post')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Atribuir a Bruno Ramos · Inativa')).toBeInTheDocument(),
    );
    expect(screen.getByRole('switch', { name: 'Automação: · Revisão do diretor' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByText('Deslize uma automação para remover.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nova automação' })).toBeInTheDocument();
    // No hover-only tooltips left on the phone rows.
    expect(document.querySelector('[title]')).toBeNull();
  });

  it('shows the empty states', async () => {
    storeMock.getPostStatusDefinitions.mockResolvedValue([]);
    storeMock.getPostStatusAutomations.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('Nenhum status personalizado ainda.')).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma automação ainda.')).toBeInTheDocument();
  });
});

describe('StatusTab (phone): status rows', () => {
  it('tapping a status picks "Se comporta como" through the same update', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /^Em design/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Se comporta como' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aprovado internamente' }));

    await waitFor(() =>
      expect(storeMock.updatePostStatusDefinition).toHaveBeenCalledWith('d1', {
        behaves_as: 'aprovado_interno',
      }),
    );
  });

  it('the menu moves a status down with the desktop swap and disables "Mover para cima" on the first', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Mais ações de Em design' }));
    const menu = await screen.findByRole('menu', { name: 'Ações de Em design' });
    expect(within(menu).getByRole('menuitem', { name: 'Mover para cima' })).toBeDisabled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mover para baixo' }));

    await waitFor(() => expect(storeMock.updatePostStatusDefinition).toHaveBeenCalledTimes(2));
    expect(storeMock.updatePostStatusDefinition).toHaveBeenNthCalledWith(1, 'd1', { ordem: 1 });
    expect(storeMock.updatePostStatusDefinition).toHaveBeenNthCalledWith(2, 'd2', { ordem: 0 });
  });

  it('"Mover para baixo" is disabled on the last status', async () => {
    renderTab();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mais ações de Revisão do diretor' }),
    );
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Mover para baixo' })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'Mover para cima' })).toBeEnabled();
  });

  it('swipe "Arquivar" confirms with the desktop copy, then archives', async () => {
    renderTab();
    await screen.findByRole('button', { name: /^Em design/ });
    fireEvent.click(screen.getAllByRole('button', { name: 'Arquivar' })[0]);

    const sheet = await screen.findByRole('dialog', { name: 'Arquivar "Em design"?' });
    expect(sheet).toHaveTextContent(
      'Os posts que estão nesse status voltarão ao status padrão correspondente (Rascunho). O histórico dos posts mantém o nome antigo.',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Arquivar' }));
    await waitFor(() => expect(storeMock.archivePostStatusDefinition).toHaveBeenCalled());
    expect(storeMock.archivePostStatusDefinition.mock.calls[0][0]).toBe('d1');
  });

  it('"Arquivar" in the menu opens the same confirm', async () => {
    renderTab();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mais ações de Revisão do diretor' }),
    );
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Arquivar' }));
    const sheet = await screen.findByRole('dialog', { name: 'Arquivar "Revisão do diretor"?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Arquivar' }));
    await waitFor(() => expect(storeMock.archivePostStatusDefinition).toHaveBeenCalled());
    expect(storeMock.archivePostStatusDefinition.mock.calls[0][0]).toBe('d2');
  });

  it('cancelling the archive sends nothing', async () => {
    renderTab();
    await screen.findByRole('button', { name: /^Em design/ });
    fireEvent.click(screen.getAllByRole('button', { name: 'Arquivar' })[0]);
    const sheet = await screen.findByRole('dialog', { name: /Arquivar/ });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(storeMock.archivePostStatusDefinition).not.toHaveBeenCalled();
  });
});

describe('StatusTab (phone): automations', () => {
  it('the switch toggles through the same update', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('switch', { name: 'Automação: Correção solicitada' }));
    await waitFor(() =>
      expect(storeMock.updatePostStatusAutomation).toHaveBeenCalledWith('a1', { ativo: false }),
    );
  });

  it('swipe "Remover" asks first, then deletes', async () => {
    renderTab();
    await screen.findByRole('switch', { name: 'Automação: Correção solicitada' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remover' })[0]);

    const sheet = await screen.findByRole('dialog', { name: 'Remover automação?' });
    expect(sheet).toHaveTextContent('Quando entrar em Correção solicitada');
    expect(storeMock.deletePostStatusAutomation).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(storeMock.deletePostStatusAutomation).toHaveBeenCalled());
    expect(storeMock.deletePostStatusAutomation.mock.calls[0][0]).toBe('a1');
  });

  it('"Nova automação" opens the create sheet; a member is required to assign, then it creates', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova automação' }));
    const sheet = await screen.findByRole('dialog', { name: 'Nova automação' });
    expect(within(sheet).getByRole('button', { name: /Quando entrar em/ })).toHaveTextContent(
      'Correção solicitada',
    );

    fireEvent.click(within(sheet).getByRole('button', { name: /^Ação/ }));
    const actionSheet = await screen.findByRole('dialog', { name: 'Ação' });
    fireEvent.click(within(actionSheet).getByRole('button', { name: 'Atribuir responsável' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ação' })).toBeNull());

    fireEvent.click(within(sheet).getByRole('button', { name: /Nova automação/ }));
    expect(toast.error).toHaveBeenCalledWith('Escolha um membro');
    expect(storeMock.createPostStatusAutomation).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole('button', { name: /^Membro/ }));
    const memberSheet = await screen.findByRole('dialog', { name: 'Membro' });
    fireEvent.click(within(memberSheet).getByRole('button', { name: 'Bruno Ramos' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Membro' })).toBeNull());

    fireEvent.click(within(sheet).getByRole('button', { name: /Nova automação/ }));
    await waitFor(() => expect(storeMock.createPostStatusAutomation).toHaveBeenCalled());
    expect(storeMock.createPostStatusAutomation.mock.calls[0][0]).toEqual({
      trigger_status: 'correcao_cliente',
      trigger_custom_status_id: null,
      action_type: 'assign_responsavel',
      config: { membro_id: 7 },
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nova automação' })).not.toBeInTheDocument(),
    );
  });
});

describe('StatusTab (phone): new status sheet', () => {
  it('"+" opens the sheet; name, icon and colour go through the same create', async () => {
    renderTab();
    await screen.findByRole('button', { name: /^Em design/ });
    fireEvent.click(screen.getByRole('button', { name: 'Novo status' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo status' });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Novo status' }));
    expect(toast.error).toHaveBeenCalledWith('Dê um nome ao status');
    expect(storeMock.createPostStatusDefinition).not.toHaveBeenCalled();

    fireEvent.change(within(sheet).getByLabelText('Nome'), { target: { value: ' Em gravação ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'camera' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cor #22c55e' }));
    expect(within(sheet).getByRole('button', { name: 'camera' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Novo status' }));

    await waitFor(() => expect(storeMock.createPostStatusDefinition).toHaveBeenCalled());
    expect(storeMock.createPostStatusDefinition.mock.calls[0][0]).toEqual({
      nome: 'Em gravação',
      cor: '#22c55e',
      icone: 'camera',
      behaves_as: 'revisao_interna',
      ordem: 2,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Novo status' })).not.toBeInTheDocument(),
    );
  });
});

describe('StatusTab (desktop smoke)', () => {
  it('keeps the desktop rows and their buttons', async () => {
    viewport.desktop = true;
    renderTab();
    expect(await screen.findByText('Em design')).toBeInTheDocument();
    expect(screen.getAllByTitle('Subir')).toHaveLength(2);
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /Novo status/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
