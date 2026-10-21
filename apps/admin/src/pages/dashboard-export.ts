import type { PayingWorkspace, TrialWorkspace } from '../lib/api';
import { centsToReais, isoDate, type CsvColumn } from '../lib/csv-export';
import { statusMeta } from '../lib/subscription';

export const PAYING_WORKSPACE_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Nome do dono' },
  { key: 'owner_email', label: 'E-mail do dono' },
  { key: 'owner_telefone', label: 'Telefone do dono' },
  { key: 'owner_marketing_opt_in', label: 'Aceita marketing' },
  { key: 'plan_name', label: 'Plano' },
  { key: 'status', label: 'Status' },
  { key: 'interval', label: 'Intervalo' },
  { key: 'monthly_amount_brl', label: 'Valor mensal (R$)' },
  { key: 'discount_label', label: 'Desconto' },
  { key: 'amount_source', label: 'Origem do valor' },
  { key: 'last_activity_at', label: 'Última atividade' },
];

export function buildPayingWorkspaceExportRows(
  workspaces: PayingWorkspace[],
): Record<string, string | number>[] {
  return workspaces.map((ws) => ({
    workspace_name: ws.name,
    owner_name: ws.owner_name ?? '',
    owner_email: ws.owner_email ?? '',
    owner_telefone: ws.owner_telefone ?? '',
    owner_marketing_opt_in: ws.owner_marketing_opt_in ? 'sim' : 'não',
    plan_name: ws.plan_name ?? '',
    status: statusMeta(ws.status).label,
    interval: ws.interval ?? '',
    monthly_amount_brl: centsToReais(ws.monthly_cents),
    discount_label: ws.discount_label ?? '',
    amount_source: ws.amount_source ?? '',
    last_activity_at: isoDate(ws.last_activity_at),
  }));
}

export const TRIAL_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Nome do dono' },
  { key: 'owner_email', label: 'E-mail do dono' },
  { key: 'owner_telefone', label: 'Telefone do dono' },
  { key: 'owner_marketing_opt_in', label: 'Aceita marketing' },
  { key: 'plan_name', label: 'Plano' },
  { key: 'interval', label: 'Intervalo' },
  { key: 'trial_ends_at', label: 'Fim do teste' },
  { key: 'monthly_amount_brl', label: 'MRR mensal (R$)' },
  { key: 'last_activity_at', label: 'Última atividade' },
];

export function buildTrialExportRows(trials: TrialWorkspace[]): Record<string, string | number>[] {
  return trials.map((t) => ({
    workspace_name: t.name,
    owner_name: t.owner_name ?? '',
    owner_email: t.owner_email ?? '',
    owner_telefone: t.owner_telefone ?? '',
    owner_marketing_opt_in: t.owner_marketing_opt_in ? 'sim' : 'não',
    plan_name: t.plan_name ?? '',
    interval: t.interval ?? '',
    trial_ends_at: isoDate(t.trial_ends_at),
    monthly_amount_brl: centsToReais(t.monthly_cents),
    last_activity_at: isoDate(t.last_activity_at),
  }));
}
