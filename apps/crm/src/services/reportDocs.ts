// Serviço do relatório interativo de blocos. Geração via edge function;
// leitura direta via PostgREST com RLS (padrão getClientReports).
import { supabase } from '../lib/supabase';
import type { ReportLayout } from '../../../../supabase/functions/_shared/report-docs/layout';
import type { ReportDocSnapshot } from '../../../../supabase/functions/_shared/report-docs/snapshot';

const EDGE_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/report-docs';

export interface ReportDocumentRow {
  id: string;
  client_id: number;
  title: string;
  period_start: string;
  period_end: string;
  layout: ReportLayout;
  data_snapshot: ReportDocSnapshot | null;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  generation_error: string | null;
  created_at: string;
  updated_at: string;
}

export type ReportDocListItem = Pick<
  ReportDocumentRow,
  'id' | 'title' | 'period_start' | 'status' | 'created_at'
>;

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function generateReportDoc(clientId: number, month: string): Promise<{ id: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clientId, month }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id) {
    throw new Error(
      data?.error === 'feature_disabled'
        ? 'Seu plano não inclui relatórios.'
        : `Erro ao gerar relatório (${res.status})`,
    );
  }
  return data;
}

export async function getReportDoc(id: string): Promise<ReportDocumentRow | null> {
  const { data, error } = await supabase
    .from('report_documents')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReportDocumentRow | null) ?? null;
}

export async function listReportDocs(clientId: number): Promise<ReportDocListItem[]> {
  const { data, error } = await supabase
    .from('report_documents')
    .select('id, title, period_start, status, created_at')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ReportDocListItem[]) ?? [];
}

/** Atualiza as únicas colunas com grant de escrita para authenticated
 * (layout, title — ver migration 20260820000010). Qualquer outra coluna
 * falharia com insufficient_privilege. */
export async function updateReportDoc(
  id: string,
  patch: { layout?: ReportLayout; title?: string },
): Promise<void> {
  const { error } = await supabase.from('report_documents').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
