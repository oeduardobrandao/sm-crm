import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Sparkles, ArrowLeft, Play, Check, MailCheck, CircleAlert } from 'lucide-react';
import { signIn, signUp, resetPassword, resendSignupConfirmation } from '../../lib/supabase';
import { clearStoredReferral, getStoredReferral } from '../../lib/referral';
import { captureEvent, identifySignup } from '@/lib/analytics';
import { trackMetaEvent } from '@/lib/metaPixelLoader';
import { markSignupStarted } from './signupStarted';
import {
  SIGNUP_FIELDS,
  signupErrorKey,
  validateSignup,
  type SignupErrorKey,
  type SignupField,
  type SignupFieldError,
} from './signupValidation';
import { useAuth } from '@/context/AuthContext';
import { CookiePreferencesLink } from '@/components/consent/CookiePreferencesLink';
import { parsePlanIntent, buildPlanIntentQuery } from '@/pages/comecar/plan-intent';
import { isNativeApp } from '@/native/platform';

type TabKey = 'login' | 'register' | 'forgot';

/** Seconds a resend button stays disabled; Supabase rate-limits resends to about one a minute. */
const RESEND_COOLDOWN_S = 60;

/**
 * With email confirmation on, Supabase answers a signup for an address that already has a
 * confirmed account with an obfuscated user whose `identities` array is empty, and sends no email.
 * A missing `identities` field is not that case, so only an explicit empty array counts.
 */
function isExistingAccountSignup(user: { identities?: unknown[] | null } | null | undefined) {
  return Array.isArray(user?.identities) && user.identities.length === 0;
}

function isEmailNotConfirmed(error: { code?: string; message?: string }) {
  return error.code === 'email_not_confirmed' || error.message === 'Email not confirmed';
}

function isGmail(email: string) {
  return /@(gmail|googlemail)\.com$/i.test(email.trim());
}

