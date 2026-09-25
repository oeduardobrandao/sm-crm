// CRUD de templates do relatório de blocos: PostgREST direto com RLS
// (precedente briefing_templates em store/hub.ts). Default SÓ pela RPC
// atômica set_default_report_template (índice único parcial no banco).
import { supabase } from '../lib/supabase';
import { getContaId } from '../store/core';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import { buildDefaultLayout } from '../../../../supabase/functions/_shared/report-docs/default-layout.ts';
import { stripAiTextForTemplate } from '../pages/relatorio-editor/templateOps';

export interface ReportTemplateRow {
  id: string;
  name: string;
  layout: ReportLayout;
  is_default: boolean;
  created_at: string;
}

const TEMPLATE_COLUMNS = 'id, name, layout, is_default, created_at';

/** Nome do layout embutido (não é uma linha do banco). */
export const SYSTEM_TEMPLATE_NAME = 'Padrão do sistema';

// Update/delete filtrados por RLS respondem 200 com zero linhas quando o
// workspace ativo muda ou o acesso some. Sem pedir o id de volta, o autosave
// marcaria como salvo algo que não persistiu (mesmo contrato de
// updateReportDoc).
function assertTouched(data: unknown[] | null): void {
  if (!data || data.length === 0) throw new Error('Modelo não encontrado');
}

export async function listReportTemplates(): Promise<ReportTemplateRow[]> {
  const { data, error } = await supabase
    .from('report_templates')
    .select(TEMPLATE_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ReportTemplateRow[]) ?? [];
}

export async function createReportTemplate(
  name: string,
  layout: ReportLayout,
): Promise<ReportTemplateRow> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('report_templates')
    .insert({ conta_id, name, layout })
    .select(TEMPLATE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as ReportTemplateRow;
}

export async function deleteReportTemplate(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('report_templates')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  assertTouched(data);
}

export async function getReportTemplate(id: string): Promise<ReportTemplateRow | null> {
  const { data, error } = await supabase
    .from('report_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReportTemplateRow | null) ?? null;
}

export async function updateReportTemplate(
  id: string,
  patch: { name?: string; layout?: ReportLayout },
): Promise<void> {
  const { data, error } = await supabase
    .from('report_templates')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  assertTouched(data);
}

/** Layout padrão do sistema com todos os blocos opcionais, sem texto de IA. */
export function buildSystemDefaultLayout(): ReportLayout {
  return stripAiTextForTemplate(
    buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true }),
  );
}

export async function setDefaultReportTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_report_template', { p_template_id: id });
  if (error) throw new Error(error.message);
}
