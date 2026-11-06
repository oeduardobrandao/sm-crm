import { call } from './postReferences';
import type { ReferenceItem } from '../types/postReferences';

/** Hub copy of MaterialRequestDTO (supabase/functions/_shared/material-requests.ts). Keep in sync. */
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
  opened_by: string | null;
  opened_at: string;
  items: MaterialItem[];
}

export interface HubMaterialRequest {
  post_id: number;
  titulo: string;
  tipo: string;
  scheduled_at: string | null;
  platform: string | null;
  client_visible: boolean;
  request: MaterialRequestDTO;
  files_by_item: Record<number, ReferenceItem[]>;
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