/** Inline error under a signup field. The id is what the input's aria-describedby points at. */
function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p
      id={id}
      className="flex items-start gap-1.5 leading-snug"
      style={{ color: 'var(--danger-text)', fontSize: '0.8rem' }}
    >
      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export default function LoginPage() {
  const { t } = useTranslation('auth');
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Preserve the full intended URL (path + query + hash) so deep links survive the login bounce —
  // e.g. the OAuth consent page needs its ?authorization_id=… after sign-in.
  const fromLoc = (
    location.state as { from?: { pathname?: string; search?: string; hash?: string } }
  )?.from;
  const from = fromLoc?.pathname
    ? `${fromLoc.pathname}${fromLoc.search ?? ''}${fromLoc.hash ?? ''}`
    : '/dashboard';
  // Inside the iOS app there is no sign-up, no plan choice and no landing page
  // (apps/mobile/DECISIONS.md D5). /login is not hydrated, so a render-time read is safe.
  const native = isNativeApp();
  // No plan intent in the app: every post-login path below then goes to `from`, never /comecar.
  const planIntent = native ? null : parsePlanIntent(location.search);
  const intentQuery = planIntent
    ? buildPlanIntentQuery(planIntent.planId, planIntent.interval)
    : '';
  const tabParam = new URLSearchParams(location.search).get('tab');
  const initialTab: TabKey =
    tabParam === 'register' && !native ? 'register' : tabParam === 'forgot' ? 'forgot' : 'login';
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [regNome, setRegNome] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  // Field errors show after the first submit attempt, then follow every keystroke.
  const [regErrors, setRegErrors] = useState<Partial<Record<SignupField, SignupFieldError>>>({});
  const [regAttempted, setRegAttempted] = useState(false);
  // Server-side failure, mapped to our own copy (never the raw Supabase message).
  const [regFormError, setRegFormError] = useState<SignupErrorKey | null>(null);
  // `disabled={loading}` only lands after a re-render; this closes the gap for a double tap.
  const regSubmitting = useRef(false);
  const regInputs = {
    nome: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };
  const [forgotEmail, setForgotEmail] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);
  // The address the confirmation went to. Kept apart from regEmail, which the form clears.
  const [pendingEmail, setPendingEmail] = useState('');
  // Signup hit an address that already has an account: no email was sent.
  const [existingAccount, setExistingAccount] = useState(false);
  // Login refused because this address is still unconfirmed.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendCooldown]);

  const confirmRedirectPath = intentQuery ? `/login?${intentQuery}` : '/login';

  const handleResend = async (email: string) => {
    if (!email || resending || resendCooldown > 0) return;
    setResending(true);
    const { error } = await resendSignupConfirmation(email, confirmRedirectPath);
    setResending(false);
    if (error) {
      toast.error(t('resend.error'));
      return;
    }
    captureEvent('signup_confirmation_resent');
    setResendCooldown(RESEND_COOLDOWN_S);
    toast.success(t('resend.success', { email }));
  };

  // A visitor can land here already authenticated: Supabase's email-confirmation
  // link redirects to /login with the session tokens in the URL hash, and
  // detectSessionInUrl (supabase.ts) establishes the session before this
  // component ever mounts a form. Without this, they are stuck looking at a
  // login form with nowhere to go and their plan choice stranded. Latched so
  // it fires once per mount; gated on `authLoading` so it never fires against
  // an unresolved auth state.
  const authRedirected = useRef(false);
  useEffect(() => {
    if (authLoading || !user || authRedirected.current) return;
    authRedirected.current = true;
    navigate(intentQuery ? `/comecar?${intentQuery}` : from, { replace: true });
  }, [authLoading, user, intentQuery, from, navigate]);

  // /login is not nested under AppLayout (see App.tsx's route tree), so
  // AppLayout's own chat:hide-on-mount effect never runs here. A Crisp
  // session bound on a PRIOR visit persists via Crisp's own cookie,
  // independent of Supabase auth state, so without this a shared machine
  // could show a previous user's identified conversation, unhidden, to
  // whoever loads this page next. Unconditional and un-gated on `user`/
  // `authLoading`: the exposure this closes exists precisely BEFORE auth
  // resolves, so it cannot wait for either.
  useEffect(() => {
    window.$crisp?.push(['do', 'chat:hide']);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setLoading(false);
    if (error && isEmailNotConfirmed(error)) {
      // A toast here was the raw English "Email not confirmed" with nothing to do next, and new
      // signups retried it until they gave up. The notice stays put and offers the resend.
      captureEvent('login_email_not_confirmed');
      setUnconfirmedEmail(loginEmail.trim());
      return;
    }
    setUnconfirmedEmail('');
    if (error) {
      toast.error(
        error.message === 'Invalid login credentials'
          ? t('login.invalidCredentials')
          : error.message,
      );
    } else {
      toast.success(t('login.success'));
      navigate(intentQuery ? `/comecar?${intentQuery}` : from, { replace: true });
    }
  };

  const updateRegField = (field: SignupField, value: string) => {
    const next = { nome: regNome, email: regEmail, password: regPassword, [field]: value };
    if (field === 'nome') setRegNome(value);
    else if (field === 'email') setRegEmail(value);
    else setRegPassword(value);
    if (regAttempted) setRegErrors(validateSignup(next));
  };

  const regErrorText = (field: SignupField) => {
    const key = regErrors[field];
    if (key === 'nameRequired') return t('register.errors.nameRequired');
    if (key === 'emailInvalid') return t('register.errors.emailInvalid');
    if (key === 'passwordShort') return t('register.errors.passwordShort');
    return null;
  };

  const regFormErrorText = (key: SignupErrorKey) => {
    if (key === 'rateLimit') return t('register.errors.rateLimit');
    if (key === 'weakPassword') return t('register.errors.weakPassword');
    if (key === 'emailInvalid') return t('register.errors.emailInvalid');
    return t('register.errors.generic');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regSubmitting.current) return;
    setRegAttempted(true);
    setRegFormError(null);
    const errors = validateSignup({ nome: regNome, email: regEmail, password: regPassword });
    setRegErrors(errors);
    const firstInvalid = SIGNUP_FIELDS.find((field) => errors[field]);
    if (firstInvalid) {
      regInputs[firstInvalid].current?.focus();
      return;
    }
    // The workspace name is collected on /workspace-setup. `empresa: ''` (not omitted) makes
    // handle_new_user write a blank company, which is what sends the owner through that step;
    // an omitted key would fall back to 'Meu Workspace' and skip it.
    const nome = regNome.trim();
    const email = regEmail.trim();
    regSubmitting.current = true;
    setLoading(true);
    const refCode = getStoredReferral();
    let result: Awaited<ReturnType<typeof signUp>>;
    try {
      result = await signUp(
        email,
        regPassword,
        { nome, empresa: '', ...(refCode ? { ref_code: refCode } : {}) },
        confirmRedirectPath,
      );
    } catch (err) {
      console.error('signUp failed:', err);
      regSubmitting.current = false;
      setLoading(false);
      setRegFormError('generic');
      return;
    }
    regSubmitting.current = false;
    setLoading(false);
    const { data, error } = result;
    if (error) {
      setRegFormError(signupErrorKey(error));
      return;
    }
    // Existing account: the uuid is fake and no email goes out, so identifying it would mint an
    // orphan person and "check your email" would leave them waiting for nothing.
    if (!data?.session && isExistingAccountSignup(data?.user)) {
      captureEvent('signup_existing_account');
      setLoginEmail(email);
      setExistingAccount(true);
      setRegPassword('');
      return;
    }
    // Identify BEFORE capturing: under `identified_only` an anonymous `signup_completed` is
    // personless forever, orphaning every signup from its later activity. signUp returns the
    // user's uuid even while email confirmation is pending, and the uuid is all identify needs.
    if (data?.user?.id) identifySignup(data.user.id);
    // A atribuição já foi gravada com o usuário; não reaproveitar em outro cadastro deste navegador.
    if (refCode) clearStoredReferral();
    captureEvent('signup_completed');
    trackMetaEvent('CompleteRegistration');
    // With email confirmation disabled signUp returns a live session, so the
    // user goes straight to the trial step. When it is enabled there is no
    // session yet and the check-your-email screen still applies.
    if (data?.session) {
      navigate(intentQuery ? `/comecar?${intentQuery}` : '/comecar', { replace: true });
      return;
    }
    setPendingEmail(email);
    setLoginEmail(email);
    // Signing up already sent the email; a resend inside the same minute would be refused.
    setResendCooldown(RESEND_COOLDOWN_S);
    setRegisterSuccess(true);
    setRegNome('');
    setRegEmail('');
    setRegPassword('');
    setRegAttempted(false);
    setRegErrors({});
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

  const tabItems = native
    ? [{ key: 'login', label: t('tabs.login') }]
    : [
        { key: 'login', label: t('tabs.login') },
        { key: 'register', label: t('tabs.register') },
      ];

  // The confirmation and existing-account states carry their own title.
  const registerState = activeTab === 'register' && (existingAccount || registerSuccess);
  const heading = registerState
    ? null
    : activeTab === 'register'
      ? { title: t('register.title'), sub: t('register.subtitle') }
      : activeTab === 'forgot'
        ? { title: t('forgot.title'), sub: t('forgot.description') }
        : { title: t('login.title'), sub: t('login.subtitle') };

  const resendButton = (email: string) => (
    <Button
      type="button"
      variant="outline"
      className="auth-secondary"
      disabled={resending || resendCooldown > 0}
      onClick={() => handleResend(email)}
    >
      {resending && <Spinner size="sm" />}
      {resendCooldown > 0 ? t('resend.cooldown', { seconds: resendCooldown }) : t('resend.button')}
    </Button>
  );

  return (
    <div className="auth-wrapper">
      <main className="auth-panel">
        <div className="auth-pane">
          <div className="auth-card animate-up">
            <div className="auth-header">
              <div className="auth-logo">
                {native ? (
                  <img src="/logo-black.svg" alt="Mesaas" />
                ) : (
                  <Link to="/" aria-label={t('homeLink')}>
                    <img src="/logo-black.svg" alt="Mesaas" />
                  </Link>
                )}
              </div>
              {heading && (
                <>
                  <h1 className="auth-title">{heading.title}</h1>
                  <p className="auth-sub">{heading.sub}</p>
                </>
              )}
            </div>

            {activeTab !== 'forgot' && tabItems.length > 1 && (
              <div className="auth-tabs">
                {tabItems.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`auth-tab${activeTab === tab.key ? ' active' : ''}`}
                    aria-pressed={activeTab === tab.key}
                    onClick={() => {
                      setActiveTab(tab.key as TabKey);
                      setRegisterSuccess(false);
                      setExistingAccount(false);
                      setUnconfirmedEmail('');
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'login' && (
              <form onSubmit={handleLogin} className="auth-form">
                <div className="auth-fields">
                  <div className="auth-field">
                    <Label htmlFor="login-email">{t('login.email')}</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder={t('login.emailPlaceholder')}
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="auth-field">
                    <div className="auth-label-row">
                      <Label htmlFor="login-password">{t('login.password')}</Label>
                      <a
                        href="#"
                        className="auth-text-link"
                        onClick={(e) => {
                          e.preventDefault();
                          setActiveTab('forgot');
                        }}
                      >
                        {t('login.forgotPassword')}
                      </a>
                    </div>
                    <PasswordInput
                      id="login-password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      minLength={8}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>
                {unconfirmedEmail && (
                  <div role="status" className="auth-notice">
                    <p className="auth-notice-title">{t('unconfirmed.title')}</p>
                    <p className="auth-notice-text">
                      {t('unconfirmed.description', { email: unconfirmedEmail })}
                    </p>
                    {resendButton(unconfirmedEmail)}
                  </div>
                )}
                <Button type="submit" disabled={loading} className="btn-primary auth-submit">
                  {loading && <Spinner size="sm" />}
                  {t('login.submit')}
                </Button>
              </form>
            )}

            {activeTab === 'register' &&
              (existingAccount ? (
                <div className="auth-form">
                  <div className="auth-state">
                    <p className="auth-state-title">{t('existingAccount.title')}</p>
                    <p className="auth-state-text">
                      {t('existingAccount.description', { email: regEmail.trim() })}
                    </p>
                  </div>
                  <Button
                    className="btn-primary auth-submit"
                    onClick={() => {
                      setExistingAccount(false);
                      setActiveTab('login');
                    }}
                  >
                    {t('existingAccount.goToLogin')}
                  </Button>
                  <p className="auth-link-row">
                    <a
                      href="#"
                      className="auth-text-link"
                      onClick={(e) => {
                        e.preventDefault();
                        setForgotEmail(regEmail.trim());
                        setExistingAccount(false);
                        setActiveTab('forgot');
                      }}
                    >
                      {t('login.forgotPassword')}
                    </a>
                  </p>
                </div>
              ) : registerSuccess ? (
                <div className="auth-form">
                  <div className="auth-state">
                    <div aria-hidden="true" className="auth-state-icon">
                      <MailCheck className="h-6 w-6" strokeWidth={1.75} />
                    </div>
                    <p className="auth-state-title">{t('registerSuccess.title')}</p>
                    <p className="auth-state-text">
                      {t('registerSuccess.description', { email: pendingEmail })}
                    </p>
                    <p className="auth-state-hint">{t('registerSuccess.spamHint')}</p>
                  </div>
                  {isGmail(pendingEmail) && (
                    <Button asChild className="btn-primary auth-submit">
                      <a
                        href="https://mail.google.com/mail/u/0/#search/in%3Aanywhere+mesaas"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('registerSuccess.openGmail')}
                      </a>
                    </Button>
                  )}
                  {resendButton(pendingEmail)}
                  <p className="auth-link-row">
                    <a
                      href="#"
                      className="auth-text-link"
                      onClick={(e) => {
                        e.preventDefault();
                        setRegisterSuccess(false);
                        setActiveTab('login');
                      }}
                    >
                      {t('registerSuccess.alreadyConfirmed')}
                    </a>
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={handleRegister}
                  onFocus={markSignupStarted}
                  className="auth-form"
                  noValidate
                >
                  <div className="auth-fields">
                    <div className="auth-field">
                      <Label htmlFor="reg-nome">{t('register.fullName')}</Label>
                      <Input
                        id="reg-nome"
                        ref={regInputs.nome}
                        placeholder={t('register.fullNamePlaceholder')}
                        autoComplete="name"
                        value={regNome}
                        onChange={(e) => updateRegField('nome', e.target.value)}
                        aria-invalid={regErrors.nome ? true : undefined}
                        aria-describedby={regErrors.nome ? 'reg-nome-error' : undefined}
                      />
                      {regErrors.nome && (
                        <FieldError id="reg-nome-error">{regErrorText('nome')!}</FieldError>
                      )}
                    </div>
                    <div className="auth-field">
                      <Label htmlFor="reg-email">{t('register.email')}</Label>
                      <Input
                        id="reg-email"
                        ref={regInputs.email}
                        type="email"
                        inputMode="email"
                        placeholder={t('register.emailPlaceholder')}
                        autoComplete="email"
                        value={regEmail}
                        onChange={(e) => updateRegField('email', e.target.value)}
                        aria-invalid={regErrors.email ? true : undefined}
                        aria-describedby={regErrors.email ? 'reg-email-error' : undefined}
                      />
                      {regErrors.email && (
                        <FieldError id="reg-email-error">{regErrorText('email')!}</FieldError>
                      )}
                    </div>
                    <div className="auth-field">
                      <Label htmlFor="reg-password">{t('register.password')}</Label>
                      <PasswordInput
                        id="reg-password"
                        ref={regInputs.password}
                        placeholder={t('register.passwordPlaceholder')}
                        autoComplete="new-password"
                        value={regPassword}
                        onChange={(e) => updateRegField('password', e.target.value)}
                        aria-invalid={regErrors.password ? true : undefined}
                        aria-describedby={
                          regErrors.password ? 'reg-password-error' : 'reg-password-help'
                        }
                      />
                      {regErrors.password ? (
                        <FieldError id="reg-password-error">{regErrorText('password')!}</FieldError>
                      ) : (
                        <p id="reg-password-help" className="auth-help">
                          {t('register.passwordHelp')}
                        </p>
                      )}
                    </div>
                  </div>
                  {regFormError && (
                    <p role="alert" className="auth-form-error">
                      {regFormErrorText(regFormError)}
                    </p>
                  )}
                  <Button type="submit" disabled={loading} className="btn-primary auth-submit">
                    {loading && <Spinner size="sm" />}
                    {t('register.submit')}
                  </Button>
                  <p className="auth-note">{t('register.nextStepNote')}</p>
                </form>
              ))}

            {activeTab === 'forgot' && (
              <form onSubmit={handleForgot} className="auth-form">
                <div className="auth-fields">
                  <div className="auth-field">
                    <Label htmlFor="forgot-email">{t('forgot.email')}</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder={t('forgot.emailPlaceholder')}
                      autoComplete="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <Button type="submit" disabled={loading} className="btn-primary auth-submit">
                  {loading && <Spinner size="sm" />}
                  {t('forgot.submit')}
                </Button>
                <p className="auth-link-row">
                  <a
                    href="#"
                    className="auth-text-link"
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveTab('login');
                    }}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('forgot.backToLogin')}
                  </a>
                </p>
              </form>
            )}
          </div>

          <p className="auth-cookie">
            <CookiePreferencesLink className="auth-cookie-link" />
          </p>
        </div>

        <aside className="auth-showcase" aria-hidden="true">
          <div className="auth-showcase-head">
            <span className="auth-showcase-badge">
              <Sparkles size={13} strokeWidth={2.2} />
              {t('showcase.badge')}
            </span>
            <h2 className="auth-showcase-title">{t('showcase.title')}</h2>
            <p className="auth-showcase-desc">{t('showcase.description')}</p>
          </div>

          <div className="auth-post-card">
            <div className="auth-post-video">
              <span className="auth-post-play">
                <Play size={16} fill="currentColor" />
              </span>
            </div>
            <div className="auth-post-body">
              <div className="auth-post-top">
                <p className="auth-post-title">{t('showcase.postTitle')}</p>
                <span className="auth-post-status">{t('showcase.postStatus')}</span>
              </div>
              <p className="auth-post-label">{t('showcase.publishTo')}</p>
              <div className="auth-post-targets">
                <div className="auth-post-target">
                  <span>{t('showcase.targetInstagram')}</span>
                  <span className="auth-post-switch" />
                </div>
                <div className="auth-post-target">
                  <span className="auth-post-target-name">
                    {t('showcase.targetTiktok')}
                    <span className="auth-post-new">{t('showcase.newTag')}</span>
                  </span>
                  <span className="auth-post-switch" />
                </div>
              </div>
              <p className="auth-post-foot">{t('showcase.postFoot')}</p>
            </div>
          </div>

          <ul className="auth-showcase-list">
            <li>
              <Check size={16} strokeWidth={2.2} />
              {t('showcase.bullet1')}
            </li>
            <li>
              <Check size={16} strokeWidth={2.2} />
              {t('showcase.bullet2')}
            </li>
            <li>
              <Check size={16} strokeWidth={2.2} />
              {t('showcase.bullet3')}
            </li>
          </ul>
        </aside>
      </main>

      <p className="auth-footer">{t('footer')}</p>
    </div>
  );
}
