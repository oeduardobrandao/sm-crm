import type { WorkspaceSummary } from '../lib/api';
import { centsToReais, isoDate, toMonthlyCents, type CsvColumn } from '../lib/csv-export';
import { statusMeta, hasSubscription } from '../lib/subscription';

export const WORKSPACE_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Owner Name' },
  { key: 'owner_email', label: 'Owner Email' },
  { key: 'owner_telefone', label: 'Owner Phone' },
  { key: 'owner_marketing_opt_in', label: 'Owner Marketing Opt-in' },
  { key: 'plan_name', label: 'Plan' },
  { key: 'subscription_status', label: 'Subscription Status' },
  { key: 'billing_interval', label: 'Billing Interval' },
  { key: 'subscription_amount_brl', label: 'Subscription Amount (R$)' },
  { key: 'monthly_amount_brl', label: 'Monthly Amount (R$)' },
  { key: 'discount_label', label: 'Discount' },
  { key: 'client_count', label: 'Clients' },
  { key: 'member_count', label: 'Members' },
  { key: 'has_overrides', label: 'Has Overrides' },
  { key: 'created_at', label: 'Created' },
  { key: 'last_activity_at', label: 'Last Activity' },
];

/** Flattens WorkspaceSummary rows into the CSV shape for WORKSPACE_EXPORT_COLUMNS. */
export function buildWorkspaceExportRows(
  workspaces: WorkspaceSummary[],
): Record<string, string | number>[] {
  return workspaces.map((ws) => {
    const sub = ws.subscription;
    const hasSub = hasSubscription(sub);
    return {
      workspace_name: ws.name,
      owner_name: ws.owner?.name ?? '',
      owner_email: ws.owner?.email ?? '',
      owner_telefone: ws.owner?.telefone ?? '',
      owner_marketing_opt_in: ws.owner?.marketing_opt_in ? 'yes' : 'no',
      plan_name: ws.plan_name ?? '',
      subscription_status: hasSub ? statusMeta(sub.status).label : '',
      billing_interval: hasSub ? (sub.interval ?? '') : '',
      subscription_amount_brl: hasSub ? centsToReais(sub.amount_cents ?? null) : '',
      monthly_amount_brl: hasSub
        ? centsToReais(toMonthlyCents(sub.interval ?? null, sub.amount_cents ?? null))
        : '',
      discount_label: hasSub ? (sub.discount_label ?? '') : '',
      client_count: ws.client_count,
      member_count: ws.member_count,
      has_overrides: ws.has_overrides ? 'yes' : 'no',
      created_at: isoDate(ws.created_at),
      last_activity_at: isoDate(ws.last_activity_at),
    };
  });
}
