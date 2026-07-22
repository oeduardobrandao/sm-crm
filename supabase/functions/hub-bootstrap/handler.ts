import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubBootstrapHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  /** Sliding-window renewal. MUST NOT throw — a renewal failure must never
   *  break the client's portal. See index.ts for the timeout + catch wrapper. */
  touchToken: (token: string) => Promise<void>;
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

    // Sliding window: keep an in-use link alive. Throttled inside the SQL function.
    // Defence in depth — index.ts already swallows errors, but a handler-level catch
    // guarantees no renewal fault can ever reach the client.
    try {
      await deps.touchToken(token);
    } catch {
      // intentionally ignored
    }

    const { data: cliente } = await db
      .from("clientes")
      .select("nome")
      .eq("id", hubToken.cliente_id)
      .single();

    // The client's photo is their connected Instagram avatar, cached to the public
    // `avatars` bucket by instagram-integration (the live CDN urls expire). Clients
    // without a connected account are normal, so this is best-effort: a miss just
    // falls back to the initial, it must never fail the whole bootstrap.
    let clienteFotoUrl: string | null = null;
    try {
      const { data: igAccount } = await db
        .from("instagram_accounts")
        .select("profile_picture_url")
        .eq("client_id", hubToken.cliente_id)
        .maybeSingle();
      clienteFotoUrl = igAccount?.profile_picture_url || null;
    } catch {
      // intentionally ignored — falls back to the client's initial
    }

    // Fail closed: an entitlements RPC hiccup must never break the client's portal —
    // same defence-in-depth principle as touchToken above, just hiding one nav item
    // instead of silently doing nothing.
    let featureMensagens = false;
    try {
      featureMensagens = await effectivePlanFeature(db as any, conta.id, "feature_mensagens");
    } catch {
      // intentionally ignored — defaults to false
    }

    return json({
      workspace: {
        name: conta.name,
        logo_url: conta.logo_url,
        brand_color: conta.brand_color ?? "#1a1a2e",
      },
      cliente_nome: cliente?.nome ?? "",
      cliente_foto_url: clienteFotoUrl,
      is_active: hubToken.is_active,
      cliente_id: hubToken.cliente_id,
      feature_mensagens: featureMensagens,
    });
  };
}
