import type {
  CorrectionReason,
  HubBootstrap,
  HubPost,
  PostApproval,
  PostHistoryResponse,
  HubPostProperty,
  HubSelectOption,
  HubBrand,
  HubBrandFile,
  HubPage,
  HubPageFull,
  BriefingQuestion,
  Briefing,
  BriefingAudioResponse,
  HubIdeia,
  IdeiaAudioResponse,
  IdeiaImage,
  IdeiaReaction,
  InstagramFeedData,
  HubPostsResponse,
  HubDashboardResponse,
  PendingEditSuggestion,
  HubMensagensResponse,
  MensagensCursor,
  HubAgendaCursor,
  HubAgendaItem,
  HubAgendaResponse,
  ConviteItem,
  ConviteResponse,
} from './types';

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function edgeUrl(fn: string, params: Record<string, string>) {
  const url = new URL(`${BASE}/functions/v1/${fn}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// Backoff schedule for HTTP 429. The Hub edge functions rate-limit per client
// with a sliding window and reject BEFORE doing any work, so a 429'd request
// had no side effect and can be replayed verbatim. Autosave (briefing answers,
// edit suggestions) is what trips the limit in practice: the retry lets a burst
// drain instead of surfacing "Não foi possível salvar" on a healthy connection.
const RETRY_AFTER_429_MS = [2_000, 6_000, 15_000];

// Resolves after `ms`, or as soon as `signal` aborts (the caller then checks
// the signal and bails), so an abandoned request never lingers in a backoff.
function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Request superseded', 'AbortError');
}

// `signal` is checked BEFORE each attempt, not passed to fetch: aborting an
// in-flight fetch can't undo what the server already applied, but an aborted
// signal must never let a stale payload be REPLAYED after a newer request for
// the same resource has gone out (autosave: the older text would overwrite
// the newer one). Callers that autosave pass one AbortController per resource
// and abort the previous one on every new edit.
async function request<T>(input: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);
    const res = await fetch(input, init);
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 429 && attempt < RETRY_AFTER_429_MS.length) {
      await sleep(RETRY_AFTER_429_MS[attempt], signal);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
}

function get<T>(fn: string, params: Record<string, string>): Promise<T> {
  return request<T>(edgeUrl(fn, params), { headers: { apikey: ANON } });
}

function post<T>(fn: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(
    `${BASE}/functions/v1/${fn}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify(body),
    },
    signal,
  );
}

export function fetchBootstrap(workspace: string, token: string) {
  return get<HubBootstrap>('hub-bootstrap', { workspace, token });
}

export function fetchPosts(token: string) {
  return get<HubPostsResponse>('hub-posts', { token });
}

export function fetchOlderPosts(token: string, before: string) {
  return get<HubPostsResponse>('hub-posts', { token, before });
}

export function fetchPostsInRange(token: string, from: string, to: string) {
  return get<HubPostsResponse>('hub-posts', { token, from, to });
}

export function fetchPost(token: string, postId: number) {
  return get<HubPostsResponse>('hub-posts', { token, post_id: String(postId) });
}

export function submitApproval(
  token: string,
  post_id: number,
  action: 'aprovado' | 'correcao' | 'mensagem',
  comentario?: string,
  motivo?: CorrectionReason,
) {
  return post<{ ok: boolean; scheduled?: boolean }>('hub-approve', {
    token,
    post_id,
    action,
    comentario,
    ...(motivo ? { motivo } : {}),
  });
}

export function fetchPostHistory(token: string, post_id: number) {
  return get<PostHistoryResponse>('hub-post-history', { token, post_id: String(post_id) });
}

export async function reorderPostSchedules(
  token: string,
  updates: { post_id: number; scheduled_at: string | null }[],
) {
  const res = await fetch(`${BASE}/functions/v1/hub-posts`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify({ token, updates }),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean; updated: number }>;
}

export function submitEditSuggestion(
  token: string,
  post_id: number,
  suggested_conteudo: Record<string, unknown> | null,
  suggested_conteudo_plain: string,
  suggested_ig_caption: string | null,
) {
  return post<{ ok: boolean; pending_suggestion: PendingEditSuggestion | null }>(
    'hub-edit-suggestion',
    { token, post_id, suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption },
  );
}

export function fetchInstagramFeed(token: string) {
  return get<InstagramFeedData>('hub-instagram-feed', { token });
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
  return get<{ briefings: Briefing[] }>('hub-briefing', { token });
}

export function submitBriefingAnswer(
  token: string,
  question_id: string,
  answer: string,
  signal?: AbortSignal,
) {
  return post<{ ok: boolean }>('hub-briefing', { token, question_id, answer }, signal);
}

export function presignBriefingAudio(
  token: string,
  payload: { question_id: string; mime_type: string; size_bytes: number },
) {
  return post<{ upload_url: string; r2_key: string; mime_type: string }>(
    'hub-briefing/upload-url',
    {
      token,
      ...payload,
    },
  );
}

export function finalizeBriefingAudio(
  token: string,
  questionId: string,
  payload: { r2_key: string; mime_type: string; size_bytes: number; duration_seconds: number },
) {
  return post<BriefingAudioResponse>(`hub-briefing/${questionId}/audio`, { token, ...payload });
}

