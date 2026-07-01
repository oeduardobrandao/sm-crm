import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";

function extractR2Keys(content: any): string[] {
  const keys: string[] = [];
  function walk(node: any) {
    if (node?.type === "inlineImage" && node.attrs?.r2Key) {
      keys.push(node.attrs.r2Key);
    }
    if (Array.isArray(node?.content)) node.content.forEach(walk);
  }
  walk(content);
  return keys;
}

function injectSignedUrls(content: any, urlMap: Record<string, string>): any {
  function walk(node: any): any {
    if (node?.type === "inlineImage" && node.attrs?.r2Key && urlMap[node.attrs.r2Key]) {
      return { ...node, attrs: { ...node.attrs, src: urlMap[node.attrs.r2Key] } };
    }
    if (Array.isArray(node?.content)) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(content);
}

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

interface HubPostsHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
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
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      const updates = body.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return json({ error: "updates array required" }, 400);
      }
      for (const u of updates) {
        if (!u || typeof u.post_id !== "number" || !("scheduled_at" in u)) {
          return json({ error: "malformed update" }, 400);
        }
      }

      // Ownership scoping, the status allowlist, and the atomic date swap (plus
      // publishing-safety for agendado rows) all live in one transactional RPC so
      // a swap can never half-apply or race the publish cron.
      const { data, error } = await db.rpc("hub_reorder_post_schedules", {
        p_cliente_id: hubToken.cliente_id,
        p_conta_id: hubToken.conta_id,
        p_updates: updates,
      });

      if (error) {
        const msg = String((error as { message?: string }).message ?? "");
        if (msg.includes("FORBIDDEN")) return json({ error: "Post não autorizado." }, 403);
        if (msg.includes("LOCKED")) {
          const lockedIds = (msg.match(/\{([\d,\s]+)\}/)?.[1] ?? "")
            .split(",")
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => Number.isFinite(n));
          return json(
            {
              error:
                "Não é possível reagendar posts em publicação ou já publicados. Atualize a página e tente novamente.",
              locked_post_ids: lockedIds,
            },
            409,
          );
        }
        if (msg.includes("BAD_REQUEST")) {
          return json({ error: "Datas inválidas para reagendamento." }, 400);
        }
        // Never leak raw internals to the client.
        return json({ error: "Falha ao reagendar." }, 500);
      }

      return json(data ?? { ok: true }, 200);
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
      .select("id, titulo, tipo, status, ordem, conteudo, conteudo_plain, scheduled_at, ig_caption, instagram_permalink, published_at, publish_error, workflow_id, workflows(titulo, created_at)")
      .in("workflow_id", workflowIds)
      .order("scheduled_at", { ascending: true });

    const flatPosts = (posts ?? []).map((post: any) => {
      const { workflows: workflow, ...rest } = post;
      return { ...rest, workflow_titulo: workflow?.titulo ?? "", workflow_created_at: workflow?.created_at ?? "" };
    });

    const postIds = flatPosts.map((post: { id: number }) => post.id);

    const { data: postApprovals } = postIds.length > 0
      ? await db
          .from("post_approvals")
          .select("id, post_id, action, comentario, is_workspace_user, created_at")
          .in("post_id", postIds)
          .order("created_at", { ascending: true })
      : { data: [] };

    const { data: pendingSuggestions } = postIds.length > 0
      ? await db
          .from("post_edit_suggestions")
          .select("id, post_id, suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption, changed_fields, updated_at")
          .in("post_id", postIds)
          .eq("status", "pending")
      : { data: [] };

    const suggestionByPost: Record<number, any> = {};
    for (const s of (pendingSuggestions ?? [])) {
      suggestionByPost[s.post_id] = s;
    }

    const { data: rejectedSuggestions } = postIds.length > 0
      ? await db
          .from("post_edit_suggestions")
          .select("post_id, updated_at")
          .in("post_id", postIds)
          .eq("status", "rejected")
          .order("updated_at", { ascending: false })
      : { data: [] };

    const rejectedAtByPost: Record<number, string> = {};
    for (const r of (rejectedSuggestions ?? [])) {
      if (!rejectedAtByPost[r.post_id]) rejectedAtByPost[r.post_id] = r.updated_at;
    }

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

    const expectedKeyPrefix = `contas/${hubToken.conta_id}/`;
    const allContentKeys: string[] = [];
    for (const post of flatPostsWithMedia) {
      if (post.conteudo) allContentKeys.push(...extractR2Keys(post.conteudo));
    }

    const contentUrlMap: Record<string, string> = {};
    if (allContentKeys.length > 0) {
      const safeKeys = allContentKeys.filter((key) => key.startsWith(expectedKeyPrefix));
      if (safeKeys.length > 0) {
        const { data: validFiles } = await db.from("files")
          .select("r2_key")
          .eq("conta_id", hubToken.conta_id)
          .in("r2_key", safeKeys);
        const validKeySet = new Set((validFiles ?? []).map((f: any) => f.r2_key));
        await Promise.all(
          safeKeys.filter((key) => validKeySet.has(key)).map(async (key) => {
            contentUrlMap[key] = await deps.signGetUrl(key, 3600);
          })
        );
      }
    }

    // Also collect R2 keys from pending suggestions for URL signing
    const suggestionContentKeys: string[] = [];
    for (const s of Object.values(suggestionByPost)) {
      if ((s as any).suggested_conteudo) {
        suggestionContentKeys.push(...extractR2Keys((s as any).suggested_conteudo));
      }
    }
    if (suggestionContentKeys.length > 0) {
      const safeKeys = suggestionContentKeys.filter((key) => key.startsWith(expectedKeyPrefix));
      const unseenKeys = safeKeys.filter((key) => !(key in contentUrlMap));
      if (unseenKeys.length > 0) {
        const { data: validFiles } = await db.from("files")
          .select("r2_key")
          .eq("conta_id", hubToken.conta_id)
          .in("r2_key", unseenKeys);
        const validKeySet = new Set((validFiles ?? []).map((f: any) => f.r2_key));
        await Promise.all(
          unseenKeys.filter((key) => validKeySet.has(key)).map(async (key) => {
            contentUrlMap[key] = await deps.signGetUrl(key, 3600);
          })
        );
      }
    }

    const postsWithResolvedContent = flatPostsWithMedia.map((post: any) => {
      const suggestion = suggestionByPost[post.id] ?? null;
      let resolvedPost = post;

      if (post.conteudo && extractR2Keys(post.conteudo).length > 0) {
        resolvedPost = { ...resolvedPost, conteudo: injectSignedUrls(post.conteudo, contentUrlMap) };
      }

      let resolvedSuggestion = suggestion;
      if (suggestion?.suggested_conteudo && extractR2Keys(suggestion.suggested_conteudo).length > 0) {
        resolvedSuggestion = {
          ...suggestion,
          suggested_conteudo: injectSignedUrls(suggestion.suggested_conteudo, contentUrlMap),
        };
      }

      return {
        ...resolvedPost,
        pending_suggestion: resolvedSuggestion,
        suggestion_rejected_at: !resolvedSuggestion ? (rejectedAtByPost[post.id] ?? null) : null,
      };
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
      posts: postsWithResolvedContent,
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
