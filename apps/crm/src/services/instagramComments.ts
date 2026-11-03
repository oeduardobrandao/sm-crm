import { EDGE_URL, getAuthHeaders } from './analytics';

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
      if (body && typeof body.error === 'string') code = body.error;
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
    `/comments-analysis/${clientId}/${encodeURIComponent(postId)}`,
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
    `/comments-analysis-account/${clientId}`,
    'POST',
  );
  return r.analysis;
}

export function commentsErrorMessage(e: unknown): string {
  if (e instanceof CommentsApiError) {
    if (e.status === 429 || e.code === 'rate_limited') {
      return 'Muitas análises seguidas. Tente de novo em alguns minutos.';
    }
    switch (e.code) {
      case 'missing_comments_scope':
        return 'Reconecte o Instagram deste cliente para ver os comentários.';
      case 'too_few_comments':
        return 'Ainda não há comentários suficientes para analisar.';
      case 'ai_unavailable':
        return 'A análise por IA está indisponível no momento.';
      case 'ai_timeout':
        return 'A análise demorou demais. Tente de novo.';
      case 'ai_bad_output':
        return 'Não foi possível gerar a análise. Tente de novo.';
    }
  }
  return 'Não foi possível carregar os comentários.';
}
