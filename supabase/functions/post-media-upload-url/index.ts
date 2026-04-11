import { createClient } from "npm:@supabase/supabase-js@2";
import { signPutUrl } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_SIZE = 400 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const THUMB_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  };
  return map[mime] ?? "bin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  let body: {
    post_id: number; filename: string; mime_type: string; size_bytes: number;
    kind: "image" | "video";
    thumbnail?: { mime_type: string; size_bytes: number };
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { post_id, filename, mime_type, size_bytes, kind, thumbnail } = body;
  if (!post_id || !filename || !mime_type || !size_bytes || !kind) return json({ error: "Missing fields" }, 400);
  if (size_bytes <= 0 || size_bytes > MAX_SIZE) return json({ error: "size_bytes out of range" }, 400);

  const allowed = kind === "image" ? IMAGE_MIME : VIDEO_MIME;
  if (!allowed.has(mime_type)) return json({ error: "Unsupported mime type" }, 400);

  if (kind === "video") {
    if (!thumbnail) return json({ error: "video requires thumbnail" }, 400);
    if (!THUMB_MIME.has(thumbnail.mime_type)) return json({ error: "Unsupported thumbnail mime type" }, 400);
    if (thumbnail.size_bytes <= 0 || thumbnail.size_bytes > 10 * 1024 * 1024) return json({ error: "thumbnail size out of range" }, 400);
  }

  // Verify post belongs to this conta
  const { data: post } = await svc.from("workflow_posts").select("id, conta_id").eq("id", post_id).single();
  if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

  // Quota check
  const { data: ws } = await svc.from("workspaces").select("storage_quota_bytes").eq("id", profile.conta_id).single();
  const quota = ws?.storage_quota_bytes ?? null;
  if (quota !== null) {
    const { data: sumRow } = await svc
      .from("post_media")
      .select("size_bytes")
      .eq("conta_id", profile.conta_id);
    const used = (sumRow ?? []).reduce((n, r: { size_bytes: number }) => n + Number(r.size_bytes), 0);
    const needed = size_bytes + (thumbnail?.size_bytes ?? 0);
    if (used + needed > quota) {
      return json({ error: "quota_exceeded", used, quota }, 413);
    }
  }

  const mediaId = crypto.randomUUID();
  const ext = extFromMime(mime_type);
  const r2_key = `contas/${profile.conta_id}/posts/${post_id}/${mediaId}.${ext}`;
  const upload_url = await signPutUrl(r2_key, mime_type);

  let thumbnail_r2_key: string | undefined;
  let thumbnail_upload_url: string | undefined;
  if (kind === "video" && thumbnail) {
    thumbnail_r2_key = `contas/${profile.conta_id}/posts/${post_id}/${mediaId}.thumb.${extFromMime(thumbnail.mime_type)}`;
    thumbnail_upload_url = await signPutUrl(thumbnail_r2_key, thumbnail.mime_type);
  }

  return json({ media_id: mediaId, upload_url, r2_key, thumbnail_upload_url, thumbnail_r2_key });
});
