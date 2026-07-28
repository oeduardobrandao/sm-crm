import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
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
  getWorkspaceUsers,
  removeWorkspaceUser,
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
  const { user, profile, workspaceRole } = useAuth();
  const isOwnerOrAdmin = workspaceRole === 'owner' || workspaceRole === 'admin';
  // Not yet consumed in this file — the financial-access toggle (a later task)
  // is the first owner-only member-management action here.
  const isOwner = workspaceRole === 'owner';

  const { data: wsUsers, refetch: refetchWsUsers } = useQuery({
    queryKey: ['workspaceUsers'],
    queryFn: getWorkspaceUsers,
    enabled: isOwnerOrAdmin,
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
    enabled: isOwnerOrAdmin && !!profile?.conta_id,
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
    setEditRoleValue(u.role);
    setEditRoleOpen(true);
  };

  const handleEditRoleSave = async () => {
    if (!editRoleUser) return;
    setEditRoleLoading(true);
    try {
      await updateWorkspaceUserRole(editRoleUser.id, editRoleValue);
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
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || result.message || `Erro ${res.status}`);
      refetchInvites();
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('agent');
      toast.success(inviteSuccessMessage(result));
      captureEvent('invite_sent');
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
          <Button onClick={() => setInviteOpen(true)}>
            <Plus className="h-4 w-4" /> Convidar
          </Button>
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
                <RoleBadge role={u.role} />
              </div>
              {u.id !== user?.id && (
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
