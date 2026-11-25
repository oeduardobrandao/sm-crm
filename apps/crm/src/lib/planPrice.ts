/**
 * Plan prices in the workspace's billing currency. `plans.price_brl*` and `plans.price_usd*`
 * are stored in cents; `workspaces.billing_currency` picks which pair a workspace pays.
 */

export type BillingCurrency = 'brl' | 'usd';

const NATIVE_LOCALE: Record<BillingCurrency, string> = { brl: 'pt-BR', usd: 'en-US' };

/** Only a recognised 'usd' is USD; null, unknown or missing reads as BRL. */
export function toBillingCurrency(value: unknown): BillingCurrency {
  return typeof value === 'string' && value.toLowerCase() === 'usd' ? 'usd' : 'brl';
}

/**
 * `cents` as a currency string: `pt-BR`/BRL ("R$ 99,90") or `en-US`/USD ("$29.00"). Zero
 * renders without decimals ("R$ 0", "$0"). `locale` overrides the currency's own locale, for
 * screens that already format BRL in the UI language.
 */
export function formatPlanPrice(cents: number, currency: BillingCurrency, locale?: string): string {
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: currency.toUpperCase(),
  };
  if (cents === 0) {
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = 0;
  }
  return (cents / 100).toLocaleString(locale ?? NATIVE_LOCALE[currency], options);
}

export interface PlanPrices {
  price_brl: number | null;
  price_brl_annual: number | null;
  price_usd?: number | null;
  price_usd_annual?: number | null;
}

/** Monthly price in cents for `currency`, or null when that column is not set. */
export function planMonthlyCents(plan: PlanPrices, currency: BillingCurrency): number | null {
  return (currency === 'usd' ? plan.price_usd : plan.price_brl) ?? null;
}

/** Annual price in cents for `currency`, or null when that column is not set. */
export function planAnnualCents(plan: PlanPrices, currency: BillingCurrency): number | null {
  return (currency === 'usd' ? plan.price_usd_annual : plan.price_brl_annual) ?? null;
}
