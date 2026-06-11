import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubBootstrapHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

export function createHubBootstrapHandler(deps: HubBootstrapHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const workspaceSlug = url.searchParams.get("workspace");
    const token = url.searchParams.get("token");

    if (!workspaceSlug || !token) return json({ error: "workspace and token are required" }, 400);

    const db = deps.createDb();

    const { data: conta } = await db
      .from("workspaces")
      .select("id, name, logo_url, brand_color, hub_enabled")
      .eq("slug", workspaceSlug)
      .maybeSingle();

    if (!conta) return json({ error: "Workspace não encontrado." }, 404);
    if (!conta.hub_enabled) return json({ error: "Hub desativado." }, 403);

    // Pass conta.id as expectedContaId to preserve the slug<->token binding:
    // a token from workspace A must never be served under workspace B's slug.
    const hubToken = await resolveHubToken(db as any, token, deps.now(), conta.id);
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    const { data: cliente } = await db
      .from("clientes")
      .select("nome")
      .eq("id", hubToken.cliente_id)
      .single();

    return json({
      workspace: {
        name: conta.name,
        logo_url: conta.logo_url,
        brand_color: conta.brand_color ?? "#1a1a2e",
      },
      cliente_nome: cliente?.nome ?? "",
      is_active: hubToken.is_active,
      cliente_id: hubToken.cliente_id,
    });
  };
}
