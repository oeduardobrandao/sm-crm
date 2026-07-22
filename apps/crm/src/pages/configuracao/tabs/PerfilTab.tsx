import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { avatarColorClass } from '@/lib/avatarColor';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import { getInitials } from '../../../store';

/** Personal settings: profile, password, account details and sign-out. */
export default function PerfilTab() {
  const { user, profile, role, signOut, refetchProfile } = useAuth();
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  // --- Profile form ---
  const [pNome, setPNome] = useState('');
  const [pEmpresa, setPEmpresa] = useState('');
  const [pTelefone, setPTelefone] = useState('');
  const [pWhatsapp, setPWhatsapp] = useState('');
  const [pMarketingOptIn, setPMarketingOptIn] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    if (profile) {
      setPNome(profile.nome ?? '');
      setPEmpresa((profile as unknown as Record<string, string>).empresa ?? '');
      setPTelefone((profile as unknown as Record<string, string>).telefone ?? '');
      setPWhatsapp((profile as unknown as Record<string, string>).whatsapp ?? '');
      setPMarketingOptIn((profile as unknown as Record<string, unknown>).marketing_opt_in === true);
    }
  }, [profile]);

  const handleProfileSave = async () => {
    if (!pNome) {
      toast.error('Nome é obrigatório.');
      return;
    }
    setProfileLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          nome: pNome,
          empresa: pEmpresa,
          telefone: pTelefone,
          whatsapp: pWhatsapp,
          marketing_opt_in: pMarketingOptIn,
        })
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
    if (!senha || senha.length < 8) {
      toast.error('Mínimo 8 caracteres.');
      return;
    }
    if (senha !== confirmar) {
      toast.error('As senhas não coincidem.');
      return;
    }
    setPwLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      setSenha('');
      setConfirmar('');
      toast.success('Senha atualizada!');
    } catch (err: unknown) {
      toast.error('Erro ao atualizar senha: ' + (err as Error).message);
    } finally {
      setPwLoading(false);
    }
  };

  if (!user) return null;

  const initials = profile?.nome ? getInitials(profile.nome) : '??';

  return (
    <>
      {/* Profile Card */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1.5rem',
            minWidth: 0,
          }}
        >
          <div
            className={`avatar ${avatarColorClass(user?.id ?? profile?.nome)}`}
            style={{ width: 64, height: 64, fontWeight: 700, fontSize: '1.4rem' }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3
              style={{
                margin: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {profile?.nome ?? user.email}
            </h3>
            <p
              style={{
                color: 'var(--text-muted)',
                margin: '4px 0 4px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user.email}
            </p>
            <span className="badge badge-success">Conta Ativa</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="config-form-grid">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={pNome} onChange={(e) => setPNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Empresa</Label>
              <Input value={pEmpresa} onChange={(e) => setPEmpresa(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Telefone</Label>
              <Input value={pTelefone} onChange={(e) => setPTelefone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>WhatsApp</Label>
              <Input value={pWhatsapp} onChange={(e) => setPWhatsapp(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Switch
              id="marketing-opt-in"
              checked={pMarketingOptIn}
              onCheckedChange={setPMarketingOptIn}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Comunicações de marketing</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {pMarketingOptIn
                  ? 'Você receberá novidades e comunicações de marketing por SMS e WhatsApp.'
                  : 'Você não receberá comunicações de marketing. Mensagens sobre sua conta continuam sendo enviadas.'}
              </div>
            </div>
          </div>
          <Button onClick={handleProfileSave} disabled={profileLoading}>
            {profileLoading && <Spinner size="sm" />} Salvar Perfil
          </Button>
        </div>
      </div>

      {/* Password */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Alterar Senha</h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nova Senha</Label>
            <PasswordInput value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Confirmar Nova Senha</Label>
            <PasswordInput value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
          </div>
          <Button onClick={handlePasswordSave} disabled={pwLoading}>
            {pwLoading && <Spinner size="sm" />} Atualizar Senha
          </Button>
        </div>
      </div>

      {/* Agents see no other tab, so the strip is hidden for them entirely —
          this is the only place that explains why. */}
      {!isOwnerOrAdmin && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <RoleRestrictionNotice
            title="Configurações do workspace"
            description="As configurações de workspace, sincronização do Instagram e gerenciamento de membros estão disponíveis apenas para proprietários e administradores."
          />
        </div>
      )}

      {/* Account Info */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">Conta</h3>
        <div className="client-info-grid">
          <div className="client-info-item">
            <span className="client-info-label">ID do Usuário</span>
            <span
              className="client-info-value"
              style={{ fontFamily: "'SF Pro Text', sans-serif", fontSize: '0.8rem' }}
            >
              {user.id.substring(0, 18)}...
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">Criado em</span>
            <span className="client-info-value">
              {user.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '—'}
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">Último acesso</span>
            <span className="client-info-value">
              {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('pt-BR') : '—'}
            </span>
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
        <Button variant="ghost" className="text-destructive" onClick={signOut}>
          <LogOut className="h-4 w-4" /> Sair da Conta
        </Button>
      </div>
    </>
  );
}
