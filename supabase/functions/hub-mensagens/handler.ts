import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubMensagensHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

const MAX_CONTENT = 4000;

function firstUnread(data: unknown): number {
  if (!Array.isArray(data) || data.length === 0) return 0;
  const n = Number((data[0] as { unread_count?: unknown }).unread_count);
  return Number.isFinite(n) ? n : 0;
}

export function createHubMensagensHandler(deps: HubMensagensHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const idx = pathParts.indexOf("hub-mensagens");
    const seg = idx >= 0 ? pathParts.slice(idx + 1) : [];
    const isSeen = seg.length === 1 && seg[0] === "seen";

    const db = deps.createDb();

    const token =
      url.searchParams.get("token") ?? (await req.clone().json().catch(() => ({}))).token;
    if (!token) return json({ error: "token required" }, 400);

    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    const mensagensOn = await effectivePlanFeature(db as any, hubToken.conta_id, "feature_mensagens");
    if (!mensagensOn) return json({ error: "Recurso indisponível." }, 403);

    const contaId = hubToken.conta_id;
    const clienteId = hubToken.cliente_id;

    if (req.method === "GET") {
      const { data: unreadData, error: unreadError } = await db.rpc("get_mensagens_unread", {
        p_conta_id: contaId,
        p_cliente_id: clienteId,
      });
      if (unreadError) {
        console.error("[hub-mensagens] unread error:", unreadError);
        return json({ error: "Erro interno." }, 500);
      }
      const unread = firstUnread(unreadData);

      if (url.searchParams.has("count")) return json({ unread });

      const before = url.searchParams.get("before");
      const beforeSource = url.searchParams.get("before_source");
      const beforeItemIdParam = url.searchParams.get("before_item_id");
      const beforeItemIdRaw = beforeItemIdParam === null ? NaN : Number(beforeItemIdParam);
      const beforeItemId = Number.isFinite(beforeItemIdRaw) ? beforeItemIdRaw : null;
      const { data: items, error } = await db.rpc("get_mensagens_feed", {
        p_conta_id: contaId,
        p_cliente_id: clienteId,
        p_before: before || null,
        p_limit: 50,
        p_before_source: beforeSource || null,
        p_before_item_id: beforeItemId,
      });
      if (error) {
        console.error("[hub-mensagens] feed error:", error);
        return json({ error: "Erro interno." }, 500);
      }
      return json({ items: items ?? [], unread });
    }

    if (req.method === "POST" && isSeen) {
      const { error } = await db.rpc("mark_mensagens_seen", {
        p_conta_id: contaId,
        p_cliente_id: clienteId,
      });
      if (error) {
        console.error("[hub-mensagens] seen error:", error);
        return json({ error: "Erro interno." }, 500);
      }
      return json({ ok: true });
    }

    if (req.method === "POST" && seg.length === 0) {
      const body = await req.json().catch(() => ({}));
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content || content.length > MAX_CONTENT) {
        return json({ error: "Mensagem inválida." }, 400);
      }
      const { error } = await db
        .from("mensagens")
        .insert({
          conta_id: contaId,
          cliente_id: clienteId,
          content,
          is_workspace_user: false,
        })
        .select("id")
        .single();
      if (error) {
        console.error("[hub-mensagens] insert error:", error);
        return json({ error: "Erro interno." }, 500);
      }
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
