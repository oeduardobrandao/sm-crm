import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createInstagramSyncCronHandler } from "./handler.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { runPool } from "./pool.ts";
import { buildSnapshotRow } from "./snapshot.ts";
import { ingestClosedDays } from "./daily-ingest.ts";
import { buildMetricFields, fetchPostInsights } from "../_shared/instagram-metrics.ts";
import { cachePostThumbnail } from "../_shared/instagram-thumbnail-cache.ts";
import { fetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";
import { collectSyncCandidates, selectAccountsToSync } from "./select.ts";
import { runMaintenanceStep } from "./backfill.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();

// Accounts synced per invocation. Runtime is bounded by this, not by customer
// count: SYNC_BATCH_LIMIT / SYNC_CONCURRENCY waves of ~4-8s each. At 25/5 that
// is ~30s, well inside the edge-function wall clock. The cron runs hourly
// (migration 20260803000009), so capacity is 24 * SYNC_BATCH_LIMIT per day
// against a 6h per-account staleness window.
const SYNC_BATCH_LIMIT = Math.max(1, parseInt(Deno.env.get("SYNC_BATCH_LIMIT") || "25", 10) || 25);
// Candidates are read in pages until the batch fills, so ineligible accounts
// (which cluster at the head of the stalest-first ordering, since they never
// sync and their last_synced_at stays NULL) get skipped past rather than
// occupying the whole window. The page cap is a runaway guard, not a
// throughput limit: at 200 x 25 it scans up to 5000 candidates, and each page
// is a cheap indexed read of ~50ms.
const CANDIDATE_PAGE_SIZE = Math.max(SYNC_BATCH_LIMIT, parseInt(Deno.env.get("SYNC_CANDIDATE_PAGE_SIZE") || "200", 10) || 200);
const MAX_CANDIDATE_PAGES = Math.max(1, parseInt(Deno.env.get("SYNC_CANDIDATE_PAGES") || "25", 10) || 25);

// Contas processadas pelo passo de manutenção (backfill mensal) por tick.
// Orçamento PRÓPRIO, independente de SYNC_BATCH_LIMIT: 1 mês (~7 requests
// fetchAccountTotals) por conta pendente, mais os extras de primeiro tick
// (reach_day 90d + histórico de seguidores) quando aplicável. Ver backfill.ts.
const BACKFILL_BATCH_LIMIT = Math.max(1, parseInt(Deno.env.get("BACKFILL_BATCH_LIMIT") || "3", 10) || 3);

// --- Token Decryption Utility ---
async function getEncryptionKey(purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(TOKEN_ENCRYPTION_KEY), { name: 'HKDF' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(purpose) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

async function getLegacyKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' },
    false,
    usage
  );
}

async function encryptToken(token: string): Promise<string> {
  const key = await getEncryptionKey('instagram-access-token', ['encrypt']);
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  const encryptedArray = new Uint8Array(encryptedBuf);
  const combined = new Uint8Array(iv.length + encryptedArray.length);
  combined.set(iv);
  combined.set(encryptedArray, iv.length);
  return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

async function decryptToken(encryptedBase64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  try {
    const key = await getEncryptionKey('instagram-access-token', ['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    const legacyKey = await getLegacyKey(['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, data);
    return new TextDecoder().decode(decryptedBuf);
  }
}

// --- Sync a single Instagram account ---
async function syncAccount(
  supabase: ReturnType<typeof createClient>,
  account: {
    id: string;
    instagram_user_id: string;
    encrypted_access_token: string;
    token_expires_at: string;
    follower_count: number;
    following_count: number;
    media_count: number;
  }
): Promise<{ success: boolean; error?: string }> {
  let accessToken = await decryptToken(account.encrypted_access_token);

  // Proactive refresh: if token expires within 7 days, refresh before syncing
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (expiresAt > 0 && expiresAt - Date.now() < sevenDaysMs) {
    try {
      const refreshRes = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${accessToken}`);
      const refreshData = await refreshRes.json();
      if (refreshData.access_token) {
        accessToken = refreshData.access_token;
        const expiresIn = refreshData.expires_in || (60 * 60 * 24 * 60);
        const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
        const newEncrypted = await encryptToken(accessToken);
        await supabase.from('instagram_accounts').update({
          encrypted_access_token: newEncrypted,
          token_expires_at: newExpiresAt,
          authorization_status: 'active',
        }).eq('id', account.id);
        console.log(`[IG-SYNC-CRON] Proactively refreshed token for account ${account.id}`);
      } else if (refreshData.error?.code === 190) {
        await supabase.from('instagram_accounts').update({ authorization_status: 'expired' }).eq('id', account.id);
        return { success: false, error: 'TOKEN_EXPIRED' };
      }
    } catch (e) { console.log('[IG-SYNC-CRON] Proactive refresh failed (non-fatal):', e); }
  }

  // Fetch account insights (28-day window), profile, and media in parallel
  const nowTimestamp = Math.floor(Date.now() / 1000);
  const sinceDate = nowTimestamp - (28 * 24 * 60 * 60);

  // Every fetch here needs its own timeout (house rule, R2-hang incident):
  // this Promise.all is inside a state-setting handler -- a stalled Graph
  // request would otherwise hold up the whole account sync indefinitely,
  // and the edge runtime can kill the invocation mid-state before it ever
  // reaches the DB updates below. A rejection here (timeout or otherwise)
  // propagates out of this async function to the caller's try/catch
  // (runPool's account callback in the handler below), which already
  // treats it as a sync failure for this account -- same as any other
  // network error today, so this doesn't change failure semantics.
  const [reachRes, viewsRes, engagedRes, websiteClicksRes, profileViewsRes, igProfileRes, mediaRes] = await Promise.all([
    fetch(`https://graph.instagram.com/me/insights?metric=reach&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`https://graph.instagram.com/me/insights?metric=views&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`https://graph.instagram.com/me/insights?metric=accounts_engaged&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`https://graph.instagram.com/me/insights?metric=website_clicks&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`https://graph.instagram.com/me/insights?metric=profile_views&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`https://graph.instagram.com/me?fields=followers_count,follows_count,media_count,profile_picture_url&access_token=${accessToken}`, { signal: AbortSignal.timeout(15_000) }),
    fetch(`https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count&limit=50&access_token=${accessToken}`, { signal: AbortSignal.timeout(15_000) })
  ]);

  const [reachData, viewsData, engagedData, websiteClicksData, profileViewsData, igProfile, mediaData] = await Promise.all([
    reachRes.json(), viewsRes.json(), engagedRes.json(), websiteClicksRes.json(), profileViewsRes.json(), igProfileRes.json(), mediaRes.json()
  ]);

  // Check for expired token — mark in DB so UI shows correct status
  if (reachData.error?.code === 190) {
    await supabase.from('instagram_accounts').update({ authorization_status: 'expired' }).eq('id', account.id);
    return { success: false, error: 'TOKEN_EXPIRED' };
  }

  // Parse insights. Variables named for what the Graph metric actually IS
  // (previously `accounts_engaged` was parsed into a variable called
  // `totalViews` and written to profile_views_28d — a mislabeled value, not
  // profile views at all; fixed here + real profile_views fetched above).
  let totalReach = 0, totalViews = 0, totalEngaged = 0, totalWebsiteClicks = 0, totalProfileViews = 0;
  if (reachData.data) {
    for (const insight of reachData.data) {
      if (insight.name === 'reach') totalReach = insight.total_value?.value || 0;
    }
  }
  if (viewsData.data) {
    for (const insight of viewsData.data) {
      if (insight.name === 'views') totalViews = insight.total_value?.value || 0;
    }
  }
  if (engagedData.data) {
    for (const insight of engagedData.data) {
      if (insight.name === 'accounts_engaged') totalEngaged = insight.total_value?.value || 0;
    }
  }
  if (websiteClicksData.data) {
    for (const insight of websiteClicksData.data) {
      if (insight.name === 'website_clicks') totalWebsiteClicks = insight.total_value?.value || 0;
    }
  }
  if (profileViewsData.data) {
    for (const insight of profileViewsData.data) {
      if (insight.name === 'profile_views') totalProfileViews = insight.total_value?.value || 0;
    }
  }

  // Cache profile picture (non-fatal)
  let storedAvatarUrl: string | undefined;
  if (igProfile.profile_picture_url) {
    try {
      const imgRes = await fetch(igProfile.profile_picture_url);
      if (imgRes.ok) {
        const imgBytes = await imgRes.arrayBuffer();
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const storagePath = `instagram/${account.id}.jpg`;
        const BUCKET = 'avatars';
        let { error: uploadError } = await supabase.storage
          .from(BUCKET).upload(storagePath, imgBytes, { contentType, upsert: true });
        if (uploadError?.message?.includes('Bucket not found')) {
          await supabase.storage.createBucket(BUCKET, { public: true });
          ({ error: uploadError } = await supabase.storage
            .from(BUCKET).upload(storagePath, imgBytes, { contentType, upsert: true }));
        }
        if (!uploadError) {
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
          storedAvatarUrl = pub.publicUrl;
        }
      }
    } catch (e) { console.log('[IG-SYNC-CRON] Avatar cache failed (non-fatal):', e); }
  }

  // Check for manual follower entry before upserting
  const today = new Date().toISOString().split('T')[0];
  const { data: existingSyncEntry } = await supabase
    .from('instagram_follower_history')
    .select('source')
    .eq('instagram_account_id', account.id)
    .eq('date', today)
    .maybeSingle();

  const shouldUpsertHistory = !existingSyncEntry || existingSyncEntry.source !== 'manual';

  // Update account stats and follower history in parallel
  await Promise.all([
    supabase.from('instagram_accounts').update({
      follower_count: igProfile.followers_count || account.follower_count,
      following_count: igProfile.follows_count || account.following_count,
      media_count: igProfile.media_count || account.media_count,
      ...(storedAvatarUrl ? { profile_picture_url: storedAvatarUrl } : igProfile.profile_picture_url ? { profile_picture_url: igProfile.profile_picture_url } : {}),
      reach_28d: totalReach,
      impressions_28d: totalViews,
      accounts_engaged_28d: totalEngaged,
      profile_views_28d: totalProfileViews,
      website_clicks_28d: totalWebsiteClicks,
      last_synced_at: new Date().toISOString()
    }).eq('id', account.id),
    ...(shouldUpsertHistory ? [
      supabase.from('instagram_follower_history').upsert({
        instagram_account_id: account.id,
        date: today,
        follower_count: igProfile.followers_count || account.follower_count,
        source: 'api',
      }, { onConflict: 'instagram_account_id,date' })
    ] : []),
    supabase.from('instagram_account_metrics_daily').upsert(
      buildSnapshotRow(account.id, {
        followers_count: igProfile.followers_count || account.follower_count,
        reach_28d: totalReach,
        impressions_28d: totalViews,
        accounts_engaged_28d: totalEngaged,
        profile_views_28d: totalProfileViews,
        website_clicks_28d: totalWebsiteClicks,
      }),
      { onConflict: 'instagram_account_id,snapshot_date' }
    ),
  ]);

  // Ingestão de dias fechados (D-1..D-3 UTC) nas colunas *_day. Falha aqui
  // (rede, token — o estado do token já foi tratado acima) só loga: nunca
  // derruba o resultado do sync desta conta.
  try {
    await ingestClosedDays(supabase, fetch, account.id, accessToken, Math.floor(Date.now() / 1000));
  } catch (e) {
    console.warn(`[IG-SYNC-CRON] ingestClosedDays failed for account ${account.id} (non-fatal):`, e);
  }

  if (mediaData.data && mediaData.data.length > 0) {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentPosts = mediaData.data.filter(
      (post: any) => new Date(post.timestamp).getTime() > thirtyDaysAgo
    );

    if (recentPosts.length > 0) {
      const existingByPostId = new Map<string, any>();
      {
        const ids = recentPosts.map((p: any) => p.id);
        if (ids.length) {
          const { data: existingRows } = await supabase
            .from('instagram_posts')
            .select('instagram_post_id, thumbnail_url, reach, impressions, saved, shares, likes, comments')
            .in('instagram_post_id', ids) as { data: any[] | null };
          for (const r of existingRows ?? []) existingByPostId.set(r.instagram_post_id, r);
        }
      }
      const allPostData: any[] = [];
      const BATCH_SIZE = 10;

      for (let i = 0; i < recentPosts.length; i += BATCH_SIZE) {
        const batch = recentPosts.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(async (post: any) => {
          const insights = await fetchPostInsights(fetch, post.id, accessToken);
          const m = buildMetricFields(existingByPostId.get(post.id) ?? null, insights, post);

          let thumbUrl = post.thumbnail_url || post.media_url || null;
          if (!thumbUrl && post.media_type === 'CAROUSEL_ALBUM') {
            try {
              const childRes = await fetch(`https://graph.instagram.com/${post.id}/children?fields=media_url,media_type&limit=1&access_token=${accessToken}`);
              const childData = await childRes.json();
              if (childData.data?.[0]?.media_url) thumbUrl = childData.data[0].media_url;
            } catch (_) { /* ignore */ }
          }
          // Persist the thumbnail to durable storage so the Hub feed never depends on
          // Instagram's expiring CDN links; keeps the raw url on any failure.
          const cachedThumb = await cachePostThumbnail(
            { fetch, storage: supabase.storage },
            account.id,
            post.id,
            thumbUrl,
            existingByPostId.get(post.id)?.thumbnail_url ?? null,
          );

          return {
            instagram_account_id: account.id,
            instagram_post_id: post.id,
            caption: post.caption || '',
            media_type: post.media_type,
            thumbnail_url: cachedThumb,
            permalink: post.permalink,
            posted_at: post.timestamp,
            likes: m.likes, comments: m.comments,
            reach: m.reach, impressions: m.impressions, saved: m.saved, shares: m.shares,
            unavailable_metrics: m.unavailable_metrics,
            synced_at: new Date().toISOString()
          };
        }));
        allPostData.push(...batchResults);
      }

      await supabase.from('instagram_posts').upsert(allPostData, { onConflict: 'instagram_post_id' });
    }
  }

  return { success: true };
}

// --- Cron Handler ---
Deno.serve(createInstagramSyncCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Passo de manutenção (backfill mensal durável + fechamento mensal),
    // ANTES do batch de sync e em try/catch próprio: seletor e orçamento
    // independentes de auto_sync_enabled/feature_auto_sync_cron, então uma
    // falha aqui nunca deve impedir o sync batch de rodar. Ver backfill.ts.
    try {
      const { backfilled, monthsClosed } = await runMaintenanceStep(
        supabase, fetch, decryptToken,
        { batchLimit: BACKFILL_BATCH_LIMIT, nowSec: Math.floor(Date.now() / 1000) },
      );
      console.log(`[IG-SYNC-CRON] Maintenance step: backfilled=${backfilled} monthsClosed=${monthsClosed}`);
    } catch (e) {
      console.error("[IG-SYNC-CRON] Maintenance step failed (non-fatal, sync batch proceeds):", e);
    }

    try {

    // Page through candidates, least-recently-attempted first, until the batch
    // is full.
    //
    // Two distinct starvation modes are being defended against here, and they
    // need different mechanisms.
    //
    // 1. Ineligible accounts (no feature_auto_sync_cron, or internal) cluster at
    //    the head of the ordering rather than spreading through it, because they
    //    are never attempted at all. A single fixed candidate window would fill
    //    with them and filter down to an empty batch every run. PAGING skips
    //    past them.
    // 2. Eligible accounts that FAIL never reach the success-path write of
    //    last_synced_at, so ordering on that column pins them at the head
    //    forever and they re-consume the batch on every run. Ordering on
    //    last_sync_attempt_at, stamped below for the whole batch before any work
    //    starts, rotates them to the back after each try.
    //
    // See select.ts.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const internalWorkspaces = await fetchInternalWorkspaceIds(supabase);

    const { candidates, allowedWorkspaces: allowed, scanned, pages, cappedByPages } =
      await collectSyncCandidates<any>(
        {
          internalWorkspaces,
          fetchPage: async (from, size) => {
            const { data, error } = await supabase
              .from('instagram_accounts')
              .select('id, instagram_user_id, encrypted_access_token, token_expires_at, follower_count, following_count, media_count, last_synced_at, last_sync_attempt_at, clientes!inner(conta_id)')
              .eq('authorization_status', 'active')
              .eq('auto_sync_enabled', true)
              // Eligibility still keys off the last SUCCESSFUL sync, so the 6h
              // staleness window keeps its meaning. Only the ORDER changes.
              .or(`last_synced_at.is.null,last_synced_at.lt.${sixHoursAgo}`)
              .order('last_sync_attempt_at', { ascending: true, nullsFirst: true })
              // Tie-break on id: last_sync_attempt_at alone is not unique (NULLs
              // especially), and without a total order .range() can skip or
              // repeat rows across pages.
              .order('id', { ascending: true })
              .range(from, from + size - 1);
            if (error) throw error;
            return data ?? [];
          },
          resolveAllowedWorkspaces: async (wsIds) => {
            const results = await Promise.all(wsIds.map(async (ws) => {
              const { data } = await supabase.rpc("effective_plan_feature",
                { ws_id: ws, feature_key: "feature_auto_sync_cron" });
              return data === true ? ws : null;
            }));
            return results.filter((ws): ws is string => ws !== null);
          },
        },
        {
          pageSize: CANDIDATE_PAGE_SIZE,
          maxPages: MAX_CANDIDATE_PAGES,
          targetEligible: SYNC_BATCH_LIMIT,
        },
      );

    if (cappedByPages) {
      // Scanned the page cap without filling the batch and without running out
      // of candidates. Not fatal, but it means throughput is capped by scanning
      // rather than by SYNC_BATCH_LIMIT, so say so instead of degrading quietly.
      console.warn(
        `[IG-SYNC-CRON] Stopped after ${pages} page(s) / ${scanned} candidate(s) ` +
        `without filling the batch. Raise SYNC_CANDIDATE_PAGES if this persists.`
      );
    }

    if (candidates.length === 0) {
      return new Response("No accounts to sync", { status: 200 });
    }

    const { selected: eligible, deferred, skippedNoFeature, skippedInternal } =
      selectAccountsToSync(candidates, {
        allowedWorkspaces: allowed,
        internalWorkspaces,
        limit: SYNC_BATCH_LIMIT,
      });

    if (!eligible.length) {
      return new Response("No eligible accounts", { status: 200 });
    }

    console.log(
      `[IG-SYNC-CRON] Syncing ${eligible.length} of ${scanned} candidate(s) scanned ` +
      `over ${pages} page(s). Deferred: ${deferred}. Skipped: ${skippedNoFeature} lacking ` +
      `feature_auto_sync_cron, ${skippedInternal} in internal workspaces.`
    );

    // Stamp the attempt for the WHOLE batch before any syncing starts.
    //
    // Before, not after, and in one write rather than per account: an account
    // whose sync kills the invocation (wall clock, OOM) would otherwise never
    // get stamped, stay pinned at the head of the ordering, and take the batch
    // down with it on every subsequent run. Stamping up front means the batch
    // rotates even when the run dies partway.
    //
    // A failure here is logged but not fatal. Syncing a batch whose queue
    // position did not advance is worse than useless only if it repeats, and
    // the next run re-reads the real ordering either way.
    const { error: stampError } = await supabase
      .from('instagram_accounts')
      .update({ last_sync_attempt_at: new Date().toISOString() })
      .in('id', eligible.map((a: any) => a.id));
    if (stampError) {
      console.error(`[IG-SYNC-CRON] Failed to stamp last_sync_attempt_at: ${stampError.message}`);
    }

    let syncedCount = 0;
    let failedCount = 0;
    const errors: Array<{ accountId: string; error: string }> = [];

    const CONCURRENCY = Math.max(1, parseInt(Deno.env.get("SYNC_CONCURRENCY") || "5", 10) || 5);
    await runPool(eligible, CONCURRENCY, async (account) => {
      try {
        const result = await syncAccount(supabase, account);
        if (result.success) {
          console.log(`[IG-SYNC-CRON] Synced account ${account.id}`);
          syncedCount++;
        } else {
          console.error(`[IG-SYNC-CRON] Account ${account.id} failed: ${result.error}`);
          failedCount++;
          errors.push({ accountId: account.id, error: result.error || 'Unknown' });
        }
      } catch (err: any) {
        console.error(`[IG-SYNC-CRON] Account ${account.id} threw:`, err);
        failedCount++;
        errors.push({ accountId: account.id, error: err.message });
      }
    });

      console.log(`[IG-SYNC-CRON] Done. Synced: ${syncedCount}, Failed: ${failedCount}`);

      if (failedCount > 0) {
        await reportCronFailure(supabase, 'instagram-sync-cron', { total: eligible.length, failed: failedCount, errors });
      }

      return new Response(JSON.stringify({
        success: true,
        synced: syncedCount,
        failed: failedCount,
        total: eligible.length,
        deferred,
        skippedNoFeature,
        skippedInternal
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err: any) {
      console.error("[IG-SYNC-CRON] Cron Job Failed", err);
      await reportCronFailure(supabase, 'instagram-sync-cron', { total: 0, failed: 1, errors: [{ error: err.message }], stack: err?.stack });
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
}));
