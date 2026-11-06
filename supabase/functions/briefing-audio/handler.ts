import { createJsonResponder } from "../_shared/http.ts";
import { AUDIO_COLUMNS, buildAudioView, type AudioRow } from "../_shared/briefing-audio.ts";
import {
  type ClientScope,
  type ClientScopeLoader,
  hasClientAccess,
  loadClientScope as realLoadClientScope,
} from "../_shared/client-scope.ts";

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  // deno-lint-ignore no-explicit-any
  createDb: () => any;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
  /** Acesso por cliente: the caller's client scope (defaults to the real loader). */
  loadClientScope?: ClientScopeLoader;
}

export function createBriefingAudioHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const svc = deps.createDb();
    const { data: { user } = { user: null }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    // Tenant = workspace ATIVA + membership confirmada (padrão automation-media).
    const { data: profile } = await svc.from("profiles").select("active_workspace_id").eq("id", user.id).single();
    const contaId = profile?.active_workspace_id as string | undefined;
    if (!contaId) return json({ error: "Profile not found" }, 403);
    const { data: member } = await svc.from("workspace_members")
      .select("user_id, role").eq("workspace_id", contaId).eq("user_id", user.id).maybeSingle();
    if (!member) return json({ error: "Forbidden" }, 403);

    const questionId = new URL(req.url).searchParams.get("question_id");
    if (!questionId || questionId.length !== 36) return json({ error: "question_id required" }, 400);

    // Acesso por cliente: a question of a client outside the caller's scope answers like a missing
    // one. Fails closed: the briefing is a "context" read the DB grants via can_see_cliente_context
    // (own item in that client); this function does not re-derive that predicate. A scope read error
    // is a generic 500, never "all clients".
    let scope: ClientScope;
    try {
      scope = await (deps.loadClientScope ?? realLoadClientScope)(svc, user.id, contaId);
    } catch (err) {
      console.error("[briefing-audio] client scope:", err instanceof Error ? err.message : String(err));
      return json({ error: "Internal server error" }, 500);
    }
    const { data: row } = await svc.from("hub_briefing_questions")
      .select(`${AUDIO_COLUMNS}, cliente_id`).eq("id", questionId).eq("conta_id", contaId).maybeSingle();
    const inScope = row && hasClientAccess(scope, (row as { cliente_id?: number | null }).cliente_id ?? null, false);
    const view = inScope ? await buildAudioView(row as AudioRow, (k) => deps.signGetUrl(k, 3600)) : null;
    if (!view) return json({ error: "Áudio não encontrado." }, 404);
    return json(view);
  };
}
