import type {
  HubBootstrap, HubPost, PostApproval, HubPostProperty, HubSelectOption, HubBrand, HubBrandFile,
  HubPage, HubPageFull, BriefingQuestion, HubIdeia, IdeiaReaction
} from './types';

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function edgeUrl(fn: string, params: Record<string, string>) {
  const url = new URL(`${BASE}/functions/v1/${fn}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function get<T>(fn: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(edgeUrl(fn, params), {
    headers: { apikey: ANON },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function post<T>(fn: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchBootstrap(workspace: string, token: string) {
  return get<HubBootstrap>('hub-bootstrap', { workspace, token });
}

export function fetchPosts(token: string) {
  return get<{ posts: HubPost[]; postApprovals: PostApproval[]; propertyValues: HubPostProperty[]; workflowSelectOptions: HubSelectOption[] }>('hub-posts', { token });
}

export function submitApproval(token: string, post_id: number, action: 'aprovado' | 'correcao' | 'mensagem', comentario?: string) {
  return post<{ ok: boolean }>('hub-approve', { token, post_id, action, comentario });
}

export function fetchBrand(token: string) {
  return get<{ brand: HubBrand | null; files: HubBrandFile[] }>('hub-brand', { token });
}

export function fetchPages(token: string) {
  return get<{ pages: HubPage[] }>('hub-pages', { token });
}

export function fetchPage(token: string, page_id: string) {
  return get<{ page: HubPageFull }>('hub-pages', { token, page_id });
}

export function fetchBriefing(token: string) {
  return get<{ questions: BriefingQuestion[] }>('hub-briefing', { token });
}

export function submitBriefingAnswer(token: string, question_id: string, answer: string) {
  return post<{ ok: boolean }>('hub-briefing', { token, question_id, answer });
}

async function patch<T>(fn: string, id: string, token: string, body: unknown): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${fn}/${id}`);
  url.searchParams.set('token', token);
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(fn: string, id: string, token: string): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${fn}/${id}`);
  url.searchParams.set('token', token);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { apikey: ANON },
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchIdeias(token: string) {
  return get<{ ideias: HubIdeia[] }>('hub-ideias', { token });
}

export function createIdeia(token: string, payload: { titulo: string; descricao: string; links: string[] }) {
  return post<{ ideia: HubIdeia }>('hub-ideias', { token, ...payload });
}

export function updateIdeia(token: string, id: string, payload: { titulo?: string; descricao?: string; links?: string[] }) {
  return patch<{ ideia: HubIdeia }>('hub-ideias', id, token, payload);
}

export function deleteIdeia(token: string, id: string) {
  return del<{ ok: boolean }>('hub-ideias', id, token);
}
