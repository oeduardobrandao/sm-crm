/**
 * Pure recommendation logic for the /comecar trial plan picker. No React and no
 * data fetching: the page feeds it the `plans` rows so every figure and feature
 * flag comes from the catalog, never from a literal here.
 */

import type { BillingPlan } from '@/services/billing';
import { planMonthlyCents, type BillingCurrency } from '@/lib/planPrice';
import {
  isSelectableTrialPlan,
  planHasPortal,
  planHasReports,
} from '@/pages/configuracao/cobranca/plan-display';

/** Copy language for the sentence builders below. Portuguese is the default and unchanged. */
export type ComecarLang = 'pt' | 'en';

export type ClientBucket = '1-2' | '3-5' | '6-15' | '16+';
export type TeamBucket = '1' | '2' | '3-5' | '6+';

interface Bucket<T> {
  id: T;
  label: string;
  labelEn: string;
  upper: number;
}

export const CLIENT_BUCKETS: Bucket<ClientBucket>[] = [
  { id: '1-2', label: '1 a 2', labelEn: '1 to 2', upper: 2 },
  { id: '3-5', label: '3 a 5', labelEn: '3 to 5', upper: 5 },
  { id: '6-15', label: '6 a 15', labelEn: '6 to 15', upper: 15 },
  { id: '16+', label: 'Mais de 15', labelEn: 'More than 15', upper: Infinity },
];

export const TEAM_BUCKETS: Bucket<TeamBucket>[] = [
  { id: '1', label: 'Só eu', labelEn: 'Just me', upper: 1 },
  { id: '2', label: '2 pessoas', labelEn: '2 people', upper: 2 },
  { id: '3-5', label: '3 a 5', labelEn: '3 to 5', upper: 5 },
  { id: '6+', label: '6 ou mais', labelEn: '6 or more', upper: Infinity },
];

export function bucketLabel(bucket: { label: string; labelEn: string }, lang: ComecarLang): string {
  return lang === 'en' ? bucket.labelEn : bucket.label;
}

