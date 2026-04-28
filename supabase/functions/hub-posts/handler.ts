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
    if (req.method !== "GET" && req.method !== "PATCH") {
      return json({ error: "Method not allowed" }, 405);
    }

    const url = new URL(req.url);
    const token = url.searchParams.get("token")
      ?? (req.method === "PATCH" ? (await req.clone().json().catch(() => ({}))).token : null);
    if (!token) return json({ error: "token required" }, 400);

    const db = deps.createDb();
    const hubToken = await resolveToken(db, token, deps.now());
    if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      const updates: { post_id: number; scheduled_at: string | null }[] = body.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return json({ error: "updates array required" }, 400);
      }

      const { data: workflows } = await db
        .from("workflows")
        .select("id")
        .eq("cliente_id", hubToken.cliente_id)
        .eq("conta_id", hubToken.conta_id);
      const workflowIds = (workflows ?? []).map((w: { id: number }) => w.id);

      const postIds = updates.map((u) => u.post_id);
      const { data: posts } = await db
        .from("workflow_posts")
        .select("id, workflow_id")
        .in("id", postIds)
        .in("workflow_id", workflowIds);

      const allowedIds = new Set((posts ?? []).map((p: { id: number }) => p.id));

      const { data: postStatuses } = await db
        .from("workflow_posts")
        .select("id, status")
        .in("id", Array.from(allowedIds));

      const lockedStatuses = new Set(["agendado", "postado", "falha_publicacao"]);
      const lockedPosts = (postStatuses ?? []).filter(
        (p: { id: number; status: string }) => lockedStatuses.has(p.status)
      );
      if (lockedPosts.length > 0) {
        const lockedIds = lockedPosts.map((p: { id: number }) => p.id);
        return json({
          error: "Não é possível alterar a data de posts agendados ou publicados. Cancele o agendamento primeiro.",
          locked_post_ids: lockedIds,
        }, 409);
      }

      const validUpdates = updates.filter((u) => allowedIds.has(u.post_id));

      if (validUpdates.length === 0) {
        return json({ error: "No valid posts to update" }, 400);
      }

      for (const u of validUpdates) {
        const { error } = await db
          .from("workflow_posts")
          .update({ scheduled_at: u.scheduled_at })
          .eq("id", u.post_id);
        if (error) return json({ error: error.message }, 500);
      }

      return json({ ok: true, updated: validUpdates.length });
    }

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
      .select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, ig_caption, instagram_permalink, published_at, publish_error, workflow_id, workflows(titulo)")
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

    const { data: mediaLinks } = postIds.length > 0
      ? await db
          .from("post_file_links")
          .select("id, post_id, is_cover, sort_order, files(id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, blur_data_url)")
          .in("post_id", postIds)
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true })
      : { data: [] };

    const mediaWithUrls = await Promise.all((mediaLinks ?? []).map(async (link: any) => {
      const f = link.files;
      return {
        id: link.id,
        post_id: link.post_id,
        kind: f.kind,
        mime_type: f.mime_type,
        width: f.width,
        height: f.height,
        duration_seconds: f.duration_seconds,
        is_cover: link.is_cover,
        sort_order: link.sort_order,
        blur_data_url: f.blur_data_url ?? null,
        url: await deps.signGetUrl(f.r2_key, 3600),
        thumbnail_url: f.thumbnail_r2_key ? await deps.signGetUrl(f.thumbnail_r2_key, 3600) : null,
      };
    }));

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

    const { data: clienteRow } = await db
      .from("clientes")
      .select("auto_publish_on_approval")
      .eq("id", hubToken.cliente_id)
      .single();

    return json({
      posts: flatPostsWithMedia,
      postApprovals: postApprovals ?? [],
      propertyValues: propertyValues ?? [],
      workflowSelectOptions: workflowSelectOptions ?? [],
      instagramProfile: igAccount
        ? { username: igAccount.username, profilePictureUrl: igAccount.profile_picture_url }
        : null,
      autoPublishOnApproval: clienteRow?.auto_publish_on_approval ?? false,
    });
  };
}
