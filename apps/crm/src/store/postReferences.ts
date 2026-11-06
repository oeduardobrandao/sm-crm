import { supabase } from './core';

// Client references on a post (Hub uploads and links). Reads and the team's delete go through
// the `post-references` edge function (signed R2 URLs, entregas/editar check on delete); the
// per-post counts for the drawer badge read `post_references` directly under its SELECT policy.
//
// Deliberately NOT re-exported from `store/index.ts`: the drawer test harnesses mock '@/store'
// with explicit factories, so callers import this module by path.

export type ReferenceFileKind = 'image' | 'video' | 'document';

/** Mirrors `ReferenceItem` in supabase/functions/_shared/post-references.ts. */
export interface ReferenceItem {
  id: number;
  kind: 'file' | 'link';
  file_kind: ReferenceFileKind | null;
  name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  /** Signed GET URL of the original file (3600s). Null for links. */
  url: string | null;
  thumbnail_url: string | null;
  blur_data_url: string | null;
  /** Signed URL with `Content-Disposition: attachment`. Files only. */
  download_url: string | null;
  link_url: string | null;
  link_title: string | null;
  link_domain: string | null;
  note: string | null;
  /** The requested material item this file/link answers (post_material_items.id), if any. */
  material_item_id: number | null;
  /** Set when the client attached it to a correction (post_approvals.id). */
  post_approval_id: number | null;
  created_at: string;
  can_remove: boolean;
}

export interface CrmMaterialItem {
  id: number;
  label: string;
  detail: string | null;
  position: number;
  file_count: number;
  done: boolean;
}

/** Mirrors `MaterialRequestDTO` (+ `opened_by_name`) of the post-references GET. */
export interface CrmMaterialRequest {
  id: number;
  post_id: number;
  status: 'aberto' | 'concluido' | 'cancelado';
  closed_by: 'auto' | 'client' | 'team' | 'system' | null;
  closed_at: string | null;
  opened_by: string | null;
  opened_at: string;
  opened_by_name: string | null;
  items: CrmMaterialItem[];
}

export interface MaterialRequestBody {
  open: boolean;
  items: { id?: number; label: string; detail?: string | null }[];
}

export interface MaterialSummaryRow {
  post_id: number;
  status: 'aberto' | 'concluido' | 'cancelado';
  done: number;
  total: number;
}

export interface PostReferencesData {
  items: ReferenceItem[];
  request: CrmMaterialRequest | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

async function callPostReferences<T>(
  method: 'GET' | 'DELETE' | 'PUT',
  pathSuffix = '',
  query?: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const url = new URL(`${SUPABASE_URL}/functions/v1/post-references${pathSuffix}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Items plus the post's material request (one call, one cache entry). */
export async function getPostReferencesData(postId: number): Promise<PostReferencesData> {
  const { items, request } = await callPostReferences<{
    items: ReferenceItem[];
    request?: CrmMaterialRequest | null;
  }>('GET', '', { post_id: String(postId) });
  return { items, request: request ?? null };
}

export async function getPostReferences(postId: number): Promise<ReferenceItem[]> {
  return (await getPostReferencesData(postId)).items;
}

/** Opens, edits or cancels the material request. Errors carry the server's code as message. */
export async function saveMaterialRequest(
  postId: number,
  body: MaterialRequestBody,
): Promise<CrmMaterialRequest | null> {
  const { request } = await callPostReferences<{ request: CrmMaterialRequest | null }>(
    'PUT',
    `/requests/${postId}`,
    undefined,
    body,
  );
  return request;
}

export async function getMaterialSummary(postIds: number[]): Promise<MaterialSummaryRow[]> {
  if (postIds.length === 0) return [];
  const { summary } = await callPostReferences<{ summary: MaterialSummaryRow[] }>(
    'GET',
    '/requests/summary',
    { post_ids: postIds.join(',') },
  );
  return summary;
}

export async function deletePostReference(id: number): Promise<void> {
  await callPostReferences<{ ok: true }>('DELETE', `/${id}`);
}

/** `{ [post_id]: count }` for the given posts; posts without references are absent. */
export async function getPostReferenceCounts(postIds: number[]): Promise<Record<number, number>> {
  if (postIds.length === 0) return {};
  const { data, error } = await supabase
    .from('post_references')
    .select('post_id')
    .in('post_id', postIds);
  if (error) throw error;
  const counts: Record<number, number> = {};
  for (const row of (data ?? []) as { post_id: number }[]) {
    counts[row.post_id] = (counts[row.post_id] ?? 0) + 1;
  }
  return counts;
}
