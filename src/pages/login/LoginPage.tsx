import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { signIn, signUp, resetPassword } from '../../lib/supabase';

type TabKey = 'login' | 'register' | 'forgot';

export default function LoginPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('login');
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regNome, setRegNome] = useState('');
  const [regEmpresa, setRegEmpresa] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setLoading(false);
    if (error) {
      toast.error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
    } else {
      toast.success('Login realizado com sucesso!');
      navigate('/dashboard');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signUp(regEmail, regPassword, { nome: regNome, empresa: regEmpresa });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Conta criada! Verifique seu e-mail para confirmar o cadastro.');
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await resetPassword(forgotEmail);
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Link de redefinição enviado para ${forgotEmail}. Verifique sua caixa de entrada.`);
      setActiveTab('login');
    }
  };

  const tabItems = [
    { key: 'login', label: 'Entrar' },
    { key: 'register', label: 'Criar Conta' },
  ];

  return (
    <div className="auth-wrapper">
      <div className="auth-card animate-up">
        <div className="auth-header">
          <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center' }}>
            <img src="/logo-black.svg" alt="Mesaas" style={{ height: 20, width: 'auto' }} className="logo-light" />
          </div>
          <div className="auth-logo-sub" style={{ marginTop: 5, letterSpacing: 1 }}>PLATAFORMA INTELIGENTE</div>
        </div>

        {activeTab !== 'forgot' && (
          <div className="auth-tabs">
            {tabItems.map(t => (
              <button
                key={t.key}
                className={`auth-tab${activeTab === t.key ? ' active' : ''}`}
                onClick={() => setActiveTab(t.key as TabKey)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'login' && (
          <form onSubmit={handleLogin} className="auth-form">
            <div className="space-y-1">
              <Label htmlFor="login-email">E-mail</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="seu@email.com"
                autoComplete="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="login-password">Senha</Label>
              <PasswordInput
                id="login-password"
                placeholder="••••••••"
                autoComplete="current-password"
                minLength={8}
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={loading} className="btn-primary auth-submit w-full">
              {loading && <Spinner size="sm" />}
              Entrar
            </Button>
            <p style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <a href="#" className="auth-text-link" onClick={(e) => { e.preventDefault(); setActiveTab('forgot'); }}>
                Esqueci minha senha
              </a>
            </p>
          </form>
        )}

        {activeTab === 'register' && (
          <form onSubmit={handleRegister} className="auth-form">
            <div className="space-y-1">
              <Label htmlFor="reg-nome">Nome Completo</Label>
              <Input id="reg-nome" placeholder="Ana Dos Santos" value={regNome} onChange={e => setRegNome(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reg-empresa">Nome da Empresa</Label>
              <Input id="reg-empresa" placeholder="Agência Digital" value={regEmpresa} onChange={e => setRegEmpresa(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reg-email">E-mail</Label>
              <Input id="reg-email" type="email" placeholder="seu@email.com" autoComplete="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reg-password">Senha</Label>
              <PasswordInput id="reg-password" placeholder="Mínimo 8 caracteres" autoComplete="new-password" minLength={8} value={regPassword} onChange={e => setRegPassword(e.target.value)} required />
            </div>
            <Button type="submit" disabled={loading} className="btn-primary auth-submit w-full">
              {loading && <Spinner size="sm" />}
              Criar Conta
            </Button>
          </form>
        )}

        {activeTab === 'forgot' && (
          <form onSubmit={handleForgot} className="auth-form">
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Informe seu e-mail para receber um link de redefinição de senha.
            </p>
            <div className="space-y-1">
              <Label htmlFor="forgot-email">E-mail</Label>
              <Input id="forgot-email" type="email" placeholder="seu@email.com" autoComplete="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required />
            </div>
            <Button type="submit" disabled={loading} className="btn-primary auth-submit w-full">
              {loading && <Spinner size="sm" />}
              Enviar Link
            </Button>
            <p style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <a href="#" className="auth-text-link" onClick={(e) => { e.preventDefault(); setActiveTab('login'); }}>
                ← Voltar para o login
              </a>
            </p>
          </form>
        )}

        <p className="auth-footer">Plataforma segura para gestão de Social Media 🇧🇷</p>
      </div>
    </div>
  );
}
