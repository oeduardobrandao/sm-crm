import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubPagesHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
}

export function createHubPagesHandler(deps: HubPagesHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const pageId = url.searchParams.get("page_id");
    if (!token) return json({ error: "token required" }, 400);

    const db = deps.createDb();
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return json({ error: "Link inválido." }, 404);
    }

    const okRead = await deps.rateLimit(
      db, `hub-read:${hubToken.conta_id}:${hubToken.cliente_id}`, 300, 300,
    );
    if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

    const { data: clientCheck } = await db
      .from("clientes")
      .select("id")
      .eq("id", hubToken.cliente_id)
      .eq("conta_id", hubToken.conta_id)
      .maybeSingle();
    if (!clientCheck) return json({ error: "Link inválido." }, 404);

    if (pageId) {
      const { data: page } = await db
        .from("hub_pages")
        .select("*, clientes!inner(conta_id)")
        .eq("id", pageId)
        .eq("cliente_id", hubToken.cliente_id)
        .eq("clientes.conta_id", hubToken.conta_id)
        .maybeSingle();
      if (!page) return json({ error: "Página não encontrada." }, 404);
      const { clientes: _, ...pageData } = page as Record<string, unknown>;
      return json({ page: pageData });
    }

    const { data: rawPages } = await db
      .from("hub_pages")
      .select("id, title, display_order, created_at, clientes!inner(conta_id)")
      .eq("cliente_id", hubToken.cliente_id)
      .eq("clientes.conta_id", hubToken.conta_id)
      .order("display_order");
    const pages = (rawPages ?? []).map(({ clientes: _, ...page }: Record<string, unknown>) => page);
    return json({ pages });
  };
}
