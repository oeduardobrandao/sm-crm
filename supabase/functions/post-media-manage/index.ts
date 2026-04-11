import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl, signPutUrl } from "../_shared/r2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const THUMB_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function extFromMime(mime: string): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const)[mime as "image/jpeg"] ?? "bin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await anon.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ['functions','v1','post-media-manage', maybe id, maybe 'thumbnail']
  const idx = parts.indexOf("post-media-manage");
  const idStr = parts[idx + 1];
  const sub = parts[idx + 2]; // e.g. 'thumbnail'

  // GET ?post_id=... → list media for a post
  if (req.method === "GET") {
    const postId = Number(url.searchParams.get("post_id"));
    if (!postId) return json({ error: "post_id required" }, 400);
    const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", postId).single();
    if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

    const { data: rows } = await svc.from("post_media")
      .select("*").eq("post_id", postId)
      .order("sort_order", { ascending: true }).order("id", { ascending: true });

    const withUrls = await Promise.all((rows ?? []).map(async (r) => ({
      ...r,
      url: await signGetUrl(r.r2_key, 900),
      thumbnail_url: r.thumbnail_r2_key ? await signGetUrl(r.thumbnail_r2_key, 900) : null,
    })));
    return json({ media: withUrls });
  }

  // Everything below requires a media id in path
  if (!idStr) return json({ error: "id required" }, 400);
  const mediaId = Number(idStr);
  if (!mediaId) return json({ error: "invalid id" }, 400);

  const { data: media } = await svc.from("post_media").select("*").eq("id", mediaId).single();
  if (!media || media.conta_id !== profile.conta_id) return json({ error: "Not found" }, 404);

  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.sort_order === "number") patch.sort_order = body.sort_order;
    if (body.thumbnail_r2_key && typeof body.thumbnail_r2_key === "string") {
      // Swapping a video thumbnail — enqueue the old one for deletion
      if (media.thumbnail_r2_key && media.thumbnail_r2_key !== body.thumbnail_r2_key) {
        await svc.from("post_media_deletions").insert({ r2_key: media.thumbnail_r2_key });
      }
      patch.thumbnail_r2_key = body.thumbnail_r2_key;
    }

    if (body.is_cover === true) {
      // Unset any existing cover for this post, then set this row
      await svc.from("post_media").update({ is_cover: false }).eq("post_id", media.post_id).eq("is_cover", true);
      patch.is_cover = true;
    }

    const { data: updated, error: updErr } = await svc.from("post_media").update(patch).eq("id", mediaId).select().single();
    if (updErr) return json({ error: updErr.message }, 500);
    return json(updated);
  }

  if (req.method === "DELETE") {
    const { error: delErr } = await svc.from("post_media").delete().eq("id", mediaId);
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true });
  }

  // POST /:id/thumbnail → presign new thumbnail upload
  if (req.method === "POST" && sub === "thumbnail") {
    if (media.kind !== "video") return json({ error: "only videos have thumbnails" }, 400);
    const body = await req.json().catch(() => ({}));
    const mime = String(body.mime_type ?? "");
    if (!THUMB_MIME.has(mime)) return json({ error: "Unsupported thumbnail mime type" }, 400);
    const key = `contas/${profile.conta_id}/posts/${media.post_id}/${crypto.randomUUID()}.thumb.${extFromMime(mime)}`;
    const upload_url = await signPutUrl(key, mime);
    return json({ thumbnail_r2_key: key, thumbnail_upload_url: upload_url });
  }

  return json({ error: "Method not allowed" }, 405);
});
