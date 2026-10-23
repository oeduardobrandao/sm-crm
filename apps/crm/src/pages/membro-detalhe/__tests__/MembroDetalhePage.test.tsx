import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { VidroToolbarHarness } from '@/test/vidroToolbar';
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';

// Regression test for the FIX 1(b) fetch-gate: getTransacoes returns raw
// financial rows and MembroDetalhePage is not a financial route, so nothing
// else stops the fetch. This asserts the `enabled` option passed to useQuery
// for the ['transacoes'] key directly, at the exact point the bug lived —
// not just the eventual masked render, which was already correct before this
// fix and would not have caught a missing gate.

const {
  paramsState,
  navigateMock,
  queryClientMock,
  queryState,
  queryCalls,
  useAuthMock,
  useWorkspaceLimitsMock,
  toastSuccessMock,
  toastErrorMock,
  viewport,
} = vi.hoisted(() => ({
  // jsdom's matchMedia reports false, so the page renders its phone branch unless a
  // test flips this to the desktop layout.
  viewport: { desktop: false },
  paramsState: { id: '1' },
  navigateMock: vi.fn(),
  queryClientMock: { invalidateQueries: vi.fn() },
  queryState: {} as Record<string, { data?: unknown; isLoading?: boolean }>,
  queryCalls: {} as Record<string, { queryKey: unknown[]; enabled?: boolean }>,
  useAuthMock: vi.fn(),
  useWorkspaceLimitsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

// The phone "…" sheet keys its history entry off the location.
const location = vi.hoisted(() => ({
  pathname: '/equipe/1',
  search: '',
  hash: '',
  state: null,
  key: 'default',
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => paramsState,
  useLocation: () => location,
  // MembroFormDialog links to the acordo when Financeiro v2 is on.
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: { queryKey: unknown[]; enabled?: boolean }) => {
    const key = String(options.queryKey[0]);
    queryCalls[key] = options;
    return queryState[key] ?? { data: undefined, isLoading: false };
  }),
  useQueryClient: () => queryClientMock,
}));

vi.mock('../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: useWorkspaceLimitsMock,
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

vi.mock('../../../store', () => ({
  getMembros: vi.fn(),
  getTransacoes: vi.fn(),
  getWorkspaceRoles: vi.fn(),
  getWorkspaceUsers: vi.fn(),
  formatDate: (value: string) => value,
  getInitials: (nome: string) => nome.slice(0, 2).toUpperCase(),
  updateMembro: vi.fn(),
  setMembroCrmUser: vi.fn(),
}));

vi.mock('../../../services/invite', () => ({
  inviteUser: vi.fn(),
}));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => viewport.desktop }));

// The upload hook needs a QueryClient and the store's RPC; the page only decides
// whether to offer it and for which target.
const { fotoMock, useFotoPessoaMock } = vi.hoisted(() => {
  const fotoMock = {
    uploading: false,
    pick: vi.fn(),
    pickCamera: vi.fn(),
    upload: vi.fn(async () => true),
    remove: vi.fn(async () => {}),
    inputProps: {
      ref: { current: null },
      type: 'file' as const,
      accept: 'image/*',
      disabled: false,
      onChange: vi.fn(),
    },
    cameraInputProps: {
      ref: { current: null },
      type: 'file' as const,
      accept: 'image/*',
      capture: 'user' as const,
      disabled: false,
      onChange: vi.fn(),
    },
  };
  return { fotoMock, useFotoPessoaMock: vi.fn((_alvo: unknown) => fotoMock) };
});
vi.mock('@/hooks/useFotoPessoa', () => ({ useFotoPessoa: useFotoPessoaMock }));

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

// The Financeiro v2 cards have their own tests; here only whether the page mounts them.
vi.mock('../AcordoCard', () => ({ AcordoCard: () => <div data-testid="acordo-card" /> }));
vi.mock('../EntregasManuaisCard', () => ({
  EntregasManuaisCard: () => <div data-testid="entregas-card" />,
}));

import * as store from '../../../store';
import * as inviteService from '../../../services/invite';
import MembroDetalhePage from '../MembroDetalhePage';

const mockedUpdateMembro = vi.mocked(store.updateMembro);
const mockedInviteUser = vi.mocked(inviteService.inviteUser);

