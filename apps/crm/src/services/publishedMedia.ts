// =============================================
// Mesaas - Instagram Published Media Service
// =============================================
// Lista mídias publicadas AO VIVO na Graph API (nunca a tabela espelho
// `instagram_posts`), consumindo POST /instagram-integration/published-media/:clientId.
// Existe para re-mirar uma automação de comentário órfã num post já publicado,
// inclusive um post recente demais para o feed sincronizado já ter.
import { getAuthHeaders } from './instagram';

const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/instagram-integration';

export interface PublishedMediaItem {
  id: string;
  caption: string | null;
  media_type: string;
  thumbnail_url: string | null;
  permalink: string;
  timestamp: string;
}

export interface PublishedMediaPage {
  posts: PublishedMediaItem[];
  next_cursor: string | null;
}

/** Erro de `getPublishedMedia` com `code` distinguível pelo chamador:
 * `instagram_not_authorized` (409 · reconecte o Instagram do cliente) ou
 * `rate_limited` (429 · aguarde e tente de novo). Ausente para os demais erros. */
export interface PublishedMediaError extends Error {
  code?: string;
}

/** Lista mídias publicadas direto da Graph API, sem passar pelo espelho
 *  `instagram_posts`: o sync pode estar atrasado e deixar de fora justamente o
 *  post que o usuário precisa escolher. `clientId` vai no path, não no corpo. */
export async function getPublishedMedia(
  clientId: number,
  cursor?: string,
): Promise<PublishedMediaPage> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/published-media/${clientId}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(cursor ? { cursor } : {}),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // O handler devolve `code` no corpo pra todo erro conhecido: 409 vem com
    // `code: "instagram_not_authorized"`, 429 vem com `code: "rate_limited"`.
    // O fallback por `res.status === 429` é só defesa em profundidade pro
    // caso de uma camada de infra na frente (proxy, gateway, rate-limit de
    // borda) devolver um 429 sem corpo reconhecível -- contra o handler real
    // isso nunca deveria disparar, já que ele sempre inclui `code`.
    const code: string | undefined = data.code ?? (res.status === 429 ? 'rate_limited' : undefined);
    const message: string =
      data.message ??
      (res.status === 429
        ? 'Muitas requisições seguidas. Aguarde um minuto e tente novamente.'
        : 'Falha ao listar mídias publicadas');
    const err = new Error(message) as PublishedMediaError;
    err.code = code;
    throw err;
  }

  return res.json();
}
