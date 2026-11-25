import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { BillingPlan } from '@/services/billing';
import { formatTrialDate } from '@/lib/reverseTrial';
import { formatPlanPrice, planMonthlyCents, type BillingCurrency } from '@/lib/planPrice';
import {
  CLIENT_BUCKETS,
  TEAM_BUCKETS,
  estimateFirstCharge,
  findFreePlan,
  freePlanNote,
  freePlanSummary,
  planUnlocks,
  recommendPlan,
  recommendationReason,
  showFreeNote,
  trialCandidates,
  type ClientBucket,
  type TeamBucket,
} from './recommend';

/** Shown before both questions are answered, when it is a candidate. */
const MOST_CHOSEN_ID = 'pro';

/**
 * `card_trial`: today's 30-day card trial. `reverse_running`: a reverse trial (14 days of Pro
 * without a card) is running and the first charge is on its end date. `reverse_ended`: the
 * reverse trial is over, so the charge is immediate.
 */
export type ComecarMode = 'card_trial' | 'reverse_running' | 'reverse_ended';

export interface TrialPlanPickerProps {
  plans: BillingPlan[];
  /** The workspace's billing currency (default BRL): which price column is shown. */
  currency?: BillingCurrency;
  busyPlanId: string | null;
  now: Date;
  mode?: ComecarMode;
  /** End of the running reverse trial (mode `reverse_running`). */
  trialEndsAt?: string | null;
  /** Plan shown before the questions are answered (`?recomendado=`), when it is a candidate. */
  preferredPlanId?: string | null;
  onStart(planId: string, recommendedPlanId: string): void;
  onSkip(): void;
  onShowAllPlans(): void;
  onRecommended(e: { clients: ClientBucket; team: TeamBucket; planId: string }): void;
}

/**
 * The default view of /comecar: two questions on the left, one recommended plan to try
 * free for 30 days on the right, Free one click away. Presentational: the page owns
 * checkout, analytics and navigation.
 */
