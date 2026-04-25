import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface HeadResult {
  contentLength: number;
}

interface FileUploadFinalizeDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  headObject: (key: string) => Promise<HeadResult | null>;
  signUrl: (key: string) => Promise<string>;
}

export function createFileUploadFinalizeHandler(deps: FileUploadFinalizeDeps) {
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

    let body: {
      file_id: string;
      r2_key: string;
      thumbnail_r2_key?: string;
      kind: "image" | "video" | "document";
      mime_type: string;
      size_bytes: number;
      name: string;
      folder_id?: number | null;
      width?: number;
      height?: number;
      duration_seconds?: number;
      blur_data_url?: string;
      post_id?: number;
    };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const expectedPrefix = `contas/${profile.conta_id}/files/`;
    if (!body.r2_key.startsWith(expectedPrefix)) return json({ error: "invalid r2_key" }, 400);
    if (body.thumbnail_r2_key && !body.thumbnail_r2_key.startsWith(expectedPrefix)) {
      return json({ error: "invalid thumbnail_r2_key" }, 400);
    }

    const head = await deps.headObject(body.r2_key);
    if (!head) return json({ error: "object not found" }, 400);
    if (head.contentLength !== body.size_bytes) return json({ error: "size mismatch" }, 400);

    if (body.kind === "video") {
      if (!body.thumbnail_r2_key) return json({ error: "video requires thumbnail_r2_key" }, 400);
      const thumbHead = await deps.headObject(body.thumbnail_r2_key);
      if (!thumbHead) return json({ error: "thumbnail not found" }, 400);
    }

    if (body.folder_id) {
      const { data: folder } = await svc.from("folders").select("conta_id").eq("id", body.folder_id).single();
      if (!folder || folder.conta_id !== profile.conta_id) return json({ error: "Folder not found" }, 404);
    }

    if (body.post_id && body.kind === "document") {
      return json({ error: "documents cannot be linked to posts" }, 400);
    }

    const { data: inserted, error: insErr } = await svc.rpc("file_insert_with_quota", {
      p: {
        conta_id: profile.conta_id,
        folder_id: body.folder_id ?? "",
        r2_key: body.r2_key,
        thumbnail_r2_key: body.thumbnail_r2_key ?? "",
        name: body.name,
        kind: body.kind,
        mime_type: body.mime_type,
        size_bytes: body.size_bytes,
        width: body.width ?? "",
        height: body.height ?? "",
        duration_seconds: body.duration_seconds ?? "",
        uploaded_by: user.id,
      },
    }).single();

    if (insErr || !inserted) {
      const msg = insErr?.message ?? "insert failed";
      return json({ error: msg }, msg.includes("quota_exceeded") ? 413 : 500);
    }

    if (body.blur_data_url && typeof body.blur_data_url === "string" && body.blur_data_url.startsWith("data:")) {
      await svc.from("files").update({ blur_data_url: body.blur_data_url }).eq("id", (inserted as any).id);
    }

    if (body.post_id) {
      const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", body.post_id).single();
      if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

      const { error: linkErr } = await svc.from("post_file_links").insert({
        post_id: body.post_id,
        file_id: (inserted as any).id,
        conta_id: profile.conta_id,
      });
      if (linkErr) return json({ error: linkErr.message }, 500);
    }

    const url = await deps.signUrl(body.r2_key);
    const thumbnail_url = body.thumbnail_r2_key ? await deps.signUrl(body.thumbnail_r2_key) : null;

    return json({ ...inserted, url, thumbnail_url, blur_data_url: body.blur_data_url ?? null });
  };
}
