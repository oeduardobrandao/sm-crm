import { supabase, getUserId, getContaId } from './core';

export interface IntegracaoStatus {
  id?: number;
  user_id?: string;
  integracao_id: string;
  status: 'conectado' | 'desconectado' | 'em_breve';
  conta_id?: string;
}

const DEFAULT_INTEGRATIONS = [
  {
    integracao_id: 'meta_ads',
    label: 'Meta Ads',
    icon: 'fa-brands fa-meta',
    desc: 'Facebook & Instagram Ads',
  },
  {
    integracao_id: 'asaas',
    label: 'Asaas',
    icon: 'fa-solid fa-file-invoice-dollar',
    desc: 'Cobranças e Boletos',
  },
  {
    integracao_id: 'whatsapp',
    label: 'WhatsApp Business',
    icon: 'fa-brands fa-whatsapp',
    desc: 'Mensagens e Notificações',
  },
  {
    integracao_id: 'google_analytics',
    label: 'Google Analytics',
    icon: 'fa-brands fa-google',
    desc: 'Métricas e Relatórios',
  },
  {
    integracao_id: 'canva',
    label: 'Canva',
    icon: 'fa-solid fa-palette',
    desc: 'Design e Criativos',
  },
  {
    integracao_id: 'notion',
    label: 'Notion',
    icon: 'fa-solid fa-book',
    desc: 'Documentos e Planejamento',
  },
];

export function getIntegrationsMeta() {
  return DEFAULT_INTEGRATIONS;
}

export async function getIntegracoesStatus(): Promise<IntegracaoStatus[]> {
  const { data, error } = await supabase.from('integracoes_status').select('*');
  if (error) throw error;
  return data || [];
}

export async function toggleIntegracao(
  integracao_id: string,
  newStatus: 'conectado' | 'desconectado',
): Promise<void> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { error } = await supabase
    .from('integracoes_status')
    .upsert(
      { user_id, conta_id, integracao_id, status: newStatus },
      { onConflict: 'user_id,integracao_id' },
    );
  if (error) throw error;
}

export interface IgAccountStatus {
  revoked: boolean;
  expired: boolean;
  canPublish: boolean;
}

/**
 * Per-client Instagram account status, scoped to the given client ids. Mirrors the
 * derivation used by WorkflowDrawer's igAccountStatus so inline publish actions gate
 * identically.
 */
export async function getInstagramAccountStatuses(
  clientIds: number[],
): Promise<Map<number, IgAccountStatus>> {
  const result = new Map<number, IgAccountStatus>();
  if (clientIds.length === 0) return result;
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select('client_id, authorization_status, token_expires_at, permissions')
    .in('client_id', clientIds);
  if (error) throw error;
  const now = Date.now();
  for (const row of (data || []) as Array<{
    client_id: number | null;
    authorization_status: string | null;
    token_expires_at: string | null;
    permissions: unknown;
  }>) {
    if (row.client_id == null) continue;
    result.set(row.client_id, {
      revoked: row.authorization_status === 'revoked',
      expired:
        row.authorization_status === 'expired' ||
        (row.token_expires_at ? new Date(row.token_expires_at).getTime() < now : false),
      canPublish:
        Array.isArray(row.permissions) &&
        row.permissions.includes('instagram_business_content_publish'),
    });
  }
  return result;
}
