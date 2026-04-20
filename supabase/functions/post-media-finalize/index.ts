import { createClient } from "npm:@supabase/supabase-js@2";
import { headObject, signGetUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");

  // Service-role client verifies the user token via the Auth API
  // (avoids ES256 local verification issue with the anon client).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: authErr } = await svc.auth.getUser(token);
  if (authErr || !user) {
    console.error("[post-media-finalize] auth failed:", JSON.stringify({
      message: authErr?.message, status: (authErr as { status?: number } | null)?.status,
      hasServiceKey: Boolean(SUPABASE_SERVICE_ROLE_KEY), tokenPrefix: token.slice(0, 12),
    }));
    return json({ error: "Unauthorized" }, 401);
  }
  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  let body: {
    post_id: number; media_id: string;
    r2_key: string; thumbnail_r2_key?: string;
    kind: "image" | "video"; mime_type: string; size_bytes: number;
    original_filename: string;
    width?: number; height?: number; duration_seconds?: number;
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Verify post ownership
  const { data: post } = await svc.from("workflow_posts").select("id, conta_id").eq("id", body.post_id).single();
  if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

  // Enforce that r2_key (and thumbnail_r2_key) are scoped to this tenant + post.
  // Without this, a caller could point a row at an existing object in another tenant's namespace.
  const expectedPrefix = `contas/${profile.conta_id}/posts/${body.post_id}/`;
  if (!body.r2_key.startsWith(expectedPrefix)) return json({ error: "invalid r2_key" }, 400);
  if (body.thumbnail_r2_key && !body.thumbnail_r2_key.startsWith(expectedPrefix)) {
    return json({ error: "invalid thumbnail_r2_key" }, 400);
  }

  // Allowlist-validate the declared MIME type before touching any DB rows
  const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
  ];
  if (!ALLOWED_MIME_TYPES.includes(body.mime_type)) {
    return json({ error: "unsupported file type" }, 415);
  }

  // Verify R2 object exists, length matches, and Content-Type matches declared MIME
  const head = await headObject(body.r2_key);
  if (!head) return json({ error: "object not found" }, 400);
  if (head.contentLength !== body.size_bytes) return json({ error: "size mismatch" }, 400);
  if (head.contentType && head.contentType !== body.mime_type) return json({ error: "content-type mismatch" }, 400);

  if (body.kind === "video") {
    if (!body.thumbnail_r2_key) return json({ error: "video requires thumbnail_r2_key" }, 400);
    const thumbHead = await headObject(body.thumbnail_r2_key);
    if (!thumbHead) return json({ error: "thumbnail not found" }, 400);
  }

  // First item on the post becomes cover automatically
  const { count } = await svc
    .from("post_media")
    .select("id", { count: "exact", head: true })
    .eq("post_id", body.post_id);
  const is_cover = (count ?? 0) === 0;

  // Atomic quota check + insert via RPC. The function locks workspaces FOR UPDATE,
  // re-reads the maintained storage_used_bytes counter, and either inserts or raises
  // 'quota_exceeded'. This prevents concurrent finalizes from collectively busting
  // the quota, which a two-step (sum-then-insert) flow would allow.
  const { data: inserted, error: insErr } = await svc.rpc("post_media_insert_with_quota", {
    p: {
      post_id: body.post_id,
      conta_id: profile.conta_id,
      r2_key: body.r2_key,
      thumbnail_r2_key: body.thumbnail_r2_key ?? "",
      kind: body.kind,
      mime_type: body.mime_type,
      size_bytes: body.size_bytes,
      original_filename: body.original_filename,
      width: body.width ?? "",
      height: body.height ?? "",
      duration_seconds: body.duration_seconds ?? "",
      is_cover,
      uploaded_by: user.id,
    },
  }).single();
  if (insErr || !inserted) {
    const msg = insErr?.message ?? "insert failed";
    const status = msg.includes("quota_exceeded") ? 413 : 500;
    return json({ error: msg }, status);
  }

  const url = await signGetUrl(body.r2_key, 900);
  const thumbnail_url = body.thumbnail_r2_key ? await signGetUrl(body.thumbnail_r2_key, 900) : null;

  return json({ ...inserted, url, thumbnail_url });
});
