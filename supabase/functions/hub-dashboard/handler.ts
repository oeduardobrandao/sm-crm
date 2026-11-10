import { createJsonResponder } from "../_shared/http.ts";
import { decryptText } from "../_shared/crypto.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import {
  type HubAccountSummary,
  instagramState,
  instagramSummary,
  loadTikTokCard,
  loadTikTokData,
  tiktokSummary,
} from "./accounts.ts";
import { resolvePlatform, topVideos, viewsHistory } from "./tiktok-detail.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubDashboardHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  encryptionSecret: string;
  effectivePlanFeature: (db: DbClient, workspaceId: string, key: string) => Promise<boolean>;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
}

const GRAPH_TIMEOUT_MS = 3000;

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

interface BodyParts {
  instagram?: Record<string, unknown>;
  accounts: HubAccountSummary[];
  platform: "instagram" | "tiktok";
  tiktok?: Record<string, unknown>;
  period: number;
}

/** The one place the response keys are assembled: legacy Instagram keys (empty when there is no
 * Instagram detail), then accounts, platform and, only when present, the tiktok block. */
function buildBody(p: BodyParts) {
  return {
    topPosts: [],
    followerHistory: [],
    reachHistory: [],
    account: null,
    ...p.instagram,
    accounts: p.accounts,
    platform: p.platform,
    ...(p.tiktok ? { tiktok: p.tiktok } : {}),
    period: p.period,
  };
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

    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return json({ error: "Link inválido." }, 404);
    }

    const okRead = await deps.rateLimit(
      db, `hub-read:${hubToken.conta_id}:${hubToken.cliente_id}`, 300, 300,
    );
    if (!okRead) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

    const { data: igAccount } = await db
      .from("instagram_accounts")
      .select("id, username, authorization_status, token_expires_at, created_at, encrypted_access_token, follower_count, following_count, media_count, reach_28d, impressions_28d, last_synced_at")
      .eq("client_id", hubToken.cliente_id)
      .maybeSingle();

    const nowIso = deps.now();
    const igState = igAccount ? instagramState(igAccount, nowIso) : null;

    const requested = url.searchParams.get("platform");
    const now = new Date(nowIso);
    const feature = (key: string) => deps.effectivePlanFeature(db, hubToken.conta_id, key);
    const igHasCard = !!igAccount && igState !== null;

    // TikTok is secondary: a failure there must not take the Instagram detail down with it. It
    // starts now and is awaited at the end, so it overlaps the Instagram queries. One query set
    // serves both the 30-day summary and, when TikTok is the platform shown, the detail.
    const tiktokP = (async () => {
      try {
        const card = await loadTikTokCard(db, hubToken.cliente_id, feature);
        if (!card) return null;
        const shown = resolvePlatform(requested, [{ platform: igHasCard ? "instagram" : "tiktok" }]);
        const data = await loadTikTokData(db, card.account, shown === "tiktok" ? period : 30, now);
        return { card, data };
      } catch (err) {
        console.error("hub-dashboard: tiktok load failed", err);
        return null;
      }
    })();

    const tiktokParts = (tt: Awaited<typeof tiktokP>, platform: "instagram" | "tiktok") => ({
      summary: tt ? tiktokSummary(tt.card, tt.data, now) : null,
      detail: tt && platform === "tiktok"
        ? {
          topVideos: topVideos(tt.data.videos),
          followerHistory: tt.data.history
            .filter((r) => r.follower_count != null)
            .map((r) => ({ date: r.date, followerCount: r.follower_count })),
          viewsHistory: viewsHistory(tt.data.videos),
        }
        : undefined,
    });

    if (!igAccount || igState === null) {
      const tt = await tiktokP;
      const accounts: HubAccountSummary[] = [];
      const parts = tiktokParts(tt, resolvePlatform(requested, tt ? [{ platform: "tiktok" }] : []));
      if (parts.summary) accounts.push(parts.summary);
      const platform = resolvePlatform(requested, accounts);
      return json(buildBody({
        accounts,
        platform,
        tiktok: platform === "tiktok" && accounts.length > 0 ? tiktokParts(tt, platform).detail : undefined,
        period,
      }));
    }

    const igPlatform = resolvePlatform(requested, [{ platform: "instagram" }]);
    if (igPlatform === "tiktok") {
      // The Instagram card still needs its 30-day change: one history query, no detail.
      const sinceDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: rows } = await db
        .from("instagram_follower_history")
        .select("date, follower_count")
        .eq("instagram_account_id", igAccount.id)
        .gte("date", sinceDate)
        .order("date", { ascending: true });
      const accounts: HubAccountSummary[] = [];
      const igSum = instagramSummary(igAccount, rows ?? [], nowIso);
      if (igSum) accounts.push(igSum);
      const tt = await tiktokP;
      const parts = tiktokParts(tt, "tiktok");
      if (parts.summary) accounts.push(parts.summary);
      return json(buildBody({ accounts, platform: "tiktok", tiktok: parts.detail, period }));
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
      .or('impressions.gt.0,reach.gt.0')
      .order("impressions", { ascending: false })
      .order("posted_at", { ascending: false })
      .limit(5);

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
      }));

    if (igState === "connected" && topPosts.length > 0 && igAccount.encrypted_access_token) {
      try {
        const accessToken = await decryptText(
          igAccount.encrypted_access_token,
          deps.encryptionSecret,
          "instagram-access-token",
        );
        const ids = topPosts.map((p: { id: string }) => p.id).join(",");
        const res = await fetch(
          `https://graph.instagram.com/?ids=${ids}&fields=thumbnail_url,media_url&access_token=${accessToken}`,
          { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) },
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

    const accounts: HubAccountSummary[] = [];
    const igSummary = instagramSummary(igAccount, followerRows ?? [], nowIso);
    if (igSummary) accounts.push(igSummary);
    const tiktokSum = tiktokParts(await tiktokP, "instagram").summary;
    if (tiktokSum) accounts.push(tiktokSum);

    return json(buildBody({
      instagram: {
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
      },
      accounts,
      platform: "instagram",
      period,
    }));
  };
}
