import { supabase, getUserId } from './core';

/**
 * A saved Entregas view on the server (table entregas_saved_views, migration
 * 20261016000001). Per user and per workspace; RLS only exposes the caller's
 * own rows in their active workspace.
 *
 * Writes take `contaId` from the caller (the workspace the page is showing)
 * rather than re-reading the profile: RLS refuses a row whose conta_id is not
 * the live active workspace, so a tab left on another workspace gets an error
 * instead of writing into the wrong one.
 */
export interface EntregasSavedView {
  id: string;
  name: string;
  /** Serialized viewQuery string, the same payload the URL carries. */
  query: string;
  position: number;
}

/** Limits mirrored from the table's CHECK constraints. */
export const SAVED_VIEW_NAME_MAX = 80;
export const SAVED_VIEW_QUERY_MAX = 4000;

const COLUMNS = 'id, name, query, position';

export async function listSavedViews(contaId: string): Promise<EntregasSavedView[]> {
  const { data, error } = await supabase
    .from('entregas_saved_views')
    .select(COLUMNS)
    .eq('conta_id', contaId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as EntregasSavedView[];
}

/**
 * Saves a view under `name`. Saving onto a name that already exists replaces
 * that view's query and moves it to `position` (the localStorage behaviour:
 * drop the old entry, append the new one), keeping its id.
 */
export async function saveSavedView(
  contaId: string,
  view: { name: string; query: string; position: number },
): Promise<EntregasSavedView> {
  const user_id = await getUserId();
  const { data, error } = await supabase
    .from('entregas_saved_views')
    .upsert(
      { conta_id: contaId, user_id, name: view.name, query: view.query, position: view.position },
      { onConflict: 'user_id,conta_id,name' },
    )
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as EntregasSavedView;
}

export async function updateSavedViewQuery(id: string, query: string): Promise<void> {
  const { error } = await supabase.from('entregas_saved_views').update({ query }).eq('id', id);
  if (error) throw error;
}

/**
 * Renames a view. Renaming onto another view's name replaces that view (the
 * localStorage semantics): the other row is deleted first, since the unique
 * (user_id, conta_id, name) constraint would otherwise reject the rename.
 */
export async function renameSavedView(
  id: string,
  name: string,
  replaceId?: string | null,
): Promise<void> {
  if (replaceId && replaceId !== id) {
    const { error: delError } = await supabase
      .from('entregas_saved_views')
      .delete()
      .eq('id', replaceId);
    if (delError) throw delError;
  }
  const { error } = await supabase.from('entregas_saved_views').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function removeSavedView(id: string): Promise<void> {
  const { error } = await supabase.from('entregas_saved_views').delete().eq('id', id);
  if (error) throw error;
}

/** Writes `position` = index for each id, in the given order. */
export async function reorderSavedViews(ids: string[]): Promise<void> {
  const results = await Promise.all(
    ids.map((id, position) =>
      supabase.from('entregas_saved_views').update({ position }).eq('id', id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/**
 * Bulk insert for the one-time localStorage import. ON CONFLICT
 * (user_id, conta_id, name) DO NOTHING: a name that already exists on the
 * server (another tab or device imported first) is skipped, never overwritten.
 */
export async function importSavedViews(
  contaId: string,
  views: { name: string; query: string; position: number }[],
): Promise<void> {
  if (views.length === 0) return;
  const user_id = await getUserId();
  const { error } = await supabase.from('entregas_saved_views').upsert(
    views.map((v) => ({ conta_id: contaId, user_id, ...v })),
    { onConflict: 'user_id,conta_id,name', ignoreDuplicates: true },
  );
  if (error) throw error;
}
