import type { PayingWorkspace, TrialWorkspace } from '../lib/api';
import { centsToReais, isoDate, type CsvColumn } from '../lib/csv-export';
import { statusMeta } from '../lib/subscription';

export const PAYING_WORKSPACE_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Owner Name' },
  { key: 'owner_email', label: 'Owner Email' },
  { key: 'owner_telefone', label: 'Owner Phone' },
  { key: 'owner_marketing_opt_in', label: 'Owner Marketing Opt-in' },
  { key: 'plan_name', label: 'Plan' },
  { key: 'status', label: 'Status' },
  { key: 'interval', label: 'Billing Interval' },
  { key: 'monthly_amount_brl', label: 'Monthly Amount (R$)' },
  { key: 'discount_label', label: 'Discount' },
  { key: 'amount_source', label: 'Amount Source' },
];

export function buildPayingWorkspaceExportRows(
  workspaces: PayingWorkspace[],
): Record<string, string | number>[] {
  return workspaces.map((ws) => ({
    workspace_name: ws.name,
    owner_name: ws.owner_name ?? '',
    owner_email: ws.owner_email ?? '',
    owner_telefone: ws.owner_telefone ?? '',
    owner_marketing_opt_in: ws.owner_marketing_opt_in ? 'yes' : 'no',
    plan_name: ws.plan_name ?? '',
    status: statusMeta(ws.status).label,
    interval: ws.interval ?? '',
    monthly_amount_brl: centsToReais(ws.monthly_cents),
    discount_label: ws.discount_label ?? '',
    amount_source: ws.amount_source ?? '',
  }));
}

export const TRIAL_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Owner Name' },
  { key: 'owner_email', label: 'Owner Email' },
  { key: 'owner_telefone', label: 'Owner Phone' },
  { key: 'owner_marketing_opt_in', label: 'Owner Marketing Opt-in' },
  { key: 'plan_name', label: 'Plan' },
  { key: 'interval', label: 'Billing Interval' },
  { key: 'trial_ends_at', label: 'Trial Ends' },
  { key: 'monthly_amount_brl', label: 'Expected Monthly Amount (R$)' },
];

export function buildTrialExportRows(trials: TrialWorkspace[]): Record<string, string | number>[] {
  return trials.map((t) => ({
    workspace_name: t.name,
    owner_name: t.owner_name ?? '',
    owner_email: t.owner_email ?? '',
    owner_telefone: t.owner_telefone ?? '',
    owner_marketing_opt_in: t.owner_marketing_opt_in ? 'yes' : 'no',
    plan_name: t.plan_name ?? '',
    interval: t.interval ?? '',
    trial_ends_at: isoDate(t.trial_ends_at),
    monthly_amount_brl: centsToReais(t.monthly_cents),
  }));
}
