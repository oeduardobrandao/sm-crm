/** Dependency-free on purpose: the content modules (and the prerender scripts that
 * typecheck them) must not reach `services/billing.ts` or `lib/supabase.ts`. */
export type BillingInterval = 'month' | 'year';
