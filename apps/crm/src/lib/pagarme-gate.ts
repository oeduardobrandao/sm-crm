// The 12x rollout gate: per-plan admin checkbox AND the tokenization public key present in
// this environment. Both off = today's Stripe-annual behavior, byte-identical.
export function isPagarme12xEnabled(
  plan: { pagarme_12x_enabled?: boolean | null } | null | undefined,
): boolean {
  return Boolean(plan?.pagarme_12x_enabled) && Boolean(import.meta.env.VITE_PAGARME_PUBLIC_KEY);
}
