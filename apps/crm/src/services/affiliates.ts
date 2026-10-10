/**
 * Cliente da edge function pública `affiliate-public` (programa de afiliados). Sem sessão:
 * o painel se autentica pelo token do link enviado por e-mail.
 */

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-public`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';
export type ReferralSituacao = 'cadastrado' | 'trial' | 'ativo' | 'outro_meio' | 'cancelado';
export type CommissionSituacao = 'pendente' | 'disponivel' | 'estornada' | 'contestada';

export interface AffiliateDashboard {
  affiliate: {
    nome: string;
    email: string;
    code: string;
    status: 'active' | 'suspended';
    commission_rate_bps: number;
    pix_key_type: PixKeyType | null;
    pix_key: string | null;
    documento_mascarado: string | null;
    titular_nome: string | null;
  };
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
    commission_cents: number;
    net_cents: number;
    available_at: string;
    situacao: CommissionSituacao;
  }>;
  payouts: Array<{ paid_at: string; amount_cents: number; method: string }>;
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

export function updateAffiliatePayout(
  token: string,
  input: { pix_key_type: PixKeyType; pix_key: string; documento?: string; titular_nome: string },
) {
  return call<{ ok: true }>({ action: 'update_payout', token, ...input });
}

/** Centavos → "R$ 1.234,56". */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
