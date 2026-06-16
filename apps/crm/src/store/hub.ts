import { supabase, getContaId, getUserId } from './core';

export interface HubBrandRow {
  id?: string;
  cliente_id: number;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  font_primary?: string | null;
  font_secondary?: string | null;
}

export interface HubBrandFileRow {
  id: string;
  cliente_id: number;
  name: string;
  file_url: string;
  file_type: string;
  display_order: number;
}

export interface HubPageRow {
  id: string;
  conta_id: string;
  cliente_id: number;
  title: string;
  content: unknown[];
  display_order: number;
  created_at: string;
}

export interface HubBriefingQuestionRow {
  id: string;
  cliente_id: number;
  conta_id: string;
  briefing_id: string | null;
  question: string;
  answer: string | null;
  section: string | null;
  display_order: number;
  created_at: string;
}

export interface BriefingRow {
  id: string;
  cliente_id: number;
  conta_id: string;
  title: string;
  display_order: number;
  created_at: string;
}

export interface BriefingTemplateQuestion {
  question: string;
  section: string | null;
}

export interface BriefingTemplateRow {
  id: string;
  conta_id: string;
  user_id: string;
  title: string;
  questions: BriefingTemplateQuestion[];
  is_default: boolean;
  created_at: string;
}

// ──────────────────────────────────────────────
// Hub management functions
// ──────────────────────────────────────────────

export async function getHubToken(clienteId: number) {
  const { data } = await supabase
    .from('client_hub_tokens')
    .select('id, token, is_active')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; token: string; is_active: boolean } | null;
}

export async function createHubToken(clienteId: number, contaId: string) {
  const { data, error } = await supabase
    .from('client_hub_tokens')
    .insert({ cliente_id: clienteId, conta_id: contaId })
    .select('id, token, is_active')
    .single();
  if (error) throw error;
  return data as { id: string; token: string; is_active: boolean };
}

export async function setHubTokenActive(tokenId: string, isActive: boolean) {
  await supabase.from('client_hub_tokens').update({ is_active: isActive }).eq('id', tokenId);
}

export async function getHubBrand(clienteId: number) {
  const { data: brand } = await supabase
    .from('hub_brand')
    .select('*')
    .eq('cliente_id', clienteId)
    .maybeSingle();
  const { data: files } = await supabase
    .from('hub_brand_files')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('display_order');
  return { brand: brand as HubBrandRow | null, files: (files ?? []) as HubBrandFileRow[] };
}

export async function upsertHubBrand(clienteId: number, values: Partial<HubBrandRow>) {
  await supabase
    .from('hub_brand')
    .upsert({ ...values, cliente_id: clienteId }, { onConflict: 'cliente_id' });
}

export async function addHubBrandFile(
  clienteId: number,
  name: string,
  file_url: string,
  file_type: string,
  display_order: number,
) {
  await supabase
    .from('hub_brand_files')
    .insert({ cliente_id: clienteId, name, file_url, file_type, display_order });
}

export async function removeHubBrandFile(fileId: string) {
  await supabase.from('hub_brand_files').delete().eq('id', fileId);
}

export async function getHubPages(clienteId: number) {
  const { data } = await supabase
    .from('hub_pages')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('display_order');
  return (data ?? []) as HubPageRow[];
}

export async function getAllHubPages(): Promise<HubPageRow[]> {
  const { data, error } = await supabase.from('hub_pages').select('*').order('display_order');
  if (error) throw error;
  return (data ?? []) as HubPageRow[];
}

export async function upsertHubPage(
  page: Partial<HubPageRow> & { cliente_id: number; conta_id: string },
) {
  if (page.id) {
    await supabase.from('hub_pages').update(page).eq('id', page.id);
  } else {
    await supabase.from('hub_pages').insert(page);
  }
}

export async function removeHubPage(pageId: string) {
  await supabase.from('hub_pages').delete().eq('id', pageId);
}

export async function getWorkspaceSlug(): Promise<string | null> {
  const conta_id = await getContaId();
  const { data: ws } = await supabase
    .from('workspaces')
    .select('slug')
    .eq('id', conta_id)
    .maybeSingle();
  if ((ws as { slug: string | null } | null)?.slug) return ws!.slug;
  const { data: conta } = await supabase
    .from('contas')
    .select('slug')
    .eq('id', conta_id)
    .maybeSingle();
  return (conta as { slug: string | null } | null)?.slug ?? null;
}

export async function getHubBriefingQuestions(
  clienteId: number,
): Promise<HubBriefingQuestionRow[]> {
  const { data, error } = await supabase
    .from('hub_briefing_questions')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('display_order');
  if (error) throw error;
  return data ?? [];
}

