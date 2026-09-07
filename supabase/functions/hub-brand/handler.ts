import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubBrandHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
}

export function createHubBrandHandler(deps: HubBrandHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const token = new URL(req.url).searchParams.get("token");
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

    const { data: brand } = await db.from("hub_brand").select("*").eq("cliente_id", hubToken.cliente_id).maybeSingle();
    const { data: files } = await db.from("hub_brand_files").select("*").eq("cliente_id", hubToken.cliente_id).order("display_order");

    return json({ brand: brand ?? null, files: files ?? [] });
  };
}
