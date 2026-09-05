import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspaceInvitesCard from '../WorkspaceInvitesCard';
import type { InviteInfo } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getWorkspaceInvites: vi.fn(),
  adminCancelInvite: vi.fn(),
  adminResendInvite: vi.fn(),
  adminCreateInvite: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import {
  getWorkspaceInvites,
  adminCancelInvite,
  adminResendInvite,
  adminCreateInvite,
} from '../../lib/api';
import { toast } from 'sonner';

const inv = (o: Partial<InviteInfo>): InviteInfo => ({
  id: 'i1',
  email: 'a@x.com',
  role: 'agent',
  status: 'pending',
  created_at: '2026-07-23T00:00:00Z',
  accepted_at: null,
  expires_at: null,
  invited_by: 'o1',
  silent_add: false,
  link_expired: false,
  auth_state: null,
  ...o,
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceInvitesCard workspaceId="c1" />
    </QueryClientProvider>,
  );
}

describe('WorkspaceInvitesCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a silent-add invite with its diagnostic tag and no action buttons', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [inv({ status: 'accepted', silent_add: true, accepted_at: '2026-07-23T00:00:00Z' })],
      total: 1,
    });
    renderCard();
    expect(await screen.findByText(/added silently/i)).toBeTruthy();
    // accepted rows expose no Cancel/Resend
    expect(screen.queryByRole('button', { name: /resend/i })).toBeNull();
  });

  it('shows a desktop header (incl. Sent) and Resend + Cancel for a pending invite', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [inv({ status: 'pending' })],
      total: 1,
    });
    renderCard();
    expect(await screen.findByText('Enviado')).toBeTruthy(); // header column (finding 8)
    expect(screen.getByRole('button', { name: /resend/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('renders the auth-state chip for an onboarded non-member', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [
        inv({
          auth_state: {
            user_id: 'u1',
            email_confirmed: true,
            confirmation_sent_at: '2026-07-23T00:00:00Z',
            invited_at: null,
            last_sign_in_at: null,
            has_password: true,
            onboarding_complete: true,
            is_member: false,
          },
        }),
      ],
      total: 1,
    });
    renderCard();
    expect(await screen.findByText('onboarded')).toBeTruthy();
  });

  it('notes truncation when total exceeds the shown rows', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [inv({})], total: 73 });
    renderCard();
    expect(await screen.findByText(/showing 1 of 73/i)).toBeTruthy();
  });

  it('resend calls the API and refetches on success', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [inv({ status: 'pending' })],
      total: 1,
    });
    (adminResendInvite as any).mockResolvedValue({
      success: true,
      route: 'invited',
      message: 'Invitation email sent.',
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /resend/i }));
    await waitFor(() => expect(adminResendInvite).toHaveBeenCalledWith('c1', 'i1', false));
    // refetch: getWorkspaceInvites called again after the mutation
    await waitFor(() => expect((getWorkspaceInvites as any).mock.calls.length).toBeGreaterThan(1));
  });

  it('cancel prompts the ALL-workspaces warning and only proceeds on confirm', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [inv({ status: 'pending' })],
      total: 1,
    });
    (adminCancelInvite as any).mockResolvedValue({ success: true, deleted_user: false });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/ALL workspaces/));
    expect(adminCancelInvite).not.toHaveBeenCalled(); // declined
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(adminCancelInvite).toHaveBeenCalledWith('c1', 'i1'));
    confirmSpy.mockRestore();
  });

  it('shows a retry control when the fetch fails', async () => {
    (getWorkspaceInvites as any).mockRejectedValue(new Error('boom'));
    renderCard();
    expect(await screen.findByText(/failed to load invites/i)).toBeTruthy();
  });

  it('disables Resend and Cancel while a resend is in flight', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [inv({ status: 'pending' })],
      total: 1,
    });
    let resolveResend: (v: { success: boolean; route: string; message: string }) => void;
    (adminResendInvite as any).mockReturnValue(
      new Promise((resolve) => {
        resolveResend = resolve;
      }),
    );
    renderCard();
    const resendButton = await screen.findByRole('button', { name: /resend/i });
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(resendButton).not.toBeDisabled();
    expect(cancelButton).not.toBeDisabled();

    fireEvent.click(resendButton);
    await waitFor(() => expect(resendButton).toBeDisabled());
    expect(cancelButton).toBeDisabled();

    resolveResend!({ success: true, route: 'invited', message: 'Invitation email sent.' });
    await waitFor(() => expect(resendButton).not.toBeDisabled());
  });

  it('reveals the create form only after clicking + Invite', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    expect(await screen.findByText(/nenhum convite/i)).toBeTruthy();
    expect(screen.queryByLabelText(/email/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /\+ invite/i }));
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
  });

  it('offers Admin and Agent roles and NO Owner option in the DOM', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));

    const roleSelect = screen.getByLabelText(/role/i) as HTMLSelectElement;
    const values = Array.from(roleSelect.options).map((o) => o.value);
    expect(values).toEqual(['agent', 'admin']);
    expect(roleSelect.value).toBe('agent'); // defaults to the lower-privilege role
    expect(screen.queryByRole('option', { name: /owner/i })).toBeNull();
  });

  it('submits the typed values, toasts the returned message and refetches', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    (adminCreateInvite as any).mockResolvedValue({
      success: true,
      route: 'invited',
      message: 'Invitation email sent.',
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'iara41.ai@gmail.com' } });
    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(adminCreateInvite).toHaveBeenCalledWith('c1', 'iara41.ai@gmail.com', 'admin', false),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invitation email sent.'));
    await waitFor(() => expect((getWorkspaceInvites as any).mock.calls.length).toBeGreaterThan(1));
  });

  it('closes and clears the form after a successful send', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    (adminCreateInvite as any).mockResolvedValue({
      success: true,
      message: 'Invitation email sent.',
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(screen.queryByLabelText(/email/i)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /\+ invite/i }));
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe('');
  });

  it('maps a seat-limit error to readable prose', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    (adminCreateInvite as any).mockRejectedValue(new Error('plan_limit_exceeded'));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/team-member limit/i)),
    );
  });

  it('disables Send while the create is in flight', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    let resolveCreate: (v: { success: boolean; message: string }) => void;
    (adminCreateInvite as any).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    const send = screen.getByRole('button', { name: /^send$/i });
    expect(send).not.toBeDisabled();

    fireEvent.click(send);
    await waitFor(() => expect(send).toBeDisabled());
    resolveCreate!({ success: true, message: 'Invitation email sent.' });
    await waitFor(() => expect(screen.queryByLabelText(/email/i)).toBeNull());
  });

  it('Dismiss closes the form without calling the API', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(adminCreateInvite).not.toHaveBeenCalled();
  });

  it('turns the cross-workspace 409 into a confirmation and retries with consent', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    const gate = Object.assign(new Error('cross_workspace_confirmation_required'), {
      body: {
        error: 'cross_workspace_confirmation_required',
        other_workspace_count: 2,
        message: 'This email has an unconfirmed account tied to 2 other workspace(s).',
      },
      status: 409,
    });
    (adminCreateInvite as any)
      .mockRejectedValueOnce(gate)
      .mockResolvedValueOnce({ success: true, message: 'Invitation email sent.' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() =>
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/2 other workspace/)),
    );
    // second attempt carries consent
    await waitFor(() =>
      expect(adminCreateInvite).toHaveBeenLastCalledWith('c1', 'a@x.com', 'agent', true),
    );
    // the gate is a question, not a failure — it must not surface as an error toast
    expect(toast.error).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('declining the cross-workspace confirmation sends nothing further', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    (adminCreateInvite as any).mockRejectedValue(
      Object.assign(new Error('cross_workspace_confirmation_required'), {
        body: { error: 'cross_workspace_confirmation_required', other_workspace_count: 1 },
        status: 409,
      }),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect((adminCreateInvite as any).mock.calls.length).toBe(1); // no retry
    expect(toast.error).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('Resend gates on the same 409 and retries with consent', async () => {
    (getWorkspaceInvites as any).mockResolvedValue({
      invites: [inv({ status: 'pending' })],
      total: 1,
    });
    (adminResendInvite as any)
      .mockRejectedValueOnce(
        Object.assign(new Error('cross_workspace_confirmation_required'), {
          body: { error: 'cross_workspace_confirmation_required', other_workspace_count: 3 },
          status: 409,
        }),
      )
      .mockResolvedValueOnce({ success: true, message: 'Invitation email sent.' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /resend/i }));
    await waitFor(() => expect(adminResendInvite).toHaveBeenCalledWith('c1', 'i1', false));
    await waitFor(() => expect(adminResendInvite).toHaveBeenLastCalledWith('c1', 'i1', true));
    confirmSpy.mockRestore();
  });

  it('Dismiss resets the role back to the lower-privilege default', async () => {
    // Picking Admin, dismissing, then reopening must NOT leave the form primed
    // to invite the next person as an admin.
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'admin' } });
    expect((screen.getByLabelText(/role/i) as HTMLSelectElement).value).toBe('admin');

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    fireEvent.click(screen.getByRole('button', { name: /\+ invite/i }));
    expect((screen.getByLabelText(/role/i) as HTMLSelectElement).value).toBe('agent');
  });

  it('collapsing via the header + Invite toggle resets the role back to the lower-privilege default', async () => {
    // Picking Admin, then collapsing the form via the header toggle (not Dismiss),
    // then reopening must NOT leave the form primed to invite the next person as an admin.
    (getWorkspaceInvites as any).mockResolvedValue({ invites: [], total: 0 });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /\+ invite/i }));
    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'admin' } });
    expect((screen.getByLabelText(/role/i) as HTMLSelectElement).value).toBe('admin');

    fireEvent.click(screen.getByRole('button', { name: /\+ invite/i })); // collapse
    fireEvent.click(screen.getByRole('button', { name: /\+ invite/i })); // reopen
    expect((screen.getByLabelText(/role/i) as HTMLSelectElement).value).toBe('agent');
  });
});
