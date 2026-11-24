import { createJsonResponder } from "../_shared/http.ts";
import { hubAccessDenied, resolveHubAccess } from "../_shared/hub-token.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubMensagensHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
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

    const access = await resolveHubAccess(db as any, req, token, deps.now());
    if (!access.ok) return hubAccessDenied(access.reason, { db, req, json, rateLimit: deps.rateLimit });
    const hubToken = access.token;

    const okRead = await deps.rateLimit(
      db, `hub-read:${hubToken.conta_id}:${hubToken.cliente_id}`, 300, 300,
    );
    if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

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
      const beforeItemIdRaw = beforeItemIdParam === null ? NaN : parseInt(beforeItemIdParam, 10);
      const beforeItemId = !Number.isNaN(beforeItemIdRaw) ? beforeItemIdRaw : null;
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
      // The CRM reads team photos from the same RPC; the Hub never shows them.
      const rows = Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
      // is_mine: the feed does not carry the person id, so look it up for the rows that
      // name a client person. Skipped without a session person. The id never leaves here.
      const mineKeys = new Set<string>();
      const sessionPersonId = access.person?.id ?? null;
      if (sessionPersonId) {
        const named = rows.filter((r) =>
          r.is_workspace_user !== true &&
          typeof r.client_person_name === "string" && r.client_person_name !== "" &&
          typeof r.item_id === "number"
        );
        const lookups: [string, string, number[]][] = [
          ["mensagem", "mensagens", []],
          ["post_feedback", "post_approvals", []],
        ];
        for (const r of named) {
          const l = lookups.find(([source]) => source === r.source);
          if (l) l[2].push(r.item_id as number);
        }
        for (const [source, table, ids] of lookups) {
          if (ids.length === 0) continue;
          try {
            let q = db.from(table).select("id, hub_person_id").in("id", ids);
            if (table === "mensagens") q = q.eq("conta_id", contaId).eq("cliente_id", clienteId);
            const { data: owners, error: ownersError } = await q;
            if (ownersError) throw ownersError;
            for (const o of (owners ?? []) as { id: number; hub_person_id: string | null }[]) {
              if (o.hub_person_id === sessionPersonId) mineKeys.add(`${source}:${o.id}`);
            }
          } catch (err) {
            console.error("[hub-mensagens] is_mine lookup failed:", err);
          }
        }
      }
      const hubItems = rows.map((item) => ({
        ...item,
        author_avatar_url: null,
        is_mine: mineKeys.has(`${String(item.source)}:${String(item.item_id)}`),
      }));
      return json({ items: hubItems, unread });
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
      const okWrite = await deps.rateLimit(
        db, `hub-write:hub-mensagens:${contaId}:${clienteId}`, 30, 3600,
      );
      if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

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
          // Who wrote it, when the client logged in (client login). Never the email.
          hub_person_id: access.person?.id ?? null,
          hub_person_nome: access.person?.nome ?? null,
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
