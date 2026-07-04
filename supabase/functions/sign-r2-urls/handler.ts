import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
};

interface SignR2UrlsDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
  /** Raw object bytes for the GET proxy route (see below). */
  getObjectBytes: (key: string) => Promise<Uint8Array | null>;
}

/** Content types the GET proxy will declare. Anything else is served as octet-stream —
 * combined with nosniff that keeps a hostile upload from ever executing in a browser. */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function contentTypeForKey(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

async function resolveContaId(
  deps: SignR2UrlsDeps,
  req: Request,
): Promise<{ contaId: string } | { errorStatus: 401 | 403; message: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { errorStatus: 401, message: "Unauthorized" };
  const token = authHeader.replace("Bearer ", "");

  const svc = deps.createDb();
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) return { errorStatus: 401, message: "Unauthorized" };

  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id)
    .single();
  if (!profile?.conta_id) return { errorStatus: 403, message: "Profile not found" };
  return { contaId: profile.conta_id };
}

export function createSignR2UrlsHandler(deps: SignR2UrlsDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    // GET ?key=<r2_key>: stream the object's bytes with app-origin CORS. The R2 bucket itself
    // only serves CORS for the production origins, so an in-browser fetch() of a signed URL
    // (satori's editor render, blob-URL conversion) fails from every other origin — this proxy
    // makes the pipeline origin-independent. Own-conta keys only: kb covers are for public
    // <img> display and never need byte-level access.
    if (req.method === "GET") {
      const resolved = await resolveContaId(deps, req);
      if ("errorStatus" in resolved) return json({ error: resolved.message }, resolved.errorStatus);

      const key = new URL(req.url).searchParams.get("key") ?? "";
      // 404 (not 403) for foreign keys — don't confirm another tenant's object exists.
      if (!key.startsWith(`contas/${resolved.contaId}/`)) {
        return json({ error: "Not found" }, 404);
      }
      const bytes = await deps.getObjectBytes(key);
      if (!bytes) return json({ error: "Not found" }, 404);
      // Blob wrapper: Deno's lib types Uint8Array<ArrayBufferLike> as not-BodyInit.
      return new Response(new Blob([bytes as BlobPart]), {
        headers: {
          ...cors,
          "Content-Type": contentTypeForKey(key),
          "X-Content-Type-Options": "nosniff",
          // Private: signed-in tenant data. 1h matches the signed-URL expiry the POST hands out.
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const resolved = await resolveContaId(deps, req);
    if ("errorStatus" in resolved) return json({ error: resolved.message }, resolved.errorStatus);

    let body: { keys: string[] };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (!Array.isArray(body.keys)) return json({ error: "keys must be an array" }, 400);

    const svc = deps.createDb();
    const prefix = `contas/${resolved.contaId}/`;
    const ownKeys = body.keys.filter((k) => typeof k === "string" && k.startsWith(prefix));
    const otherKeys = body.keys.filter((k) => typeof k === "string" && !k.startsWith(prefix));

    let kbKeys: string[] = [];
    if (otherKeys.length > 0) {
      const { data: kbRows } = await svc
        .from("kb_articles")
        .select("cover_image_url")
        .eq("status", "published")
        .in("cover_image_url", otherKeys);
      if (kbRows) kbKeys = kbRows.map((r: { cover_image_url: string }) => r.cover_image_url);
    }

    const validKeys = [...ownKeys, ...kbKeys];
    const urls: Record<string, string> = {};
    await Promise.all(validKeys.map(async (key) => {
      urls[key] = await deps.signGetUrl(key, 3600);
    }));

    return json({ urls });
  };
}