export async function addHubBriefingQuestion(
  clienteId: number,
  contaId: string,
  question: string,
  section?: string | null,
  answer?: string | null,
): Promise<void> {
  const { data: existing } = await supabase
    .from('hub_briefing_questions')
    .select('display_order')
    .eq('cliente_id', clienteId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (existing?.display_order ?? -1) + 1;
  const { error } = await supabase.from('hub_briefing_questions').insert({
    cliente_id: clienteId,
    conta_id: contaId,
    question,
    display_order: nextOrder,
    section: section ?? null,
    answer: answer ?? null,
  });
  if (error) throw error;
}

export async function updateHubBriefingQuestionSection(
  id: string,
  section: string | null,
): Promise<void> {
  const { error } = await supabase.from('hub_briefing_questions').update({ section }).eq('id', id);
  if (error) throw error;
}

export async function updateHubBriefingQuestion(id: string, question: string): Promise<void> {
  const { error } = await supabase.from('hub_briefing_questions').update({ question }).eq('id', id);
  if (error) throw error;
}

export async function deleteHubBriefingQuestion(id: string): Promise<void> {
  const { error } = await supabase.from('hub_briefing_questions').delete().eq('id', id);
  if (error) throw error;
}

// ──────────────────────────────────────────────
// Briefings (titled containers, one client → many)
// ──────────────────────────────────────────────

export async function getBriefings(clienteId: number): Promise<BriefingRow[]> {
  const { data, error } = await supabase
    .from('briefings')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('display_order')
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function addBriefing(
  clienteId: number,
  contaId: string,
  title: string,
): Promise<BriefingRow> {
  const { data: existing } = await supabase
    .from('briefings')
    .select('display_order')
    .eq('cliente_id', clienteId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (existing?.display_order ?? -1) + 1;
  const { data, error } = await supabase
    .from('briefings')
    .insert({ cliente_id: clienteId, conta_id: contaId, title, display_order: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBriefingTitle(id: string, title: string): Promise<void> {
  const { error } = await supabase.from('briefings').update({ title }).eq('id', id);
  if (error) throw error;
}

export async function deleteBriefing(id: string): Promise<void> {
  // hub_briefing_questions rows cascade-delete via FK.
  const { error } = await supabase.from('briefings').delete().eq('id', id);
  if (error) throw error;
}

// ──────────────────────────────────────────────
// Briefing templates (reusable question sets, one default per workspace)
// ──────────────────────────────────────────────

export async function getBriefingTemplates(): Promise<BriefingTemplateRow[]> {
  const { data, error } = await supabase
    .from('briefing_templates')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addBriefingTemplate(
  t: Pick<BriefingTemplateRow, 'title' | 'questions'>,
): Promise<BriefingTemplateRow> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('briefing_templates')
    .insert({ title: t.title, questions: t.questions, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBriefingTemplate(
  id: string,
  t: Partial<Pick<BriefingTemplateRow, 'title' | 'questions'>>,
): Promise<void> {
  const { error } = await supabase.from('briefing_templates').update(t).eq('id', id);
  if (error) throw error;
}

export async function removeBriefingTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('briefing_templates').delete().eq('id', id);
  if (error) throw error;
}

export async function setDefaultBriefingTemplate(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_default_briefing_template', { p_template_id: id });
  if (error) throw error;
}

/**
 * Creates a new briefing for the client and copies the template's questions into it
 * (independent copies — no propagation). If the question insert fails, the just-created
 * briefing is deleted so we never leave an empty briefing behind.
 */
export async function applyTemplateToClient(
  clienteId: number,
  contaId: string,
  templateId: string,
  titleOverride?: string,
): Promise<BriefingRow> {
  const { data: template, error: tErr } = await supabase
    .from('briefing_templates')
    .select('*')
    .eq('id', templateId)
    .single();
  if (tErr || !template) throw tErr ?? new Error('Template não encontrado.');

  const title = (titleOverride ?? '').trim() || template.title;
  const briefing = await addBriefing(clienteId, contaId, title);

  const tplQuestions: BriefingTemplateQuestion[] = template.questions ?? [];
  const rows = tplQuestions.map((q, i) => ({
    cliente_id: clienteId,
    conta_id: contaId,
    briefing_id: briefing.id,
    question: q.question,
    section: q.section ?? null,
    answer: null,
    display_order: i,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from('hub_briefing_questions').insert(rows);
    if (error) {
      const { error: cleanupErr } = await supabase.from('briefings').delete().eq('id', briefing.id);
      if (cleanupErr) {
        console.warn('[applyTemplateToClient] compensating briefing delete failed:', cleanupErr);
      }
      throw error;
    }
  }
  return briefing;
}
