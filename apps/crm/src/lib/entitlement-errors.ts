export type EntitlementError =
  | { kind: 'limit'; key: string; label: string }
  | { kind: 'feature'; key: string; label: string }
  | { kind: 'quota'; key: 'storage'; label: string; used?: number; quota?: number };

// PT labels for the limit_key / feature flag surfaced to users.
const LIMIT_LABELS: Record<string, string> = {
  max_clients: 'clientes',
  max_team_members: 'usuários',
  max_leads: 'leads',
  max_instagram_accounts: 'contas do Instagram',
  max_hub_tokens: 'portais do Hub',
  max_workflow_templates: 'modelos de fluxo',
  max_active_workflows_per_client: 'fluxos ativos por cliente',
  max_custom_properties_per_template: 'propriedades personalizadas',
  max_posts_per_workflow: 'posts por fluxo',
};

const FEATURE_LABELS: Record<string, string> = {
  feature_leads: 'Leads',
  feature_financial: 'Financeiro',
  feature_contracts: 'Contratos',
  feature_ideas: 'Ideias',
  feature_hub_portal: 'Portal do Cliente',
  feature_analytics_reports: 'Relatórios e Analytics',
  feature_post_scheduling: 'Agendamento de Posts',
  feature_instagram_ai: 'Análise com IA',
  feature_best_times: 'Melhores Horários',
  feature_audience_demographics: 'Demografia da Audiência',
  feature_post_tagging: 'Tags de Posts',
  feature_brand_customization: 'Personalização de Marca',
  feature_custom_properties: 'Propriedades Personalizadas',
  feature_csv_import: 'Importação CSV',
};

/** Normalizes a DB-raised message or an edge-function JSON error into an EntitlementError, or null. */
export function mapEntitlementError(err: unknown): EntitlementError | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as {
    message?: string;
    error?: string;
    feature?: string;
    used?: number;
    quota?: number;
  };

  // DB-raised PostgREST message: "plan_limit_exceeded:max_clients"
  const msg = typeof e.message === 'string' ? e.message : '';
  const limitMatch = msg.match(/plan_limit_exceeded:([a-z_]+)/);
  if (limitMatch || e.error === 'plan_limit_exceeded') {
    const key = limitMatch?.[1] ?? 'max_team_members';
    return { kind: 'limit', key, label: LIMIT_LABELS[key] ?? key };
  }
  if (e.error === 'feature_disabled' && e.feature) {
    return { kind: 'feature', key: e.feature, label: FEATURE_LABELS[e.feature] ?? e.feature };
  }
  if (e.error === 'quota_exceeded' || /quota_exceeded/.test(msg)) {
    return { kind: 'quota', key: 'storage', label: 'armazenamento', used: e.used, quota: e.quota };
  }
  return null;
}

/** User-facing PT sentence for an entitlement error. */
export function entitlementMessage(e: EntitlementError): string {
  if (e.kind === 'limit') return `Você atingiu o limite de ${e.label} do seu plano.`;
  if (e.kind === 'feature') return `O recurso "${e.label}" não está disponível no seu plano.`;
  return 'Você atingiu o limite de armazenamento do seu plano.';
}
