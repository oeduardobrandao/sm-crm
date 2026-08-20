// Cliente de comentários/DM (Instagram Login). REGRAS DA CASA aplicadas aqui:
// Bearer no header (nunca token em query string) e AbortSignal.timeout em TODA
// chamada (um fetch pendurado seguraria o lock de 'processing' do envio).
import { GRAPH_BASE } from "./instagram-graph.ts";
import type { PrivateReplyMessage } from "./instagram-dm-payload.ts";

export interface IgMessagingDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export type IgErrorKind = "transient" | "token_expired" | "already_replied" | "permanent" | "timeout";

const TRANSIENT_GRAPH_CODES = new Set([1, 2, 4, 9, 17, 613]);
// A Meta não documenta um código estável para "já existe private reply";
// classificação por mensagem, com o erro completo logado para observabilidade.
const ALREADY_REPLIED_RE = /already.*(private reply|received)|one private reply/i;

export class IgApiError extends Error {
  kind: IgErrorKind;
  graphCode?: number;
  graphSubcode?: number;
  httpStatus?: number;
  constructor(message: string, opts: { kind?: IgErrorKind; graphCode?: number; graphSubcode?: number; httpStatus?: number } = {}) {
    super(message);
    this.graphCode = opts.graphCode;
    this.graphSubcode = opts.graphSubcode;
    this.httpStatus = opts.httpStatus;
    this.kind = opts.kind ?? classifyRaw(message, opts.graphCode);
  }
}

function classifyRaw(message: string, graphCode?: number): IgErrorKind {
  if (ALREADY_REPLIED_RE.test(message)) return "already_replied";
  if (graphCode === 190) return "token_expired";
  if (graphCode !== undefined && TRANSIENT_GRAPH_CODES.has(graphCode)) return "transient";
  return "permanent";
}

export function classifyIgError(err: unknown): IgErrorKind {
  if (err instanceof IgApiError) {
    return err.kind;
  }
  if (err instanceof DOMException && err.name === "TimeoutError") return "timeout";
  return "permanent";
}

async function igRequest(
  deps: IgMessagingDeps,
  method: "GET" | "POST",
  path: string,
  token: string,
  body?: unknown,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  let res: Response;
  try {
    res = await fetchFn(`${GRAPH_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new IgApiError("graph request timed out", { kind: "timeout" });
    }
    throw new IgApiError(e instanceof Error ? e.message : String(e), { kind: "transient" });
  }
  const data = await res.json().catch(() => ({}));
  if (data.error) {
    console.error("[instagram-messaging] graph error:", JSON.stringify(data.error));
    throw new IgApiError(String(data.error.message ?? "graph error"), {
      graphCode: typeof data.error.code === "number" ? data.error.code : undefined,
      graphSubcode: typeof data.error.error_subcode === "number" ? data.error.error_subcode : undefined,
      httpStatus: res.status,
    });
  }
  if (!res.ok) {
    throw new IgApiError(`graph http ${res.status}`, { httpStatus: res.status, kind: "transient" });
  }
  return data;
}

export async function sendPrivateReply(
  deps: IgMessagingDeps,
  args: { igUserId: string; token: string; commentId: string; message: PrivateReplyMessage },
): Promise<void> {
  await igRequest(deps, "POST", `/${args.igUserId}/messages`, args.token, {
    recipient: { comment_id: args.commentId },
    message: args.message,
  });
}

export async function replyToComment(
  deps: IgMessagingDeps,
  args: { commentId: string; token: string; text: string },
): Promise<{ replyId: string }> {
  const data = await igRequest(deps, "POST", `/${args.commentId}/replies`, args.token, {
    message: args.text,
  });
  return { replyId: String(data.id ?? "") };
}

export interface IgCommentDetails {
  id: string;
  from?: { id: string; username?: string };
  parent_id?: string;
  text?: string;
  media?: { id: string };
  timestamp?: string;
}

export async function fetchComment(
  deps: IgMessagingDeps,
  args: { commentId: string; token: string },
): Promise<IgCommentDetails> {
  return await igRequest(
    deps, "GET", `/${args.commentId}?fields=from,parent_id,text,media,timestamp`, args.token,
  ) as IgCommentDetails;
}

export async function fetchReplies(
  deps: IgMessagingDeps,
  args: { commentId: string; token: string },
): Promise<Array<{ id: string; text?: string; from?: { id: string } }>> {
  const data = await igRequest(deps, "GET", `/${args.commentId}/replies?fields=id,text,from`, args.token);
  return Array.isArray(data.data) ? data.data : [];
}

export async function subscribeToComments(deps: IgMessagingDeps, token: string): Promise<void> {
  await igRequest(deps, "POST", `/me/subscribed_apps?subscribed_fields=comments`, token);
}

export async function fetchSubscribedFields(deps: IgMessagingDeps, token: string): Promise<string[]> {
  const data = await igRequest(deps, "GET", `/me/subscribed_apps`, token);
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows.flatMap((r: { subscribed_fields?: string[] }) => r.subscribed_fields ?? []);
}