/** Paid, self-serve plans the trial can start on, cheapest first, priced in `currency`. */
export function trialCandidates(
  plans: BillingPlan[],
  currency: BillingCurrency = 'brl',
): BillingPlan[] {
  const monthly = (p: BillingPlan) => planMonthlyCents(p, currency) ?? 0;
  return plans
    .filter((p) => isSelectableTrialPlan(p, currency) && monthly(p) > 0)
    .sort(
      (a, b) => monthly(a) - monthly(b) || a.sort_order - b.sort_order || a.id.localeCompare(b.id),
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
  currency: BillingCurrency = 'brl',
): BillingPlan | null {
  const candidates = trialCandidates(plans, currency);
  if (candidates.length === 0) return null;
  const clientUpper = CLIENT_BUCKETS.find((b) => b.id === clients)?.upper ?? Infinity;
  const teamUpper = TEAM_BUCKETS.find((b) => b.id === team)?.upper ?? Infinity;
  return (
    candidates.find(
      (p) => fits(p.max_clients, clientUpper) && fits(p.max_team_members, teamUpper),
    ) ?? candidates[candidates.length - 1]
  );
}

/** "A", "A e B", "A, B e C" ("A, B and C"); the first label is capitalised, the rest lower-cased. */
function joinLabels(labels: string[], lang: ComecarLang): string {
  const [first, ...rest] = labels;
  const parts = [first, ...rest.map((l) => l.toLowerCase())];
  if (parts.length === 1) return parts[0];
  const and = lang === 'en' ? 'and' : 'e';
  return `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}`;
}

function groupLabel(items: [boolean, string][], whenAll: string, lang: ComecarLang): string | null {
  const present = items.filter(([on]) => on).map(([, label]) => label);
  if (present.length === 0) return null;
  return present.length === items.length ? whenAll : joinLabels(present, lang);
}

const UNLOCK_COPY = {
  pt: {
    portal: 'Portal para o cliente aprovar os posts',
    reportsAi: 'Relatórios do Instagram com IA',
    reports: 'Relatórios do Instagram',
    autoSync: 'Métricas atualizadas sozinhas',
    financial: 'Financeiro',
    contracts: 'Contratos',
    leads: 'Leads',
    moneyAll: 'Financeiro, contratos e leads',
    agenda: 'Agenda',
    messages: 'Mensagens',
    teamChat: 'Chat da equipe',
    teamAll: 'Agenda, mensagens e chat da equipe',
    automation: 'Respostas automáticas no Instagram',
    briefingAudio: 'Briefing em áudio',
  },
  en: {
    portal: 'Client portal to approve posts',
    reportsAi: 'Instagram reports with AI',
    reports: 'Instagram reports',
    autoSync: 'Metrics that update on their own',
    financial: 'Finance',
    contracts: 'Contracts',
    leads: 'Leads',
    moneyAll: 'Finance, contracts and leads',
    agenda: 'Calendar',
    messages: 'Messages',
    teamChat: 'Team chat',
    teamAll: 'Calendar, messages and team chat',
    automation: 'Instagram auto-replies',
    briefingAudio: 'Audio briefs',
  },
} as const;

/** What the plan unlocks, in display order, read from the plan row's flags. */
export function planUnlocks(plan: BillingPlan, lang: ComecarLang = 'pt'): string[] {
  const c = UNLOCK_COPY[lang];
  const out: string[] = [];
  if (planHasPortal(plan)) out.push(c.portal);
  if (planHasReports(plan)) out.push(plan.feature_instagram_ai ? c.reportsAi : c.reports);
  if (plan.feature_auto_sync_cron) out.push(c.autoSync);
  const money = groupLabel(
    [
      [plan.feature_financial, c.financial],
      [plan.feature_contracts, c.contracts],
      [plan.feature_leads, c.leads],
    ],
    c.moneyAll,
    lang,
  );
  if (money) out.push(money);
  const team = groupLabel(
    [
      [plan.feature_agenda, c.agenda],
      [plan.feature_mensagens, c.messages],
      [plan.feature_team_chat, c.teamChat],
    ],
    c.teamAll,
    lang,
  );
  if (team) out.push(team);
  if (plan.feature_instagram_automation) out.push(c.automation);
  if (plan.feature_briefing_audio) out.push(c.briefingAudio);
  return out;
}

const CLIENT_PHRASE: Record<ComecarLang, Record<ClientBucket, string>> = {
  pt: {
    '1-2': '1 a 2 clientes',
    '3-5': '3 a 5 clientes',
    '6-15': '6 a 15 clientes',
    '16+': 'mais de 15 clientes',
  },
  en: {
    '1-2': '1 to 2 clients',
    '3-5': '3 to 5 clients',
    '6-15': '6 to 15 clients',
    '16+': 'more than 15 clients',
  },
};

const TEAM_PHRASE: Record<ComecarLang, Record<TeamBucket, string>> = {
  pt: {
    '1': 'sem equipe',
    '2': 'com mais uma pessoa',
    '3-5': 'com uma equipe de 3 a 5',
    '6+': 'com uma equipe de 6 ou mais',
  },
  en: {
    '1': 'on their own',
    '2': 'with one more person',
    '3-5': 'with a team of 3 to 5',
    '6+': 'with a team of 6 or more',
  },
};

export function recommendationReason(
  clients: ClientBucket,
  team: TeamBucket,
  lang: ComecarLang = 'pt',
): string {
  const client = CLIENT_PHRASE[lang][clients];
  const crew = TEAM_PHRASE[lang][team];
  return lang === 'en'
    ? `Built for agencies serving ${client} ${crew}.`
    : `Pensado para quem atende ${client} ${crew}.`;
}

/** Only the smallest answer set fits Free's 2 clients and 1 user. */
export function showFreeNote(clients: ClientBucket, team: TeamBucket): boolean {
  return clients === '1-2' && team === '1';
}

/** The Free row of the catalog, if the page received one. */
export function findFreePlan(plans: BillingPlan[]): BillingPlan | null {
  return plans.find((p) => p.id === 'free') ?? null;
}

function clientsPhrase(max: number | null, lang: ComecarLang): string {
  if (lang === 'en') {
    if (max === null) return 'unlimited clients';
    return max === 1 ? '1 client' : `${max} clients`;
  }
  if (max === null) return 'clientes ilimitados';
  return max === 1 ? '1 cliente' : `${max} clientes`;
}

function teamPhrase(max: number | null, lang: ComecarLang): string {
  if (lang === 'en') {
    if (max === null) return 'unlimited users';
    return max <= 1 ? 'just you' : `up to ${max} people`;
  }
  if (max === null) return 'usuários ilimitados';
  return max <= 1 ? 'só você' : `até ${max} pessoas`;
}

/** "A", "A e B", "A, B e C" ("A, B and C"), already lower-case. */
function joinAnd(parts: string[], lang: ComecarLang): string {
  if (parts.length <= 1) return parts.join('');
  const and = lang === 'en' ? 'and' : 'e';
  return `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}`;
}

const FREE_COPY = {
  pt: {
    noFree: 'Plano gratuito, com limites menores e menos recursos.',
    portal: 'portal de aprovação',
    reports: 'relatórios',
    autoSync: 'métricas automáticas',
    without: (missing: string[]) => `sem ${missing.join(' nem ')}`,
    tail: (name: string) => `Teste o ${name} e decida depois.`,
    noFreeNote: (tail: string) => `O Free também serve para começar, com limites menores. ${tail}`,
    covers: (clients: string) => `O Free também cobre ${clients}`,
    butWithout: (covers: string, missing: string, tail: string) =>
      `${covers}, mas sem ${missing}. ${tail}`,
  },
  en: {
    noFree: 'Free plan, with lower limits and fewer features.',
    portal: 'approval portal',
    reports: 'reports',
    autoSync: 'automatic metrics',
    without: (missing: string[]) => `no ${missing.join(' or ')}`,
    tail: (name: string) => `Try ${name} and decide later.`,
    noFreeNote: (tail: string) => `Free also works to get started, with lower limits. ${tail}`,
    covers: (clients: string) => `Free also covers ${clients}`,
    butWithout: (covers: string, missing: string, tail: string) =>
      `${covers}, but without ${missing}. ${tail}`,
  },
};

/**
 * The line under "Continuar no Free", read from the Free row: "2 clientes, só você, sem
 * portal de aprovação nem relatórios." With no Free row it states no plan figure at all.
 */
export function freePlanSummary(free: BillingPlan | null, lang: ComecarLang = 'pt'): string {
  const c = FREE_COPY[lang];
  if (!free) return c.noFree;
  const missing = [!planHasPortal(free) && c.portal, !planHasReports(free) && c.reports].filter(
    (m): m is string => Boolean(m),
  );
  const parts = [clientsPhrase(free.max_clients, lang), teamPhrase(free.max_team_members, lang)];
  if (missing.length > 0) parts.push(c.without(missing));
  return `${parts.join(', ')}.`;
}

/**
 * The note shown when the answers would fit Free, read from the Free row: "O Free também
 * cobre 2 clientes, mas sem portal de aprovação, relatórios e métricas automáticas. Teste o
 * Start e decida depois." With no Free row it states no plan figure at all.
 */
export function freePlanNote(
  free: BillingPlan | null,
  recommendedName: string,
  lang: ComecarLang = 'pt',
): string {
  const c = FREE_COPY[lang];
  const tail = c.tail(recommendedName);
  if (!free) return c.noFreeNote(tail);
  const missing = [
    !planHasPortal(free) && c.portal,
    !planHasReports(free) && c.reports,
    !free.feature_auto_sync_cron && c.autoSync,
  ].filter((m): m is string => Boolean(m));
  const covers = c.covers(clientsPhrase(free.max_clients, lang));
  return missing.length > 0
    ? c.butWithout(covers, joinAnd(missing, lang), tail)
    : `${covers}. ${tail}`;
}

/** When the card is first charged if the trial is not cancelled: `days` after `now`. */
export function estimateFirstCharge(now: Date, days = 30): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
