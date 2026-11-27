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
  DashboardPlatform,
  HubDashboardResponse,
  PendingEditSuggestion,
  SuggestionBases,
  SuggestionField,
  HubMensagensResponse,
  MensagensCursor,
  HubAgendaCursor,
  HubAgendaItem,
  HubAgendaResponse,
  ConviteItem,
  ConviteResponse,
  HubLinhaAcaoBody,
  HubLinhasResponse,
} from './types';
import { getHubSession } from './lib/hubSession';

const BASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Headers every Hub call carries: the public anon key, plus the client's login session when
 * one is stored (hub-* functions read it from `x-hub-session`). Read on every call, so a login
 * or logout takes effect on the next request without rebuilding anything.
 */
export function hubHeaders(base: Record<string, string> = {}): Record<string, string> {
  const session = getHubSession();
  return { apikey: ANON, ...base, ...(session ? { 'x-hub-session': session } : {}) };
}

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

/**
 * What request() throws on a non-OK answer. The message stays the body's `error` (callers
 * match on it, e.g. the agenda-convite contract); `status` and `code` are there for the
 * callers that need to tell one failure from another.
 */
export class HubApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** The parsed error JSON (e.g. the `login` payload of a 401 `login_required`). */
  readonly body?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, body?: Record<string, unknown>) {
    super(message);
    this.name = 'HubApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * 403 `hub_paused`: the agency's workspace is paused (reverse trial ended), so the link opens
 * the PortalPausado page. Keyed on the code, never on the status: "Hub desativado." is a 403
 * too. Never a reason to clear the stored session; the same link and login work again once
 * the agency reactivates the portal.
 */
export class HubPausedError extends HubApiError {
  readonly agencyName: string | null;
  constructor(message: string, body?: Record<string, unknown>) {
    super(message, 403, 'hub_paused', body);
    this.name = 'HubPausedError';
    const name = body?.agency_name;
    this.agencyName = typeof name === 'string' && name.trim() ? name : null;
  }
}

/** The answer a client without a valid login session gets from a hub-* function. */
// Twin of queries.ts `isLoginRequiredError` (structural, also matches PostReferenceError); keep in step.
export function isLoginRequired(error: unknown): boolean {
  return error instanceof HubApiError && error.code === 'login_required';
}

let loginRequiredListener: ((error: unknown) => void) | null = null;

/**
 * Called when a hub-* call is about to fail with `login_required`, wherever it was awaited
 * (TanStack or a plain await in a component). The query client registers the handler that
 * drops the stale session and refetches bootstrap. The hub-auth calls never notify it: their
 * 401s are answers for the login form.
 */
export function setLoginRequiredListener(fn: ((error: unknown) => void) | null) {
  loginRequiredListener = fn;
}

/**
 * Tells the listener, then hands the error back for the caller to throw. `sentSession` is the
 * session the request went out with (null for none). When the stored one has changed since (a
 * login finished, or a sibling answer already dropped it), this is a late answer about a
 * session that is no longer the current one: the error is marked `staleSession` and the
 * handler leaves the stored session alone. Without that, a slow 401 from before a login
 * wiped the session the login had just stored.
 */
export function notifyLoginRequired<E extends object>(error: E, sentSession?: string | null): E {
  if (sentSession !== undefined && sentSession !== getHubSession()) {
    Object.defineProperty(error, 'staleSession', { value: true });
  }
  loginRequiredListener?.(error);
  return error;
}

/** The session a request's headers carry (what hubHeaders put there), or null. */
export function sessionOf(headers: unknown): string | null {
  const value = (headers as Record<string, unknown> | undefined)?.['x-hub-session'];
  return typeof value === 'string' ? value : null;
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
interface RequestOptions {
  signal?: AbortSignal;
  /** Default true. Login calls turn it off: a 429 there is an answer for the person, not a blip. */
  retry429?: boolean;
  /** How a successful body is read. Default 'json'. */
  parse?: 'json' | 'text' | 'blob';
  /** Default true. The hub-auth calls turn it off: their 401 never means "session expired". */
  notifyLogin?: boolean;
}

async function request<T>(
  input: string,
  init: RequestInit,
  { signal, retry429 = true, parse = 'json', notifyLogin = true }: RequestOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(signal);
    const res = await fetch(input, init);
    if (res.ok) {
      return (
        parse === 'text' ? res.text() : parse === 'blob' ? res.blob() : res.json()
      ) as Promise<T>;
    }
    if (retry429 && res.status === 429 && attempt < RETRY_AFTER_429_MS.length) {
      await sleep(RETRY_AFTER_429_MS[attempt], signal);
      continue;
    }
    const raw = await res.json().catch(() => null);
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const message = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    if (res.status === 403 && body.code === 'hub_paused') throw new HubPausedError(message, body);
    const error = new HubApiError(
      message,
      res.status,
      typeof body.code === 'string' ? body.code : undefined,
      body,
    );
    throw notifyLogin && isLoginRequired(error)
      ? notifyLoginRequired(error, sessionOf(init.headers))
      : error;
  }
}

// Only hub-* functions know the session header. agenda-convite is the guest invite page and
// keeps sending exactly the headers it always did.
const sendsSession = (fn: string) => fn.startsWith('hub-');

function get<T>(fn: string, params: Record<string, string>): Promise<T> {
  return request<T>(edgeUrl(fn, params), {
    headers: sendsSession(fn) ? hubHeaders() : { apikey: ANON },
  });
}

export function post<T>(fn: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return postWith<T>(fn, body, { signal });
}

function postWith<T>(fn: string, body: unknown, options: RequestOptions): Promise<T> {
  return request<T>(
    `${BASE}/functions/v1/${fn}`,
    {
      method: 'POST',
      headers: sendsSession(fn)
        ? hubHeaders({ 'Content-Type': 'application/json' })
        : { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify(body),
    },
    options,
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
  /** Post references staged in the correction composer; hub-approve links them to the approval. */
  referenceIds?: number[],
) {
  return post<{ ok: boolean; scheduled?: boolean }>('hub-approve', {
    token,
    post_id,
    action,
    comentario,
    ...(motivo ? { motivo } : {}),
    ...(action === 'correcao' && referenceIds && referenceIds.length > 0
      ? { reference_ids: referenceIds }
      : {}),
  });
}

export function fetchPostHistory(token: string, post_id: number) {
  return get<PostHistoryResponse>('hub-post-history', { token, post_id: String(post_id) });
}

export function reorderPostSchedules(
  token: string,
  updates: { post_id: number; scheduled_at: string | null }[],
) {
  return request<{ ok: boolean; updated: number }>(`${BASE}/functions/v1/hub-posts`, {
    method: 'PATCH',
    headers: hubHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ token, updates }),
  });
}

/** What one edit-suggestion save sends. Untouched fields still carry their draft value; the
 * server only records the ones in `touched_fields` (each with its raw base in `bases`). */
export interface EditSuggestionPayload {
  conteudo: Record<string, unknown> | null;
  conteudo_plain: string;
  captions: {
    ig_caption: string | null;
    /** Omitted (undefined) = not sent at all. */
    tiktok_caption?: string | null;
    geral_caption?: string | null;
  };
  touched_fields: SuggestionField[];
  bases: SuggestionBases | null;
}

/**
 * Errors worth telling apart (HubApiError.status/code): 409 `target_gone` (the destination
 * was removed from the post), 409 `retry` (a concurrent write, safe to resend), 400
 * `caption_too_long` (TikTok caption above its limit).
 */
export function submitEditSuggestion(
  token: string,
  post_id: number,
  payload: EditSuggestionPayload,
) {
  return post<{ ok: boolean; pending_suggestion: PendingEditSuggestion | null }>(
    'hub-edit-suggestion',
    {
      token,
      post_id,
      suggested_conteudo: payload.conteudo,
      suggested_conteudo_plain: payload.conteudo_plain,
      suggested_ig_caption: payload.captions.ig_caption,
      suggested_tiktok_caption: payload.captions.tiktok_caption,
      suggested_geral_caption: payload.captions.geral_caption,
      touched_fields: payload.touched_fields,
      bases: payload.bases,
    },
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
    headers: hubHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

function del<T>(fn: string, id: string, token: string): Promise<T> {
  const url = new URL(`${BASE}/functions/v1/${fn}/${id}`);
  url.searchParams.set('token', token);
  return request<T>(url.toString(), { method: 'DELETE', headers: hubHeaders() });
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

export function deleteIdeiaImage(token: string, ideiaId: string, fileId: number) {
  return request<{ ok: boolean }>(
    `${BASE}/functions/v1/hub-ideias/${ideiaId}/files/${fileId}?token=${encodeURIComponent(token)}`,
    { method: 'DELETE', headers: hubHeaders() },
  );
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

export function fetchDashboard(token: string, period: number, platform?: DashboardPlatform) {
  const params: Record<string, string> = { token, period: String(period) };
  if (platform) params.platform = platform;
  return get<HubDashboardResponse>('hub-dashboard', params);
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

export function fetchReportHtml(token: string, month: string): Promise<string> {
  return request<string>(
    edgeUrl('hub-reports/html/' + month, { token }),
    { headers: hubHeaders() },
    { parse: 'text' },
  );
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

/** Print payload: also carries the workspace language the PDF renders in (hub-report-docs). */
export interface HubPrintReportDoc extends HubReportDoc {
  language?: 'pt' | 'en';
}

export function fetchReportDoc(token: string, docId: string) {
  return get<{ doc: HubReportDoc }>(`hub-report-docs/doc/${docId}`, { token });
}

export function fetchPrintReportDoc(docId: string, pt: string) {
  return get<{ doc: HubPrintReportDoc }>(`hub-report-docs/print-doc/${docId}`, { pt });
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
 * Plain download link for one occurrence's .ics, for a Hub with no client login: hub-agenda
 * runs with verify_jwt = false and authenticates by the token in the query. With login
 * required a link cannot carry the session header, so `downloadAgendaIcs` is used instead.
 */
export function agendaIcsUrl(token: string, ocorrenciaId: number) {
  const url = new URL(`${BASE}/functions/v1/hub-agenda/ocorrencia/${ocorrenciaId}.ics`);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Downloads one occurrence's .ics. A plain link cannot carry the session header, so this
 * fetches it (with the Hub headers) and saves the blob from a temporary anchor. The agenda
 * feed subscription and the guest invite keep their plain links (they authenticate by the
 * token in the query alone).
 */
export async function downloadAgendaIcs(token: string, ocorrenciaId: number): Promise<void> {
  const url = new URL(`${BASE}/functions/v1/hub-agenda/ocorrencia/${ocorrenciaId}.ics`);
  url.searchParams.set('token', token);
  const blob = await request<Blob>(
    url.toString(),
    { headers: hubHeaders() },
    { parse: 'blob', retry429: false },
  );
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `evento-${ocorrenciaId}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked later: some browsers cancel the download if the URL dies in the click's own tick.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
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

// ── Linha editorial ─────────────────────────────────────────────────────────

export function fetchLinhas(token: string) {
  return get<HubLinhasResponse>('hub-linha-editorial', { token });
}

/**
 * Comment on a row, decide a row (`item_id` with aprovado, ajustes or pendente, which
 * returns the linha's counts), or finish the whole linha (no `item_id`). Every failure
 * (404 gone or not this client's, 409 already decided, 422 empty comment) comes back with the
 * same generic message, so callers show one "try again" and refetch the list to resync. The
 * one exception is a finish with `aprovado` while a row has an ajuste: a 409 whose
 * `HubApiError.code` is `itens_com_ajustes`.
 */
export function submitLinhaAcao(token: string, body: HubLinhaAcaoBody) {
  return post<{
    ok: true;
    status?: string;
    aprovados?: number;
    ajustes?: number;
    pendentes?: number;
  }>('hub-linha-editorial', { token, ...body });
}

// ── Client login (e-mail + 6-digit code) ────────────────────────────────────

// Login calls never replay a 429: the person is told to wait, and a replay loop would keep
// the form busy for ~23 s while burning the attempts that caused the limit.
const LOGIN_REQUEST: RequestOptions = { retry429: false, notifyLogin: false };

export function requestLoginCode(workspace: string, token: string, email: string) {
  return postWith<{ ok: true }>(
    'hub-auth',
    { action: 'request_code', workspace, token, email },
    LOGIN_REQUEST,
  );
}

export function verifyLoginCode(workspace: string, token: string, email: string, code: string) {
  return postWith<{ session_token: string }>(
    'hub-auth',
    { action: 'verify_code', workspace, token, email, code },
    LOGIN_REQUEST,
  );
}

/** Ends the session on the server; the caller clears the local copy either way. */
export function logoutHub() {
  return postWith<{ ok: true }>('hub-auth', { action: 'logout' }, LOGIN_REQUEST);
}
