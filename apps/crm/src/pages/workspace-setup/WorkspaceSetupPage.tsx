import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CircleAlert } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { captureEvent } from '@/lib/analytics';
import { useAuth } from '../../context/AuthContext';
import { isNativeApp } from '@/native/platform';
import { saveWorkspaceSetup } from './saveWorkspaceSetup';
import { isValidBrPhone, safeNextPath } from './setupHelpers';
import './workspace-setup.css';

type SetupField = 'nome' | 'empresa' | 'telefone';

/** Form order: focus goes to the first invalid field. */
const FIELDS: readonly SetupField[] = ['nome', 'empresa', 'telefone'];

const FIELD_ERRORS: Record<SetupField, string> = {
  nome: 'Informe seu nome.',
  empresa: 'Informe o nome da empresa ou agência.',
  telefone: 'Informe um telefone com DDD, como (11) 99999-9999.',
};

function validate(v: Record<SetupField, string>): Partial<Record<SetupField, true>> {
  const errors: Partial<Record<SetupField, true>> = {};
  if (!v.nome.trim()) errors.nome = true;
  if (!v.empresa.trim()) errors.empresa = true;
  if (!isValidBrPhone(v.telefone)) errors.telefone = true;
  return errors;
}

function FieldError({ field }: { field: SetupField }) {
  return (
    <p
      id={`setup-${field}-error`}
      className="flex items-start gap-1.5 leading-snug"
      style={{ color: 'var(--danger-text)', fontSize: '0.8rem' }}
    >
      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{FIELD_ERRORS[field]}</span>
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
export default function WorkspaceSetupPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, patchProfile } = useAuth();
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
    if (attempted) setErrors(validate(next));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    setAttempted(true);
    setSaveFailed(false);
    const found = validate(values);
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
    const telefone = values.telefone.trim();
    savingRef.current = true;
    setSaving(true);
    try {
      await saveWorkspaceSetup({
        userId: user.id,
        workspaceId,
        nome,
        empresa,
        telefone,
        marketingOptIn: optIn,
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
    patchProfile({ nome, empresa, telefone, marketing_opt_in: optIn });
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

  return (
    <div className="auth-wrapper workspace-setup-shell">
      <div className="auth-card animate-up">
        <div className="setup-header">
          <img src="/logo-black.svg" alt="Mesaas" className="setup-logo" />
          <span className="setup-step">Passo 2 de 2</span>
          <h1 className="setup-title">Falta pouco</h1>
          <p className="setup-sub">
            Conte um pouco sobre sua agência para configurarmos seu espaço.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="space-y-1">
            <Label htmlFor="setup-nome">Seu nome</Label>
            <Input
              {...fieldProps('nome')}
              placeholder="Ana dos Santos"
              autoComplete="name"
              aria-describedby={errors.nome ? 'setup-nome-error' : undefined}
            />
            {errors.nome && <FieldError field="nome" />}
          </div>

          <div className="space-y-1">
            <Label htmlFor="setup-empresa">Nome da empresa ou agência</Label>
            <Input
              {...fieldProps('empresa')}
              placeholder="Agência Digital"
              autoComplete="organization"
              aria-describedby={errors.empresa ? 'setup-empresa-error' : undefined}
            />
            {errors.empresa && <FieldError field="empresa" />}
          </div>

          <div className="space-y-1">
            <Label htmlFor="setup-telefone">Telefone / WhatsApp</Label>
            <Input
              {...fieldProps('telefone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 99999-9999"
              aria-describedby={errors.telefone ? 'setup-telefone-error' : 'setup-telefone-hint'}
            />
            {errors.telefone ? (
              <FieldError field="telefone" />
            ) : (
              <p
                id="setup-telefone-hint"
                style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}
              >
                {t('register.phoneHint')}
              </p>
            )}
          </div>

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
              {t('register.marketingOptIn')}
            </Label>
          </div>

          {saveFailed && (
            <p role="alert" style={{ color: 'var(--danger-text)', fontSize: '0.85rem' }}>
              Não foi possível salvar. Tente de novo.
            </p>
          )}

          <Button type="submit" disabled={saving} className="btn-primary auth-submit w-full">
            {saving && <Spinner size="sm" />}
            Continuar
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>

        <p className="auth-footer">Você pode alterar essas informações depois em Configurações.</p>
      </div>
    </div>
  );
}