export function TrialPlanPicker({
  plans,
  currency = 'brl',
  busyPlanId,
  now,
  mode = 'card_trial',
  trialEndsAt = null,
  preferredPlanId = null,
  onStart,
  onSkip,
  onShowAllPlans,
  onRecommended,
}: TrialPlanPickerProps) {
  const [clients, setClients] = useState<ClientBucket | null>(null);
  const [team, setTeam] = useState<TeamBucket | null>(null);

  const candidates = trialCandidates(plans, currency);
  const freePlan = findFreePlan(plans);
  const answered = clients !== null && team !== null;
  const plan = answered
    ? recommendPlan(plans, clients, team, currency)
    : (candidates.find((p) => p.id === preferredPlanId) ??
      candidates.find((p) => p.id === MOST_CHOSEN_ID) ??
      candidates[0] ??
      null);

  // Fired from the click handlers, not an effect, so a parent re-render (or StrictMode's
  // double effect) never reports the same recommendation twice.
  function answer(nextClients: ClientBucket | null, nextTeam: TeamBucket | null) {
    if (nextClients === clients && nextTeam === team) return;
    setClients(nextClients);
    setTeam(nextTeam);
    if (nextClients === null || nextTeam === null) return;
    const next = recommendPlan(plans, nextClients, nextTeam, currency);
    if (next) onRecommended({ clients: nextClients, team: nextTeam, planId: next.id });
  }

  const firstCharge =
    mode === 'reverse_running' && trialEndsAt
      ? formatTrialDate(trialEndsAt)
      : format(estimateFirstCharge(now), "d 'de' MMMM", { locale: ptBR });
  const price = plan ? formatPlanPrice(planMonthlyCents(plan, currency) ?? 0, currency) : '';
  // BRL keeps the literal copy; USD formats its zero ("$0").
  const zeroToday = currency === 'brl' ? 'R$ 0' : formatPlanPrice(0, currency);

  return (
    <div className="comecar-picker">
      <section className="comecar-picker__intro">
        {mode === 'reverse_running' ? (
          <Badge variant="warning" size="sm">
            Teste do Pro até {firstCharge}
          </Badge>
        ) : mode === 'card_trial' ? (
          <Badge variant="success" size="sm">
            Conta criada
          </Badge>
        ) : null}
        <h1>
          {mode === 'reverse_running'
            ? 'Continue depois do teste'
            : mode === 'reverse_ended'
              ? 'Volte para um plano pago'
              : 'Vamos montar sua conta'}
        </h1>
        <p className="comecar-picker__lead">
          {mode === 'reverse_running'
            ? 'Duas perguntas e mostramos o plano certo para continuar depois do teste.'
            : mode === 'reverse_ended'
              ? 'Duas perguntas e mostramos o plano certo para você. A cobrança é imediata: o teste grátis já foi usado.'
              : 'Duas perguntas e mostramos o plano certo para você testar de graça por 30 dias.'}
        </p>

        <fieldset className="comecar-question">
          <legend>Quantos clientes você atende hoje?</legend>
          <div className="comecar-chips">
            {CLIENT_BUCKETS.map((b) => (
              <button
                key={b.id}
                type="button"
                className="comecar-chip"
                aria-pressed={clients === b.id}
                onClick={() => answer(b.id, team)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="comecar-question">
          <legend>Quantas pessoas trabalham com você, contando você?</legend>
          <div className="comecar-chips">
            {TEAM_BUCKETS.map((b) => (
              <button
                key={b.id}
                type="button"
                className="comecar-chip"
                aria-pressed={team === b.id}
                onClick={() => answer(clients, b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="comecar-reco" aria-live="polite">
        {plan && (
          <>
            <span className="comecar-reco__label">
              {answered ? 'Recomendado para você' : 'O mais escolhido'}
            </span>
            <h2 className="comecar-reco__name">{plan.name}</h2>
            {answered && (
              <p className="comecar-reco__reason">{recommendationReason(clients, team)}</p>
            )}
            <div className="comecar-reco__limits">
              <Badge variant="neutral">
                {plan.max_clients == null
                  ? 'Clientes ilimitados'
                  : `Até ${plan.max_clients} clientes`}
              </Badge>
              <Badge variant="neutral">
                {plan.max_team_members == null
                  ? 'Usuários ilimitados'
                  : `Até ${plan.max_team_members} usuários`}
              </Badge>
            </div>
            <ul className="comecar-card__features">
              {planUnlocks(plan).map((f) => (
                <li key={f}>
                  <Check size={14} aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
            {answered && showFreeNote(clients, team) && (
              <p className="comecar-reco__note">{freePlanNote(freePlan, plan.name)}</p>
            )}
            <button
              type="button"
              className="comecar-cta"
              onClick={() => onStart(plan.id, plan.id)}
              disabled={busyPlanId !== null}
            >
              {busyPlanId === plan.id
                ? 'Aguarde…'
                : mode === 'reverse_running'
                  ? `Continuar no ${plan.name} depois do teste`
                  : mode === 'reverse_ended'
                    ? `Assinar o ${plan.name}`
                    : `Começar 30 dias grátis do ${plan.name}`}
            </button>
            {mode === 'reverse_running' ? (
              <p className="comecar-reco__fine">
                {zeroToday} hoje. Primeira cobrança de {price}/mês em {firstCharge}, no fim do
                teste. Cancele quando quiser.
              </p>
            ) : mode === 'reverse_ended' ? (
              <p className="comecar-reco__fine">
                Cobrança de {price}/mês a partir de hoje. Cancele quando quiser.
              </p>
            ) : (
              <p className="comecar-reco__fine">
                {zeroToday} hoje. Primeira cobrança de {price}/mês por volta de {firstCharge}, só se
                você continuar. Avisamos por e-mail 7 dias antes, com o valor e a data exatos.
              </p>
            )}
            <button type="button" className="comecar-link" onClick={onShowAllPlans}>
              Ver todos os planos
            </button>
          </>
        )}
      </section>

      {/* After the card in the DOM, so on a phone the trial comes before the Free exit;
          the grid places it under the questions on wider screens. */}
      <div className="comecar-picker__free">
        <button type="button" className="comecar-link" onClick={onSkip}>
          {mode === 'reverse_running' ? 'Decidir depois' : 'Continuar no Free'}
        </button>
        {mode !== 'reverse_running' && <p>{freePlanSummary(freePlan)}</p>}
      </div>
    </div>
  );
}
