import { createJsonResponder } from "../_shared/http.ts";
import { AUDIO_COLUMNS, buildAudioView, type AudioRow } from "../_shared/briefing-audio.ts";

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  // deno-lint-ignore no-explicit-any
  createDb: () => any;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
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

    const { data: row } = await svc.from("hub_briefing_questions")
      .select(AUDIO_COLUMNS).eq("id", questionId).eq("conta_id", contaId).maybeSingle();
    const view = row ? await buildAudioView(row as AudioRow, (k) => deps.signGetUrl(k, 3600)) : null;
    if (!view) return json({ error: "Áudio não encontrado." }, 404);
    return json(view);
  };
}
