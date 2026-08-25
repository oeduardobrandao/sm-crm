import { createJsonResponder, internalServerError } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface PostMediaManageDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  signUrl: (key: string) => Promise<string>;
  signPutUrl: (key: string, mimeType: string) => Promise<string>;
  randomUUID?: () => string;
  signPlayback?: (uid: string) => Promise<{ hls: string; expires_at: string }>;
}

const THUMB_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime: string): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const)[mime as "image/jpeg"] ?? "bin";
}

function toLegacy(
  link: any,
  file: any,
  url: string | null,
  thumbnailUrl: string | null,
  playback: { hls: string; expires_at: string } | null,
) {
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
    // 'manual' | 'design' (T4.1) — lets the CRM distinguish Estúdio-rendered tiles from user
    // uploads (design §5.2 read paths; the column existed but was invisible to clients).
    origin: link.origin ?? "manual",
    uploaded_by: file.uploaded_by,
    created_at: file.created_at,
    blur_data_url: file.blur_data_url ?? null,
    media_lost_at: file.media_lost_at ?? null,
    url,
    thumbnail_url: thumbnailUrl,
    playback,
  };
}

async function resolvePlayback(
  file: any,
  deps: Pick<PostMediaManageDeps, "signPlayback">,
): Promise<{ hls: string; expires_at: string } | null> {
  return file.stream_uid && file.stream_status === "ready" && deps.signPlayback
    ? await deps.signPlayback(file.stream_uid)
    : null;
}

async function signIfPresent(
  file: any,
  deps: Pick<PostMediaManageDeps, "signUrl">,
): Promise<{ url: string | null; thumbnailUrl: string | null }> {
  if (file.media_lost_at) return { url: null, thumbnailUrl: null };
  const url = await deps.signUrl(file.r2_key);
  const thumbnailUrl = file.thumbnail_r2_key ? await deps.signUrl(file.thumbnail_r2_key) : null;
  return { url, thumbnailUrl };
}

export function createPostMediaManageHandler(deps: PostMediaManageDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = { ...deps.buildCorsHeaders(req), "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS" };
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    const svc = deps.createDb();
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

        const postById = new Map<number, any>(posts.map((p: any) => [p.id, p] as [number, any]));
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
            const { url: u, thumbnailUrl: tu } = await signIfPresent(f, deps);
            const playback = await resolvePlayback(f, deps);
            return toLegacy(l, f, u, tu, playback);
          })),
        })));
        return json({ covers: result });
      }

      const postIdsParam = requestUrl.searchParams.get("post_ids");
      if (postIdsParam) {
        const postIds = postIdsParam.split(",").map(Number).filter((n) => Number.isFinite(n));
        if (postIds.length === 0) return json({ covers: [] });

        // Ownership: only cover media for this account's posts.
        const { data: ownedPosts } = await svc.from("workflow_posts")
          .select("id")
          .in("id", postIds)
          .eq("conta_id", profile.conta_id);
        const ownedIds = (ownedPosts ?? []).map((p: any) => p.id);
        if (ownedIds.length === 0) return json({ covers: [] });

        const { data: links } = await svc.from("post_file_links")
          .select("*, files(*)")
          .in("post_id", ownedIds)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true });

        // One cover per post: the is_cover link if flagged, else the first by sort_order.
        const coverByPost = new Map<number, any>();
        for (const l of (links ?? [])) {
          const existing = coverByPost.get(l.post_id);
          if (!existing || (l.is_cover && !existing.is_cover)) coverByPost.set(l.post_id, l);
        }

        const covers = await Promise.all(Array.from(coverByPost.values()).map(async (l: any) => {
          const f = l.files;
          const { url: u, thumbnailUrl: tu } = await signIfPresent(f, deps);
          const playback = await resolvePlayback(f, deps);
          return { post_id: l.post_id, media: toLegacy(l, f, u, tu, playback) };
        }));
        return json({ covers });
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
        const { url: u, thumbnailUrl: tu } = await signIfPresent(f, deps);
        const playback = await resolvePlayback(f, deps);
        return toLegacy(l, f, u, tu, playback);
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
        if (swapErr) return internalServerError(json, "post-media-manage:set-cover", swapErr);
      }

      if (typeof body.sort_order === "number") {
        await svc.from("post_file_links").update({ sort_order: body.sort_order }).eq("id", linkId);
      }

      if (body.thumbnail_r2_key && typeof body.thumbnail_r2_key === "string") {
        const expectedPrefix = `contas/${profile.conta_id}/`;
        if (!body.thumbnail_r2_key.startsWith(expectedPrefix)) {
          return json({ error: "invalid thumbnail_r2_key" }, 400);
        }
        if (file.thumbnail_r2_key && file.thumbnail_r2_key !== body.thumbnail_r2_key) {
          await svc.from("file_deletions").insert({ r2_key: file.thumbnail_r2_key });
        }
        await svc.from("files").update({ thumbnail_r2_key: body.thumbnail_r2_key }).eq("id", file.id);
      }

      const { data: updatedLink } = await svc.from("post_file_links").select("*, files(*)").eq("id", linkId).single();
      const uf = (updatedLink as any).files;
      const { url: u, thumbnailUrl: tu } = await signIfPresent(uf, deps);
      const playback = await resolvePlayback(uf, deps);
      return json(toLegacy(updatedLink, uf, u, tu, playback));
    }

    if (req.method === "DELETE") {
      const { error: delErr } = await svc.from("post_file_links").delete().eq("id", linkId);
      if (delErr) return internalServerError(json, "post-media-manage:delete-link", delErr);
      return json({ ok: true });
    }

    if (req.method === "POST" && sub === "thumbnail") {
      if (file.kind !== "video") return json({ error: "only videos have thumbnails" }, 400);
      const body = await req.json().catch(() => ({}));
      const mime = String(body.mime_type ?? "");
      if (!THUMB_MIME.has(mime)) return json({ error: "Unsupported thumbnail mime type" }, 400);
      const key = `contas/${profile.conta_id}/files/${(deps.randomUUID ?? crypto.randomUUID.bind(crypto))()}.thumb.${extFromMime(mime)}`;
      const upload_url = await deps.signPutUrl(key, mime);
      return json({ thumbnail_r2_key: key, thumbnail_upload_url: upload_url });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
