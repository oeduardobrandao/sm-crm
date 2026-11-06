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

async function request<T>(path: string, method: 'GET' | 'POST'): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}${path}`, { method, headers });
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

/** User-facing copy for a comments error. `t` is the one from
 *  `useTranslation('analyticsComments')`. */
export function commentsErrorMessage(e: unknown, t: TFunction): string {
  if (e instanceof CommentsApiError) {
    if (e.status === 429 || e.code === 'rate_limited') {
      return t('error.rateLimited');
    }
    switch (e.code) {
      case 'missing_comments_scope':
        return t('error.missingScope');
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