export function retryBriefingTranscription(token: string, questionId: string) {
  return post<BriefingAudioResponse>(`hub-briefing/${questionId}/audio/transcribe`, { token });
}

export function deleteBriefingAudio(token: string, questionId: string) {
  return del<{ ok: boolean }>('hub-briefing', `${questionId}/audio`, token);
}

function patch<T>(fn: string, id: string, token: string, body: unknown): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${fn}/${id}`);
  url.searchParams.set('token', token);
  return request<T>(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', apikey: ANON },
    body: JSON.stringify(body),
  });
}

function del<T>(fn: string, id: string, token: string): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${fn}/${id}`);
  url.searchParams.set('token', token);
  return request<T>(url.toString(), { method: 'DELETE', headers: { apikey: ANON } });
}

export function fetchIdeias(token: string) {
  return get<{ ideias: HubIdeia[] }>('hub-ideias', { token });
}

export function createIdeia(
  token: string,
  payload: {
    titulo: string;
    // Optional: an ideia can be conveyed entirely through its audio recording instead.
    descricao: string | null;
    links: string[];
    tipo: 'ideia' | 'solicitacao';
  },
) {
  return post<{ ideia: HubIdeia }>('hub-ideias', { token, ...payload });
}

export function updateIdeia(
  token: string,
  id: string,
  payload: {
    titulo?: string;
    descricao?: string | null;
    links?: string[];
    tipo?: 'ideia' | 'solicitacao';
  },
) {
  return patch<{ ideia: HubIdeia }>('hub-ideias', id, token, payload);
}

export function deleteIdeia(token: string, id: string) {
  return del<{ ok: boolean }>('hub-ideias', id, token);
}

export function presignIdeiaImage(
  token: string,
  payload: {
    ideia_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    thumbnail: { mime_type: string; size_bytes: number };
  },
) {
  return post<{
    upload_id: string;
    upload_url: string;
    r2_key: string;
    thumbnail_upload_url: string;
    thumbnail_r2_key: string;
  }>('hub-ideias/upload-url', { token, ...payload });
}

export function finalizeIdeiaImage(
  token: string,
  ideiaId: string,
  payload: {
    r2_key: string;
    thumbnail_r2_key: string;
    mime_type: string;
    size_bytes: number;
    thumbnail_bytes: number;
    name: string;
    width?: number;
    height?: number;
    blur_data_url?: string;
    sort_order?: number;
  },
) {
  return post<IdeiaImage>(`hub-ideias/${ideiaId}/files`, { token, ...payload });
}

export async function deleteIdeiaImage(token: string, ideiaId: string, fileId: number) {
  const res = await fetch(
    `${BASE}/functions/v1/hub-ideias/${ideiaId}/files/${fileId}?token=${encodeURIComponent(token)}`,
    { method: 'DELETE', headers: { apikey: ANON } },
  );
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ ok: boolean }>;
}

export function presignIdeiaAudio(
  token: string,
  payload: { ideia_id: string; mime_type: string; size_bytes: number },
) {
  return post<{ upload_url: string; r2_key: string; mime_type: string }>(
    'hub-ideias/audio-upload-url',
    {
      token,
      ...payload,
    },
  );
}

export function finalizeIdeiaAudio(
  token: string,
  ideiaId: string,
  payload: { r2_key: string; mime_type: string; size_bytes: number; duration_seconds: number },
) {
  return post<IdeiaAudioResponse>(`hub-ideias/${ideiaId}/audio`, { token, ...payload });
}

export function retryIdeiaTranscription(token: string, ideiaId: string) {
  return post<IdeiaAudioResponse>(`hub-ideias/${ideiaId}/audio/transcribe`, { token });
}

export function deleteIdeiaAudio(token: string, ideiaId: string) {
  return del<{ ok: boolean }>('hub-ideias', `${ideiaId}/audio`, token);
}

export function fetchDashboard(token: string, period: number) {
  return get<HubDashboardResponse>('hub-dashboard', { token, period: String(period) });
}

export interface HubReport {
  month: string;
  status: string;
  generated_at: string | null;
  has_pdf: boolean;
  has_html: boolean;
}

export function fetchReports(token: string) {
  return get<{ reports: HubReport[] }>('hub-reports/list', { token });
}

