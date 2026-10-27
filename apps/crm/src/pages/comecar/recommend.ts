/**
 * Pure recommendation logic for the /comecar trial plan picker. No React and no
 * data fetching: the page feeds it the `plans` rows so every figure and feature
 * flag comes from the catalog, never from a literal here.
 */

import type { BillingPlan } from '@/services/billing';
import {
  isSelectableTrialPlan,
  planHasPortal,
  planHasReports,
} from '@/pages/configuracao/cobranca/plan-display';

export type ClientBucket = '1-2' | '3-5' | '6-15' | '16+';
export type TeamBucket = '1' | '2' | '3-5' | '6+';

export const CLIENT_BUCKETS: { id: ClientBucket; label: string; upper: number }[] = [
  { id: '1-2', label: '1 a 2', upper: 2 },
  { id: '3-5', label: '3 a 5', upper: 5 },
  { id: '6-15', label: '6 a 15', upper: 15 },
  { id: '16+', label: 'Mais de 15', upper: Infinity },
];

export const TEAM_BUCKETS: { id: TeamBucket; label: string; upper: number }[] = [
  { id: '1', label: 'Só eu', upper: 1 },
  { id: '2', label: '2 pessoas', upper: 2 },
  { id: '3-5', label: '3 a 5', upper: 5 },
  { id: '6+', label: '6 ou mais', upper: Infinity },
];

/** Paid, self-serve plans the trial can start on, cheapest first. */
export function trialCandidates(plans: BillingPlan[]): BillingPlan[] {
  return plans
    .filter((p) => isSelectableTrialPlan(p) && (p.price_brl ?? 0) > 0)
    .sort(
      (a, b) =>
        (a.price_brl ?? 0) - (b.price_brl ?? 0) ||
        a.sort_order - b.sort_order ||
        a.id.localeCompare(b.id),
    );
}

function fits(limit: number | null, upper: number): boolean {
  return limit === null || limit >= upper;
}

/**
 * The cheapest candidate that covers both bucket ceilings (null = unlimited).
 * When nothing covers them, the largest candidate; null when there is none.
 */
export function recommendPlan(
  plans: BillingPlan[],
  clients: ClientBucket,
  team: TeamBucket,
): BillingPlan | null {
  const candidates = trialCandidates(plans);
  if (candidates.length === 0) return null;
  const clientUpper = CLIENT_BUCKETS.find((b) => b.id === clients)?.upper ?? Infinity;
  const teamUpper = TEAM_BUCKETS.find((b) => b.id === team)?.upper ?? Infinity;
  return (
    candidates.find(
      (p) => fits(p.max_clients, clientUpper) && fits(p.max_team_members, teamUpper),
    ) ?? candidates[candidates.length - 1]
  );
}

/** "A", "A e B", "A, B e C"; the first label is capitalised, the rest lower-cased. */
function joinPtBr(labels: string[]): string {
  const [first, ...rest] = labels;
  const parts = [first, ...rest.map((l) => l.toLowerCase())];
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

function groupLabel(items: [boolean, string][], whenAll: string): string | null {
  const present = items.filter(([on]) => on).map(([, label]) => label);
  if (present.length === 0) return null;
  return present.length === items.length ? whenAll : joinPtBr(present);
}

/** What the plan unlocks, in display order, read from the plan row's flags. */
export function planUnlocks(plan: BillingPlan): string[] {
  const out: string[] = [];
  if (planHasPortal(plan)) out.push('Portal para o cliente aprovar os posts');
  if (planHasReports(plan)) {
    out.push(
      plan.feature_instagram_ai ? 'Relatórios do Instagram com IA' : 'Relatórios do Instagram',
    );
  }
  if (plan.feature_auto_sync_cron) out.push('Métricas atualizadas sozinhas');
  const money = groupLabel(
    [
      [plan.feature_financial, 'Financeiro'],
      [plan.feature_contracts, 'Contratos'],
      [plan.feature_leads, 'Leads'],
    ],
    'Financeiro, contratos e leads',
  );
  if (money) out.push(money);
  const team = groupLabel(
    [
      [plan.feature_agenda, 'Agenda'],
      [plan.feature_mensagens, 'Mensagens'],
      [plan.feature_team_chat, 'Chat da equipe'],
    ],
    'Agenda, mensagens e chat da equipe',
  );
  if (team) out.push(team);
  if (plan.feature_instagram_automation) out.push('Respostas automáticas no Instagram');
  if (plan.feature_briefing_audio) out.push('Briefing em áudio');
  return out;
}

const CLIENT_PHRASE: Record<ClientBucket, string> = {
  '1-2': '1 a 2 clientes',
  '3-5': '3 a 5 clientes',
  '6-15': '6 a 15 clientes',
  '16+': 'mais de 15 clientes',
};

const TEAM_PHRASE: Record<TeamBucket, string> = {
  '1': 'sem equipe',
  '2': 'com mais uma pessoa',
  '3-5': 'com uma equipe de 3 a 5',
  '6+': 'com uma equipe de 6 ou mais',
};

export function recommendationReason(clients: ClientBucket, team: TeamBucket): string {
  return `Pensado para quem atende ${CLIENT_PHRASE[clients]} ${TEAM_PHRASE[team]}.`;
}

/** Only the smallest answer set fits Free's 2 clients and 1 user. */
export function showFreeNote(clients: ClientBucket, team: TeamBucket): boolean {
  return clients === '1-2' && team === '1';
}

/** When the card is first charged if the trial is not cancelled: `days` after `now`. */
export function estimateFirstCharge(now: Date, days = 30): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
