import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';
import {
  getWorkspaceInvites,
  adminCancelInvite,
  adminResendInvite,
  adminCreateInvite,
  type AdminApiError,
  type InviteInfo,
} from '../lib/api';
import { authStateLabel, statusTags, canActOnInvite } from './workspace-invites';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

const CANCEL_WARNING =
  'Isso exclui o convite e, se a pessoa nunca terminou o onboarding, também exclui a conta dela, removendo-a de TODOS os workspaces. Continuar?';

const SEAT_LIMIT_MESSAGE =
  'Este workspace está no limite de membros da equipe. Reenviar excederia o número de vagas do plano.';

/**
 * A 409 from the cross-workspace gate is a question, not a failure: nothing has
 * been mutated yet. Ask, and on a yes re-run the same request with consent.
 * Returns true when it handled the error.
 */
function confirmedCrossWorkspace(e: unknown, retry: () => void): boolean {
  const body = (e as AdminApiError).body as
    | { error?: string; other_workspace_count?: number; message?: string }
    | undefined;
  if (body?.error !== 'cross_workspace_confirmation_required') return false;
  const count = body.other_workspace_count ?? 0;
  const warning =
    `${body.message ?? ''}\n\nIsso vai remover essa conta de ${count} outro(s) workspace(s) e quebrar os links de convite pendentes dela. Continuar?`.trim();
  if (window.confirm(warning)) retry();
  return true;
}

export default function WorkspaceInvitesCard({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'agent'>('agent');

  const closeForm = () => {
    setFormOpen(false);
    setEmail('');
    setRole('agent');
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'workspace', workspaceId, 'invites'],
    queryFn: () => getWorkspaceInvites(workspaceId),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', workspaceId, 'invites'] });

  const resendMutation = useMutation({
    mutationFn: ({ inviteId, confirm }: { inviteId: string; confirm: boolean }) =>
      adminResendInvite(workspaceId, inviteId, confirm),
    onMutate: ({ inviteId }) => setBusyId(inviteId),
    onSettled: () => setBusyId(null),
    onSuccess: (res) => {
      toast.success(res.message ?? 'Convite enviado.');
      invalidate();
    },
    onError: (e: unknown, vars) => {
      if (
        confirmedCrossWorkspace(e, () =>
          resendMutation.mutate({ inviteId: vars.inviteId, confirm: true }),
        )
      )
        return;
      const message = (e as Error).message;
      toast.error(message === 'plan_limit_exceeded' ? SEAT_LIMIT_MESSAGE : message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (inviteId: string) => adminCancelInvite(workspaceId, inviteId),
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (res) => {
      toast.success(
        res.deleted_user ? 'Convite cancelado e conta removida.' : 'Convite cancelado.',
      );
      invalidate();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const createMutation = useMutation({
    mutationFn: (confirmCrossWorkspace: boolean) =>
      adminCreateInvite(workspaceId, email.trim(), role, confirmCrossWorkspace),
    onSuccess: (res) => {
      toast.success(res.message ?? 'Convite enviado.');
      closeForm();
      invalidate();
    },
    onError: (e: unknown) => {
      if (confirmedCrossWorkspace(e, () => createMutation.mutate(true))) return;
      const message = (e as Error).message;
      toast.error(message === 'plan_limit_exceeded' ? SEAT_LIMIT_MESSAGE : message);
    },
  });

  const invites = data?.invites ?? [];
  const total = data?.total ?? invites.length;

  return (
    <Card className="mb-6 mt-6 min-w-0 overflow-hidden">
      <CardHeader>
        <CardTitle>Convites ({total})</CardTitle>
        <div className="flex items-center gap-3">
          {total > invites.length && (
            <span className="text-xs text-muted-foreground">
              mostrando {invites.length} de {total}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-primary"
            onClick={() => (formOpen ? closeForm() : setFormOpen(true))}
          >
            + Convidar
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {formOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate(false); // unconfirmed; the gate may ask
            }}
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Input
              aria-label="E-mail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@exemplo.com"
              className="min-w-0 flex-1"
            />
            <span id="invite-role-label" className="sr-only">
              Papel
            </span>
            <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'agent')}>
              <SelectTrigger
                id="invite-role-trigger"
                aria-labelledby="invite-role-label invite-role-trigger"
                className="w-full sm:w-32"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">Agente</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={createMutation.isPending}>
              Enviar
            </Button>
            <Button type="button" variant="ghost" onClick={closeForm}>
              Descartar
            </Button>
          </form>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : isError ? (
          <ErrorState message="Falha ao carregar convites." onRetry={() => refetch()} />
        ) : invites.length === 0 ? (
          <EmptyState icon={Mail} title="Nenhum convite" />
        ) : (
          <>
            {/* Desktop header row (finding 8) */}
            <div className="hidden border-b border-border pb-2 text-[0.7rem] uppercase tracking-wider text-muted-foreground md:grid md:grid-cols-[2fr_0.7fr_1fr_1.1fr_1.6fr_1fr] md:gap-2">
              <span>E-mail</span>
              <span>Papel</span>
              <span>Status</span>
              <span>Enviado</span>
              <span>Estado de autenticação</span>
              <span>Ações</span>
            </div>
            <div className="flex flex-col gap-2">
              {invites.map((it) => (
                <InviteRow
                  key={it.id}
                  invite={it}
                  busy={busyId === it.id}
                  onResend={() => resendMutation.mutate({ inviteId: it.id, confirm: false })}
                  onCancel={() => {
                    if (window.confirm(CANCEL_WARNING)) cancelMutation.mutate(it.id);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
          <Badge key={t} variant="warning" size="sm" className="mr-1 mt-0.5">
            {t}
          </Badge>
        ))}
      </div>
      {/* Mobile: same nodes, laid out as a wrapped meta line instead of a hidden grid column
          (md:contents lets them fall back into their normal grid cells at md+, so nothing
          is duplicated and the desktop grid is unaffected). */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 md:mt-0 md:contents">
        <span className="text-xs text-muted-foreground">{invite.role}</span>
        <Badge
          variant={
            invite.status === 'accepted'
              ? 'success'
              : invite.status === 'expired'
                ? 'neutral'
                : 'warning'
          }
          size="sm"
          className="w-fit"
        >
          {invite.status}
        </Badge>
        <span className="text-xs text-muted-foreground">{formatSent(invite.created_at)}</span>
        <span className="text-xs text-muted-foreground">{authStateLabel(invite.auth_state)}</span>
      </div>
      <div className="mt-2 flex shrink-0 gap-1 md:mt-0">
        {actable && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary"
              onClick={onResend}
              disabled={busy}
            >
              Reenviar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onCancel}
              disabled={busy}
            >
              Cancelar
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
