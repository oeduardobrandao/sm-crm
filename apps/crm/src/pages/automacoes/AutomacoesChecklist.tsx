import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface AutomacoesChecklistProps {
  accountReady: boolean;
  hasAutomation: boolean;
  hasFirstDm: boolean;
  /** Entitlement de criação: sem ele o CTA do passo 2 não renderiza (o
   * FeatureGate do header não cobre este caminho e o dialog vive fora dele). */
  canCreate: boolean;
  onCreate: () => void;
  onDismiss: () => void;
}

type StepState = 'done' | 'current' | 'pending';

function stateOf(done: boolean, isCurrent: boolean): StepState {
  return done ? 'done' : isCurrent ? 'current' : 'pending';
}

function StepMarker({ state }: { state: StepState }) {
  if (state === 'done') {
    return <Check className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--success)' }} />;
  }
  return (
    <span
      className="inline-block h-4 w-4 rounded-full border-2 flex-shrink-0"
      style={{ borderColor: state === 'current' ? 'var(--primary-color)' : 'var(--border-color)' }}
    />
  );
}

/** Checklist "Comece por aqui" (formato B do spec 2026-08-27). Presentacional:
 * a página é dona dos sinais, do dismiss persistido e da visibilidade externa. */
export default function AutomacoesChecklist({
  accountReady,
  hasAutomation,
  hasFirstDm,
  canCreate,
  onCreate,
  onDismiss,
}: AutomacoesChecklistProps) {
  const { t } = useTranslation('automations');
  if (accountReady && hasAutomation && hasFirstDm) return null;

  const s1 = stateOf(accountReady, !accountReady);
  const s2 = stateOf(hasAutomation, accountReady && !hasAutomation);
  const s3 = stateOf(hasFirstDm, accountReady && hasAutomation && !hasFirstDm);
  const doneCount = [accountReady, hasAutomation, hasFirstDm].filter(Boolean).length;

  const rowCls = (state: StepState) =>
    `flex items-center gap-2.5 text-sm ${state === 'pending' ? 'opacity-55' : ''}`;
  const labelCls = (state: StepState) => (state === 'done' ? 'line-through' : '');

  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border-color)' }}
      data-testid="automacoes-checklist"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-semibold text-[15px]">{t('checklist.title')}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('checklist.subtitle')} · {doneCount}/3
          </div>
        </div>
        <button
          type="button"
          className="text-xs underline"
          style={{ color: 'var(--text-muted)' }}
          onClick={onDismiss}
        >
          {t('checklist.dismiss')}
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <div className={rowCls(s1)} data-testid="checklist-step-1" data-state={s1}>
          <StepMarker state={s1} />
          <span
            className={labelCls(s1)}
            style={s1 === 'done' ? { color: 'var(--text-muted)' } : undefined}
          >
            {t('checklist.step1')}
          </span>
          {s1 === 'current' && (
            <Link
              to="/clientes"
              className="ml-auto text-xs underline"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('checklist.step1Cta')} <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
        <div className={rowCls(s2)} data-testid="checklist-step-2" data-state={s2}>
          <StepMarker state={s2} />
          <span
            className={labelCls(s2)}
            style={s2 === 'done' ? { color: 'var(--text-muted)' } : undefined}
          >
            {t('checklist.step2')}
          </span>
          {s2 === 'current' && canCreate && (
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={onCreate}>
              {t('checklist.step2Cta')} <span aria-hidden="true">→</span>
            </Button>
          )}
        </div>
        <div className={rowCls(s3)} data-testid="checklist-step-3" data-state={s3}>
          <StepMarker state={s3} />
          <span className={labelCls(s3)}>{t('checklist.step3')}</span>
          {s3 === 'current' && (
            <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('checklist.step3Hint')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