const membro = {
  id: 1,
  nome: 'Ana Editora',
  cargo: 'Editora',
  tipo: 'clt' as const,
  custo_mensal: 1000,
  data_pagamento: 5,
  avatar_url: 'https://cdn.exemplo.com/ana.jpg',
  crm_user_id: null,
};

let transacoes: unknown[] = [];
let membrosLoading = false;
let financeiroV2 = false;

function setup(
  canSeeFinancials: boolean | 'unknown',
  can: (module: PermissionModule, action?: PermissionAction) => PermissionCheck = makeCan(
    fakeMembership({ role: 'admin' }),
  ),
  vidroShell?: boolean,
) {
  useAuthMock.mockReturnValue({
    canSeeFinancials,
    can,
    workspaceRole: 'admin',
    profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
  });
  useWorkspaceLimitsMock.mockReturnValue({
    limits: { max_team_members: 10 },
    features: financeiroV2 ? { feature_financial: true, feature_financeiro_v2: true } : undefined,
    isLoading: false,
    isUnlimited: false,
  });
  queryState.membros = membrosLoading
    ? { data: [], isLoading: true }
    : { data: [membro], isLoading: false };
  queryState.transacoes = { data: transacoes, isLoading: false };
  queryState['workspace-users'] = { data: [], isLoading: false };
  queryState.invites = { data: [], isLoading: false };
  render(
    vidroShell === undefined ? (
      <MembroDetalhePage />
    ) : (
      <VidroToolbarHarness vidroShell={vidroShell}>
        <MembroDetalhePage />
      </VidroToolbarHarness>
    ),
  );
}

/** Phone: Editar and the photo actions live in the "…" sheet of the nav bar. */
function openMemberMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Mais ações do membro' }));
  return screen.getByRole('dialog', { name: 'Ana Editora' });
}

async function openEditFromPhone() {
  fireEvent.click(within(openMemberMenu()).getByRole('button', { name: 'Editar' }));
  return screen.findByRole('dialog', { name: /Editar Membro/ });
}

describe('MembroDetalhePage financial query gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    financeiroV2 = false;
    viewport.desktop = false;
    transacoes = [];
  });

  it('disables the transacoes fetch when the caller cannot see financials', () => {
    setup(false);

    expect(queryCalls.transacoes).toBeDefined();
    expect(queryCalls.transacoes.enabled).toBe(false);
  });

  it('enables the transacoes fetch when the caller can see financials', () => {
    setup(true);

    expect(queryCalls.transacoes).toBeDefined();
    expect(queryCalls.transacoes.enabled).toBe(true);
  });

  it('shows a restriction notice instead of an empty transactions table when restricted', () => {
    setup(false);

    expect(screen.getByText(/apenas para quem tem acesso financeiro liberado/i)).toBeTruthy();
    expect(screen.queryByText('Descrição')).toBeNull();
  });

  it('shows the transactions table when the caller can see financials (desktop)', () => {
    viewport.desktop = true;
    setup(true);

    expect(screen.getByText('Descrição')).toBeTruthy();
    expect(screen.queryByText(/apenas para quem tem acesso financeiro liberado/i)).toBeNull();
  });

  it('mounts the acordo cards when Financeiro v2 is on and the caller can see financials', () => {
    viewport.desktop = true;
    financeiroV2 = true;
    setup(true);

    expect(screen.getByTestId('acordo-card')).toBeInTheDocument();
    expect(screen.getByTestId('entregas-card')).toBeInTheDocument();
  });

  it('leaves the page as it was when Financeiro v2 is off', () => {
    viewport.desktop = true;
    setup(true);

    expect(screen.queryByTestId('acordo-card')).toBeNull();
    expect(screen.queryByTestId('entregas-card')).toBeNull();
  });

  it('does not mount the acordo cards without financial access', () => {
    viewport.desktop = true;
    financeiroV2 = true;
    setup(false);

    expect(screen.queryByTestId('acordo-card')).toBeNull();
  });

  it('lists the transactions as grouped rows on phones', () => {
    transacoes = [
      {
        id: 9,
        descricao: 'Ana Editora',
        valor: 1000,
        data: '2026-10-05',
        categoria: 'Salário',
        tipo: 'saida',
        status: 'agendado',
      },
    ];
    setup(true);

    const list = screen.getByRole('list', { name: 'Transações' });
    expect(within(list).getByText('2026-10-05 · Salário')).toBeInTheDocument();
    expect(within(list).getByText('Agendado')).toBeInTheDocument();
    expect(screen.queryByText(/apenas para quem tem acesso financeiro liberado/i)).toBeNull();
  });
});

