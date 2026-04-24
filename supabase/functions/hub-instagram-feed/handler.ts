import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubInstagramFeedHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

export function createHubInstagramFeedHandler(deps: HubInstagramFeedHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);

    const db = deps.createDb();

    const { data: hubToken } = await db
      .from("client_hub_tokens")
      .select("cliente_id, conta_id, is_active")
      .eq("token", token)
      .gt("expires_at", deps.now())
      .maybeSingle();

    if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

    const { data: igAccount } = await db
      .from("instagram_accounts")
      .select("id, username, profile_picture_url, follower_count, following_count, media_count")
      .eq("client_id", hubToken.cliente_id)
      .maybeSingle();

    if (!igAccount) return json({ error: "Conta Instagram não encontrada." }, 404);

    const { data: posts } = await db
      .from("instagram_posts")
      .select("instagram_post_id, thumbnail_url, media_type, permalink, posted_at, impressions")
      .eq("instagram_account_id", igAccount.id)
      .order("posted_at", { ascending: false })
      .limit(30);

    return json({
      profile: {
        username: igAccount.username,
        profilePictureUrl: igAccount.profile_picture_url,
        followerCount: igAccount.follower_count,
        followingCount: igAccount.following_count,
        mediaCount: igAccount.media_count,
      },
      recentPosts: (posts ?? []).map((p: any) => ({
        id: p.instagram_post_id,
        thumbnailUrl: p.thumbnail_url,
        mediaType: p.media_type,
        permalink: p.permalink,
        postedAt: p.posted_at,
        impressions: p.impressions ?? 0,
      })),
    });
  };
}
