import { createJsonResponder, internalServerError } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface HeadResult {
  contentLength: number;
  contentType?: string | null;
}

interface FileUploadFinalizeDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  headObject: (key: string) => Promise<HeadResult | null>;
  signUrl: (key: string) => Promise<string>;
  streamCopy?: (r2Key: string, meta: { file_id: string; conta_id: string }) => Promise<string>;
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
      sort_order?: number;
    };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const expectedPrefix = `contas/${profile.conta_id}/files/`;
    if (!body.r2_key.startsWith(expectedPrefix)) return json({ error: "invalid r2_key" }, 400);
    if (body.thumbnail_r2_key && !body.thumbnail_r2_key.startsWith(expectedPrefix)) {
      return json({ error: "invalid thumbnail_r2_key" }, 400);
    }

    const MIME_ALLOWLIST: Record<string, string[]> = {
      image: ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
      video: ["video/mp4", "video/quicktime", "video/webm"],
      document: ["application/pdf", "application/zip"],
    };
    if (!MIME_ALLOWLIST[body.kind]?.includes(body.mime_type)) {
      return json({ error: "unsupported file type" }, 415);
    }

    const head = await deps.headObject(body.r2_key);
    if (!head) return json({ error: "object not found" }, 400);
    if (head.contentLength !== body.size_bytes) return json({ error: "size mismatch" }, 400);
    if (head.contentType && head.contentType !== body.mime_type) {
      return json({ error: "content-type mismatch" }, 400);
    }

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

    let folderId = body.folder_id ?? null;
    if (!folderId && body.post_id) {
      const { data: postFolder } = await svc.from("folders")
        .select("id")
        .eq("conta_id", profile.conta_id)
        .eq("source_type", "post")
        .eq("source_id", body.post_id)
        .maybeSingle();
      if (postFolder) folderId = postFolder.id;
    }

    if (body.post_id) {
      const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", body.post_id).single();
      if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);
    }

    const { data: inserted, error: insErr } = await svc.rpc("file_insert_with_quota", {
      p: {
        conta_id: profile.conta_id,
        folder_id: folderId ?? "",
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
      if (msg.includes("quota_exceeded")) return json({ error: "quota_exceeded" }, 413);
      return internalServerError(json, "file-upload-finalize:insert-file", insErr ?? new Error(msg));
    }

    if (body.blur_data_url && typeof body.blur_data_url === "string" && body.blur_data_url.startsWith("data:")) {
      await svc.from("files").update({ blur_data_url: body.blur_data_url }).eq("id", (inserted as any).id);
    }

    if (body.post_id) {
      // sort_order is assigned client-side from the upload selection order so
      // concurrent uploads land in the picked order, not finalize-completion
      // order. Omitted -> DB default (0), preserving the prior behavior.
      const link: Record<string, unknown> = {
        post_id: body.post_id,
        file_id: (inserted as any).id,
        conta_id: profile.conta_id,
      };
      if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
        link.sort_order = Math.max(0, Math.trunc(body.sort_order));
      }
      const { error: linkErr } = await svc.from("post_file_links").insert(link);
      if (linkErr) return internalServerError(json, "file-upload-finalize:create-link", linkErr);
    }

    if (body.kind === "video" && deps.streamCopy) {
      const fileId = (inserted as any).id;
      try {
        // Durable intent BEFORE the external call: a pending row with a null uid
        // is exactly what the cron sweep repairs (spec §5.3). supabase-js update()
        // RESOLVES with { error } instead of throwing, so both writes below must be
        // checked and thrown explicitly -- an unchecked pending-write failure would
        // still call streamCopy for a row the DB never actually marked pending, and
        // an unchecked uid-write failure would leave stream_uid set with
        // stream_status left null, a state none of the webhook (requires
        // stream_status='pending'), settle sweep (selects stream_status='pending'),
        // or catch-up sweep (selects stream_uid is null) can ever pick back up --
        // the video falls back to MP4 forever while Stream keeps billing for it.
        const { error: pendingErr } = await svc
          .from("files")
          .update({ stream_status: "pending" })
          .eq("id", fileId);
        if (pendingErr) throw pendingErr;
        const uid = await deps.streamCopy(body.r2_key, {
          file_id: String(fileId),
          conta_id: profile.conta_id,
        });
        const { error: uidErr } = await svc.from("files").update({ stream_uid: uid }).eq("id", fileId);
        if (uidErr) throw uidErr;
      } catch (e) {
        console.error("file-upload-finalize:stream-copy", e);
      }
    }

    const url = await deps.signUrl(body.r2_key);
    const thumbnail_url = body.thumbnail_r2_key ? await deps.signUrl(body.thumbnail_r2_key) : null;

    // Same contract as file-manage: stream_uid/stream_status are internal, never returned
    // to the client — always null at this point in the flow anyway (the ingest below hasn't
    // run yet), but strip them so the keys never leak even if that ever changes.
    const { stream_uid, stream_status, ...pub } = inserted as Record<string, unknown>;
    return json({ ...pub, url, thumbnail_url, blur_data_url: body.blur_data_url ?? null });
  };
}