describe('MembroDetalhePage on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = false;
    transacoes = [];
  });

  it('renders a pushed screen: back to Equipe, the member header and Informações rows', () => {
    setup(true);

    expect(screen.getByRole('button', { name: 'Voltar para Equipe' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ana Editora' })).toBeInTheDocument();
    const info = screen.getByRole('list', { name: 'Informações' });
    expect(within(info).getByText('Dia de pagamento')).toBeInTheDocument();
    expect(within(info).getByText('5')).toBeInTheDocument();
    // No desktop header, no outline "Voltar" button.
    expect(document.querySelector('.header')).toBeNull();
  });

  it('goes back to Equipe when opened directly (no in-app history)', () => {
    setup(true);

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Equipe' }));
    expect(navigateMock).toHaveBeenCalledWith('/equipe', { replace: true });
  });

  it('shows the not-found state with the nav bar', () => {
    setup(true);
    cleanup();
    paramsState.id = '999';
    try {
      render(<MembroDetalhePage />);
      expect(screen.getByText('Membro não encontrado.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Voltar para Equipe' })).toBeInTheDocument();
    } finally {
      paramsState.id = '1';
    }
  });
});

/**
 * Task 14: `isAgent = role === 'agent'` collapsed onto `canEditTeam =
 * can('equipe', 'editar') === true`. `AGENT_ROLE_PRESET.equipe` is 'none' and
 * admin resolves to `true` for every non-financial module, so the two legacy
 * cases below reproduce the OLD isAgent gate byte-for-byte — only a CUSTOM
 * role (role_id set) can diverge from its chassis role.
 */
describe('MembroDetalhePage — Editar button gated on equipe:editar', () => {
  it('hides the Editar button for a legacy agent (equipe preset is none, matches the old isAgent gate)', () => {
    setup(true, makeCan(fakeMembership({ role: 'agent' })));

    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();
  });

  it('shows the Editar button for a legacy admin (equipe preset resolves to true)', () => {
    setup(true, makeCan(fakeMembership({ role: 'admin' })));

    expect(within(openMemberMenu()).getByRole('button', { name: 'Editar' })).toBeTruthy();
  });

  it('hides the Editar button for a custom role with equipe:ver only', () => {
    setup(
      true,
      makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'ver' } })),
    );

    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();
  });

  it('shows the Editar button for a custom role with equipe:editar (the fix)', () => {
    setup(
      true,
      makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'editar' } }),
      ),
    );

    expect(within(openMemberMenu()).getByRole('button', { name: 'Editar' })).toBeTruthy();
  });
});

describe('MembroDetalhePage member editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = false;
  });

  it('lets a workspace admin save the member and invite them to the CRM', async () => {
    mockedUpdateMembro.mockResolvedValueOnce(undefined);
    mockedInviteUser.mockResolvedValueOnce({ success: true, message: 'Convite enviado' });
    setup(true);

    const dialog = await openEditFromPhone();
    expect(within(dialog).getByRole('combobox', { name: 'Conta CRM' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('switch', { name: 'Convidar para o workspace' }));
    fireEvent.change(within(dialog).getByLabelText('Email *'), {
      target: { value: 'ana@exemplo.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar e convidar' }));

    await waitFor(() => {
      expect(mockedUpdateMembro).toHaveBeenCalledTimes(1);
      expect(mockedInviteUser).toHaveBeenCalledWith('ana@exemplo.com', 'agent', 1);
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Convite enviado');
  });

  it('does not clear the existing avatar when saving from the detail page', async () => {
    mockedUpdateMembro.mockResolvedValueOnce(undefined);
    setup(true);

    const dialog = await openEditFromPhone();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdateMembro).toHaveBeenCalledTimes(1));
    const [, payload] = mockedUpdateMembro.mock.calls[0];
    expect(payload).not.toHaveProperty('avatar_url');
  });
});

