import { createJsonResponder } from "../_shared/http.ts";
import {
  presignIdeiaImage, finalizeIdeiaImage, listIdeiaImages, removeIdeiaImage,
} from "../_shared/ideia-media.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signPutUrl: (key: string, mime: string) => Promise<string>;
  signGetUrl: (key: string, expires?: number) => Promise<string>;
  headObject: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
}

export function createIdeiaMediaManageHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = {
      ...deps.buildCorsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    };
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const db = deps.createDb();
    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const conta_id = profile.conta_id as string;

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("ideia-media-manage");
    const seg = idx >= 0 ? parts.slice(idx + 1) : [];
    const ideiaId = seg[0] && seg[0] !== "upload-url" ? seg[0] : null;

    // GET ?ideia_id= -> list
    if (req.method === "GET") {
      const qid = url.searchParams.get("ideia_id");
      if (!qid) return json({ error: "ideia_id required" }, 400);
      const r = await listIdeiaImages({
        db: db as any, conta_id, cliente_id: null, ideia_id: qid, signGetUrl: deps.signGetUrl,
      });
      return json(r.body, r.status);
    }

    // POST /upload-url -> presign
    if (req.method === "POST" && seg[0] === "upload-url") {
      const body = await req.json().catch(() => ({}));
      const r = await presignIdeiaImage({
        db: db as any, conta_id, cliente_id: null,
        ideia_id: String(body.ideia_id ?? ""),
        filename: String(body.filename ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail: {
          mime_type: String(body.thumbnail?.mime_type ?? ""),
          size_bytes: Number(body.thumbnail?.size_bytes ?? 0),
        },
        signPutUrl: deps.signPutUrl,
      });
      return json(r.body, r.status);
    }

    // POST /:id/files -> finalize
    if (req.method === "POST" && ideiaId && seg[1] === "files") {
      const body = await req.json().catch(() => ({}));
      const r = await finalizeIdeiaImage({
        db: db as any, conta_id, cliente_id: null, ideia_id: ideiaId,
        r2_key: String(body.r2_key ?? ""),
        thumbnail_r2_key: String(body.thumbnail_r2_key ?? ""),
        mime_type: String(body.mime_type ?? ""),
        size_bytes: Number(body.size_bytes ?? 0),
        thumbnail_bytes: Number(body.thumbnail_bytes ?? 0),
        name: String(body.name ?? "image"),
        width: body.width != null ? Number(body.width) : undefined,
        height: body.height != null ? Number(body.height) : undefined,
        blur_data_url: typeof body.blur_data_url === "string" ? body.blur_data_url : undefined,
        sort_order: body.sort_order != null ? Number(body.sort_order) : undefined,
        uploaded_by: user.id,
        headObject: deps.headObject,
        signGetUrl: deps.signGetUrl,
      });
      return json(r.body, r.status);
    }

    // DELETE /:id/files/:fileId -> remove
    if (req.method === "DELETE" && ideiaId && seg[1] === "files" && seg[2]) {
      const fileId = Number(seg[2]);
      if (Number.isNaN(fileId)) return json({ error: "invalid file id" }, 400);
      const r = await removeIdeiaImage({
        db: db as any, conta_id, cliente_id: null, ideia_id: ideiaId, file_id: fileId,
      });
      return json(r.body, r.status);
    }

    return json({ error: "Not found" }, 404);
  };
}
