import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createInstagramSyncCronHandler } from "./handler.ts";
import { notifyCronFailure } from "../_shared/notify.ts";
import { runPool } from "./pool.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();

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

  const [reachRes, viewsRes, engagedRes, websiteClicksRes, igProfileRes, mediaRes] = await Promise.all([
    fetch(`https://graph.instagram.com/me/insights?metric=reach&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
    fetch(`https://graph.instagram.com/me/insights?metric=views&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
    fetch(`https://graph.instagram.com/me/insights?metric=accounts_engaged&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
    fetch(`https://graph.instagram.com/me/insights?metric=website_clicks&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
    fetch(`https://graph.instagram.com/me?fields=followers_count,follows_count,media_count,profile_picture_url&access_token=${accessToken}`),
    fetch(`https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count&limit=50&access_token=${accessToken}`)
  ]);

  const [reachData, viewsData, engagedData, websiteClicksData, igProfile, mediaData] = await Promise.all([
    reachRes.json(), viewsRes.json(), engagedRes.json(), websiteClicksRes.json(), igProfileRes.json(), mediaRes.json()
  ]);

  // Check for expired token — mark in DB so UI shows correct status
  if (reachData.error?.code === 190) {
    await supabase.from('instagram_accounts').update({ authorization_status: 'expired' }).eq('id', account.id);
    return { success: false, error: 'TOKEN_EXPIRED' };
  }

  // Parse insights
  let totalReach = 0, totalImpressions = 0, totalViews = 0, totalWebsiteClicks = 0;
  if (reachData.data) {
    for (const insight of reachData.data) {
      if (insight.name === 'reach') totalReach = insight.total_value?.value || 0;
    }
  }
  if (viewsData.data) {
    for (const insight of viewsData.data) {
      if (insight.name === 'views') totalImpressions = insight.total_value?.value || 0;
    }
  }
  if (engagedData.data) {
    for (const insight of engagedData.data) {
      if (insight.name === 'accounts_engaged') totalViews = insight.total_value?.value || 0;
    }
  }
  if (websiteClicksData.data) {
    for (const insight of websiteClicksData.data) {
      if (insight.name === 'website_clicks') totalWebsiteClicks = insight.total_value?.value || 0;
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
      impressions_28d: totalImpressions,
      profile_views_28d: totalViews,
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
  ]);

  // Fetch and upsert posts with insights (batched at 10)
  if (mediaData.data && mediaData.data.length > 0) {
    const allPostData: any[] = [];
    const BATCH_SIZE = 10;
    for (let i = 0; i < mediaData.data.length; i += BATCH_SIZE) {
      const batch = mediaData.data.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(async (post: any) => {
        let reach = 0, impressions = 0, saved = 0, shares = 0;
        try {
          let metrics = 'reach,views,saved';
          if (post.media_type === 'VIDEO') metrics += ',shares';
          const postInsightsRes = await fetch(`https://graph.instagram.com/${post.id}/insights?metric=${metrics}&access_token=${accessToken}`);
          const postInsightsData = await postInsightsRes.json();
          if (postInsightsData.data) {
            for (const insight of postInsightsData.data) {
              if (insight.name === 'reach') reach = insight.values[0].value;
              if (insight.name === 'views') impressions = insight.values[0].value;
              if (insight.name === 'saved') saved = insight.values[0].value;
              if (insight.name === 'shares') shares = insight.values[0].value;
            }
          }
        } catch (_) { /* ignore per-post insight errors */ }

        // Get thumbnail: VIDEO has thumbnail_url, IMAGE has media_url, CAROUSEL needs first child
        let thumbUrl = post.thumbnail_url || post.media_url || null;
        if (!thumbUrl && post.media_type === 'CAROUSEL_ALBUM') {
          try {
            const childRes = await fetch(`https://graph.instagram.com/${post.id}/children?fields=media_url,media_type&limit=1&access_token=${accessToken}`);
            const childData = await childRes.json();
            if (childData.data?.[0]?.media_url) thumbUrl = childData.data[0].media_url;
          } catch (_) { /* ignore */ }
        }

        return {
          instagram_account_id: account.id,
          instagram_post_id: post.id,
          caption: post.caption || '',
          media_type: post.media_type,
          thumbnail_url: thumbUrl,
          permalink: post.permalink,
          posted_at: post.timestamp,
          likes: post.like_count || 0,
          comments: post.comments_count || 0,
          reach, impressions, saved, shares,
          synced_at: new Date().toISOString()
        };
      }));
      allPostData.push(...batchResults);
    }
    // Single bulk upsert
    await supabase.from('instagram_posts').upsert(allPostData, { onConflict: 'instagram_post_id' });
  }

  return { success: true };
}

// --- Cron Handler ---
Deno.serve(createInstagramSyncCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch all accounts with auto-sync enabled and active status
    // (proactive refresh inside syncAccount handles near-expiry tokens)
    const { data: accounts, error } = await supabase
      .from('instagram_accounts')
      .select('id, instagram_user_id, encrypted_access_token, token_expires_at, follower_count, following_count, media_count')
      .eq('authorization_status', 'active')
      .eq('auto_sync_enabled', true);

    if (error) throw error;
    if (!accounts || accounts.length === 0) {
      return new Response("No accounts to sync", { status: 200 });
    }

    console.log(`[IG-SYNC-CRON] Starting sync for ${accounts.length} account(s)`);

    let syncedCount = 0;
    let failedCount = 0;
    const errors: Array<{ accountId: string; error: string }> = [];

    const CONCURRENCY = Math.max(1, parseInt(Deno.env.get("SYNC_CONCURRENCY") || "5", 10) || 5);
    await runPool(accounts, CONCURRENCY, async (account) => {
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
        await notifyCronFailure('instagram-sync-cron', { total: accounts.length, failed: failedCount, errors });
      }

      return new Response(JSON.stringify({
        success: true,
        synced: syncedCount,
        failed: failedCount,
        total: accounts.length,
        errors
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err: any) {
      console.error("[IG-SYNC-CRON] Cron Job Failed", err);
      await notifyCronFailure('instagram-sync-cron', { total: 0, failed: 1, errors: [{ error: err.message }] });
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
}));
