// CRUD de templates do relatório de blocos: PostgREST direto com RLS
// (precedente briefing_templates em store/hub.ts). Default SÓ pela RPC
// atômica set_default_report_template (índice único parcial no banco).
import { supabase } from '../lib/supabase';
import { getContaId } from '../store/core';
import type { ReportLayout } from '@mesaas/report-blocks/types';

export interface ReportTemplateRow {
  id: string;
  name: string;
  layout: ReportLayout;
  is_default: boolean;
  created_at: string;
}

export async function listReportTemplates(): Promise<ReportTemplateRow[]> {
  const { data, error } = await supabase
    .from('report_templates')
    .select('id, name, layout, is_default, created_at')
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
    .select('id, name, layout, is_default, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as ReportTemplateRow;
}

export async function deleteReportTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('report_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setDefaultReportTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_report_template', { p_template_id: id });
  if (error) throw new Error(error.message);
}
