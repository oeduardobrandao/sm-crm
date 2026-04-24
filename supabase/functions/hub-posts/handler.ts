import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubPostsHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
}

async function resolveToken(db: DbClient, token: string, now: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, conta_id, is_active")
    .eq("token", token)
    .gt("expires_at", now)
    .maybeSingle();
  return data;
}

export function createHubPostsHandler(deps: HubPostsHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);

    const db = deps.createDb();
    const hubToken = await resolveToken(db, token, deps.now());
    if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

    const { data: workflows } = await db
      .from("workflows")
      .select("id")
      .eq("cliente_id", hubToken.cliente_id)
      .eq("conta_id", hubToken.conta_id);

    const workflowIds = (workflows ?? []).map((workflow: { id: number }) => workflow.id);
    if (workflowIds.length === 0) {
      const { data: igAccount } = await db
        .from("instagram_accounts")
        .select("username, profile_picture_url")
        .eq("client_id", hubToken.cliente_id)
        .maybeSingle();

      return json({
        posts: [],
        postApprovals: [],
        propertyValues: [],
        workflowSelectOptions: [],
        instagramProfile: igAccount
          ? { username: igAccount.username, profilePictureUrl: igAccount.profile_picture_url }
          : null,
      });
    }

    const { data: posts } = await db
      .from("workflow_posts")
      .select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, workflow_id, workflows(titulo)")
      .in("workflow_id", workflowIds)
      .order("scheduled_at", { ascending: true });

    const flatPosts = (posts ?? []).map((post: any) => {
      const { workflows: workflow, ...rest } = post;
      return { ...rest, workflow_titulo: workflow?.titulo ?? "" };
    });

    const postIds = flatPosts.map((post: { id: number }) => post.id);

    const { data: postApprovals } = postIds.length > 0
      ? await db
          .from("post_approvals")
          .select("id, post_id, action, comentario, is_workspace_user, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: true })
      : { data: [] };

    const { data: propertyValues } = postIds.length > 0
      ? await db
          .from("post_property_values")
          .select("post_id, value, template_property_definitions!inner(name, type, config, portal_visible, display_order)")
          .in("post_id", postIds)
          .eq("template_property_definitions.portal_visible", true)
          .order("template_property_definitions(display_order)", { ascending: true })
      : { data: [] };

    const { data: workflowSelectOptions } = postIds.length > 0
      ? await db
          .from("workflow_select_options")
          .select("workflow_id, property_definition_id, option_id, label, color")
          .in("workflow_id", workflowIds)
      : { data: [] };

    const { data: mediaRows } = postIds.length > 0
      ? await db
          .from("post_media")
          .select("id, post_id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, is_cover, sort_order")
          .in("post_id", postIds)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
      : { data: [] };

    const mediaWithUrls = await Promise.all((mediaRows ?? []).map(async (media: any) => ({
      id: media.id,
      post_id: media.post_id,
      kind: media.kind,
      mime_type: media.mime_type,
      width: media.width,
      height: media.height,
      duration_seconds: media.duration_seconds,
      is_cover: media.is_cover,
      sort_order: media.sort_order,
      url: await deps.signGetUrl(media.r2_key, 3600),
      thumbnail_url: media.thumbnail_r2_key ? await deps.signGetUrl(media.thumbnail_r2_key, 3600) : null,
    })));

    const mediaByPost: Record<number, typeof mediaWithUrls> = {};
    for (const media of mediaWithUrls) {
      (mediaByPost[media.post_id] ??= []).push(media);
    }

    const flatPostsWithMedia = flatPosts.map((post: any) => {
      const mediaForPost = mediaByPost[post.id] ?? [];
      const cover_media = mediaForPost.find((media) => media.is_cover) ?? mediaForPost[0] ?? null;
      return { ...post, media: mediaForPost, cover_media };
    });

    const { data: igAccount } = await db
      .from("instagram_accounts")
      .select("username, profile_picture_url")
      .eq("client_id", hubToken.cliente_id)
      .maybeSingle();

    return json({
      posts: flatPostsWithMedia,
      postApprovals: postApprovals ?? [],
      propertyValues: propertyValues ?? [],
      workflowSelectOptions: workflowSelectOptions ?? [],
      instagramProfile: igAccount
        ? { username: igAccount.username, profilePictureUrl: igAccount.profile_picture_url }
        : null,
    });
  };
}
