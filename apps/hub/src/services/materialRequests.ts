import { call } from './postReferences';
import type { ReferenceItem } from '../types/postReferences';

/**
 * Hub copy of MaterialRequestDTO (supabase/functions/_shared/material-requests.ts). Keep in sync.
 * The Hub never receives `opened_by` (a team member's id): hub-post-references strips it.
 */
export interface MaterialItem {
  id: number;
  label: string;
  detail: string | null;
  position: number;
  file_count: number;
  done: boolean;
}

export interface MaterialRequestDTO {
  id: number;
  post_id: number;
  status: 'aberto' | 'concluido' | 'cancelado';
  closed_by: 'auto' | 'client' | 'team' | 'system' | null;
  closed_at: string | null;
  opened_at: string;
  items: MaterialItem[];
}

export interface HubMaterialRequest {
  post_id: number;
  titulo: string | null;
  tipo: string | null;
  scheduled_at: string | null;
  platform: string | null;
  client_visible: boolean;
  request: MaterialRequestDTO;
  files_by_item: Record<number, ReferenceItem[]>;
}

/** The post title, or the "Post sem título" fallback when it is null or blank. */
export function materialTitle(entry: Pick<HubMaterialRequest, 'titulo'>, fallback: string): string {
  const titulo = entry.titulo?.trim();
  return titulo ? titulo : fallback;
}

/** Open requests of the client, ordered by the server (scheduled_at asc nulls last, then opened_at). */
export async function fetchMaterialRequests(token: string): Promise<HubMaterialRequest[]> {
  const res = await call<{ requests: HubMaterialRequest[] }>('GET', '/requests', {
    query: { token },
  });
  return res.requests;
}

/** "Enviei o que tenho". Throws PostReferenceError (nothing_sent, request_closed, not_found...). */
export async function closeMaterialRequest(token: string, postId: number): Promise<void> {
  await call<{ ok: true }>('POST', `/requests/${postId}/close`, { body: { token } });
}
