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

// 'system' é a sentinela explícita do "Padrão do sistema" (edge function
// client-id.ts): generateReportDoc envia o literal no body em vez de omitir.
// Omitido continua significando "usa o template is_default do workspace" --
// o bug original (achado de review externo, PR #379) era o dialog omitir
// para "Padrão do sistema" também, o que o servidor lia como "usa o default".
export async function generateReportDoc(
  clientId: number,
  month: string,
  templateId?: string,
): Promise<{ id: string }> {
  const headers = await getAuthHeaders();
  const body: { clientId: number; month: string; templateId?: string } = { clientId, month };
  if (templateId) body.templateId = templateId;
  const res = await fetch(`${EDGE_URL}/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.id) {
    throw new Error(
      data?.error === 'feature_disabled'
        ? 'Seu plano não inclui relatórios.'
        : data?.error === 'invalid_template'
          ? 'Template inválido. Tente outro ou o layout padrão.'
          : `Erro ao gerar relatório (${res.status})`,
    );
  }
  return data;
}

/** POST /:id/pdf (spec §5/§9). 503 quando o Gotenberg não está configurado
 * neste ambiente (REPORT_PRINT_BASE/GOTENBERG_URL/INTERNAL_FUNCTION_SECRET
 * ausentes); 502 quando a conversão falhou. */
export async function exportReportPdf(id: string): Promise<{ url: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}/${id}/pdf`, { method: 'POST', headers });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    throw new Error(
      data?.error === 'pdf_not_configured'
        ? 'Export de PDF não configurado neste ambiente.'
        : data?.error === 'pdf_failed'
          ? 'Não foi possível gerar o PDF. Tente novamente.'
          : `Erro ao exportar PDF (${res.status})`,
    );
  }
  return data;
}

/** POST /:id/refresh-data: re-gera o data_snapshot mantendo o layout em edição. */
export async function refreshReportDoc(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}/${id}/refresh-data`, { method: 'POST', headers });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(`Erro ao atualizar dados (${res.status})`);
  }
}

/** DELETE /:id: remove o documento e o PDF exportado (edge function, spec §5). */
export async function deleteReportDoc(id: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}/${id}`, { method: 'DELETE', headers });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(`Erro ao excluir relatório (${res.status})`);
  }
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
 * falharia com insufficient_privilege.
 *
 * `.select('id')` + checagem de linhas é obrigatório: um `.update().eq()` sem
 * `.select()` filtrado pela RLS (ex.: workspace ativo trocou em outra aba)
 * devolve `error: null` com 0 linhas afetadas — um no-op silencioso que o
 * indicador "Salvando…" reportaria como sucesso (achado I3). O throw aqui
 * entra na mesma retenção-e-retry do useLayoutAutosave. */
export async function updateReportDoc(
  id: string,
  patch: { layout?: ReportLayout; title?: string },
): Promise<void> {
  const { data, error } = await supabase
    .from('report_documents')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('report_document não encontrado para atualização');
  }
}
