import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  getWorkspaceUsers,
  updateWorkspaceUserRole,
  removeWorkspaceUser,
  getCurrentWorkspace,
  updateWorkspace,
  getInitials,
} from '../../store';

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = { owner: 'badge-danger', admin: 'badge-info', agent: 'badge-neutral' };
  const pt: Record<string, string> = { owner: 'DONO', admin: 'ADMIN', agent: 'AGENTE' };
  return <span className={`badge ${map[role] ?? 'badge-neutral'}`}>{pt[role] ?? role}</span>;
}

function InviteStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { pending: 'badge-warning', expired: 'badge-danger', accepted: 'badge-success' };
  const pt: Record<string, string> = { pending: 'PENDENTE', expired: 'EXPIRADO', accepted: 'ACEITO' };
  return <span className={`badge ${map[status] ?? 'badge-neutral'}`}>{pt[status] ?? status}</span>;
}

export default function ConfiguracaoPage() {
  const { user, profile, role, signOut, refetchProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  // --- Profile form ---
  const [pNome, setPNome] = useState('');
  const [pEmpresa, setPEmpresa] = useState('');
  const [pTelefone, setPTelefone] = useState('');
  const [pWhatsapp, setPWhatsapp] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    if (profile) {
      setPNome(profile.nome ?? '');
      setPEmpresa((profile as unknown as Record<string, string>).empresa ?? '');
      setPTelefone((profile as unknown as Record<string, string>).telefone ?? '');
      setPWhatsapp((profile as unknown as Record<string, string>).whatsapp ?? '');
    }
  }, [profile]);

  const handleProfileSave = async () => {
    if (!pNome) { toast.error('Nome é obrigatório.'); return; }
    setProfileLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ nome: pNome, empresa: pEmpresa, telefone: pTelefone, whatsapp: pWhatsapp })
        .eq('id', user!.id);
      if (error) throw error;
      await refetchProfile();
      toast.success('Perfil atualizado!');
    } catch (err: unknown) {
      toast.error('Erro ao salvar: ' + (err as Error).message);
    } finally {
      setProfileLoading(false);
    }
  };

  // --- Password form ---
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const handlePasswordSave = async () => {
    if (!senha || senha.length < 8) { toast.error('Mínimo 8 caracteres.'); return; }
    if (senha !== confirmar) { toast.error('As senhas não coincidem.'); return; }
    setPwLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      setSenha(''); setConfirmar('');
      toast.success('Senha atualizada!');
    } catch (err: unknown) {
      toast.error('Erro ao atualizar senha: ' + (err as Error).message);
    } finally {
      setPwLoading(false);
    }
  };

  // --- Workspace ---
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const { data: workspace, refetch: refetchWorkspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
    enabled: isOwnerOrAdmin,
  });

  const [wsName, setWsName] = useState('');
  const [wsLogoUrl, setWsLogoUrl] = useState<string | null>(null);
  const [wsLogoLoading, setWsLogoLoading] = useState(false);
  const [removeLogoOpen, setRemoveLogoOpen] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (workspace) {
      setWsName(workspace.name ?? '');
      setWsLogoUrl(workspace.logo_url ?? null);
    }
  }, [workspace]);

  const handleLogoUpload = async (file: File) => {
    if (!workspace) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Arquivo deve ser menor que 2MB.'); return; }
    setWsLogoLoading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const size = Math.min(bitmap.width, bitmap.height, 512);
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, size, size);
      const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/png'));

      const path = `workspaces/${workspace.id}/logo.png`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now();
      await updateWorkspace(workspace.id, { logo_url: publicUrl });
      setWsLogoUrl(publicUrl);
      refetchWorkspace();
      toast.success('Logo atualizada!');
    } catch (err: unknown) {
      toast.error('Erro ao enviar logo: ' + (err as Error).message);
    } finally {
      setWsLogoLoading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!workspace) return;
    setWsLogoLoading(true);
    try {
      await updateWorkspace(workspace.id, { logo_url: null });
      setWsLogoUrl(null);
      refetchWorkspace();
      toast.success('Logo removida.');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    } finally {
      setWsLogoLoading(false);
      setRemoveLogoOpen(false);
    }
  };

  const handleWsSave = async () => {
    if (!workspace || !wsName.trim()) return;
    try {
      await updateWorkspace(workspace.id, { name: wsName });
      refetchWorkspace();
      toast.success('Workspace atualizado!');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    }
  };

  // --- Instagram auto-sync ---
  const { data: igAccounts } = useQuery({
    queryKey: ['igAccountsForSync'],
    queryFn: async () => {
      if (!profile?.conta_id) return [];
      const { data } = await supabase
        .from('instagram_accounts')
        .select('id, auto_sync_enabled, client_id, clientes!inner(conta_id)')
        .eq('clientes.conta_id', profile.conta_id);
      return data ?? [];
    },
    enabled: isOwnerOrAdmin && !!profile?.conta_id,
  });

  const autoSyncEnabled = (igAccounts ?? []).some((a: Record<string, unknown>) => a.auto_sync_enabled);

  const handleAutoSyncToggle = async (checked: boolean) => {
    if (!igAccounts || igAccounts.length === 0) return;
    try {
      const ids = igAccounts.map((a: Record<string, unknown>) => a.id);
      const { error } = await supabase.from('instagram_accounts').update({ auto_sync_enabled: checked }).in('id', ids);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['igAccountsForSync'] });
      toast.success(checked ? 'Auto-sync ativado.' : 'Auto-sync desativado.');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    }
  };

  // --- Workspace members ---
  const { data: wsUsers, refetch: refetchWsUsers } = useQuery({
    queryKey: ['workspaceUsers'],
    queryFn: getWorkspaceUsers,
    enabled: isOwnerOrAdmin,
  });

  const { data: invites, refetch: refetchInvites } = useQuery({
    queryKey: ['invites'],
    queryFn: async () => {
      if (!profile?.conta_id) return [];
      const { data } = await supabase.from('invites').select('*').eq('conta_id', profile.conta_id).in('status', ['pending', 'expired']).order('created_at', { ascending: false });
      return (data ?? []).map((inv) => {
        if (inv.status === 'pending' && inv.expires_at && new Date(inv.expires_at) < new Date()) {
          return { ...inv, status: 'expired' };
        }
        return inv;
      });
    },
    enabled: isOwnerOrAdmin && !!profile?.conta_id,
  });

  // Edit role modal
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [editRoleUser, setEditRoleUser] = useState<{ id: string; nome: string; role: string } | null>(null);
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
    if (!inviteEmail) { toast.error('Email é obrigatório.'); return; }
    setInviteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || result.message || `Erro ${res.status}`);
      refetchInvites();
      setInviteOpen(false);
      setInviteEmail(''); setInviteRole('agent');
      toast.success('Convite enviado!');
    } catch (err: unknown) {
      toast.error('Erro ao convidar: ' + (err as Error).message);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCancelInvite = async () => {
    if (cancelInviteId == null) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user?id=${cancelInviteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session?.access_token}` },
      });
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
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ email: invite.email, role: invite.role }),
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      refetchInvites();
      toast.success('Convite reenviado!');
    } catch (err: unknown) {
      toast.error('Erro: ' + (err as Error).message);
    }
  };

  if (!user) return <div style={{ padding: '2rem', textAlign: 'center' }}><Spinner size="lg" /></div>;

  const initials = profile?.nome ? getInitials(profile.nome) : '??';

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto' }}>
      <h2 className="header-title" style={{ marginBottom: '1.5rem' }}>Configurações</h2>

      {/* Profile Card */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="avatar" style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '1.4rem', flexShrink: 0 }}>
            {initials}
          </div>
          <div>
            <h3 style={{ margin: 0 }}>{profile?.nome ?? user.email}</h3>
            <p style={{ color: 'var(--text-muted)', margin: '4px 0 4px' }}>{user.email}</p>
            <span className="badge badge-success">Conta Ativa</span>
          </div>
        </div>

        <div className="space-y-3">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div className="space-y-1"><Label>Nome *</Label><Input value={pNome} onChange={e => setPNome(e.target.value)} /></div>
            <div className="space-y-1"><Label>Empresa</Label><Input value={pEmpresa} onChange={e => setPEmpresa(e.target.value)} /></div>
            <div className="space-y-1"><Label>Telefone</Label><Input value={pTelefone} onChange={e => setPTelefone(e.target.value)} /></div>
            <div className="space-y-1"><Label>WhatsApp</Label><Input value={pWhatsapp} onChange={e => setPWhatsapp(e.target.value)} /></div>
          </div>
          <Button onClick={handleProfileSave} disabled={profileLoading}>{profileLoading && <Spinner size="sm" />} Salvar Perfil</Button>
        </div>
      </div>

      {/* Password */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Alterar Senha</h3>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Nova Senha</Label><PasswordInput value={senha} onChange={e => setSenha(e.target.value)} /></div>
          <div className="space-y-1"><Label>Confirmar Nova Senha</Label><PasswordInput value={confirmar} onChange={e => setConfirmar(e.target.value)} /></div>
          <Button onClick={handlePasswordSave} disabled={pwLoading}>{pwLoading && <Spinner size="sm" />} Atualizar Senha</Button>
        </div>
      </div>

      {/* Workspace Branding */}
      {isOwnerOrAdmin && workspace && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="config-title">Workspace</h3>
          <div style={{ marginBottom: '1rem' }}>
            <Label style={{ display: 'block', marginBottom: 8 }}>Logo</Label>
            {wsLogoUrl && (
              <div style={{ marginBottom: 12 }}>
                <img src={wsLogoUrl} alt="Logo" style={{ maxHeight: 80, borderRadius: 8, border: '1px solid var(--border-color)' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="outline" disabled={wsLogoLoading} onClick={() => logoInputRef.current?.click()}>
                {wsLogoLoading && <Spinner size="sm" />} {wsLogoUrl ? 'Trocar Logo' : 'Enviar Logo'}
              </Button>
              {wsLogoUrl && (
                <Button variant="ghost" className="text-destructive" disabled={wsLogoLoading} onClick={() => setRemoveLogoOpen(true)}>
                  Remover
                </Button>
              )}
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ''; }}
            />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6 }}>PNG, JPG ou WebP. Máx 2MB. Será redimensionado para 512px.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <Label style={{ display: 'block', marginBottom: 6 }}>Nome do Workspace</Label>
              <Input value={wsName} onChange={e => setWsName(e.target.value)} />
            </div>
            <Button onClick={handleWsSave}>Salvar</Button>
          </div>
        </div>
      )}

      {/* Instagram Auto-Sync */}
      {isOwnerOrAdmin && (igAccounts ?? []).length > 0 && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <h3 className="config-title">Auto-Sync Instagram</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Switch checked={autoSyncEnabled} onCheckedChange={handleAutoSyncToggle} />
            <span>{autoSyncEnabled ? 'Sincronização automática ativada' : 'Sincronização automática desativada'}</span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
            Quando ativada, os dados do Instagram são sincronizados automaticamente uma vez por dia.
          </p>
        </div>
      )}

      {/* Workspace Members */}
      {isOwnerOrAdmin && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 className="config-title">Membros do Workspace</h3>
            <Button onClick={() => setInviteOpen(true)}><Plus className="h-4 w-4" /> Convidar</Button>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            {(wsUsers ?? []).map((u: Record<string, string>) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
                <div className="avatar" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                  {getInitials(u.nome || '?')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{u.nome}</div>
                  <RoleBadge role={u.role} />
                </div>
                {u.id !== user?.id && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button size="sm" variant="outline" onClick={() => handleEditRole(u)}>Função</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoveUserId(u.id)}>Remover</Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Invites */}
          {(invites ?? []).length > 0 && (
            <>
              <h4 style={{ marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Convites</h4>
              {(invites ?? []).map((inv: Record<string, string>) => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 500 }}>{inv.email}</span>
                    <div style={{ marginTop: 4 }}>
                      <InviteStatusBadge status={inv.status} />
                      <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {({ owner: 'dono', admin: 'admin', agent: 'agente' } as Record<string, string>)[inv.role] ?? inv.role}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {inv.status === 'expired' && (
                      <Button size="sm" variant="outline" onClick={() => handleResendInvite(inv)}>Reenviar</Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelInviteId(inv.id)}>Cancelar</Button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Account Info */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Conta</h3>
        <div className="client-info-grid">
          <div className="client-info-item">
            <span className="client-info-label">ID do Usuário</span>
            <span className="client-info-value" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{user.id.substring(0, 18)}...</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">Criado em</span>
            <span className="client-info-value">{user.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '—'}</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">Último acesso</span>
            <span className="client-info-value">{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('pt-BR') : '—'}</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">Provedor</span>
            <span className="client-info-value">{user.app_metadata?.provider ?? 'email'}</span>
          </div>
        </div>
      </div>

      {/* Logout */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Sessão</h3>
        <Button variant="ghost" className="text-destructive" onClick={signOut}><LogOut className="h-4 w-4" /> Sair da Conta</Button>
      </div>

      {/* Edit Role Modal */}
      <Dialog open={editRoleOpen} onOpenChange={setEditRoleOpen}>
        <DialogContent onConfirmClose={() => setEditRoleOpen(false)}>
          <DialogHeader><DialogTitle>Editar função — {editRoleUser?.nome}</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label>Função</Label>
            <Select value={editRoleValue} onValueChange={setEditRoleValue}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="agent">Agente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRoleOpen(false)}>Cancelar</Button>
            <Button onClick={handleEditRoleSave} disabled={editRoleLoading}>{editRoleLoading && <Spinner size="sm" />} Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite Modal */}
      <Dialog open={inviteOpen} onOpenChange={open => { if (!open) { setInviteEmail(''); setInviteRole('agent'); } setInviteOpen(open); }}>
        <DialogContent onConfirmClose={() => { setInviteEmail(''); setInviteRole('agent'); setInviteOpen(false); }}>
          <DialogHeader><DialogTitle>Convidar Membro</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Email *</Label><Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Função</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="agent">Agente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setInviteOpen(false); setInviteEmail(''); setInviteRole('agent'); }}>Cancelar</Button>
            <Button onClick={handleInvite} disabled={inviteLoading}>{inviteLoading && <Spinner size="sm" />} Enviar Convite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove User Confirm */}
      <AlertDialog open={removeUserId !== null} onOpenChange={open => { if (!open) setRemoveUserId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover membro?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveUser}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove Logo Confirm */}
      <AlertDialog open={removeLogoOpen} onOpenChange={setRemoveLogoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remover logo?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveLogo}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Invite Confirm */}
      <AlertDialog open={cancelInviteId !== null} onOpenChange={open => { if (!open) setCancelInviteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Cancelar convite?</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelInvite}>Sim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
