import type { WorkspaceSummary } from '../lib/api';
import { centsToReais, isoDate, toMonthlyCents, type CsvColumn } from '../lib/csv-export';
import { statusMeta, hasSubscription, providerLabel } from '../lib/subscription';

export const WORKSPACE_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Nome do dono' },
  { key: 'owner_email', label: 'E-mail do dono' },
  { key: 'owner_telefone', label: 'Telefone do dono' },
  { key: 'owner_marketing_opt_in', label: 'Aceita marketing' },
  { key: 'plan_name', label: 'Plano' },
  { key: 'subscription_status', label: 'Status da assinatura' },
  { key: 'provider', label: 'Provedor' },
  { key: 'billing_interval', label: 'Intervalo' },
  { key: 'subscription_amount_brl', label: 'Valor da assinatura (R$)' },
  { key: 'monthly_amount_brl', label: 'Valor mensal (R$)' },
  { key: 'discount_label', label: 'Desconto' },
  { key: 'client_count', label: 'Clientes' },
  { key: 'member_count', label: 'Membros' },
  { key: 'has_overrides', label: 'Tem overrides' },
  { key: 'created_at', label: 'Criado em' },
  { key: 'last_activity_at', label: 'Última atividade' },
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
      owner_marketing_opt_in: ws.owner?.marketing_opt_in ? 'sim' : 'não',
      plan_name: ws.plan_name ?? '',
      subscription_status: hasSub ? statusMeta(sub.status).label : '',
      provider: hasSub && sub.provider ? providerLabel(sub.provider) : '',
      billing_interval: hasSub ? (sub.interval ?? '') : '',
      subscription_amount_brl: hasSub ? centsToReais(sub.amount_cents ?? null) : '',
      monthly_amount_brl: hasSub
        ? centsToReais(toMonthlyCents(sub.interval ?? null, sub.amount_cents ?? null))
        : '',
      discount_label: hasSub ? (sub.discount_label ?? '') : '',
      client_count: ws.client_count,
      member_count: ws.member_count,
      has_overrides: ws.has_overrides ? 'sim' : 'não',
      created_at: isoDate(ws.created_at),
      last_activity_at: isoDate(ws.last_activity_at),
    };
  });
}
