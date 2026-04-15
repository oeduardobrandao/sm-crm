import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function resolveToken(db: ReturnType<typeof createClient>, token: string) {
  const { data } = await db
    .from("client_hub_tokens")
    .select("cliente_id, conta_id, is_active")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const hubToken = await resolveToken(db, token);
  if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

  // Fetch all workflows for this client (scoped to conta_id for IDOR protection)
  const { data: workflows } = await db
    .from("workflows")
    .select("id")
    .eq("cliente_id", hubToken.cliente_id)
    .eq("conta_id", hubToken.conta_id);

  const workflowIds = (workflows ?? []).map((w: { id: number }) => w.id);
  if (workflowIds.length === 0) return json({ posts: [], postApprovals: [] });

  // Fetch all posts
  const { data: posts } = await db
    .from("workflow_posts")
    .select("id, titulo, tipo, status, ordem, conteudo_plain, scheduled_at, workflow_id, workflows(titulo)")
    .in("workflow_id", workflowIds)
    .order("scheduled_at", { ascending: true });

  const flatPosts = (posts ?? []).map((p: any) => {
    const { workflows, ...rest } = p;
    return { ...rest, workflow_titulo: workflows?.titulo ?? '' };
  });

  const postIds = flatPosts.map((p: { id: number }) => p.id);

  // Fetch approval history for those posts
  const { data: postApprovals } = postIds.length > 0
    ? await db
        .from("post_approvals")
        .select("id, post_id, action, comentario, is_workspace_user, created_at")
        .in("post_id", postIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  // Fetch portal-visible property values for those posts
  const { data: propertyValues } = postIds.length > 0
    ? await db
        .from("post_property_values")
        .select("post_id, value, template_property_definitions!inner(name, type, config, portal_visible, display_order)")
        .in("post_id", postIds)
        .eq("template_property_definitions.portal_visible", true)
        .order("template_property_definitions(display_order)", { ascending: true })
    : { data: [] };

  // For select/multiselect, also fetch workflow-level options for these posts' workflows
  const { data: workflowSelectOptions } = postIds.length > 0
    ? await db
        .from("workflow_select_options")
        .select("workflow_id, property_definition_id, option_id, label, color")
        .in("workflow_id", workflowIds)
    : { data: [] };

  // Fetch media for those posts
  const { data: mediaRows } = postIds.length > 0
    ? await db
        .from("post_media")
        .select("id, post_id, kind, mime_type, r2_key, thumbnail_r2_key, width, height, duration_seconds, is_cover, sort_order")
        .in("post_id", postIds)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
    : { data: [] };

  const mediaWithUrls = await Promise.all((mediaRows ?? []).map(async (m: any) => ({
    id: m.id,
    post_id: m.post_id,
    kind: m.kind,
    mime_type: m.mime_type,
    width: m.width,
    height: m.height,
    duration_seconds: m.duration_seconds,
    is_cover: m.is_cover,
    sort_order: m.sort_order,
    url: await signGetUrl(m.r2_key, 3600),
    thumbnail_url: m.thumbnail_r2_key ? await signGetUrl(m.thumbnail_r2_key, 3600) : null,
  })));

  const mediaByPost: Record<number, typeof mediaWithUrls> = {};
  for (const m of mediaWithUrls) {
    (mediaByPost[m.post_id] ??= []).push(m);
  }

  const flatPostsWithMedia = flatPosts.map((p: any) => {
    const mediaForPost = mediaByPost[p.id] ?? [];
    const cover_media = mediaForPost.find((m) => m.is_cover) ?? mediaForPost[0] ?? null;
    return { ...p, media: mediaForPost, cover_media };
  });

  return json({
    posts: flatPostsWithMedia,
    postApprovals: postApprovals ?? [],
    propertyValues: propertyValues ?? [],
    workflowSelectOptions: workflowSelectOptions ?? [],
  });
});
