import { createClient } from "npm:@supabase/supabase-js@2";
import { headObject, signGetUrl } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

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

  // Verify R2 object exists and length matches
  const head = await headObject(body.r2_key);
  if (!head) return json({ error: "object not found" }, 400);
  if (head.contentLength !== body.size_bytes) return json({ error: "size mismatch" }, 400);

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

  const { data: inserted, error: insErr } = await svc
    .from("post_media")
    .insert({
      post_id: body.post_id,
      conta_id: profile.conta_id,
      r2_key: body.r2_key,
      thumbnail_r2_key: body.thumbnail_r2_key ?? null,
      kind: body.kind,
      mime_type: body.mime_type,
      size_bytes: body.size_bytes,
      original_filename: body.original_filename,
      width: body.width ?? null,
      height: body.height ?? null,
      duration_seconds: body.duration_seconds ?? null,
      is_cover,
      uploaded_by: user.id,
    })
    .select()
    .single();
  if (insErr || !inserted) return json({ error: insErr?.message ?? "insert failed" }, 500);

  const url = await signGetUrl(body.r2_key, 900);
  const thumbnail_url = body.thumbnail_r2_key ? await signGetUrl(body.thumbnail_r2_key, 900) : null;

  return json({ ...inserted, url, thumbnail_url });
});
