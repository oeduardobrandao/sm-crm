import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  getWorkspaceInvites,
  adminCancelInvite,
  adminResendInvite,
  type InviteInfo,
} from '../lib/api';
import { authStateLabel, statusTags, canActOnInvite } from './workspace-invites';

const CANCEL_WARNING =
  'This deletes the invite and, if the person never finished onboarding, deletes their account — removing them from ALL workspaces. Continue?';

export default function WorkspaceInvitesCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'workspace', workspaceId, 'invites'],
    queryFn: () => getWorkspaceInvites(workspaceId),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', workspaceId, 'invites'] });

  const resendMutation = useMutation({
    mutationFn: (inviteId: string) => adminResendInvite(workspaceId, inviteId),
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (res) => {
      toast.success(res.message ?? 'Invitation sent.');
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const cancelMutation = useMutation({
    mutationFn: (inviteId: string) => adminCancelInvite(workspaceId, inviteId),
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (res) => {
      toast.success(
        res.deleted_user ? 'Invite cancelled and account removed.' : 'Invite cancelled.',
      );
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const invites = data?.invites ?? [];
  const total = data?.total ?? invites.length;

  return (
    <div className="min-w-0 overflow-hidden bg-card border border-border rounded-2xl p-5 mt-6 mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Invites ({total})</h2>
        {total > invites.length && (
          <span className="text-xs text-muted-foreground">
            showing {invites.length} of {total}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : isError ? (
        <button onClick={() => refetch()} className="text-sm text-destructive hover:underline">
          Failed to load invites — retry
        </button>
      ) : invites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invites.</p>
      ) : (
        <>
          {/* Desktop header row (finding 8) */}
          <div className="hidden md:grid grid-cols-[2fr_0.7fr_1fr_1.1fr_1.6fr_1fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-2 border-b border-border">
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span>Sent</span>
            <span>Auth state</span>
            <span>Actions</span>
          </div>
          <div className="flex flex-col gap-2">
            {invites.map((it) => (
              <InviteRow
                key={it.id}
                invite={it}
                busy={busyId === it.id}
                onResend={() => resendMutation.mutate(it.id)}
                onCancel={() => {
                  if (window.confirm(CANCEL_WARNING)) cancelMutation.mutate(it.id);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatSent(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function InviteRow({
  invite,
  busy,
  onResend,
  onCancel,
}: {
  invite: InviteInfo;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  const tags = statusTags(invite);
  const actable = canActOnInvite(invite);
  return (
    <div className="min-w-0 border-b border-border/50 py-2.5 md:grid md:grid-cols-[2fr_0.7fr_1fr_1.1fr_1.6fr_1fr] md:gap-2 md:items-center">
      <div className="min-w-0">
        <span className="block truncate text-sm">{invite.email}</span>
        {tags.map((t) => (
          <span
            key={t}
            className="mt-0.5 mr-1 inline-block text-[0.6rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-warning/10 text-warning"
          >
            {t}
          </span>
        ))}
      </div>
      {/* Mobile: same nodes, laid out as a wrapped meta line instead of a hidden grid column
          (md:contents lets them fall back into their normal grid cells at md+, so nothing
          is duplicated and the desktop grid is unaffected). */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 md:mt-0 md:contents">
        <span className="text-xs text-muted-foreground">{invite.role}</span>
        <span className="text-xs text-muted-foreground">{invite.status}</span>
        <span className="text-xs text-muted-foreground">{formatSent(invite.created_at)}</span>
        <span className="text-xs text-muted-foreground">{authStateLabel(invite.auth_state)}</span>
      </div>
      <div className="mt-2 flex shrink-0 gap-3 md:mt-0">
        {actable && (
          <>
            <button
              onClick={onResend}
              disabled={busy}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            >
              Resend
            </button>
            <button
              onClick={onCancel}
              disabled={busy}
              className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
