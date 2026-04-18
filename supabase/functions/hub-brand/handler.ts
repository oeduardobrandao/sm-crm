import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubBrandHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
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
    const { data: hubToken } = await db
      .from("client_hub_tokens")
      .select("cliente_id, conta_id, is_active")
      .eq("token", token)
      .gt("expires_at", deps.now())
      .maybeSingle();
    if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

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
