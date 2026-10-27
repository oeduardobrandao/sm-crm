import type { ContentFormat } from '@mesaas/platforms';
import type { JSONContent } from '@tiptap/core';
import { supabase, getContaId, getUserId } from './core';
import type { SelectOption, WorkflowPost } from './posts';

// Linha editorial: the monthly plan an agency drafts per client and sends to the Hub for
// approval (spec 2026-10-26-linha-editorial-design.md). Cell edits go through PostgREST under
// RLS; the state machine (criar, enviar, recolher, converter) goes through the RPCs. The new
// tables are not in generated types, so rows are cast at the edge of each function.
//
// Tests that mock '@/store' with an explicit factory must add the functions they use.

export type LinhaStatus = 'rascunho' | 'enviada' | 'ajustes' | 'aprovada';

export type LinhaColunaTipo =
  'text' | 'number' | 'select' | 'multiselect' | 'date' | 'person' | 'checkbox' | 'url';

export type LinhaRespostaAcao = 'comentario' | 'aprovado' | 'ajustes';

export interface LinhaEditorial {
  id: string;
  conta_id: string;
  cliente_id: number;
  /** First day of the month, `YYYY-MM-01`. */
  periodo: string;
  status: LinhaStatus;
  enviada_at: string | null;
  enviada_por: string | null;
  decidida_at: string | null;
  rodada: number;
  /** Only on `listLinhasDoMes`: rows in the linha. */
  itens_total?: number;
  /** Only on `listLinhasDoMes`: rows already turned into posts. */
  itens_convertidos?: number;
  /** Only on `listLinhasDoMes`: rows the client approved (spec §13.6). */
  itens_aprovados?: number;
}

/** The client's decision on one row (spec §13). `null` (or absent) means pending. */
export type LinhaItemAprovacao = 'aprovado' | 'ajustes';

export interface LinhaColuna {
  id: string;
  nome: string;
  tipo: LinhaColunaTipo;
  config: { options?: SelectOption[] };
  visivel_cliente: boolean;
  oculta: boolean;
  ordem: number;
}

export interface LinhaItem {
  id: string;
  linha_id: string;
  /** `YYYY-MM-DD`, null means "sem data". */
  data: string | null;
  tipo: ContentFormat;
  titulo: string;
  direcao: string;
  /** `{ [coluna_id]: value }`, same value shapes as `post_property_values.value`. */
  valores: Record<string, unknown>;
  ordem: number;
  post_id: number | null;
  convertido_at?: string | null;
  /** Written only by the Hub RPCs. Optional so fixtures and optimistic inserts can omit it. */
  aprovacao?: LinhaItemAprovacao | null;
  /** Last client decision on the row. */
  aprovacao_at?: string | null;
}

export interface LinhaResposta {
  id: string;
  linha_id: string;
  item_id: string | null;
  acao: LinhaRespostaAcao;
  comentario: string | null;
  rodada: number;
  is_workspace_user: boolean;
  author_user_id: string | null;
  created_at: string;
}

export interface ConverterPostPayload {
  item_id: string;
  conteudo: JSONContent;
  conteudo_plain: string;
  property_values: { property_definition_id: number; value: unknown }[];
}

export interface LinhaPost {
  id: number;
  status: WorkflowPost['status'];
  /** uuid of a custom status definition, as `WorkflowPost.custom_status_id`. */
  custom_status_id: string | null;
  titulo: string;
  workflow_id: number | null;
  workflow_titulo: string | null;
}

/** Fields of an item a cell edit may write (`post_id` and `convertido_*` never are). */
export type LinhaItemPatch = Partial<
  Pick<LinhaItem, 'data' | 'tipo' | 'titulo' | 'direcao' | 'valores' | 'ordem'>
>;
export type LinhaItemInsert = LinhaItemPatch & { id?: string };

export type LinhaColunaInput = Pick<LinhaColuna, 'nome' | 'tipo'> &
  Partial<Pick<LinhaColuna, 'config' | 'visivel_cliente' | 'oculta' | 'ordem'>>;
export type LinhaColunaPatch = Partial<
  Pick<LinhaColuna, 'nome' | 'tipo' | 'config' | 'visivel_cliente' | 'oculta' | 'ordem'>
>;

