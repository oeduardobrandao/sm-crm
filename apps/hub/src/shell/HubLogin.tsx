import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { HubApiError, requestLoginCode, verifyLoginCode } from '../api';
import { setHubSession } from '../lib/hubSession';
import type { HubLoginPayload } from '../types';

const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ErrorKey = 'hub.login.invalidCode' | 'hub.login.tooMany' | 'hub.login.genericError';

// A wrong or expired code is a 400 `invalid_code`, a rate limit a 429; everything else
// (network, 500, any other 400) is generic.
// request_code never reveals whether an address is listed, so no other mapping exists.
function errorKeyOf(error: unknown): ErrorKey {
  if (error instanceof HubApiError) {
    if (error.status === 400 && error.code === 'invalid_code') return 'hub.login.invalidCode';
    if (error.status === 429) return 'hub.login.tooMany';
  }
  return 'hub.login.genericError';
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const FIELD_CLASS =
  'w-full box-border hub-bg-card hub-txt border hub-border rounded-xl px-3.5 outline-none focus:border-[var(--hub-acc)]';
const PRIMARY_CLASS =
  'w-full min-h-[48px] rounded-xl px-4 text-[15px] font-semibold hub-btn-primary disabled:opacity-50 disabled:cursor-not-allowed';
const LINK_CLASS =
  'min-h-[44px] px-3 font-medium underline hub-txt disabled:opacity-50 disabled:cursor-not-allowed';

function Brand({ login }: { login: HubLoginPayload }) {
  const { name, logo_url: logoUrl } = login.workspace;
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3">
      {logoUrl && !failed ? (
        <img
          src={logoUrl}
          alt=""
          onError={() => setFailed(true)}
          className="w-14 h-14 rounded-[14px] object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="w-14 h-14 rounded-[14px] flex items-center justify-center font-display text-[26px] font-semibold hub-btn-primary"
        >
          {name.trim().charAt(0).toUpperCase()}
        </div>
      )}
      <span className="text-[14px] hub-tx2">{name}</span>
    </div>
  );
}

export interface HubLoginProps {
  workspace: string;
  token: string;
  login: HubLoginPayload;
  onLoggedIn: () => void;
}

/** Client login: e-mail, then the 6-digit code mailed to it. Rendered in place of the portal. */
export function HubLogin({ workspace, token, login, onLoggedIn }: HubLoginProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(RESEND_SECONDS);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  // True from a successful verify until the portal replaces this screen.
  const awaitingPortal = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    (step === 'code' ? codeRef : emailRef).current?.focus();
  }, [step]);

  // One timeout per second, re-armed by each tick; cleanup cancels it on unmount or step change.
  useEffect(() => {
    if (step !== 'code' || remaining <= 0) return;
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [step, remaining]);

  // A new login payload after a successful verify means the hub asked for login again (the new
  // session was refused, or cleared by a late answer to an older request). Unlock the form, or
  // it would stay disabled until a reload.
  useEffect(() => {
    if (!awaitingPortal.current) return;
    awaitingPortal.current = false;
    setBusy(false);
    setCode('');
    setErrorKey('hub.login.genericError');
  }, [login]);

  const trimmedEmail = email.trim();
  const emailValid = EMAIL_RE.test(trimmedEmail);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (!emailValid || busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await requestLoginCode(workspace, token, trimmedEmail);
      if (!mounted.current) return;
      setCode('');
      setRemaining(RESEND_SECONDS);
      setStep('code');
    } catch (err) {
      if (mounted.current) setErrorKey(errorKeyOf(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function resend() {
    if (busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await requestLoginCode(workspace, token, trimmedEmail);
      if (mounted.current) setRemaining(RESEND_SECONDS);
    } catch (err) {
      if (mounted.current) setErrorKey(errorKeyOf(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setErrorKey(null);
    let loggedIn = false;
    try {
      const { session_token } = await verifyLoginCode(workspace, token, trimmedEmail, code);
      setHubSession(session_token);
      loggedIn = true;
      awaitingPortal.current = true;
      onLoggedIn();
    } catch (err) {
      if (!mounted.current) return;
      setErrorKey(errorKeyOf(err));
      codeRef.current?.focus();
    } finally {
      // After a successful verify the code is consumed: stay busy while the bootstrap refetch
      // runs (the login can stay mounted mid-session), so a second tap cannot resend it.
      if (mounted.current && !loggedIn) setBusy(false);
    }
  }

  function restartWithOtherEmail() {
    setEmail('');
    setCode('');
    setErrorKey(null);
    setStep('email');
  }

  const error = errorKey && (
    <p
      role="alert"
      className="m-0 text-[14px] text-center"
      style={{ color: 'var(--danger-text, #b91c1c)' }}
    >
      {t(errorKey)}
    </p>
  );

  return (
    <div className="mx-auto w-full max-w-[420px] min-h-screen box-border flex flex-col gap-8 px-6 pt-24 pb-8">
      <Brand login={login} />

      {step === 'email' ? (
        <>
          <div className="flex flex-col gap-2 text-center">
            <h1 className="m-0 font-display text-[28px] font-medium tracking-tight hub-txt">
              {t('hub.login.emailTitle')}
            </h1>
            <p className="m-0 leading-normal hub-tx2">{t('hub.login.emailBody')}</p>
          </div>
          <form onSubmit={sendCode} className="flex flex-col gap-4" noValidate>
            <label htmlFor="hub-login-email" className="text-[14px] font-medium">
              {t('hub.login.emailLabel')}
            </label>
            <input
              id="hub-login-email"
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${FIELD_CLASS} h-12 text-[16px]`}
            />
            {error}
            <button type="submit" disabled={!emailValid || busy} className={PRIMARY_CLASS}>
              {t('hub.login.sendCode')}
            </button>
          </form>
          <p className="m-0 mt-auto text-center text-[14px] leading-normal hub-tx2">
            {t('hub.login.noAccess', { agency: login.workspace.name })}
          </p>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2 text-center">
            <h1 className="m-0 font-display text-[28px] font-medium tracking-tight hub-txt">
              {t('hub.login.codeTitle')}
            </h1>
            <p className="m-0 leading-normal hub-tx2 break-words">
              {t('hub.login.codeBody', { email: trimmedEmail })}
            </p>
          </div>
          <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
            <label htmlFor="hub-login-code" className="text-[14px] font-medium">
              {t('hub.login.codeLabel')}
            </label>
            <input
              id="hub-login-code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={`${FIELD_CLASS} h-14 text-[24px] font-semibold tracking-[0.3em] text-center`}
            />
            {error}
            <button type="submit" disabled={code.length !== 6 || busy} className={PRIMARY_CLASS}>
              {t('hub.login.enter')}
            </button>
          </form>
          <div className="flex flex-col items-center gap-1 text-[14px]">
            {remaining > 0 ? (
              <span className="min-h-[44px] flex items-center hub-tx2">
                {t('hub.login.resendIn', { time: formatClock(remaining) })}
              </span>
            ) : (
              <button type="button" onClick={resend} disabled={busy} className={LINK_CLASS}>
                {t('hub.login.resend')}
              </button>
            )}
            {/* Disabled while a request is in flight: its late answer would land on the next step. */}
            <button
              type="button"
              onClick={restartWithOtherEmail}
              disabled={busy}
              className={LINK_CLASS}
            >
              {t('hub.login.otherEmail')}
            </button>
          </div>
          <p className="m-0 mt-auto text-center text-[14px] leading-normal hub-tx2">
            {t('hub.login.validity')}
          </p>
        </>
      )}
    </div>
  );
}
