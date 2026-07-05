import { supabase } from './core';

// Estúdio designs (design-first model, spec 2026-07-04). Reads are direct RLS selects
// (designs grants SELECT to authenticated, scoped by conta); ALL writes go through the
// design-manage edge function → service-role RPCs.

export interface DesignSummary {
  id: number;
  rev: number;
  render_status: 'pending' | 'rendering' | 'rendered' | 'failed';
  is_stale: boolean;
  post_id: number | null;
  cliente_id: number | null;
  format: string;
  name: string;
  render_manifest: Array<{ r2_key: string }> | null;
  updated_at: string;
}

const DESIGN_COLUMNS =
  'id, rev, render_status, is_stale, post_id, cliente_id, format, name, render_manifest, updated_at';

/** The design attached to a post, if any. Direct RLS select — NEVER the edge function
 * (creation is explicit now; GET /blob is a plain fetch). Null = post has no design. */
export async function getDesignForPost(postId: number): Promise<DesignSummary | null> {
  const { data, error } = await supabase
    .from('designs')
    .select(DESIGN_COLUMNS)
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw error;
  return data as DesignSummary | null;
}

/** Gallery list — conta-scoped by the RLS policy itself. */
export async function listDesigns(clienteId?: number): Promise<DesignSummary[]> {
  let query = supabase
    .from('designs')
    .select(DESIGN_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (clienteId !== undefined) query = query.eq('cliente_id', clienteId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as DesignSummary[];
}

export async function getDesign(designId: number): Promise<DesignSummary | null> {
  const { data, error } = await supabase
    .from('designs')
    .select(DESIGN_COLUMNS)
    .eq('id', designId)
    .maybeSingle();
  if (error) throw error;
  return data as DesignSummary | null;
}

/** Authed call to the design-manage edge function (pattern from services/postMedia.ts).
 * Throws the server's `{error}` code as the Error message so callers can map it. */
async function callDesignManage<T>(path: string, method: string, body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const url = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/design-manage${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Create a design. With post_id the design is born attached (format derives from the
 * post's tipo); standalone creations pass format explicitly. */
export async function createDesign(input: {
  post_id?: number;
  format?: string;
  cliente_id?: number;
  name?: string;
}): Promise<{ design_id: number }> {
  return callDesignManage('/designs', 'POST', input);
}

export async function duplicateDesign(designId: number): Promise<{ design_id: number }> {
  return callDesignManage(`/designs/${designId}/duplicate`, 'POST');
}

export async function attachDesign(
  designId: number,
  postId: number,
): Promise<{ post_tipo: string }> {
  return callDesignManage(`/designs/${designId}/attach`, 'POST', { post_id: postId });
}

export async function detachDesign(designId: number): Promise<void> {
  return callDesignManage(`/designs/${designId}/detach`, 'POST');
}

export async function deleteDesign(designId: number): Promise<void> {
  return callDesignManage(`/designs/${designId}`, 'DELETE');
}

// ---------- gallery thumbnails ----------

export interface AttachedThumbSource {
  coverKey: string | null;
  videoThumbKey: string | null;
}

/** Which R2 key previews a design. Unattached designs keep their last render manifest on
 * the row (finalize stores it); attached feed/carrossel designs' renders ARE the post's
 * origin='design' media; attached reel covers live on the post video's thumbnail. Null =
 * nothing to show (never rendered / failed) → placeholder. */
export function pickThumbKey(
  design: Pick<DesignSummary, 'render_manifest' | 'post_id' | 'format'>,
  attached?: AttachedThumbSource,
): string | null {
  const manifestKey = design.render_manifest?.[0]?.r2_key;
  if (manifestKey) return manifestKey;
  if (design.post_id !== null && attached) {
    if (design.format === 'reel_cover') return attached.videoThumbKey;
    return attached.coverKey;
  }
  return null;
}

interface ThumbLinkRow {
  post_id: number;
  is_cover: boolean;
  origin: string;
  files: { r2_key: string | null; kind: string; thumbnail_r2_key: string | null };
}

/** One batched RLS read of the attached posts' media, shaped for pickThumbKey. */
export async function fetchAttachedThumbSources(
  postIds: number[],
): Promise<Map<number, AttachedThumbSource>> {
  const map = new Map<number, AttachedThumbSource>();
  if (postIds.length === 0) return map;
  const { data, error } = await supabase
    .from('post_file_links')
    .select('post_id, is_cover, origin, files!inner(r2_key, kind, thumbnail_r2_key)')
    .in('post_id', postIds);
  if (error) throw error;
  for (const row of (data ?? []) as unknown as ThumbLinkRow[]) {
    const entry = map.get(row.post_id) ?? { coverKey: null, videoThumbKey: null };
    if (row.files.kind === 'video' && row.files.thumbnail_r2_key) {
      entry.videoThumbKey = row.files.thumbnail_r2_key;
    }
    if (row.origin === 'design' && row.files.r2_key && (row.is_cover || !entry.coverKey)) {
      entry.coverKey = row.files.r2_key;
    }
    map.set(row.post_id, entry);
  }
  return map;
}
