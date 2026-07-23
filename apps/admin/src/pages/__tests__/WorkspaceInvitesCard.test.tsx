import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkspaceInvitesCard from '../WorkspaceInvitesCard';
import type { InviteInfo } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getWorkspaceInvites: vi.fn(),
  adminCancelInvite: vi.fn(),
  adminResendInvite: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { getWorkspaceInvites, adminCancelInvite, adminResendInvite } from '../../lib/api';

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
    expect(await screen.findByText('Sent')).toBeTruthy(); // header column (finding 8)
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
    await waitFor(() => expect(adminResendInvite).toHaveBeenCalledWith('c1', 'i1'));
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
});
