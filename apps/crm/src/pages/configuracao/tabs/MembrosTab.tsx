import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { avatarColorClass } from '@/lib/avatarColor';
import { captureEvent } from '@/lib/analytics';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import {
  getInitials,
  getWorkspaceRoles,
  getWorkspaceUsers,
  removeWorkspaceUser,
  setWorkspaceUserFinancialAccess,
  updateWorkspaceUserRole,
} from '../../../store';
import {
  RoleBadge,
  InviteStatusBadge,
  InviteTimeLeft,
  computeEffectiveInviteStatus,
  inviteSuccessMessage,
} from '../inviteHelpers';

/** Workspace members and pending invites. */
export default function MembrosTab() {
  const { user, profile, workspaceRole, can } = useAuth();
  const canViewTeam = can('equipe', 'ver') === true;
  // Mutations (invite, edit role, remove, cancel/resend invite) all require
  // `editar` — a custom role granted only `equipe:ver` can reach this tab
  // (configTabs.ts gates the tab itself on `ver`) and see the roster, but
  // must not see controls it cannot actually use (the edge functions behind
  // them already enforce `equipe:editar` server-side — see invite-user and
  // manage-workspace-user).
  const canManageTeam = can('equipe', 'editar') === true;
  // The financial-access toggle is a STRICTER, owner-only lever — distinct
  // from general team management. `set-financial-access` stays owner-only
  // server-side regardless of `equipe:editar`, so this intentionally does not
  // fold into `canManageTeam`.
  const isOwner = workspaceRole === 'owner';

  const { data: wsUsers, refetch: refetchWsUsers } = useQuery({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
    enabled: canViewTeam,
  });

  // Gated on `canManageTeam` (equipe:editar), not just owner/admin: the
  // server-side authorization for update-role/invite-user is
  // `hasPermissionFor(..., 'equipe', 'editar')` (manage-workspace-user/
  // index.ts), so a custom role with that grant can assign papéis too — this
  // must match, not a coarser owner/admin-only gate.
  const { data: workspaceRoles = [] } = useQuery({
    queryKey: ['workspace-roles'],
    queryFn: getWorkspaceRoles,
    enabled: canManageTeam,
  });

  const { data: invites, refetch: refetchInvites } = useQuery({
    queryKey: ['invites'],
    queryFn: async () => {
      if (!profile?.conta_id) return [];
      const { data } = await supabase
        .from('invites')
        .select('*')
        .eq('conta_id', profile.conta_id)
        .in('status', ['pending', 'expired'])
        .order('created_at', { ascending: false });
      return computeEffectiveInviteStatus(data ?? []);
    },
    enabled: canViewTeam && !!profile?.conta_id,
  });

  // Edit role modal
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [editRoleUser, setEditRoleUser] = useState<{
    id: string;
    nome: string;
    role: string;
  } | null>(null);
  const [editRoleValue, setEditRoleValue] = useState('');
  const [editRoleLoading, setEditRoleLoading] = useState(false);
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);

  const handleEditRole = (u: Record<string, string>) => {
    setEditRoleUser(u as unknown as { id: string; nome: string; role: string });
    // Encoding: 'admin' | 'agent' | 'custom:<uuid>'. A member with a custom
    // papel always has role_id set (the server pins the chassis role to
    // 'agent' for those — see roleUpdate.ts's resolveRoleUpdate), so role_id
    // alone decides which form this select opens in.
    setEditRoleValue(u.role_id ? `custom:${u.role_id}` : u.role);
    setEditRoleOpen(true);
  };

  const handleEditRoleSave = async () => {
    if (!editRoleUser) return;
    setEditRoleLoading(true);
    try {
      const value = editRoleValue.startsWith('custom:')
        ? { roleId: editRoleValue.slice(7) }
        : { role: editRoleValue as 'admin' | 'agent' };
      await updateWorkspaceUserRole(editRoleUser.id, value);
      refetchWsUsers();
      setEditRoleOpen(false);
      toast.success('Função atualizada!');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    } finally {
      setEditRoleLoading(false);
    }
  };

  const handleRemoveUser = async () => {
    if (!removeUserId) return;
    try {
      await removeWorkspaceUser(removeUserId);
      refetchWsUsers();
      toast.success('Membro removido.');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    } finally {
      setRemoveUserId(null);
    }
  };

  // Financial-access toggle (owner-only, admin rows only). No optimistic
  // update: the switch stays put until the server call resolves, then the
  // list is refetched — a rejection surfaces as an error toast, not a flip
  // that silently reverts.
  const [financialAccessLoadingId, setFinancialAccessLoadingId] = useState<string | null>(null);

  const handleToggleFinancialAccess = async (memberId: string, checked: boolean) => {
    setFinancialAccessLoadingId(memberId);
    try {
      await setWorkspaceUserFinancialAccess(memberId, checked);
      toast.success(checked ? 'Acesso financeiro liberado.' : 'Acesso financeiro restrito.');
      await refetchWsUsers();
    } catch {
      toast.error('Não foi possível atualizar o acesso.');
    } finally {
      setFinancialAccessLoadingId(null);
    }
  };

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('agent');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [cancelInviteId, setCancelInviteId] = useState<string | null>(null);

  const handleInvite = async () => {
    if (!inviteEmail) {
      toast.error('Email é obrigatório.');
      return;
    }
    setInviteLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      // Decode the 'admin' | 'agent' | 'custom:<uuid>' select encoding: a
      // custom papel always invites with the underlying 'agent' chassis role
      // plus role_id — mirrors updateWorkspaceUserRole's own split above and
      // EquipePage's invite submit.
      const body = inviteRole.startsWith('custom:')
        ? { email: inviteEmail, role: 'agent', role_id: inviteRole.slice(7) }
        : { email: inviteEmail, role: inviteRole };
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || result.message || `Erro ${res.status}`);
      refetchInvites();
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('agent');
      toast.success(inviteSuccessMessage(result));
      captureEvent('invite_sent', { source: 'configuracao' });
    } catch (err: unknown) {
      toast.error('Erro ao convidar: ' + (err as Error).message);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCancelInvite = async () => {
    if (cancelInviteId == null) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user?id=${cancelInviteId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session?.access_token}` },
        },
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Erro ${res.status}`);
      await refetchInvites();
      toast.success('Convite cancelado.');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    } finally {
      setCancelInviteId(null);
    }
  };

  const handleResendInvite = async (invite: Record<string, string>) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email: invite.email, role: invite.role }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Erro ${res.status}`);
      refetchInvites();
      toast.success(result.message || 'Convite reenviado!');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    }
  };

  return (
    <>
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h3 className="config-title">Membros do Workspace</h3>
          {canManageTeam && (
            <Button onClick={() => setInviteOpen(true)}>
              <Plus className="h-4 w-4" /> Convidar
            </Button>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          {(wsUsers ?? []).map((u: Record<string, string>) => (
            <div key={u.id} className="config-member-row">
              <div
                className={`avatar ${avatarColorClass(u.id ?? u.nome)}`}
                style={{ width: 36, height: 36, fontWeight: 700 }}
              >
                {getInitials(u.nome || '?')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {u.nome}
                </div>
                {u.papel_nome ? (
                  // Custom papel: same badge look as RoleBadge (badge
                  // badge-neutral), but with the papel's own name instead of
                  // one of the three legacy PT-BR labels — inviteHelpers
                  // itself stays untouched for the legacy cases (RoleBadge's
                  // three-entry map has no slot for an arbitrary papel name).
                  <span className="badge badge-neutral">{u.papel_nome}</span>
                ) : (
                  <RoleBadge role={u.role} />
                )}
              </div>
              {isOwner && u.role === 'admin' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Ver financeiro
                  </span>
                  <Switch
                    checked={Boolean(u.can_see_financials)}
                    disabled={financialAccessLoadingId === u.id}
                    onCheckedChange={(checked) => handleToggleFinancialAccess(u.id, checked)}
                    aria-label={`Acesso financeiro de ${u.nome}`}
                  />
                </div>
              )}
              {canManageTeam && u.id !== user?.id && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <Button size="sm" variant="outline" onClick={() => handleEditRole(u)}>
                    Função
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setRemoveUserId(u.id)}
                  >
                    Remover
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Invites */}
        {(invites ?? []).length > 0 && (
          <>
            <h4
              style={{
                marginBottom: 8,
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
              }}
            >
              Convites
            </h4>
            {(invites ?? []).map((inv: Record<string, string>) => (
              <div key={inv.id} className="config-member-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontWeight: 500,
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {inv.email}
                  </span>
                  <div
                    style={{
                      marginTop: 4,
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <InviteStatusBadge status={inv.status} />
                    <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {(
                        { owner: 'dono', admin: 'admin', agent: 'agente' } as Record<string, string>
                      )[inv.role] ?? inv.role}
                    </span>
                    <InviteTimeLeft expiresAt={inv.expires_at} status={inv.status} />
                  </div>
                </div>
                {canManageTeam && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(inv.status === 'expired' || inv.status === 'pending') && (
                      <Button size="sm" variant="outline" onClick={() => handleResendInvite(inv)}>
                        Reenviar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setCancelInviteId(inv.id)}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Edit Role Modal */}
      <Dialog open={editRoleOpen} onOpenChange={setEditRoleOpen}>
        <DialogContent onConfirmClose={() => setEditRoleOpen(false)}>
          <DialogHeader>
            <DialogTitle>Editar função — {editRoleUser?.nome}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Função</Label>
            <Select value={editRoleValue} onValueChange={setEditRoleValue}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="agent">Agente</SelectItem>
                {workspaceRoles.map((r) => (
                  <SelectItem key={r.id} value={`custom:${r.id}`}>
                    {r.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRoleOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEditRoleSave} disabled={editRoleLoading}>
              {editRoleLoading && <Spinner size="sm" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Modal */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setInviteEmail('');
            setInviteRole('agent');
          }
          setInviteOpen(open);
        }}
      >
        <DialogContent
          onConfirmClose={() => {
            setInviteEmail('');
            setInviteRole('agent');
            setInviteOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Convidar Membro</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Email *</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Função</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="agent">Agente</SelectItem>
                  {workspaceRoles.map((r) => (
                    <SelectItem key={r.id} value={`custom:${r.id}`}>
                      {r.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setInviteOpen(false);
                setInviteEmail('');
                setInviteRole('agent');
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleInvite} disabled={inviteLoading}>
              {inviteLoading && <Spinner size="sm" />} Enviar Convite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove User Confirm */}
      <AlertDialog
        open={removeUserId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveUserId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveUser}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Invite Confirm */}
      <AlertDialog
        open={cancelInviteId !== null}
        onOpenChange={(open) => {
          if (!open) setCancelInviteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar convite?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelInvite}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
