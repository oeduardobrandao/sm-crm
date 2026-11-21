// Busca os comentários de uma mídia na Graph API, com prazo.
// Paginação: mesma rota, cursor `paging.cursors.after` enquanto houver `paging.next`
// (o token continua só no header Bearer; nunca seguimos `paging.next` cru, que
// carregaria o access_token na query string).
// Log nunca leva texto de comentário nem username: só o `kind` do erro.
import { classifyIgError, IgApiError, igRequest } from "../_shared/instagram-messaging.ts";

export interface IgComment {
  id: string;
  text: string;
  timestamp: string;
  username: string;
  like_count: number;
  replies_count: number;
  replies_more: boolean;
  hidden: boolean;
  from_owner: boolean;
  parent_id: string | null;
}

/** A Graph respondeu 200 sem `success: true` numa moderação. */
export class GraphNoSuccess extends Error {}

export interface CommentRef {
  id: string;
  mediaId: string | null;
  fromId: string | null;
  parentId: string | null;
}

const PAGE_LIMIT = 50;
const REPLIES_LIMIT = 25;
const PAGE_TIMEOUT_MS = 8000;
// `username` vem vazio para boa parte dos comentários; `from{username}` é o
// mesmo campo que o webhook de comentários já lê e serve de alternativa.
const FIELDS =
  `id,text,timestamp,username,hidden,parent_id,from{id,username},like_count,replies.limit(${REPLIES_LIMIT}){id}`;

// deno-lint-ignore no-explicit-any
function mapComment(raw: any, ownerIds: string[]): IgComment {
  const replies = Array.isArray(raw?.replies?.data) ? raw.replies.data : [];
  // `from.id` só serve para comparar com o dono; nunca vai no resultado.
  const fromId = raw?.from?.id == null ? "" : String(raw.from.id);
  return {
    id: String(raw?.id ?? ""),
    text: typeof raw?.text === "string" ? raw.text : "",
    timestamp: typeof raw?.timestamp === "string" ? raw.timestamp : "",
    username: typeof raw?.username === "string" && raw.username
      ? raw.username
      : typeof raw?.from?.username === "string"
      ? raw.from.username
      : "",
    like_count: typeof raw?.like_count === "number" ? raw.like_count : 0,
    replies_count: replies.length,
    replies_more: replies.length >= REPLIES_LIMIT || Boolean(raw?.replies?.paging?.next),
    hidden: raw?.hidden === true,
    from_owner: fromId !== "" && ownerIds.includes(fromId),
    parent_id: typeof raw?.parent_id === "string" && raw.parent_id ? raw.parent_id : null,
  };
}

export async function fetchMediaComments(
  deps: { fetchFn?: typeof fetch; now?: () => number },
  args: { mediaId: string; token: string; max: number; deadlineAt: number; ownerIds: string[] },
): Promise<{ comments: IgComment[]; truncated: boolean }> {
  const now = deps.now ?? Date.now;
  // Dedupe por id ao longo de todas as páginas (respostas aparecem soltas e aninhadas).
  const byId = new Map<string, IgComment>();
  // reply id -> id do pai, visto em qualquer página (a resposta pode vir antes do pai).
  const derivedParent = new Map<string, string>();
  let after: string | undefined;
  let first = true;

  const finish = (truncated: boolean) => {
    const comments = [...byId.values()].map((c) =>
      c.parent_id === null && derivedParent.has(c.id) ? { ...c, parent_id: derivedParent.get(c.id)! } : c
    );
    return { comments, truncated };
  };

  while (true) {
    const remaining = args.deadlineAt - now();
    if (remaining <= 0) return finish(true);
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
      return finish(true);
    }
    first = false;

    const page = Array.isArray(data?.data) ? data.data : [];
    for (let i = 0; i < page.length; i++) {
      const c = mapComment(page[i], args.ownerIds);
      if (c.id && !byId.has(c.id)) byId.set(c.id, c);
      const rs = Array.isArray(page[i]?.replies?.data) ? page[i].replies.data : [];
      for (const r of rs) {
        if (r?.id != null && c.id && !derivedParent.has(String(r.id))) derivedParent.set(String(r.id), c.id);
      }
      if (byId.size >= args.max) {
        const more = i < page.length - 1 || Boolean(data?.paging?.next);
        return finish(more);
      }
    }

    const nextAfter = data?.paging?.cursors?.after;
    if (!data?.paging?.next || typeof nextAfter !== "string" || !nextAfter) {
      return finish(false);
    }
    after = nextAfter;
  }
}

const MODERATION_TIMEOUT_MS = 8000;

export async function getCommentRef(
  deps: { fetchFn?: typeof fetch },
  args: { commentId: string; token: string },
): Promise<CommentRef> {
  const fields = encodeURIComponent("id,media{id},from{id},parent_id");
  const data = await igRequest(
    { fetchFn: deps.fetchFn, timeoutMs: MODERATION_TIMEOUT_MS },
    "GET",
    `/${encodeURIComponent(args.commentId)}?fields=${fields}`,
    args.token,
  );
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    id: String(data?.id ?? args.commentId),
    mediaId: str(data?.media?.id),
    fromId: str(data?.from?.id),
    parentId: str(data?.parent_id),
  };
}

export async function setCommentHidden(
  deps: { fetchFn?: typeof fetch },
  args: { commentId: string; token: string; hidden: boolean },
): Promise<void> {
  const data = await igRequest(
    { fetchFn: deps.fetchFn, timeoutMs: MODERATION_TIMEOUT_MS },
    "POST",
    `/${encodeURIComponent(args.commentId)}?hide=${args.hidden ? "true" : "false"}`,
    args.token,
  );
  if (data?.success !== true) throw new GraphNoSuccess("hide did not report success");
}

export async function deleteComment(
  deps: { fetchFn?: typeof fetch },
  args: { commentId: string; token: string },
): Promise<void> {
  const data = await igRequest(
    { fetchFn: deps.fetchFn, timeoutMs: MODERATION_TIMEOUT_MS },
    "DELETE",
    `/${encodeURIComponent(args.commentId)}`,
    args.token,
  );
  if (data?.success !== true) throw new GraphNoSuccess("delete did not report success");
}

/** Comentário já apagado ou inacessível: erro 100 / subcódigo 33 da Graph. */
export function isCommentUnavailable(e: unknown): boolean {
  return e instanceof IgApiError && e.graphCode === 100 && e.graphSubcode === 33;
}
