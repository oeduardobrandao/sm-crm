import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form } from '@/components/ui/form';
import { InviteSection } from '../InviteSection';
import { membroSchema, MEMBRO_FORM_DEFAULTS, type MembroFormValues } from '../membroForm';
import type { SeatState } from '../inviteSupport';

function Harness({
  seat,
  pendingInvite = null,
  inviteEnabled = false,
}: {
  seat: SeatState;
  pendingInvite?: { email: string; role: string; expires_at: string } | null;
  inviteEnabled?: boolean;
}) {
  const form = useForm<MembroFormValues>({
    resolver: zodResolver(membroSchema),
    defaultValues: { ...MEMBRO_FORM_DEFAULTS, inviteEnabled },
  });
  return (
    <Form {...form}>
      <InviteSection form={form} seat={seat} pendingInvite={pendingInvite} />
    </Form>
  );
}

const OK_SEAT: SeatState = { status: 'ok', used: 3, limit: 5, remaining: 2 };

describe('InviteSection', () => {
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
});
