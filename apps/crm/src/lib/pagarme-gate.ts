// The 12x rollout gate: per-plan admin checkbox AND the tokenization public key present in
// this environment AND a positive installment price configured on the plan. All three off =
// today's Stripe-annual behavior, byte-identical. A plan with the checkbox on but no (or a
// non-positive) pagarme_installment_cents is misconfigured and falls back to Stripe-only
// everywhere, rather than surfacing a 12x price of R$ 0,00.
export function isPagarme12xEnabled(
  plan:
    | { pagarme_12x_enabled?: boolean | null; pagarme_installment_cents?: number | null }
    | null
    | undefined,
  workspaceCurrency?: 'brl' | 'usd',
): boolean {
  // Pagar.me is Brazil-only: a USD workspace never sees the 12x UI.
  if (workspaceCurrency === 'usd') return false;
  return (
    Boolean(plan?.pagarme_12x_enabled) &&
    Boolean(import.meta.env.VITE_PAGARME_PUBLIC_KEY) &&
    (plan?.pagarme_installment_cents ?? 0) > 0
  );
}
