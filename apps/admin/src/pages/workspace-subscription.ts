/**
 * Pure formatters for the Pagar.me block of the workspace detail's subscription card.
 * No JSX and no data fetching, so they are unit-tested without rendering the page
 * (same pattern as plan-form.ts and workspace-events.ts).
 */
import { statusMeta, type PagarmeDrift, type PagarmeLiveCard } from '../lib/subscription';

/** ISO timestamp → "dd/MM/yyyy" (pt-BR). "—" for null, empty or unparsable input. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** "visa" + "4242" + 12/2028 → "Visa •••• 4242 · 12/28". Missing parts are dropped; nothing → "—". */
export function formatCard(card: PagarmeLiveCard | null | undefined): string {
  if (!card) return '—';
  const head: string[] = [];
  const brand = card.brand?.trim();
  if (brand) head.push(capitalize(brand));
  if (card.last4) head.push(`•••• ${card.last4}`);
  const expiry =
    card.exp_month != null && card.exp_year != null
      ? `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}`
      : null;
  const parts = [head.join(' '), expiry].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : '—';
}

/** One line per divergent field between the mirror and the live read; empty when in sync. */
export function describeDrift(drift: PagarmeDrift | null | undefined): string[] {
  if (!drift) return [];
  const lines: string[] = [];
  if (drift.status) {
    lines.push(
      `Status: espelho ${statusMeta(drift.status.mirror).label}, Pagar.me ${statusMeta(drift.status.live).label}`,
    );
  }
  if (drift.period) {
    lines.push(
      `Período: espelho ${formatDay(drift.period.mirror)}, Pagar.me ${formatDay(drift.period.live)}`,
    );
  }
  return lines;
}
