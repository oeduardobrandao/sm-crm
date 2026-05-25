import { createJsonResponder } from "../_shared/http.ts";
import { decryptText } from "../_shared/crypto.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubDashboardHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  encryptionSecret: string;
}

const VALID_PERIODS = new Set([30, 60, 90]);

function parsePeriod(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  return VALID_PERIODS.has(n) ? n : 30;
}

function computeEngagementRate(post: {
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  reach: number;
}): number {
  if (post.reach <= 0) return 0;
  const interactions = post.likes + post.comments + post.saved + post.shares;
  return Math.round((interactions / post.reach) * 1000) / 10;
}

export function createHubDashboardHandler(deps: HubDashboardHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);

    const period = parsePeriod(url.searchParams.get("period"));
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
      .select("id, encrypted_access_token, follower_count, following_count, media_count, reach_28d, impressions_28d, last_synced_at")
      .eq("client_id", hubToken.cliente_id)
      .maybeSingle();

    if (!igAccount) {
      return json({
        topPosts: [],
        followerHistory: [],
        reachHistory: [],
        account: null,
        period,
      });
    }

    const cutoff = new Date(
      new Date(deps.now()).getTime() - period * 24 * 60 * 60 * 1000,
    ).toISOString();

    const cutoffDate = cutoff.slice(0, 10);

    const { data: topPostsRaw } = await db
      .from("instagram_posts")
      .select("instagram_post_id, thumbnail_url, media_type, permalink, posted_at, likes, comments, reach, impressions, saved, shares")
      .eq("instagram_account_id", igAccount.id)
      .gte("posted_at", cutoff)
      .gt("reach", 0)
      .order("reach", { ascending: false })
      .limit(20);

    const topPosts = (topPostsRaw ?? [])
      .map((p: any) => ({
        id: p.instagram_post_id,
        thumbnailUrl: p.thumbnail_url as string | null,
        mediaType: p.media_type,
        permalink: p.permalink,
        postedAt: p.posted_at,
        likes: p.likes ?? 0,
        comments: p.comments ?? 0,
        reach: p.reach ?? 0,
        impressions: p.impressions ?? 0,
        saved: p.saved ?? 0,
        shares: p.shares ?? 0,
        engagementRate: computeEngagementRate({
          likes: p.likes ?? 0,
          comments: p.comments ?? 0,
          saved: p.saved ?? 0,
          shares: p.shares ?? 0,
          reach: p.reach ?? 0,
        }),
      }))
      .sort((a: { reach: number }, b: { reach: number }) =>
        b.reach - a.reach,
      )
      .slice(0, 5);

    if (topPosts.length > 0 && igAccount.encrypted_access_token) {
      try {
        const accessToken = await decryptText(
          igAccount.encrypted_access_token,
          deps.encryptionSecret,
          "instagram-access-token",
        );
        const ids = topPosts.map((p: { id: string }) => p.id).join(",");
        const res = await fetch(
          `https://graph.instagram.com/?ids=${ids}&fields=thumbnail_url,media_url&access_token=${accessToken}`,
        );
        if (res.ok) {
          const data = await res.json();
          for (const post of topPosts) {
            const media = data[post.id];
            if (media) {
              post.thumbnailUrl = media.thumbnail_url || media.media_url || post.thumbnailUrl;
            }
          }
        }
      } catch {
        // keep existing (possibly expired) thumbnail URLs
      }
    }

    const postsWithRate = topPosts;

    const { data: followerRows } = await db
      .from("instagram_follower_history")
      .select("date, follower_count")
      .eq("instagram_account_id", igAccount.id)
      .gte("date", cutoffDate)
      .order("date", { ascending: true });

    const { data: reachRows } = await db
      .from("instagram_posts")
      .select("posted_at, reach, impressions")
      .eq("instagram_account_id", igAccount.id)
      .gte("posted_at", cutoff)
      .order("posted_at", { ascending: true });

    const reachByDate = new Map<string, { reach: number; impressions: number }>();
    for (const row of reachRows ?? []) {
      const date = (row as any).posted_at.slice(0, 10);
      const existing = reachByDate.get(date) ?? { reach: 0, impressions: 0 };
      existing.reach += (row as any).reach ?? 0;
      existing.impressions += (row as any).impressions ?? 0;
      reachByDate.set(date, existing);
    }

    return json({
      topPosts: postsWithRate,
      followerHistory: (followerRows ?? []).map((r: any) => ({
        date: r.date,
        followerCount: r.follower_count,
      })),
      reachHistory: Array.from(reachByDate.entries())
        .map(([date, val]) => ({ date, reach: val.reach, impressions: val.impressions }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      account: {
        followerCount: igAccount.follower_count,
        followingCount: igAccount.following_count,
        mediaCount: igAccount.media_count,
        reach28d: igAccount.reach_28d,
        impressions28d: igAccount.impressions_28d,
        lastSyncedAt: igAccount.last_synced_at,
      },
      period,
    });
  };
}
