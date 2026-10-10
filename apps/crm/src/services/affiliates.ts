/**
 * Programa de afiliados: cliente da edge function pública `affiliate-public` (sem sessão; o
 * painel se autentica pelo token do link enviado por e-mail) e leitura da tabela de comissões
 * por plano (`affiliate_commission_rules`, leitura pública).
 */
import { supabase } from '../lib/supabase';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-public`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type ReferralSituacao = 'cadastrado' | 'trial' | 'ativo' | 'outro_meio' | 'cancelado';
export type CommissionSituacao = 'pendente' | 'disponivel' | 'estornada' | 'contestada';
export type PayoutStatus = 'pending' | 'paid' | 'failed';

export interface AffiliateDashboard {
  affiliate: {
    nome: string;
    email: string;
    code: string;
    status: 'active' | 'suspended';
    stripe: { connected: boolean; details_submitted: boolean; transfers_active: boolean };
  };
  min_payout_cents: number;
  summary: {
    referrals_count: number;
    trialing_count: number;
    paying_count: number;
    pending_cents: number;
    available_cents: number;
    paid_out_cents: number;
    lifetime_cents: number;
  };
  referrals: Array<{ numero: number; created_at: string; situacao: ReferralSituacao }>;
  commissions: Array<{
    paid_at: string;
    invoice_amount_cents: number;
    plan_id: string | null;
    rate_bps: number;
    commission_cents: number;
    net_cents: number;
    available_at: string;
    situacao: CommissionSituacao;
  }>;
  payouts: Array<{
    created_at: string;
    paid_at: string | null;
    amount_cents: number;
    status: PayoutStatus;
  }>;
}

export interface CommissionRule {
  plan_id: string;
  rate_bps: number;
  months: number;
}

export class AffiliateApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AffiliateApiError';
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new AffiliateApiError(
      data.error || 'Não foi possível concluir. Tente de novo.',
      res.status,
    );
  }
  return data as T;
}

export function affiliateSignup(input: {
  nome: string;
  email: string;
  telefone?: string;
  aceite_termos: boolean;
}) {
  return call<{ ok: true }>({ action: 'signup', ...input });
}

export function affiliateSendLink(email: string) {
  return call<{ ok: true }>({ action: 'send_link', email });
}

export function getAffiliateDashboard(token: string) {
  return call<AffiliateDashboard>({ action: 'dashboard', token });
}

/** Link de onboarding da conta Express no Stripe (cria a conta na primeira vez). */
export function startAffiliateStripeConnect(token: string) {
  return call<{ url: string }>({ action: 'connect_start', token });
}

/** Link de acesso ao painel Express (repasses e dados bancários). */
export function openAffiliateStripeDashboard(token: string) {
  return call<{ url: string }>({ action: 'connect_dashboard', token });
}

/** Tabela de comissões por plano. RLS: leitura pública. */
export async function listCommissionRules(): Promise<CommissionRule[]> {
  const { data, error } = await supabase
    .from('affiliate_commission_rules')
    .select('plan_id, rate_bps, months');
  if (error) throw new Error(error.message);
  return (data ?? []) as CommissionRule[];
}

/** Centavos → "R$ 1.234,56". */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
