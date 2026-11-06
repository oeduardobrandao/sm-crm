import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubMediaNotesHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
}

const MAX_BODY_LENGTH = 2000;
// post_media_notes.t_seconds is numeric(8,2): anything larger would overflow in the RPC.
const MAX_T_SECONDS = 999999.99;
const TOO_MANY = "Muitas tentativas. Aguarde alguns minutos.";
const INVALID = "Dados inválidos.";

const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isFraction = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

function parseBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_BODY_LENGTH ? trimmed : null;
}

// The agency's inbox shows p_comentario as the message text: say it is about the media,
// and keep a long body to a preview (the full text is on the post).
const NOTIFICATION_BODY_MAX = 280;
const NOTIFICATION_PREFIX = {
  create: "Comentário na mídia: ",
  reply: "Resposta a um comentário na mídia: ",
} as const;

export function notificationComentario(op: "create" | "reply", body: string): string {
  // Code points, not UTF-16 units, so an emoji is never cut in half.
  const chars = Array.from(body);
  const preview = chars.length > NOTIFICATION_BODY_MAX
    ? `${chars.slice(0, NOTIFICATION_BODY_MAX - 1).join("").trimEnd()}…`
    : body;
  return NOTIFICATION_PREFIX[op] + preview;
}

/** RPC raise codes (P0001) arrive in the error message, possibly with context around them. */
function rpcErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}

export function createHubMediaNotesHandler(deps: HubMediaNotesHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let payload: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: INVALID }, 400);
      payload = parsed as Record<string, unknown>;
    } catch {
      return json({ error: INVALID }, 400);
    }

    const { token, op } = payload;
    if (typeof token !== "string" || !token) return json({ error: "token required" }, 400);
    if (op !== "create" && op !== "reply") return json({ error: INVALID }, 400);

    // Everything is validated before the first DB round-trip so a bad payload costs nothing.
    const body = parseBody(payload.body);
    if (!body) return json({ error: INVALID }, 400);

    let create: { postId: number; linkId: number; t: number | null; x: number | null; y: number | null } | null = null;
    let noteId = 0;
    if (op === "create") {
      const { post_id, link_id, t_seconds, x, y } = payload;
      if (!isPositiveInt(post_id) || !isPositiveInt(link_id)) return json({ error: INVALID }, 400);
      const hasT = t_seconds != null;
      if (hasT && !(typeof t_seconds === "number" && Number.isFinite(t_seconds) && t_seconds >= 0 && t_seconds <= MAX_T_SECONDS)) {
        return json({ error: INVALID }, 400);
      }
      // A spot needs both coordinates, as fractions of the rendered media box.
      const hasX = x != null;
      const hasY = y != null;
      if (hasX !== hasY) return json({ error: INVALID }, 400);
      if (hasX && !(isFraction(x) && isFraction(y))) return json({ error: INVALID }, 400);
      create = {
        postId: post_id,
        linkId: link_id,
        t: hasT ? (t_seconds as number) : null,
        x: hasX ? (x as number) : null,
        y: hasY ? (y as number) : null,
      };
    } else {
      if (!isPositiveInt(payload.note_id)) return json({ error: INVALID }, 400);
      noteId = payload.note_id;
    }

    const db = deps.createDb();

    // deno-lint-ignore no-explicit-any
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return json({ error: TOO_MANY }, 429);
      return json({ error: "Link inválido." }, 404);
    }

    // Writes only: a note must never spend the read budget the Hub pages share.
    const okWrite = await deps.rateLimit(
      db, `hub-write:hub-media-notes:${hubToken.conta_id}:${hubToken.cliente_id}`, 60, 3600,
    );
    if (!okWrite) return json({ error: TOO_MANY }, 429);

    // conta/cliente come from the token, never from the request.
    const { data, error } = create
      ? await db.rpc("hub_create_media_note", {
        p_conta_id: hubToken.conta_id,
        p_cliente_id: hubToken.cliente_id,
        p_token: token,
        p_post_id: create.postId,
        p_link_id: create.linkId,
        p_t_seconds: create.t,
        p_x: create.x,
        p_y: create.y,
        p_body: body,
      })
      : await db.rpc("hub_add_media_note_reply", {
        p_conta_id: hubToken.conta_id,
        p_cliente_id: hubToken.cliente_id,
        p_token: token,
        p_note_id: noteId,
        p_body: body,
      });

    if (error) {
      const message = rpcErrorMessage(error);
      if (message.includes("post_not_found") || message.includes("note_not_found")) {
        return json({ error: "Post não encontrado." }, 404);
      }
      if (message.includes("post_not_visible")) {
        return json({ error: "Post ainda não foi enviado para o cliente." }, 400);
      }
      if (message.includes("link_not_on_post") || message.includes("invalid_anchor")) {
        return json({ error: INVALID }, 400);
      }
      console.error("[hub-media-notes] rpc failed:", error);
      return json({ error: "Erro ao salvar comentário." }, 500);
    }

    const newId = Number(data);

    // The agency is told via the same channel as a plain Hub message. Best-effort:
    // the note is already saved, so a failure here only logs.
    try {
      let postId: number | null = create?.postId ?? null;
      if (postId == null) {
        const { data: row, error: lookupErr } = await db
          .from("post_media_notes")
          .select("post_id")
          .eq("id", noteId)
          .eq("conta_id", hubToken.conta_id)
          .maybeSingle();
        if (lookupErr) console.error("[hub-media-notes] note lookup failed:", lookupErr);
        postId = typeof row?.post_id === "number" ? row.post_id : null;
      }
      if (postId != null) {
        const { error: notifErr } = await db.rpc("create_post_approval_notification", {
          p_post_id: postId,
          p_action: "mensagem",
          p_comentario: notificationComentario(create ? "create" : "reply", body),
        });
        if (notifErr) console.error("[hub-media-notes] notification creation failed:", notifErr);
      }
    } catch (e) {
      console.error("[hub-media-notes] notification threw:", e);
    }

    return json(create ? { ok: true, note_id: newId } : { ok: true, reply_id: newId });
  };
}
