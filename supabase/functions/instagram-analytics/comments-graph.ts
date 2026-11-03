// Busca os comentários de uma mídia na Graph API, com prazo.
// Paginação: mesma rota, cursor `paging.cursors.after` enquanto houver `paging.next`
// (o token continua só no header Bearer; nunca seguimos `paging.next` cru, que
// carregaria o access_token na query string).
// Log nunca leva texto de comentário nem username: só o `kind` do erro.
import { classifyIgError, igRequest } from "../_shared/instagram-messaging.ts";

export interface IgComment {
  id: string;
  text: string;
  timestamp: string;
  username: string;
  like_count: number;
  replies_count: number;
  replies_more: boolean;
}

const PAGE_LIMIT = 50;
const REPLIES_LIMIT = 25;
const PAGE_TIMEOUT_MS = 8000;
const FIELDS = `id,text,timestamp,username,like_count,replies.limit(${REPLIES_LIMIT}){id}`;

// deno-lint-ignore no-explicit-any
function mapComment(raw: any): IgComment {
  const replies = Array.isArray(raw?.replies?.data) ? raw.replies.data : [];
  return {
    id: String(raw?.id ?? ""),
    text: typeof raw?.text === "string" ? raw.text : "",
    timestamp: typeof raw?.timestamp === "string" ? raw.timestamp : "",
    username: typeof raw?.username === "string" ? raw.username : "",
    like_count: typeof raw?.like_count === "number" ? raw.like_count : 0,
    replies_count: replies.length,
    replies_more: replies.length >= REPLIES_LIMIT || Boolean(raw?.replies?.paging?.next),
  };
}

export async function fetchMediaComments(
  deps: { fetchFn?: typeof fetch; now?: () => number },
  args: { mediaId: string; token: string; max: number; deadlineAt: number },
): Promise<{ comments: IgComment[]; truncated: boolean }> {
  const now = deps.now ?? Date.now;
  const comments: IgComment[] = [];
  let after: string | undefined;
  let first = true;

  while (true) {
    const remaining = args.deadlineAt - now();
    if (remaining <= 0) return { comments, truncated: true };
    const timeoutMs = Math.min(PAGE_TIMEOUT_MS, remaining);
    let path = `/${encodeURIComponent(args.mediaId)}/comments?fields=${encodeURIComponent(FIELDS)}&limit=${PAGE_LIMIT}`;
    if (after) path += `&after=${encodeURIComponent(after)}`;

    // deno-lint-ignore no-explicit-any
    let data: any;
    try {
      data = await igRequest({ fetchFn: deps.fetchFn, timeoutMs }, "GET", path, args.token);
    } catch (e) {
      if (first) throw e;
      console.error("[comments-graph] page failed, returning partial:", classifyIgError(e));
      return { comments, truncated: true };
    }
    first = false;

    const page = Array.isArray(data?.data) ? data.data : [];
    for (let i = 0; i < page.length; i++) {
      comments.push(mapComment(page[i]));
      if (comments.length >= args.max) {
        const more = i < page.length - 1 || Boolean(data?.paging?.next);
        return { comments, truncated: more };
      }
    }

    const nextAfter = data?.paging?.cursors?.after;
    if (!data?.paging?.next || typeof nextAfter !== "string" || !nextAfter) {
      return { comments, truncated: false };
    }
    after = nextAfter;
  }
}