export async function fetchReportHtml(token: string, month: string): Promise<string> {
  const url = edgeUrl('hub-reports/html/' + month, { token });
  const res = await fetch(url, { headers: { apikey: ANON } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function fetchReportPdfUrl(token: string, month: string) {
  return get<{ url: string }>('hub-reports/pdf-url/' + month, { token });
}

export type HubReportListItem =
  | {
      kind: 'legacy';
      month: string;
      status: string;
      generated_at: string | null;
      has_pdf: boolean;
      has_html: boolean;
    }
  | { kind: 'doc'; id: string; title: string; month: string; generated_at: string };

export function fetchReportList(token: string) {
  return get<{ items: HubReportListItem[] }>('hub-report-docs/list', { token });
}

export interface HubReportDoc {
  id: string;
  title: string;
  layout: unknown;
  data_snapshot: unknown;
  period_start: string;
}

export function fetchReportDoc(token: string, docId: string) {
  return get<{ doc: HubReportDoc }>(`hub-report-docs/doc/${docId}`, { token });
}

export function fetchPrintReportDoc(docId: string, pt: string) {
  return get<{ doc: HubReportDoc }>(`hub-report-docs/print-doc/${docId}`, { pt });
}

export function fetchMensagens(token: string, cursor?: MensagensCursor) {
  return get<HubMensagensResponse>('hub-mensagens', {
    token,
    ...(cursor
      ? {
          before: cursor.before,
          before_source: cursor.beforeSource,
          before_item_id: String(cursor.beforeItemId),
        }
      : {}),
  });
}

export function fetchMensagensUnread(token: string) {
  return get<{ unread: number }>('hub-mensagens', { token, count: '1' });
}

export function sendHubMensagem(token: string, content: string) {
  return post<{ ok: boolean }>('hub-mensagens', { token, content });
}

export function markMensagensSeen(token: string) {
  return post<{ ok: boolean }>('hub-mensagens/seen', { token });
}

// ── Agenda ──────────────────────────────────────────────────────────────────

export function fetchAgenda(token: string, apos?: HubAgendaCursor) {
  return get<HubAgendaResponse>('hub-agenda', {
    token,
    ...(apos ? { apos_inicio: apos.inicio, apos_id: String(apos.id) } : {}),
  });
}

/** The shared occurrences overlapping [de, ate) (ISO instants, at most 45 days apart). */
export function fetchAgendaPeriodo(token: string, de: string, ate: string) {
  return get<{ itens: HubAgendaItem[] }>('hub-agenda', { token, de, ate });
}

/** Deep link: one occurrence that may not be on the first page. */
export function fetchAgendaItem(token: string, ocorrenciaId: number) {
  return get<{ item: HubAgendaItem }>('hub-agenda', {
    token,
    ocorrencia: String(ocorrenciaId),
  });
}

/** `inicioVisto` is the item's `inicio` as shown: the server answers 409 if it moved since. */
export function responderAgenda(
  token: string,
  ocorrenciaId: number,
  resposta: 'sim' | 'nao',
  inicioVisto: string,
) {
  return post<{ item: HubAgendaItem }>('hub-agenda', {
    token,
    acao: 'responder',
    ocorrencia_id: ocorrenciaId,
    resposta,
    inicio_visto: inicioVisto,
  });
}

/** `data` (YYYY-MM-DD) and `hora` (HH:MM, null for all-day) are wall time in the item's tz. */
export function remarcarAgenda(
  token: string,
  ocorrenciaId: number,
  data: string,
  hora: string | null,
  mensagem: string,
) {
  return post<{ item: HubAgendaItem }>('hub-agenda', {
    token,
    acao: 'remarcar',
    ocorrencia_id: ocorrenciaId,
    data,
    hora,
    mensagem,
  });
}

export function cancelarRemarcacao(token: string, remarcacaoId: number) {
  return post<{ ok: true }>('hub-agenda', {
    token,
    acao: 'cancelar_remarcacao',
    remarcacao_id: remarcacaoId,
  });
}

/**
 * Direct download link for one occurrence's .ics. A plain GET with no headers, like the
 * agenda-feed subscription and the client-email-unsub link: hub-agenda runs with
 * verify_jwt = false and authenticates by the token in the query.
 */
export function agendaIcsUrl(token: string, ocorrenciaId: number) {
  const url = new URL(`${BASE}/functions/v1/hub-agenda/ocorrencia/${ocorrenciaId}.ics`);
  url.searchParams.set('token', token);
  return url.toString();
}

// ── Guest invite (agenda-convite) ───────────────────────────────────────────

// request() throws Error(body.error) without the HTTP status, so the invite page tells
// the states apart by these exact messages (the agenda-convite error contract).
export const CONVITE_INDISPONIVEL = 'Este convite não está mais disponível.';
export const CONVITE_HORARIO_MUDOU = 'Este evento mudou de horário. Atualize a página.';
export const CONVITE_JA_ACONTECEU = 'Este evento já aconteceu.';

export function fetchConvite(token: string) {
  return get<ConviteResponse>('agenda-convite', { token });
}

/** `inicioVisto` is the item's `inicio` as shown: the server answers 409 if it moved since. */
export function responderConvite(
  token: string,
  ocorrenciaId: number,
  resposta: 'sim' | 'nao',
  inicioVisto: string,
) {
  return post<{ item: ConviteItem }>('agenda-convite', {
    token,
    acao: 'responder',
    ocorrencia_id: ocorrenciaId,
    resposta,
    inicio_visto: inicioVisto,
  });
}

/** Direct .ics download for one occurrence of the invite (plain GET, token in the query). */
export function conviteIcsUrl(token: string, ocorrenciaId: number) {
  const url = new URL(`${BASE}/functions/v1/agenda-convite/ocorrencia/${ocorrenciaId}.ics`);
  url.searchParams.set('token', token);
  return url.toString();
}
