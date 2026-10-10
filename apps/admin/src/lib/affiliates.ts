/** 3000 → "30%", 1250 → "12,5%". */
export function formatRateBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toLocaleString('pt-BR')}%`;
}

/** "30" / "12,5" / "12.5%" → basis points (inteiro 0..10000); null se inválido. */
export function parsePercentToBps(raw: string): number | null {
  const cleaned = raw.replace(/[%\s]/g, '').replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps >= 0 && bps <= 10_000 ? bps : null;
}

export type StripeConnectState = 'none' | 'onboarding' | 'review' | 'ready';

/** Situação da conta Express do afiliado a partir dos flags espelhados. */
export function stripeConnectState(a: {
  stripe_account_id: string | null;
  stripe_details_submitted: boolean;
  stripe_transfers_active: boolean;
}): StripeConnectState {
  if (!a.stripe_account_id) return 'none';
  if (a.stripe_transfers_active) return 'ready';
  return a.stripe_details_submitted ? 'review' : 'onboarding';
}

export const STRIPE_STATE_LABEL: Record<StripeConnectState, string> = {
  none: 'Sem conta Stripe',
  onboarding: 'Cadastro no Stripe incompleto',
  review: 'Stripe em análise',
  ready: 'Recebe pelo Stripe',
};
