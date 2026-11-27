import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CircleAlert } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { captureEvent } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import type { BillingCurrency } from '@/lib/planPrice';
import { getEffectivePlanWithSource, type EffectivePlan } from '@/services/billing';
import { useAuth } from '../../context/AuthContext';
import { isNativeApp } from '@/native/platform';
import { saveWorkspaceSetup } from './saveWorkspaceSetup';
import { isValidBrPhone, normalizeInternationalPhone, safeNextPath } from './setupHelpers';
import './workspace-setup.css';

type SetupField = 'nome' | 'empresa' | 'telefone';

/** Form order: focus goes to the first invalid field. */
const FIELDS: readonly SetupField[] = ['nome', 'empresa', 'telefone'];

/** Same cache entry Cobrança and /comecar read, so a repaired currency reaches them too. */
const CURRENT_WORKSPACE_KEY = ['currentWorkspace'] as const;
const EFFECTIVE_PLAN_KEY = ['billing', 'effective-plan-with-source'] as const;

/** Phone rules follow the workspace currency: BRL is a Brazilian number, USD a US/international one. */
function isValidPhone(value: string, usd: boolean): boolean {
  return usd ? normalizeInternationalPhone(value) !== null : isValidBrPhone(value);
}

function validate(v: Record<SetupField, string>, usd: boolean): Partial<Record<SetupField, true>> {
  const errors: Partial<Record<SetupField, true>> = {};
  if (!v.nome.trim()) errors.nome = true;
  if (!v.empresa.trim()) errors.empresa = true;
  if (!isValidPhone(v.telefone, usd)) errors.telefone = true;
  return errors;
}

