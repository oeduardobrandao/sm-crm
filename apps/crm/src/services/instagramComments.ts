import type { TFunction } from 'i18next';
import { i18n } from '@mesaas/i18n';
import { EDGE_URL, getAuthHeaders } from './analytics';

/** A análise sai no idioma da interface (seletor pt/en). */
function langQuery(): string {
  return `?lang=${i18n.language?.startsWith('en') ? 'en' : 'pt'}`;
}

export interface IgComment {
  id: string;
  text: string;
  timestamp: string;
  username: string;
  like_count: number;
  replies_count: number;
  replies_more: boolean;
  /** Absent on an older function: treat as false. */
  hidden?: boolean;
  from_owner?: boolean;
  /** Absent on an older function: treat as null (top-level). */
  parent_id?: string | null;
}

export type Sentimento = 'positivo' | 'misto' | 'negativo' | 'polemico';

export interface CommentAnalysis {
  sentimento_geral: Sentimento;
  resumo: string;
  distribuicao: {
    apoio: number;
    duvida: number;
    critica: number;
    discussao: number;
    spam: number;
  };
  temas: { tema: string; peso: number; exemplo: string; post_ids?: string[] }[];
  perguntas_frequentes: string[];
  ideias: { id: string; titulo: string; descricao: string; motivo: string }[];
}

export interface StoredAnalysis {
  result: CommentAnalysis;
  comments_analyzed: number;
  comments_count_at_analysis: number;
  /** Posts whose comments were read for this analysis; null on rows saved before it existed. */
  posts_analyzed: number | null;
  analyzed_at: string;
  period_start: string | null;
  period_end: string | null;
}

export interface PostCommentsResponse {
  comments: IgComment[];
  total_fetched: number;
  truncated: boolean;
  comments_count: number;
  cached_analysis: StoredAnalysis | null;
}

export interface AccountCommentsAnalysisResponse {
  analysis: StoredAnalysis | null;
  current_comments: number;
}

export class CommentsApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.name = 'CommentsApiError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const authHeaders = await getAuthHeaders();
  const init: RequestInit =
    body === undefined
      ? { method, headers: authHeaders }
      : {
          method,
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
  const res = await fetch(`${EDGE_URL}${path}`, init);
  if (!res.ok) {
    let code = 'unknown';
    try {
      const body = await res.json();
      // Comments routes answer `{ error: "<code>" }`; the shared expired-token path
      // answers `{ error: true, code: "TOKEN_EXPIRED" }`.
      if (body && typeof body.error === 'string') code = body.error;
      else if (body && typeof body.code === 'string') code = body.code;
    } catch {
      /* non-JSON body */
    }
    throw new CommentsApiError(code, res.status);
  }
  return (await res.json()) as T;
}

export function getPostComments(clientId: number, postId: string): Promise<PostCommentsResponse> {
  return request(`/post-comments/${clientId}/${encodeURIComponent(postId)}`, 'GET');
}

export async function analyzePostComments(
  clientId: number,
  postId: string,
): Promise<StoredAnalysis> {
  const r = await request<{ analysis: StoredAnalysis }>(
    `/comments-analysis/${clientId}/${encodeURIComponent(postId)}${langQuery()}`,
    'POST',
  );
  return r.analysis;
}

export function getAccountCommentsAnalysis(
  clientId: number,
): Promise<AccountCommentsAnalysisResponse> {
  return request(`/comments-analysis-account/${clientId}`, 'GET');
}

export async function analyzeAccountComments(clientId: number): Promise<StoredAnalysis> {
  const r = await request<{ analysis: StoredAnalysis }>(
    `/comments-analysis-account/${clientId}${langQuery()}`,
    'POST',
  );
  return r.analysis;
}

export function setCommentHidden(
  clientId: number,
  postId: string,
  commentId: string,
  hidden: boolean,
): Promise<{ id: string; hidden: boolean }> {
  return request(
    `/post-comments/${clientId}/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/hide`,
    'POST',
    { hidden },
  );
}

export function deleteComment(
  clientId: number,
  postId: string,
  commentId: string,
): Promise<{ id: string; deleted: true }> {
  return request(
    `/post-comments/${clientId}/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}`,
    'DELETE',
  );
}

/** User-facing copy for a comments error. `t` is the one from
 *  `useTranslation('analyticsComments')`. */
export function commentsErrorMessage(e: unknown, t: TFunction): string {
  if (e instanceof CommentsApiError) {
    if (e.code === 'write_rate_limited') return t('error.writeRateLimited');
    if (e.status === 429 || e.code === 'rate_limited') {
      return t('error.rateLimited');
    }
    switch (e.code) {
      case 'missing_comments_scope':
        return t('error.missingScope');
      case 'forbidden':
        return t('error.forbidden');
      case 'comment_not_found':
      case 'comment_unavailable':
        return t('error.commentGone');
      case 'owner_comment_not_hideable':
        return t('error.ownerNotHideable');
      case 'TOKEN_EXPIRED':
        return t('error.tokenExpired');
      case 'too_few_comments':
        return t('error.tooFewComments');
      case 'ai_unavailable':
        return t('error.aiUnavailable');
      case 'ai_timeout':
        return t('error.aiTimeout');
      case 'ai_bad_output':
        return t('error.aiBadOutput');
    }
  }
  return t('error.generic');
}
