// supabase/functions/file-upload-url/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { signPutUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_SIZE = 400 * 1024 * 1024;

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
    "application/pdf": "pdf", "application/zip": "zip",
  };
  return map[mime] ?? "bin";
}

function classifyKind(mime: string): "image" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  let body: {
    folder_id?: number | null;
    filename: string;
    mime_type: string;
    size_bytes: number;
    thumbnail?: { mime_type: string; size_bytes: number };
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { folder_id, filename, mime_type, size_bytes, thumbnail } = body;
  if (!filename || !mime_type || !size_bytes) return json({ error: "Missing fields" }, 400);
  if (size_bytes <= 0 || size_bytes > MAX_SIZE) return json({ error: "size_bytes out of range" }, 400);

  const kind = classifyKind(mime_type);

  if (kind === "video" && !thumbnail) return json({ error: "video requires thumbnail" }, 400);
  if (thumbnail) {
    if (!thumbnail.mime_type.startsWith("image/")) return json({ error: "thumbnail must be an image" }, 400);
    if (thumbnail.size_bytes <= 0 || thumbnail.size_bytes > 10 * 1024 * 1024) {
      return json({ error: "thumbnail size out of range" }, 400);
    }
  }

  if (folder_id) {
    const { data: folder } = await svc.from("folders").select("conta_id").eq("id", folder_id).single();
    if (!folder || folder.conta_id !== profile.conta_id) return json({ error: "Folder not found" }, 404);
  }

  const { data: ws } = await svc.from("workspaces")
    .select("storage_quota_bytes, storage_used_bytes")
    .eq("id", profile.conta_id).single();
  const quota = ws?.storage_quota_bytes ?? null;
  if (quota !== null) {
    const used = Number(ws?.storage_used_bytes ?? 0);
    const needed = size_bytes + (thumbnail?.size_bytes ?? 0);
    if (used + needed > quota) {
      return json({ error: "quota_exceeded", used, quota }, 413);
    }
  }

  const fileId = crypto.randomUUID();
  const ext = extFromMime(mime_type);
  const r2_key = `contas/${profile.conta_id}/files/${fileId}.${ext}`;
  const upload_url = await signPutUrl(r2_key, mime_type);

  let thumbnail_r2_key: string | undefined;
  let thumbnail_upload_url: string | undefined;
  if (thumbnail) {
    thumbnail_r2_key = `contas/${profile.conta_id}/files/${fileId}.thumb.${extFromMime(thumbnail.mime_type)}`;
    thumbnail_upload_url = await signPutUrl(thumbnail_r2_key, thumbnail.mime_type);
  }

  return json({
    file_id: fileId, upload_url, r2_key, kind,
    thumbnail_upload_url, thumbnail_r2_key,
  });
});
