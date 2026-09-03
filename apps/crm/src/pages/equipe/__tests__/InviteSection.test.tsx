import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form } from '@/components/ui/form';
import { InviteSection } from '../InviteSection';
import { membroSchema, MEMBRO_FORM_DEFAULTS, type MembroFormValues } from '../membroForm';
import type { SeatState } from '../inviteSupport';

// The seat meter's showUpgradeCta gates the "Fazer upgrade" Link on
// useIsWorkspaceOwner. Mocked false so no CTA (and no react-router Link,
// which would otherwise need a Router context) disturbs the copy assertions.
vi.mock('@/hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: () => false }));

const { getWorkspaceRolesMock } = vi.hoisted(() => ({
  getWorkspaceRolesMock: vi.fn(async () => [] as { id: string; nome: string }[]),
}));
vi.mock('@/store', () => ({ getWorkspaceRoles: getWorkspaceRolesMock }));

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't
// implement — mocked the same way PapeisTab.test.tsx does, so the custom-papel
// SelectItems render as plain clickable buttons instead of fighting jsdom's
// missing portal/pointer-capture behaviour.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }
  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }
  function SelectTrigger({ children }: { children: React.ReactNode }) {
    return <button type="button">{children}</button>;
  }
  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value || placeholder || ''}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

function Harness({
  seat,
  pendingInvite = null,
  inviteEnabled = false,
  canManageWorkspace = true,
  canAssignRoles = true,
}: {
  seat: SeatState;
  pendingInvite?: { email: string; role: string; expires_at: string } | null;
  inviteEnabled?: boolean;
  canManageWorkspace?: boolean;
  /** Chassis check (owner/admin), distinct from canManageWorkspace. */
  canAssignRoles?: boolean;
}) {
  const form = useForm<MembroFormValues>({
    resolver: zodResolver(membroSchema),
    defaultValues: { ...MEMBRO_FORM_DEFAULTS, inviteEnabled },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Form {...form}>
        <InviteSection
          form={form}
          seat={seat}
          pendingInvite={pendingInvite}
          canManageWorkspace={canManageWorkspace}
          canAssignRoles={canAssignRoles}
        />
      </Form>
    </QueryClientProvider>
  );
}

const OK_SEAT: SeatState = { status: 'ok', used: 3, limit: 5, remaining: 2 };

describe('InviteSection', () => {
  beforeEach(() => {
    getWorkspaceRolesMock.mockClear();
    getWorkspaceRolesMock.mockResolvedValue([]);
  });

  it('shows the switch and the seat meter when seats are available', () => {
    render(<Harness seat={OK_SEAT} />);
    expect(screen.getByText('Convidar para o workspace')).toBeInTheDocument();
    expect(screen.getByText('3 de 5 vagas do plano usadas')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeEnabled();
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();
  });

  it('reveals email and role fields when the switch is on', () => {
    render(<Harness seat={OK_SEAT} inviteEnabled />);
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
    expect(screen.getByText('Função no workspace')).toBeInTheDocument();
    expect(screen.getByText(/ocupará 1 vaga/)).toBeInTheDocument();
  });

  it('previews post-invite seat usage when the switch is on', () => {
    render(<Harness seat={OK_SEAT} inviteEnabled />);
    expect(screen.getByText('4 de 5 vagas após este convite')).toBeInTheDocument();
    expect(screen.getByText('1 restante')).toBeInTheDocument();
  });

  it('disables the switch and shows upgrade copy when full', () => {
    render(<Harness seat={{ status: 'full', used: 5, limit: 5, remaining: 0 }} />);
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText(/Todas as vagas do plano estão em uso/)).toBeInTheDocument();
  });

  it('disables the switch while limits load and when they are unavailable', () => {
    const { rerender } = render(
      <Harness seat={{ status: 'loading', used: 0, limit: null, remaining: null }} />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText('Carregando vagas do plano...')).toBeInTheDocument();
    rerender(<Harness seat={{ status: 'unavailable', used: 0, limit: null, remaining: null }} />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('hides the meter on unlimited plans but keeps the switch enabled', () => {
    render(<Harness seat={{ status: 'unlimited', used: 3, limit: null, remaining: null }} />);
    expect(screen.getByRole('switch')).toBeEnabled();
    expect(screen.queryByText(/vagas do plano usadas/)).not.toBeInTheDocument();
  });

  it('collapses into the pending notice when the membro already has a pending invite', () => {
    render(
      <Harness
        seat={OK_SEAT}
        pendingInvite={{ email: 'ju@x.com', role: 'agent', expires_at: '2099-01-01T00:00:00Z' }}
      />,
    );
    expect(screen.getByText(/Convite pendente para/)).toBeInTheDocument();
    expect(screen.getByText(/ju@x.com/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('lists custom papéis alongside Admin/Agente once getWorkspaceRoles resolves', async () => {
    getWorkspaceRolesMock.mockResolvedValue([
      { id: 'role-1', nome: 'Editor de Conteúdo' },
      { id: 'role-2', nome: 'Financeiro Only' },
    ]);
    render(<Harness seat={OK_SEAT} inviteEnabled canManageWorkspace />);

    expect(await screen.findByRole('button', { name: 'Editor de Conteúdo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Financeiro Only' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agente' })).toBeInTheDocument();
  });

  it('does not fetch workspace roles when canManageWorkspace is false', async () => {
    render(<Harness seat={OK_SEAT} inviteEnabled canManageWorkspace={false} />);

    // Give the query a tick to run if it were (incorrectly) enabled.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getWorkspaceRolesMock).not.toHaveBeenCalled();
    // Admin/Agente stay available -- only the CUSTOM papel fetch is gated.
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agente' })).toBeInTheDocument();
  });

  it('selecting a custom papel sets the encoded custom:<uuid> form value', async () => {
    getWorkspaceRolesMock.mockResolvedValue([{ id: 'role-9', nome: 'Editor' }]);
    render(<Harness seat={OK_SEAT} inviteEnabled canManageWorkspace />);

    const option = await screen.findByRole('button', { name: 'Editor' });
    fireEvent.click(option);

    await waitFor(() => {
      expect(screen.getByText('custom:role-9')).toBeInTheDocument();
    });
  });
});

/**
 * Revisão externa (P2), same finding as MembrosTab's invite dialog. This
 * section's own gate (`canManageWorkspace` = `equipe:editar`) is NOT the check
 * that decides which roles may be handed out: `invite-user/index.ts` requires
 * the caller's CHASSIS role to be owner/admin before it accepts role='admin'
 * or any role_id. A custom `equipe:editar` actor was offered both and only
 * found out on submit.
 */
describe('InviteSection — role options follow the chassis rule', () => {
  beforeEach(() => {
    getWorkspaceRolesMock.mockClear();
    getWorkspaceRolesMock.mockResolvedValue([
      { id: 'role-1', nome: 'Editor de Conteúdo' },
      { id: 'role-2', nome: 'Financeiro Only' },
    ]);
  });

  it('a non-privileged equipe:editar actor sees ONLY Agente', async () => {
    render(<Harness seat={OK_SEAT} inviteEnabled canAssignRoles={false} />);

    // Wait for the papéis query to settle, so a missing custom option is a
    // real assertion rather than a race against the fetch.
    await waitFor(() => expect(getWorkspaceRolesMock).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'Agente' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editor de Conteúdo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Financeiro Only' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Apenas donos e admins convidam com função elevada ou papel.'),
    ).toBeInTheDocument();
  });

  it('a privileged actor sees Admin, Agente and every custom papel', async () => {
    render(<Harness seat={OK_SEAT} inviteEnabled canAssignRoles />);

    expect(await screen.findByRole('button', { name: 'Editor de Conteúdo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Financeiro Only' })).toBeInTheDocument();
    expect(
      screen.queryByText('Apenas donos e admins convidam com função elevada ou papel.'),
    ).not.toBeInTheDocument();
  });

  it('the default form value stays agent, so a non-privileged actor submits a valid shape', async () => {
    render(<Harness seat={OK_SEAT} inviteEnabled canAssignRoles={false} />);
    await waitFor(() => expect(getWorkspaceRolesMock).toHaveBeenCalled());
    // MEMBRO_FORM_DEFAULTS.inviteRole is the value the Select renders; with no
    // elevated option available it can never become 'admin' or 'custom:*'.
    expect(MEMBRO_FORM_DEFAULTS.inviteRole).toBe('agent');
  });
});
