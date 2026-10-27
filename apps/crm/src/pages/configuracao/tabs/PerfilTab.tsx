import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { RoleRestrictionNotice } from '@/components/help/RoleRestrictionNotice';
import { FotoPessoaEditor } from '@/components/FotoPessoaEditor';
import { openConsentPreferences } from '@/lib/consent';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { PerfilPhone } from './phone/PerfilPhone';

/** Personal settings: profile, password, account details and sign-out. */
export default function PerfilTab() {
  const { t } = useTranslation('settings');
  const intlLocale = useIntlLocale();
  const { user, profile, can, signOut, refetchProfile } = useAuth();
  const isPhone = !useIsDesktop(768);
  // The `configuracoes` tab itself is already gated on `configuracoes:ver`
  // at the tab layer (configTabs.ts, Task 12) -- mirrors that here. Was
  // `role === 'owner' || role === 'admin'`, which a custom role with the
  // chassis 'agent' role never passed even when it held the tab-level
  // grant, wrongly telling it other config subsections were off-limits.
  const canViewConfig = can('configuracoes', 'ver') === true;

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
      toast.error(t('perfil.nameRequired'));
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
      toast.success(t('perfil.updated'));
    } catch (err: unknown) {
      toast.error(t('perfil.saveError', { message: (err as Error).message }));
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
      toast.error(t('perfil.passwordMin'));
      return;
    }
    if (senha !== confirmar) {
      toast.error(t('perfil.passwordMismatch'));
      return;
    }
    setPwLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      setSenha('');
      setConfirmar('');
      toast.success(t('perfil.passwordUpdated'));
    } catch (err: unknown) {
      toast.error(t('perfil.passwordError', { message: (err as Error).message }));
    } finally {
      setPwLoading(false);
    }
  };

  if (!user) return null;

  const displayName = profile?.nome ?? user.email ?? '';
  const fotoEditor = (variant: 'desktop' | 'phone') => (
    <FotoPessoaEditor
      alvo={{ kind: 'self', userId: user.id }}
      nome={displayName}
      seed={user.id}
      fotoUrl={profile?.avatar_url ?? null}
      variant={variant}
      descricao={t('perfil.photoDescription')}
    />
  );

  if (isPhone) {
    return (
      <PerfilPhone
        user={user}
        displayName={displayName}
        fotoEditor={fotoEditor('phone')}
        nome={{ value: pNome, onChange: setPNome }}
        empresa={{ value: pEmpresa, onChange: setPEmpresa }}
        telefone={{ value: pTelefone, onChange: setPTelefone }}
        whatsapp={{ value: pWhatsapp, onChange: setPWhatsapp }}
        marketingOptIn={pMarketingOptIn}
        onMarketingOptInChange={setPMarketingOptIn}
        profileSaving={profileLoading}
        onSaveProfile={handleProfileSave}
        senha={{ value: senha, onChange: setSenha }}
        confirmar={{ value: confirmar, onChange: setConfirmar }}
        passwordSaving={pwLoading}
        onSavePassword={handlePasswordSave}
        showRestriction={!canViewConfig}
        onSignOut={signOut}
      />
    );
  }

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
            <span className="badge badge-success">{t('perfil.activeAccount')}</span>
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 600 }}>
            {t('perfil.yourPhoto')}
          </h4>
          {fotoEditor('desktop')}
        </div>
        <div style={{ height: 1, background: 'var(--border-color)', marginBottom: '1.5rem' }} />

        <div className="space-y-3">
          <div className="config-form-grid">
            <div className="space-y-1">
              <Label>{t('perfil.nameLabel')}</Label>
              <Input value={pNome} onChange={(e) => setPNome(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('perfil.company')}</Label>
              <Input value={pEmpresa} onChange={(e) => setPEmpresa(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('perfil.phone')}</Label>
              <Input value={pTelefone} onChange={(e) => setPTelefone(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('perfil.whatsapp')}</Label>
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
              <div style={{ fontWeight: 500 }}>{t('perfil.marketing')}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {pMarketingOptIn ? t('perfil.marketingOn') : t('perfil.marketingOff')}
              </div>
            </div>
          </div>
          <Button onClick={handleProfileSave} disabled={profileLoading}>
            {profileLoading && <Spinner size="sm" />} {t('perfil.saveProfile')}
          </Button>
        </div>
      </div>

      {/* Password */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">{t('perfil.changePassword')}</h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t('perfil.newPassword')}</Label>
            <PasswordInput value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t('perfil.confirmNewPassword')}</Label>
            <PasswordInput value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
          </div>
          <Button onClick={handlePasswordSave} disabled={pwLoading}>
            {pwLoading && <Spinner size="sm" />} {t('perfil.updatePassword')}
          </Button>
        </div>
      </div>

      {/* Agents see no other tab, so the strip is hidden for them entirely —
          this is the only place that explains why. */}
      {!canViewConfig && (
        <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
          <RoleRestrictionNotice
            title={t('perfil.restrictionTitle')}
            description={t('perfil.restrictionBody')}
          />
        </div>
      )}

      {/* Account Info */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">{t('perfil.account')}</h3>
        <div className="client-info-grid">
          <div className="client-info-item">
            <span className="client-info-label">{t('perfil.userId')}</span>
            <span
              className="client-info-value"
              style={{ fontFamily: "'SF Pro Text', sans-serif", fontSize: '0.8rem' }}
            >
              {user.id.substring(0, 18)}...
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('perfil.createdAt')}</span>
            <span className="client-info-value">
              {user.created_at ? new Date(user.created_at).toLocaleDateString(intlLocale) : '—'}
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('perfil.lastAccess')}</span>
            <span className="client-info-value">
              {user.last_sign_in_at
                ? new Date(user.last_sign_in_at).toLocaleString(intlLocale)
                : '—'}
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('perfil.provider')}</span>
            <span className="client-info-value">{user.app_metadata?.provider ?? 'email'}</span>
          </div>
        </div>
      </div>

      {/* Privacy */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">{t('nav.privacidade')}</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          {t('perfil.privacyBody')}
        </p>
        <Button variant="outline" onClick={() => openConsentPreferences()}>
          {t('perfil.cookies')}
        </Button>
      </div>

      {/* Logout */}
      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="config-title">{t('perfil.session')}</h3>
        <Button variant="ghost" className="text-destructive" onClick={signOut}>
          <LogOut className="h-4 w-4" /> {t('perfil.signOut')}
        </Button>
      </div>
    </>
  );
}