export const linhaPostsKey = (linhaId: string) => ['linha-posts', linhaId] as const;

const LINHA_COLS =
  'id, conta_id, cliente_id, periodo, status, enviada_at, enviada_por, decidida_at, rodada';
const COLUNA_COLS = 'id, nome, tipo, config, visivel_cliente, oculta, ordem';

type CountEmbed = { count: number }[] | null | undefined;

export async function listLinhasDoMes(periodo: string): Promise<LinhaEditorial[]> {
  const { data, error } = await supabase
    .from('linhas_editoriais')
    .select(
      `${LINHA_COLS}, itens:linha_editorial_itens(count), convertidos:linha_editorial_itens(count), aprovados:linha_editorial_itens(count)`,
    )
    .eq('periodo', periodo)
    // Each filter narrows only its own embed (no !inner), so `itens` keeps every row.
    .not('convertidos.post_id', 'is', null)
    .eq('aprovados.aprovacao', 'aprovado')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (
    (data ?? []) as unknown as (LinhaEditorial & {
      itens?: CountEmbed;
      convertidos?: CountEmbed;
      aprovados?: CountEmbed;
    })[]
  ).map(({ itens, convertidos, aprovados, ...linha }) => ({
    ...linha,
    itens_total: itens?.[0]?.count ?? 0,
    itens_convertidos: convertidos?.[0]?.count ?? 0,
    itens_aprovados: aprovados?.[0]?.count ?? 0,
  }));
}

export async function listItens(linhaId: string): Promise<LinhaItem[]> {
  const { data, error } = await supabase
    .from('linha_editorial_itens')
    .select('*')
    .eq('linha_id', linhaId)
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data ?? []) as LinhaItem[];
}

export async function listColunas(): Promise<LinhaColuna[]> {
  const { data, error } = await supabase
    .from('linha_editorial_colunas')
    .select(COLUNA_COLS)
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data ?? []) as LinhaColuna[];
}