describe('MembroDetalhePage — member photo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transacoes = [];
  });

  it('shows the editor with equipe:editar', () => {
    viewport.desktop = true;
    setup(true, makeCan(fakeMembership({ role: 'admin' })));

    expect(screen.getByRole('button', { name: 'Alterar foto de Ana Editora' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover foto' })).toBeInTheDocument();
    expect(useFotoPessoaMock).toHaveBeenCalledWith({ kind: 'membro', membroId: 1 });
  });

  it.each([
    ['false', makeCan(fakeMembership({ role: 'agent' }))],
    ['unknown', makeCan(null)],
  ])('hides the editor without equipe:editar (%s)', (_label, can) => {
    viewport.desktop = true;
    setup(true, can);

    expect(screen.queryByRole('button', { name: /foto de Ana Editora/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /foto/i })).toBeNull();
    expect(document.querySelector('img.avatar--photo')).toHaveAttribute(
      'src',
      'https://cdn.exemplo.com/ana.jpg',
    );
  });

  it('offers the photo from the "…" sheet and the avatar on phones with equipe:editar', () => {
    viewport.desktop = false;
    setup(true, makeCan(fakeMembership({ role: 'admin' })));

    expect(useFotoPessoaMock).toHaveBeenCalledWith({ kind: 'membro', membroId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Alterar foto de Ana Editora' }));
    expect(fotoMock.pick).toHaveBeenCalledTimes(1);

    const sheet = openMemberMenu();
    expect(within(sheet).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Tirar foto' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Alterar foto' }));
    expect(fotoMock.pick).toHaveBeenCalledTimes(2);

    fireEvent.click(within(openMemberMenu()).getByRole('button', { name: 'Remover foto' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Remover a foto?' })).getByRole('button', {
        name: 'Remover',
      }),
    );
    expect(fotoMock.remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['false', makeCan(fakeMembership({ role: 'agent' }))],
    ['unknown', makeCan(null)],
  ])('hides the photo actions on phones without equipe:editar (%s)', (_label, can) => {
    viewport.desktop = false;
    setup(true, can);

    expect(screen.queryByRole('button', { name: 'Mais ações do membro' })).toBeNull();
    expect(screen.queryByRole('button', { name: /foto de Ana Editora/ })).toBeNull();
    expect(document.querySelector('img.avatar--photo')).toHaveAttribute(
      'src',
      'https://cdn.exemplo.com/ana.jpg',
    );
  });
});

describe('MembroDetalhePage in the Vidro toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = true;
    transacoes = [];
  });

  it('puts Voltar, the member name and Editar in the toolbar', async () => {
    setup(true, undefined, true);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Ana Editora');
    const toolbar = h1s[0].closest('.vidro-toolbar') as HTMLElement;
    expect(within(toolbar).getAllByRole('button', { name: 'Voltar' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Voltar' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    // The content heading stays.
    expect(screen.getByRole('heading', { level: 2, name: 'Ana Editora' })).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeNull();
  });

  it('keeps the in-page header when the Vidro shell is off', async () => {
    setup(true, undefined, false);

    expect(document.querySelector('.vidro-toolbar')).toBeNull();
    expect(document.querySelector('.header')).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Voltar' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(1);
  });

  it('keeps Voltar in the toolbar, with no heading, while the member loads', () => {
    membrosLoading = true;
    try {
      setup(true, undefined, true);

      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      const toolbar = document.querySelector('.vidro-toolbar') as HTMLElement;
      expect(toolbar).not.toBeNull();
      expect(screen.getAllByRole('button', { name: 'Voltar' })).toHaveLength(1);
      expect(within(toolbar).getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    } finally {
      membrosLoading = false;
    }
  });

  it('registers nothing for a member that does not exist, keeping its own Voltar', async () => {
    paramsState.id = '999';
    try {
      setup(true, undefined, true);

      expect(await screen.findByText('Membro não encontrado.')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Voltar' })).toHaveLength(1);
    } finally {
      paramsState.id = '1';
    }
  });
});
