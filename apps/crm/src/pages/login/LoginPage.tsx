import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { signIn, signUp, resetPassword } from '../../lib/supabase';

type TabKey = 'login' | 'register' | 'forgot';

export default function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname ?? '/dashboard';
  const initialTab: TabKey = new URLSearchParams(location.search).get('tab') === 'register' ? 'register' : 'login';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regNome, setRegNome] = useState('');
  const [regEmpresa, setRegEmpresa] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setLoading(false);
    if (error) {
      toast.error(error.message === 'Invalid login credentials' ? t('login.invalidCredentials') : error.message);
    } else {
      toast.success(t('login.success'));
      navigate(from, { replace: true });
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regPassword !== regConfirm) {
      toast.error(t('register.passwordMismatch'));
      return;
    }
    setLoading(true);
    const { error } = await signUp(regEmail, regPassword, { nome: regNome, empresa: regEmpresa });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      setRegisterSuccess(true);
      setRegNome('');
      setRegEmpresa('');
      setRegEmail('');
      setRegPassword('');
      setRegConfirm('');
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
      toast.success(t('forgot.success', { email: forgotEmail }));
      setActiveTab('login');
    }
  };

  const tabItems = [
    { key: 'login', label: t('tabs.login') },
    { key: 'register', label: t('tabs.register') },
  ];

  return (
    <div className="auth-wrapper">
      <div className="auth-card animate-up">
        <div className="auth-header">
          <div className="auth-logo" style={{ display: 'flex', justifyContent: 'center' }}>
            <img src="/logo-black.svg" alt="Mesaas" style={{ height: 20, width: 'auto' }} />
          </div>
          <div className="auth-logo-sub" style={{ marginTop: 5, letterSpacing: 1 }}>{t('tagline')}</div>
        </div>

        {activeTab !== 'forgot' && (
          <div className="auth-tabs">
            {tabItems.map(tab => (
              <button
                key={tab.key}
                className={`auth-tab${activeTab === tab.key ? ' active' : ''}`}
                onClick={() => { setActiveTab(tab.key as TabKey); setRegisterSuccess(false); }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'login' && (
          <form onSubmit={handleLogin} className="auth-form">
            <div className="space-y-1">
              <Label htmlFor="login-email">{t('login.email')}</Label>
              <Input
                id="login-email"
                type="email"
                placeholder={t('login.emailPlaceholder')}
                autoComplete="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="login-password">{t('login.password')}</Label>
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
              {t('login.submit')}
            </Button>
            <p style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <a href="#" className="auth-text-link" onClick={(e) => { e.preventDefault(); setActiveTab('forgot'); }}>
                {t('login.forgotPassword')}
              </a>
            </p>
          </form>
        )}

        {activeTab === 'register' && (
          registerSuccess ? (
            <div className="auth-form" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📧</p>
              <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{t('registerSuccess.title')}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                {t('registerSuccess.description')}
              </p>
              <Button className="btn-primary auth-submit w-full" onClick={() => { setRegisterSuccess(false); setActiveTab('login'); }}>
                {t('registerSuccess.goToLogin')}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="auth-form">
              <div className="space-y-1">
                <Label htmlFor="reg-nome">{t('register.fullName')}</Label>
                <Input id="reg-nome" placeholder={t('register.fullNamePlaceholder')} value={regNome} onChange={e => setRegNome(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-empresa">{t('register.companyName')}</Label>
                <Input id="reg-empresa" placeholder={t('register.companyPlaceholder')} value={regEmpresa} onChange={e => setRegEmpresa(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-email">{t('register.email')}</Label>
                <Input id="reg-email" type="email" placeholder={t('register.emailPlaceholder')} autoComplete="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-password">{t('register.password')}</Label>
                <PasswordInput id="reg-password" placeholder={t('register.passwordPlaceholder')} autoComplete="new-password" minLength={8} value={regPassword} onChange={e => setRegPassword(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reg-confirm">{t('register.confirmPassword')}</Label>
                <PasswordInput id="reg-confirm" placeholder={t('register.confirmPlaceholder')} autoComplete="new-password" minLength={8} value={regConfirm} onChange={e => setRegConfirm(e.target.value)} required />
              </div>
              <Button type="submit" disabled={loading} className="btn-primary auth-submit w-full">
                {loading && <Spinner size="sm" />}
                {t('register.submit')}
              </Button>
            </form>
          )
        )}

        {activeTab === 'forgot' && (
          <form onSubmit={handleForgot} className="auth-form">
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              {t('forgot.description')}
            </p>
            <div className="space-y-1">
              <Label htmlFor="forgot-email">{t('forgot.email')}</Label>
              <Input id="forgot-email" type="email" placeholder={t('forgot.emailPlaceholder')} autoComplete="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required />
            </div>
            <Button type="submit" disabled={loading} className="btn-primary auth-submit w-full">
              {loading && <Spinner size="sm" />}
              {t('forgot.submit')}
            </Button>
            <p style={{ textAlign: 'center', marginTop: '0.75rem' }}>
              <a href="#" className="auth-text-link" onClick={(e) => { e.preventDefault(); setActiveTab('login'); }}>
                {t('forgot.backToLogin')}
              </a>
            </p>
          </form>
        )}

        <p className="auth-footer">{t('footer')}</p>
      </div>
    </div>
  );
}