export async function listRespostas(linhaId: string): Promise<LinhaResposta[]> {
  const { data, error } = await supabase
    .from('linha_editorial_respostas')
    .select(
      'id, linha_id, item_id, acao, comentario, rodada, is_workspace_user, author_user_id, created_at',
    )
    .eq('linha_id', linhaId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as LinhaResposta[];
}

/** Idempotent per (cliente, mês): returns the existing linha's id when there is one. */
export async function criarLinha(clienteId: number, periodo: string): Promise<string> {
  const { data, error } = await supabase.rpc('linha_editorial_criar', {
    p_cliente_id: clienteId,
    p_periodo: periodo,
  });
  if (error) throw error;
  return data as string;
}

export async function addItem(linhaId: string, patch: LinhaItemInsert): Promise<LinhaItem> {
  let ordem = patch.ordem;
  if (ordem === undefined) {
    const { data: last, error: lastErr } = await supabase
      .from('linha_editorial_itens')
      .select('ordem')
      .eq('linha_id', linhaId)
      .order('ordem', { ascending: false })
      .limit(1);
    if (lastErr) throw lastErr;
    ordem = ((last as { ordem: number }[] | null)?.[0]?.ordem ?? -1) + 1;
  }
  const contaId = await getContaId();
  const { id, data: dia, tipo, titulo, direcao, valores } = patch;
  const { data, error } = await supabase
    .from('linha_editorial_itens')
    .insert({
      ...(id ? { id } : {}),
      conta_id: contaId,
      linha_id: linhaId,
      data: dia ?? null,
      tipo: tipo ?? 'feed',
      titulo: titulo ?? '',
      direcao: direcao ?? '',
      valores: valores ?? {},
      ordem,
    })
    .select()
    .single();
  if (error) throw error;
  return data as LinhaItem;
}

export async function updateItem(id: string, patch: LinhaItemPatch): Promise<void> {
  const { error } = await supabase.from('linha_editorial_itens').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('linha_editorial_itens').delete().eq('id', id);
  if (error) throw error;
}

/** Writes `ordem = index` for each id, in the order given. */
export async function reorderItens(ids: string[]): Promise<void> {
  const results = await Promise.all(
    ids.map((id, ordem) => supabase.from('linha_editorial_itens').update({ ordem }).eq('id', id)),
  );
  for (const { error } of results) if (error) throw error;
}

export async function addColuna(input: LinhaColunaInput): Promise<LinhaColuna> {
  let ordem = input.ordem;
  if (ordem === undefined) {
    const { data: last, error: lastErr } = await supabase
      .from('linha_editorial_colunas')
      .select('ordem')
      .order('ordem', { ascending: false })
      .limit(1);
    if (lastErr) throw lastErr;
    ordem = ((last as { ordem: number }[] | null)?.[0]?.ordem ?? -1) + 1;
  }
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('linha_editorial_colunas')
    .insert({
      conta_id: contaId,
      nome: input.nome,
      tipo: input.tipo,
      config: input.config ?? {},
      visivel_cliente: input.visivel_cliente ?? true,
      oculta: input.oculta ?? false,
      ordem,
    })
    .select(COLUNA_COLS)
    .single();
  if (error) throw error;
  return data as LinhaColuna;
}

export async function updateColuna(id: string, patch: LinhaColunaPatch): Promise<void> {
  const { error } = await supabase.from('linha_editorial_colunas').update(patch).eq('id', id);
  if (error) throw error;
}

/** Deletes the column and strips its key from unconverted items' `valores`. */
export async function excluirColuna(id: string): Promise<void> {
  const { error } = await supabase.rpc('linha_editorial_coluna_excluir', { p_coluna_id: id });
  if (error) throw error;
}

export async function enviarLinha(id: string): Promise<void> {
  const { error } = await supabase.rpc('linha_editorial_enviar', { p_linha_id: id });
  if (error) throw error;
}

export async function recolherLinha(id: string): Promise<void> {
  const { error } = await supabase.rpc('linha_editorial_recolher', { p_linha_id: id });
  if (error) throw error;
}

/** Team reply. `rodada` is stamped by a DB trigger, so it is not sent. */
export async function responderComentario(
  linhaId: string,
  itemId: string | null,
  texto: string,
): Promise<void> {
  const [contaId, userId] = await Promise.all([getContaId(), getUserId()]);
  const { error } = await supabase.from('linha_editorial_respostas').insert({
    conta_id: contaId,
    linha_id: linhaId,
    item_id: itemId,
    acao: 'comentario',
    comentario: texto,
    is_workspace_user: true,
    author_user_id: userId,
  });
  if (error) throw error;
}

/**
 * Atomic: every post in `posts` is created and linked to its item, or none is. A plan-limit
 * failure surfaces as `plan_limit_exceeded:*` (map it with `mapEntitlementError`).
 */
export async function converterItens(
  linhaId: string,
  workflowId: number | null,
  posts: ConverterPostPayload[],
): Promise<{ item_id: string; post_id: number }[]> {
  const { data, error } = await supabase.rpc('linha_editorial_converter', {
    p_linha_id: linhaId,
    p_workflow_id: workflowId,
    p_posts: posts,
  });
  if (error) throw error;
  const list = Array.isArray(data) ? data : ((data as { posts?: unknown[] } | null)?.posts ?? []);
  return list as { item_id: string; post_id: number }[];
}

/** The linha row a post was created from, or null when it was not (or the row was released). */
export async function getOrigemDoPost(
  postId: number,
): Promise<{ linha: LinhaEditorial; item: LinhaItem } | null> {
  const { data, error } = await supabase
    .from('linha_editorial_itens')
    .select(`*, linha:linhas_editoriais(${LINHA_COLS})`)
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { linha, ...item } = data as unknown as LinhaItem & { linha: LinhaEditorial | null };
  if (!linha) return null;
  return { linha, item: item as LinhaItem };
}

/** Production state of the posts a linha produced (for "N de M em produção"). */
export async function listPostsDaLinha(postIds: number[]): Promise<LinhaPost[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('id, status, custom_status_id, titulo, workflow_id, workflows(titulo)')
    .in('id', postIds);
  if (error) throw error;
  type Row = Omit<LinhaPost, 'workflow_titulo'> & {
    workflows: { titulo: string } | { titulo: string }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map(({ workflows, ...post }) => {
    const wf = Array.isArray(workflows) ? workflows[0] : workflows;
    return { ...post, workflow_titulo: wf?.titulo ?? null };
  });
}
