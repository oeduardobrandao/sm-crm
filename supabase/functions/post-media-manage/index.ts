// supabase/functions/post-media-manage/index.ts
// Adapter: queries post_file_links + files, returns legacy PostMedia-shaped records.
// link.id serves as the legacy "media ID".
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

function toLegacy(link: any, file: any, url: string, thumbnailUrl: string | null) {
  return {
    id: link.id,
    post_id: link.post_id,
    conta_id: link.conta_id,
    r2_key: file.r2_key,
    thumbnail_r2_key: file.thumbnail_r2_key,
    kind: file.kind,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    original_filename: file.name,
    width: file.width,
    height: file.height,
    duration_seconds: file.duration_seconds,
    is_cover: link.is_cover,
    sort_order: link.sort_order,
    uploaded_by: file.uploaded_by,
    created_at: file.created_at,
    blur_data_url: file.blur_data_url ?? null,
    url,
    thumbnail_url: thumbnailUrl,
  };
}

Deno.serve(async (req) => {
  const cors = { ...buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

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

  const requestUrl = new URL(req.url);
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const fnIdx = parts.indexOf("post-media-manage");
  const idStr = parts[fnIdx + 1];
  const sub = parts[fnIdx + 2];

  if (req.method === "GET") {
    const workflowIdsParam = requestUrl.searchParams.get("workflow_ids");
    if (workflowIdsParam) {
      const workflowIds = workflowIdsParam.split(",").map(Number).filter((n) => Number.isFinite(n));
      if (workflowIds.length === 0) return json({ covers: [] });

      const { data: posts } = await svc.from("workflow_posts")
        .select("id, workflow_id, ordem")
        .in("workflow_id", workflowIds)
        .eq("conta_id", profile.conta_id)
        .order("ordem", { ascending: true });
      if (!posts || posts.length === 0) return json({ covers: [] });

      const postIds = posts.map((p: any) => p.id);
      const { data: coverLinks } = await svc.from("post_file_links")
        .select("*, files(*)")
        .in("post_id", postIds)
        .eq("is_cover", true);

      const postById = new Map(posts.map((p: any) => [p.id, p]));
      const sorted = (coverLinks ?? []).slice().sort((a: any, b: any) => {
        const pa = postById.get(a.post_id);
        const pb = postById.get(b.post_id);
        return (pa?.ordem ?? 0) - (pb?.ordem ?? 0) || a.post_id - b.post_id;
      });

      const byWorkflow = new Map<number, any[]>();
      for (const link of sorted) {
        const post = postById.get(link.post_id);
        if (!post) continue;
        const arr = byWorkflow.get(post.workflow_id) ?? [];
        arr.push(link);
        byWorkflow.set(post.workflow_id, arr);
      }

      const result = await Promise.all(Array.from(byWorkflow.entries()).map(async ([workflow_id, links]) => ({
        workflow_id,
        media: await Promise.all(links.map(async (l: any) => {
          const f = l.files;
          const u = await signUrl(f.r2_key);
          const tu = f.thumbnail_r2_key ? await signUrl(f.thumbnail_r2_key) : null;
          return toLegacy(l, f, u, tu);
        })),
      })));
      return json({ covers: result });
    }

    const postId = Number(requestUrl.searchParams.get("post_id"));
    if (!postId) return json({ error: "post_id required" }, 400);

    const { data: post } = await svc.from("workflow_posts").select("conta_id").eq("id", postId).single();
    if (!post || post.conta_id !== profile.conta_id) return json({ error: "Post not found" }, 404);

    const { data: links } = await svc.from("post_file_links")
      .select("*, files(*)")
      .eq("post_id", postId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    const media = await Promise.all((links ?? []).map(async (l: any) => {
      const f = l.files;
      const u = await signUrl(f.r2_key);
      const tu = f.thumbnail_r2_key ? await signUrl(f.thumbnail_r2_key) : null;
      return toLegacy(l, f, u, tu);
    }));
    return json({ media });
  }

  if (!idStr) return json({ error: "id required" }, 400);
  const linkId = Number(idStr);
  if (!linkId) return json({ error: "invalid id" }, 400);

  const { data: link } = await svc.from("post_file_links").select("*, files(*)").eq("id", linkId).single();
  if (!link || link.conta_id !== profile.conta_id) return json({ error: "Not found" }, 404);
  const file = (link as any).files;

  if (req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));

    if (body.is_cover === true) {
      const { error: swapErr } = await svc.rpc("post_file_link_set_cover", { p_link_id: linkId });
      if (swapErr) return json({ error: swapErr.message }, 500);
    }

    if (typeof body.sort_order === "number") {
      await svc.from("post_file_links").update({ sort_order: body.sort_order }).eq("id", linkId);
    }

    if (body.thumbnail_r2_key && typeof body.thumbnail_r2_key === "string") {
      if (file.thumbnail_r2_key && file.thumbnail_r2_key !== body.thumbnail_r2_key) {
        await svc.from("file_deletions").insert({ r2_key: file.thumbnail_r2_key });
      }
      await svc.from("files").update({ thumbnail_r2_key: body.thumbnail_r2_key }).eq("id", file.id);
    }

    const { data: updatedLink } = await svc.from("post_file_links").select("*, files(*)").eq("id", linkId).single();
    const uf = (updatedLink as any).files;
    const u = await signUrl(uf.r2_key);
    const tu = uf.thumbnail_r2_key ? await signUrl(uf.thumbnail_r2_key) : null;
    return json(toLegacy(updatedLink, uf, u, tu));
  }

  if (req.method === "DELETE") {
    const { error: delErr } = await svc.from("post_file_links").delete().eq("id", linkId);
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true });
  }

  if (req.method === "POST" && sub === "thumbnail") {
    if (file.kind !== "video") return json({ error: "only videos have thumbnails" }, 400);
    const body = await req.json().catch(() => ({}));
    const mime = String(body.mime_type ?? "");
    if (!THUMB_MIME.has(mime)) return json({ error: "Unsupported thumbnail mime type" }, 400);
    const key = `contas/${profile.conta_id}/files/${crypto.randomUUID()}.thumb.${extFromMime(mime)}`;
    const upload_url = await signPutUrl(key, mime);
    return json({ thumbnail_r2_key: key, thumbnail_upload_url: upload_url });
  }

  return json({ error: "Method not allowed" }, 405);
});
