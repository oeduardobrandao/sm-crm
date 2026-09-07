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
    // O 429 do handler não carrega `code` no corpo (so `{ error: "Rate limit
    // exceeded" }`) -- so o status distingue esse caso do 409, que ja vem com
    // `code: "instagram_not_authorized"`.
    const code: string | undefined = res.status === 429 ? 'rate_limited' : data.code;
    const message: string =
      res.status === 429
        ? 'Muitas requisições seguidas. Aguarde um minuto e tente novamente.'
        : (data.message ?? 'Falha ao listar mídias publicadas');
    const err = new Error(message) as PublishedMediaError;
    err.code = code;
    throw err;
  }

  return res.json();
}
