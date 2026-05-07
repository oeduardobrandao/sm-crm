import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
};

interface SignR2UrlsDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
}

export function createSignR2UrlsHandler(deps: SignR2UrlsDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const svc = deps.createDb();
    const { data: { user }, error: authErr } = await svc.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

    let body: { keys: string[] };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    if (!Array.isArray(body.keys)) return json({ error: "keys must be an array" }, 400);

    const prefix = `contas/${profile.conta_id}/`;
    const validKeys = body.keys.filter((k) => typeof k === "string" && k.startsWith(prefix));

    const urls: Record<string, string> = {};
    await Promise.all(validKeys.map(async (key) => {
      urls[key] = await deps.signGetUrl(key, 3600);
    }));

    return json({ urls });
  };
}