function FieldError({ field, message }: { field: SetupField; message: string }) {
  return (
    <p
      id={`setup-${field}-error`}
      className="flex items-start gap-1.5 leading-snug"
      style={{ color: 'var(--danger-text)', fontSize: '0.8rem' }}
    >
      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

const INVALID_INPUT =
  'border-[color:var(--danger-text)] focus-visible:ring-[color:var(--danger-text)]';

/**
 * Step 2 of signup: the company, phone and WhatsApp opt-in the signup form no longer asks for.
 * ProtectedRoute sends a blank-company owner here with `?next=<path>`; on success the page
 * continues there (or to /comecar), with the profile patched in place so the gate lets go.
 */
type RepairState = 'idle' | 'running' | 'done' | 'failed';

export default function WorkspaceSetupPage() {
  const { t } = useTranslation('setup');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { user, profile, patchProfile } = useAuth();
  // Signup from an /en CTA (Task 9). Read from the server-written metadata, never the URL.
  const usSignup = user?.user_metadata?.market === 'us';

  // The workspace currency picks the phone rules. A failed read falls back to the signup market.
  const planQuery = useQuery({
    queryKey: EFFECTIVE_PLAN_KEY,
    queryFn: getEffectivePlanWithSource,
  });
  // A failed background refetch keeps the last good value; only a read that never produced data
  // falls back to the signup market.
  const readCurrency: BillingCurrency | null =
    planQuery.data?.billingCurrency ?? (planQuery.isError ? (usSignup ? 'usd' : 'brl') : null);

  // A US signup the part 1 trigger left in BRL is repaired server-side before the form is usable;
  // the RPC reads the market from auth.users itself and is a no-op for anyone else.
  const needsRepair = usSignup && planQuery.data?.billingCurrency === 'brl';
  const [repair, setRepair] = useState<RepairState>('idle');
  const runRepair = useCallback(async () => {
    setRepair('running');
    let result: string = 'error';
    try {
      const { data, error } = await supabase.rpc('billing_market_apply');
      if (!error && typeof data === 'string') result = data;
    } catch (err) {
      console.error('[workspace-setup] billing_market_apply failed:', err);
    }
    if (result === 'usd') {
      queryClient.setQueryData<EffectivePlan>(EFFECTIVE_PLAN_KEY, (old) =>
        old ? { ...old, billingCurrency: 'usd' } : old,
      );
      void queryClient.invalidateQueries({ queryKey: EFFECTIVE_PLAN_KEY });
      // /workspace-setup sits inside ProtectedRoute, so WorkspaceLanguageSync has already cached
      // the workspace as 'pt' (the repair also sets language 'en'). Left stale, that 'pt' would
      // beat the /en hint: flip it now (only if cached, to avoid a flash) and refetch.
      queryClient.setQueryData<{ language?: string } | null>(CURRENT_WORKSPACE_KEY, (old) =>
        old ? { ...old, language: 'en' } : old,
      );
      void queryClient.invalidateQueries({ queryKey: CURRENT_WORKSPACE_KEY });
      setRepair('done');
      return;
    }
    captureEvent('us_signup_currency_mismatch', { result });
    // Analytics is consent-gated and a us_default record reads undecided on /login: log it here too.
    console.error('[workspace-setup] us_signup_currency_mismatch', { result });
    setRepair('failed');
  }, [queryClient]);
  // Latched so StrictMode's double effect (and a refetch still reading BRL) never repeats it;
  // "Try again" calls runRepair directly.
  const repairStarted = useRef(false);
  useEffect(() => {
    if (!needsRepair || repairStarted.current) return;
    repairStarted.current = true;
    void runRepair();
  }, [needsRepair, runRepair]);

  const currency: BillingCurrency | null = repair === 'done' ? 'usd' : readCurrency;
  const usd = currency === 'usd';
  const repairPending = needsRepair && (repair === 'idle' || repair === 'running');
  const repairFailed = needsRepair && repair === 'failed';

  const [values, setValues] = useState<Record<SetupField, string>>({
    nome: profile?.nome ?? '',
    empresa: '',
    telefone: '',
  });
  const [optIn, setOptIn] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<SetupField, true>>>({});
  const [attempted, setAttempted] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // `disabled={saving}` only lands after a re-render; this closes the gap for a double tap.
  const savingRef = useRef(false);
  const inputs = {
    nome: useRef<HTMLInputElement>(null),
    empresa: useRef<HTMLInputElement>(null),
    telefone: useRef<HTMLInputElement>(null),
  };

  // A silent deploy reload must not drop a save in flight (typed fields are covered by the
  // DOM heuristic in app-lifecycle).
  useUnsavedWork(saving);

  // The iOS app never offers a plan, so without a `next` it goes straight to the dashboard.
  const target =
    safeNextPath(searchParams.get('next')) ?? (isNativeApp() ? '/dashboard' : '/comecar');

  const update = (field: SetupField, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    if (attempted) setErrors(validate(next, usd));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    setAttempted(true);
    setSaveFailed(false);
    const found = validate(values, usd);
    setErrors(found);
    const firstInvalid = FIELDS.find((field) => found[field]);
    if (firstInvalid) {
      inputs[firstInvalid].current?.focus();
      return;
    }
    const workspaceId = profile?.active_workspace_id || profile?.conta_id;
    if (!user || !workspaceId) {
      setSaveFailed(true);
      return;
    }

    const nome = values.nome.trim();
    const empresa = values.empresa.trim();
    // USD: digits only, country code first (`14155550132`). BRL keeps today's typed value.
    const telefone = usd
      ? (normalizeInternationalPhone(values.telefone) ?? '')
      : values.telefone.trim();
    // The WhatsApp opt-in is Brazilian only; it is not shown for a USD workspace.
    const marketingOptIn = usd ? false : optIn;
    savingRef.current = true;
    setSaving(true);
    try {
      await saveWorkspaceSetup({
        userId: user.id,
        workspaceId,
        nome,
        empresa,
        telefone,
        marketingOptIn,
      });
    } catch (err) {
      console.error('[workspace-setup] save failed:', err);
      savingRef.current = false;
      setSaving(false);
      setSaveFailed(true);
      return;
    }
    // Not refetchProfile(): it raises the global `loading` (ProtectedRoute swaps this page for
    // a skeleton) and a failed forced fetch returns the cached pre-setup profile, which would
    // bounce the owner straight back here with no error.
    patchProfile({ nome, empresa, telefone, marketing_opt_in: marketingOptIn });
    captureEvent('workspace_setup_completed');
    // /comecar self-guards: a workspace that already subscribed, or a non-owner, is bounced
    // to the dashboard from there.
    navigate(target, { replace: true });
  };

  const fieldProps = (field: SetupField) => ({
    id: `setup-${field}`,
    ref: inputs[field],
    value: values[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => update(field, e.target.value),
    'aria-invalid': errors[field] ? true : undefined,
    className: errors[field] ? INVALID_INPUT : undefined,
  });

  const header = (
    <div className="setup-header">
      <img src="/logo-black.svg" alt="Mesaas" className="setup-logo" />
      <span className="setup-step">{t('workspace.step')}</span>
      <h1 className="setup-title">{t('workspace.title')}</h1>
      <p className="setup-sub">{t('workspace.sub')}</p>
    </div>
  );

  let body: React.ReactNode;
  if (repairFailed) {
    body = (
      <div className="auth-form">
        <p role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.85rem' }}>
          {t('workspace.currencyMismatch')}
        </p>
        <Button
          type="button"
          className="btn-primary auth-submit w-full"
          onClick={() => void runRepair()}
        >
          {t('workspace.retry')}
        </Button>
      </div>
    );
  } else if (currency === null || repairPending) {
    body = (
      <div className="auth-form" aria-busy="true" aria-label={t('workspace.loading')}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
        <Skeleton className="h-11 w-full" />
      </div>
    );
  } else {
    body = (
      <form onSubmit={handleSubmit} className="auth-form" noValidate>
        <div className="space-y-1">
          <Label htmlFor="setup-nome">{t('workspace.nomeLabel')}</Label>
          <Input
            {...fieldProps('nome')}
            placeholder={t('workspace.nomePlaceholder')}
            autoComplete="name"
            aria-describedby={errors.nome ? 'setup-nome-error' : undefined}
          />
          {errors.nome && <FieldError field="nome" message={t('workspace.errorNome')} />}
        </div>

        <div className="space-y-1">
          <Label htmlFor="setup-empresa">{t('workspace.empresaLabel')}</Label>
          <Input
            {...fieldProps('empresa')}
            placeholder={t('workspace.empresaPlaceholder')}
            autoComplete="organization"
            aria-describedby={errors.empresa ? 'setup-empresa-error' : undefined}
          />
          {errors.empresa && <FieldError field="empresa" message={t('workspace.errorEmpresa')} />}
        </div>

        <div className="space-y-1">
          <Label htmlFor="setup-telefone">
            {usd ? t('workspace.phoneLabelIntl') : t('workspace.phoneLabelBr')}
          </Label>
          <Input
            {...fieldProps('telefone')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={
              usd ? t('workspace.phonePlaceholderIntl') : t('workspace.phonePlaceholderBr')
            }
            aria-describedby={errors.telefone ? 'setup-telefone-error' : 'setup-telefone-hint'}
          />
          {errors.telefone ? (
            <FieldError
              field="telefone"
              message={usd ? t('workspace.errorPhoneIntl') : t('workspace.errorPhoneBr')}
            />
          ) : (
            <p
              id="setup-telefone-hint"
              style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}
            >
              {usd ? t('workspace.phoneHintIntl') : t('workspace.phoneHintBr')}
            </p>
          )}
        </div>

        {!usd && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="setup-optin"
              checked={optIn}
              onCheckedChange={(checked) => setOptIn(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="setup-optin"
              style={{
                fontWeight: 400,
                lineHeight: 1.4,
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {t('workspace.marketingOptIn')}
            </Label>
          </div>
        )}

        {saveFailed && (
          <p role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.85rem' }}>
            {t('workspace.saveFailed')}
          </p>
        )}

        <Button type="submit" disabled={saving} className="btn-primary auth-submit w-full">
          {saving && <Spinner size="sm" />}
          {t('workspace.continue')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    );
  }

  return (
    <div className="auth-wrapper workspace-setup-shell">
      <div className="auth-card animate-up">
        {header}
        {body}
        <p className="auth-footer">{t('workspace.footer')}</p>
      </div>
    </div>
  );
}
