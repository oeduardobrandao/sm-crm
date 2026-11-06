import { FEATURE_FLAG_KEYS, type Plan } from '../../lib/api';

/** "R$ 97" for whole reais, "R$ 99,90" otherwise. */
export function formatBrl(centavos: number): string {
  const reais = centavos / 100;
  return `R$ ${reais.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(reais) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatStorage(bytes: number | null): string {
  if (bytes == null) return '∞';
  const mb = bytes / 1048576;
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

function count(value: number | null, singular: string, plural: string): string {
  return `${value ?? '∞'} ${value === 1 ? singular : plural}`;
}

/** The four headline limits, in the order the cards and rows show them. */
export function planLimits(plan: Plan): string[] {
  return [
    count(plan.max_clients, 'cliente', 'clientes'),
    count(plan.max_team_members, 'membro', 'membros'),
    `${plan.max_instagram_accounts ?? '∞'} Instagram`,
    formatStorage(plan.storage_quota_bytes),
  ];
}

export function enabledFeatureCount(plan: Plan): number {
  return FEATURE_FLAG_KEYS.filter((k) => plan[k]).length;
}

export function featureSummary(plan: Plan): string {
  return `${enabledFeatureCount(plan)} de ${FEATURE_FLAG_KEYS.length} funcionalidades`;
}

export interface PriceLine {
  /** "R$ 297", "Grátis" or "Sem preço". */
  main: string;
  /** "/mês · R$ 2.970/ano", empty when there is no recurring price. */
  suffix: string;
}

export function planPrice(plan: Plan): PriceLine {
  if (plan.price_brl == null) return { main: 'Sem preço', suffix: '' };
  if (plan.price_brl === 0) return { main: 'Grátis', suffix: '' };
  const annual = plan.price_brl_annual != null ? ` · ${formatBrl(plan.price_brl_annual)}/ano` : '';
  return { main: formatBrl(plan.price_brl), suffix: `/mês${annual}` };
}

export function workspaceCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'workspace' : 'workspaces'}`;
}

export function plansSummary(plans: Plan[]): string {
  const workspaces = plans.reduce((sum, p) => sum + p.workspace_count, 0);
  return `${plans.length} ${plans.length === 1 ? 'plano' : 'planos'} · ${workspaceCountLabel(workspaces)}`;
}
