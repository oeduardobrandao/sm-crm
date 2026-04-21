import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { supabase } from '../../lib/supabase';

function getPasswordStrength(password: string): { percent: number; label: string } {
  if (!password) return { percent: 0, label: '' };
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const map = [
    { percent: 25, label: 'Fraca' },
    { percent: 50, label: 'Razoável' },
    { percent: 75, label: 'Boa' },
    { percent: 100, label: 'Forte' },
  ];
  return map[score - 1] ?? { percent: 0, label: '' };
}

export default function ConfigurarSenhaPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [progressWidth, setProgressWidth] = useState(0);
  const [password, setPassword] = useState('');
  const [nome, setNome] = useState('');
  const [isInvite, setIsInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [inviterName, setInviterName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [inviterInitials, setInviterInitials] = useState('');
  const [tokenError, setTokenError] = useState(false);

  useEffect(() => {
    const sessionReceived = { current: false };
    const mounted = { current: true };
    const timeout = setTimeout(() => {
      if (!sessionReceived.current) setTokenError(true);
    }, 8000);

    const processSession = async (session: { user: { email?: string; user_metadata?: Record<string, unknown> } }) => {
      if (!mounted.current) return;
      sessionReceived.current = true;
      clearTimeout(timeout);
      setTokenError(false);

      // Clear hash fragments left by Supabase implicit-grant redirect to prevent
      // the auth client from re-processing stale tokens after updateUser().
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      const userEmail = session.user.email || '';
      const contaId = (session.user.user_metadata?.conta_id as string) || '';
      setEmail(userEmail);
      setIsInvite(!!contaId);

      if (contaId) {
        const { data } = await supabase
          .from('profiles')
          .select('nome, empresa')
          .eq('conta_id', contaId)
          .eq('role', 'owner')
          .maybeSingle();
        if (data && mounted.current) {
          setWorkspaceName(data.empresa || '');
          setInviterName(data.nome || '');
          const initials = (data.nome || '')
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((w: string) => w[0].toUpperCase())
            .join('');
          setInviterInitials(initials);
        }
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !sessionReceived.current) {
        const hasConta = !!session.user.user_metadata?.conta_id;
        if (hasConta || window.location.pathname === '/configurar-senha') {
          processSession(session);
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!session || sessionReceived.current) return;
      const hasConta = !!session.user.user_metadata?.conta_id;
      const isInviteEvent = (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && hasConta;
      const isRecoveryEvent = event === 'PASSWORD_RECOVERY' || (event === 'INITIAL_SESSION' && !hasConta);
      if (isRecoveryEvent || isInviteEvent) {
        processSession(session);
      }
    });

    return () => {
      mounted.current = false;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error('Sessão expirada. Solicite um novo link.');
      return;
    }

    setLoading(true);
    const updateData: { password: string; data?: { nome: string } } = { password };
    if (isInvite && nome) updateData.data = { nome };

    const { error } = await supabase.auth.updateUser(updateData);
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    if (isInvite && nome && session.user.id) {
      await supabase.from('profiles').update({ nome }).eq('id', session.user.id);
    }

    if (isInvite && email) {
      try {
        const token = session.access_token;
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-workspace-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ action: 'accept-invite', email: email.toLowerCase() }),
        });
      } catch { /* non-critical */ }
    }

    setLoading(false);
    setSuccess(true);
    setTimeout(() => setProgressWidth(100), 100);
    setTimeout(() => { window.location.replace('/dashboard'); }, 2800);
  };

  const strength = getPasswordStrength(password);

  return (
    <div className="invite-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem', background: '#f5f3ee' }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)' }}>

        <div style={{ background: '#1a3d2b', padding: '2rem 2rem 1.75rem', textAlign: 'center' }}>
          <img src="/logo-white.svg" alt="Mesaas" style={{ display: 'block', margin: '0 auto 1.5rem', height: 24, width: 'auto' }} />
          {isInvite && inviterInitials && (
            <div style={{ width: 52, height: 52, background: '#f0a832', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#1a3d2b', margin: '0 auto 1rem' }}>
              {inviterInitials}
            </div>
          )}
          <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 600, margin: '0 0 0.35rem' }}>
            {isInvite ? 'Você foi convidado' : 'Configurar Senha'}
          </h1>
          {isInvite && inviterName && (
            <p style={{ color: '#9dbfa9', fontSize: 14, margin: 0 }}>
              <strong style={{ color: '#fff' }}>{inviterName}</strong> te convidou para
            </p>
          )}
          {!isInvite && (
            <p style={{ color: '#9dbfa9', fontSize: 14, margin: 0 }}>Defina sua nova senha para acessar a plataforma.</p>
          )}
          {isInvite && workspaceName && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(240,168,50,0.15)', border: '1px solid rgba(240,168,50,0.3)', borderRadius: 20, padding: '4px 12px', marginTop: '0.75rem', fontSize: 13, fontWeight: 500, color: '#f0a832' }}>
              {workspaceName}
            </div>
          )}
        </div>

        {tokenError ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, background: '#fdecea', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#c0392b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a3d2b', margin: '0 0 0.5rem' }}>Link inválido ou expirado</h2>
            <p style={{ fontSize: 14, color: '#888780', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
              Este link é inválido ou já expirou. Solicite um novo link de redefinição de senha.
            </p>
            <Button
              onClick={() => navigate('/login')}
              className="w-full"
              style={{ height: 46, background: '#1a3d2b', borderColor: '#1a3d2b', color: '#fff', fontSize: 15, fontWeight: 600 }}
            >
              Solicitar novo link
            </Button>
          </div>
        ) : !success ? (
          <div style={{ padding: '2rem' }}>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label>Seu e-mail</Label>
                <Input value={email} readOnly style={{ background: '#f8f7f3', color: '#888780', cursor: 'not-allowed' }} />
              </div>

              {isInvite && (
                <div className="space-y-1">
                  <Label htmlFor="conf-nome">Seu nome completo</Label>
                  <Input id="conf-nome" placeholder="Como prefere ser chamado?" value={nome} onChange={e => setNome(e.target.value)} required />
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="conf-password">{isInvite ? 'Crie sua senha' : 'Nova senha'}</Label>
                <PasswordInput
                  id="conf-password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              {password && (
                <div style={{ marginTop: -8 }}>
                  <Progress value={strength.percent} className="h-1.5" />
                  <span style={{ fontSize: 12, color: '#888780' }}>{strength.label}</span>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full"
                style={{ height: 46, background: '#1a3d2b', borderColor: '#1a3d2b', color: '#fff', fontSize: 15, fontWeight: 600 }}
              >
                {loading && <Spinner size="sm" />}
                {isInvite ? 'Aceitar convite e entrar' : 'Salvar senha'}
              </Button>

              {isInvite && (
                <p style={{ textAlign: 'center', fontSize: 12, color: '#888780', lineHeight: 1.6 }}>
                  Ao aceitar, você concorda com os <a href="/politica-de-privacidade" style={{ color: '#1a3d2b' }}>Termos de Uso</a> e a{' '}
                  <a href="/politica-de-privacidade" style={{ color: '#1a3d2b' }}>Política de Privacidade</a> do Mesaas.
                </p>
              )}
            </form>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem 2rem 2.5rem' }}>
            <div style={{ width: 60, height: 60, background: '#eaf3de', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="#3b6d11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1a3d2b', margin: '0 0 0.5rem' }}>Conta criada com sucesso!</h2>
            <p style={{ fontSize: 14, color: '#888780', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
              {isInvite && workspaceName
                ? <>Bem-vindo ao workspace <strong style={{ color: '#444441' }}>{workspaceName}</strong>. Redirecionando você agora...</>
                : 'Senha atualizada. Redirecionando você agora...'}
            </p>
            <div style={{ width: '100%', height: 4, background: '#f1efe8', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#1a3d2b', width: `${progressWidth}%`, borderRadius: 4, transition: 'width 2.5s ease' }} />
            </div>
          </div>
        )}

        <div style={{ padding: '1rem 2rem', background: '#f8f7f3', borderTop: '1px solid #ece9e2', textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: '#888780', margin: 0 }}>
            {isInvite ? 'Não esperava este convite? Ignore este e-mail — nenhuma conta será criada.' : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
