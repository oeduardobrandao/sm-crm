import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl, signPutUrl } from "../_shared/r2.ts";
import { signMediaUrl, isMediaProxyEnabled } from "../_shared/media-url.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const signUrl = isMediaProxyEnabled()
  ? (key: string) => signMediaUrl(key)
  : (key: string) => signGetUrl(key, 900);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const THUMB_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime: string): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const)[mime as "image/jpeg"] ?? "bin";
}

Deno.serve(async (req) => {
  const cors = { ...buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

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
    console.error("[post-media-manage] auth failed:", JSON.stringify({
      message: authErr?.message, status: (authErr as { status?: number } | null)?.status,
      hasServiceKey: Boolean(SUPABASE_SERVICE_ROLE_KEY), tokenPrefix: token.slice(0, 12),
    }));
    return json({ error: "Unauthorized" }, 401);
  }
  const { data: profile } = await svc.from("profiles").select("conta_id").eq("id", user.id).single();
  if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean); // ['functions','v1','post-media-manage', maybe id, maybe 'thumbnail']
  const idx = parts.indexOf("post-media-manage");
  const idStr = parts[idx + 1];
  const sub = parts[idx + 2]; // e.g. 'thumbnail'

  // GET ?post_id=... → list media for a post
  // GET ?workflow_ids=1,2,3 → return all post covers per workflow
  if (req.method === "GET") {
    const workflowIdsParam = url.searchParams.get("workflow_ids");
    if (workflowIdsParam) {
      const workflowIds = workflowIdsParam.split(",").map(Number).filter((n) => Number.isFinite(n));
      if (workflowIds.length === 0) return json({ covers: [] });
      const { data: posts } = await svc.from("workflow_posts")
        .select("id, workflow_id, ordem")
        .in("workflow_id", workflowIds)
        .eq("conta_id", profile.conta_id)
        .order("ordem", { ascending: true });
      if (!posts || posts.length === 0) return json({ covers: [] });
      const postIds = posts.map((p) => p.id);
      const { data: covers } = await svc.from("post_media")
        .select("*")
        .in("post_id", postIds)
        .eq("is_cover", true);

      const postById = new Map(posts.map((p) => [p.id, p]));
      const sortedCovers = (covers ?? []).slice().sort((a, b) => {
        const pa = postById.get(a.post_id); const pb = postById.get(b.post_id);
        return (pa?.ordem ?? 0) - (pb?.ordem ?? 0) || a.post_id - b.post_id;
      });
      const byWorkflow = new Map<number, typeof covers[number][]>();
      for (const c of sortedCovers) {
        const post = postById.get(c.post_id);
        if (!post) continue;
        const arr = byWorkflow.get(post.workflow_id) ?? [];
        arr.push(c);
        byWorkflow.set(post.workflow_id, arr);
      }

      const result = await Promise.all(Array.from(byWorkflow.entries()).map(async ([workflow_id, mediaRows]) => ({
        workflow_id,
        media: await Promise.all(mediaRows.map(async (r) => ({
          ...r,
          url: await signUrl(r.r2_key),
          thumbnail_url: r.thumbnail_r2_key ? await signUrl(r.thumbnail_r2_key) : null,
        }))),
      })));
      return json({ covers: result });
    }

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
      // Atomic cover swap via RPC: a single UPDATE with CASE flips the target row
      // to true and all siblings to false, relying on Postgres deferring the partial
      // unique-index check to statement end. A two-statement unset-then-set can
      // leave the post with zero covers on partial failure.
      const { error: swapErr } = await svc.rpc("post_media_set_cover", { p_media_id: mediaId });
      if (swapErr) return json({ error: swapErr.message }, 500);
      // Drop is_cover from patch since the RPC already handled it.
      delete patch.is_cover;
    }

    if (Object.keys(patch).length === 0) {
      // Cover-only patch: return the updated row.
      const { data: current } = await svc.from("post_media").select("*").eq("id", mediaId).single();
      return json(current);
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
