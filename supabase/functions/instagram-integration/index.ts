import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { insertAuditLog } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID")!;
const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;
const META_REDIRECT_URI = Deno.env.get("META_REDIRECT_URI");
const OAUTH_REDIRECT_BASE = Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:3000";
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();

// --- Token Encryption Utility ---
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
  // Try HKDF-derived key first (new scheme)
  try {
    const key = await getEncryptionKey('instagram-access-token', ['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    // Fall back to legacy padEnd key (old scheme — tokens not yet re-encrypted)
    const legacyKey = await getLegacyKey(['decrypt']);
    const decryptedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, legacyKey, data);
    return new TextDecoder().decode(decryptedBuf);
  }
}

// --- Signed OAuth State ---
async function getHmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(TOKEN_ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromUrlSafeBase64(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return pad ? padded + '='.repeat(4 - pad) : padded;
}

async function createSignedState(clientId: string): Promise<string> {
  const payload = JSON.stringify({ clientId, nonce: crypto.randomUUID(), iat: Date.now() });
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const payloadB64 = toUrlSafeBase64(btoa(payload));
  const sigB64 = toUrlSafeBase64(btoa(String.fromCharCode(...new Uint8Array(sigBuf))));
  return payloadB64 + '.' + sigB64;
}

async function verifySignedState(state: string): Promise<{ clientId: string }> {
  const s = decodeURIComponent(state);
  const dotIdx = s.indexOf('.');
  if (dotIdx === -1) throw new Error('Invalid state format');
  const payloadB64 = s.slice(0, dotIdx);
  const sigB64 = s.slice(dotIdx + 1);
  const payload = atob(fromUrlSafeBase64(payloadB64));
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const sigBytes = Uint8Array.from(atob(fromUrlSafeBase64(sigB64)), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
  if (!valid) throw new Error('State signature invalid');
  const parsed = JSON.parse(payload);
  if (Date.now() - parsed.iat > 10 * 60 * 1000) throw new Error('State expired');
  return { clientId: parsed.clientId };
}

// --- Workspace Ownership Verification ---
async function verifyClientOwnership(
  svc: ReturnType<typeof createClient>,
  clientId: string,
  contaId: string
): Promise<boolean> {
  const { data: client } = await svc
    .from('clientes')
    .select('conta_id')
    .eq('id', parseInt(clientId, 10))
    .single();
  return client?.conta_id === contaId;
}

// --- Main Handler ---
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace('/instagram-integration', '').replace(/\/$/, '');
  // Use META_REDIRECT_URI (registered in Meta Developer Console) as canonical redirect_uri.
  // Fall back to deriving from req.url if the env var isn't set.
  const origin = url.origin.replace(/^http:\/\//, 'https://');
  const functionBaseUrl = META_REDIRECT_URI || `${origin}/functions/v1/instagram-integration`;

  // Setup Supabase Client
  const authHeader = req.headers.get('Authorization');
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader || '' } },
  });

  const corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ---- VERIFY AUTHENTICATION ----
    // We only enforce auth for the endpoints that modify internal data (which is everything except callback)
    let user;
    if (path !== '/callback' && !(path === '' && url.searchParams.has('code'))) {
       const token = authHeader?.replace(/^Bearer\s+/i, '');

       if (!token || token === 'undefined' || token === 'null') {
           throw new Error("Unauthorized: No valid token provided in Authorization header");
       }

       const userRes = await supabaseClient.auth.getUser();
       user = userRes.data?.user;

       if (userRes.error || !user) {
           throw new Error("Unauthorized: Token verification failed");
       }
    }

    // 1. GET /auth/:clientId
    if (req.method === 'GET' && path.startsWith('/auth/')) {
        const clientId = path.split('/')[2];
        if (!clientId || !/^\d+$/.test(clientId)) throw new Error("Client ID required");

        // Verify caller's workspace owns this client
        const authServiceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: authCallerProfile } = await authServiceClient.from('profiles').select('conta_id').eq('id', user!.id).single();
        if (!authCallerProfile?.conta_id || !await verifyClientOwnership(authServiceClient, clientId, authCallerProfile.conta_id)) {
            return new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 });
        }

        // Pass clientId in signed state (HMAC-SHA256)
        const state = await createSignedState(clientId);
        
        const oauthUrl = `https://www.instagram.com/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(functionBaseUrl)}&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish&state=${state}`;

        return new Response(JSON.stringify({ url: oauthUrl }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
    }

    // 2. GET /callback (also handle callback at root when META_REDIRECT_URI doesn't include /callback)
    if (req.method === 'GET' && (path === '/callback' || (path === '' && url.searchParams.has('code')))) {
        const code = url.searchParams.get('code')?.replace(/#_$/, '');
        const state = url.searchParams.get('state');

        if (!code) throw new Error("Missing auth code");

        const { clientId } = await verifySignedState(state || '');
        if (!clientId || !/^\d+$/.test(String(clientId))) throw new Error("Invalid client ID in state parameter");

        // Exchange code for short-lived token (Instagram Business Login)
        const exchangeRes = await fetch('https://api.instagram.com/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: META_APP_ID,
                client_secret: META_APP_SECRET,
                grant_type: 'authorization_code',
                redirect_uri: functionBaseUrl,
                code: code
            })
        });
        const slTokenData = await exchangeRes.json();
        if (!exchangeRes.ok) {
            console.error('[IG-CALLBACK] Token exchange failed:', exchangeRes.status, 'redirect_uri:', functionBaseUrl);
            console.error('[IG-CALLBACK] Instagram response:', JSON.stringify(slTokenData));
        }

        // Handle both error formats: {error: "string"} and {error: {message: "...", type: "...", code: N}}
        if (slTokenData.error || slTokenData.error_type) {
            const errMsg = slTokenData.error_message
                || (typeof slTokenData.error === 'object' ? (slTokenData.error.message || JSON.stringify(slTokenData.error)) : null)
                || slTokenData.error_description
                || slTokenData.error
                || 'Unknown OAuth error';
            console.error('[IG-CALLBACK] Token exchange error:', errMsg);
            throw new Error(errMsg);
        }

        const shortLivedToken = slTokenData.access_token;
        if (!shortLivedToken) {
            throw new Error('Instagram did not return an access token');
        }

        // Fetch the real user ID via /me to avoid JSON number precision loss
        // (Instagram user IDs exceed Number.MAX_SAFE_INTEGER)
        const meRes = await fetch(`https://graph.instagram.com/me?fields=id&access_token=${shortLivedToken}`);
        const meData = await meRes.json();
        if (meData.error || !meData.id) {
            throw new Error(`Failed to fetch Instagram user ID: ${meData.error?.message ?? 'no id returned'}`);
        }
        const igBusinessId = String(meData.id);
        console.error('[IG-CALLBACK] Token exchange OK. user_id (from /me):', igBusinessId, 'token_type:', slTokenData.token_type, 'permissions:', JSON.stringify(slTokenData.permissions));

        // Exchange short-lived token for long-lived token (retry on transient 500s)
        let longLivedToken = shortLivedToken;
        let expiresInSeconds = 3600;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
            const llRes = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${META_APP_SECRET}&access_token=${shortLivedToken}`);
            const llData = await llRes.json();
            if (llData.access_token) {
                longLivedToken = llData.access_token;
                expiresInSeconds = llData.expires_in || (60 * 60 * 24 * 60);
                break;
            }
            console.error(`[IG-CALLBACK] LL token attempt ${attempt + 1} failed:`, llRes.status, JSON.stringify(llData));
            if (!llData.error?.is_transient) break;
        }
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

        const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        const profileFields = 'username,profile_picture_url,followers_count,follows_count,media_count';
        const profileRes = await fetch(`https://graph.instagram.com/me?fields=${profileFields}&access_token=${longLivedToken}`);
        const igProfile = await profileRes.json();
        if (igProfile.error) {
            console.error('[IG-CALLBACK] Profile fetch failed:', profileRes.status, JSON.stringify(igProfile));
            throw new Error('Profile fetch failed');
        }

        // Encrypt Long Lived Token
        const encryptedToken = await encryptToken(longLivedToken);

        // Fetch 28-day account insights
        let reach_28d = 0, impressions_28d = 0, profile_views_28d = 0, website_clicks_28d = 0;
        try {
            const nowTimestamp = Math.floor(Date.now() / 1000);
            const sinceDate = nowTimestamp - (28 * 24 * 60 * 60);
            // Fetch reach, views, accounts_engaged and website_clicks via total_value
            const [reachRes, viewsRes, profileTapsRes, websiteClicksRes] = await Promise.all([
                fetch(`https://graph.instagram.com/me/insights?metric=reach&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${longLivedToken}`),
                fetch(`https://graph.instagram.com/me/insights?metric=views&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${longLivedToken}`),
                fetch(`https://graph.instagram.com/me/insights?metric=accounts_engaged&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${longLivedToken}`),
                fetch(`https://graph.instagram.com/me/insights?metric=website_clicks&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${longLivedToken}`)
            ]);
            const [reachData, viewsData, profileTapsData, websiteClicksData] = await Promise.all([reachRes.json(), viewsRes.json(), profileTapsRes.json(), websiteClicksRes.json()]);
            if (reachData.data) {
                for (const insight of reachData.data) {
                    if (insight.name === 'reach') reach_28d = insight.total_value?.value || 0;
                }
            }
            if (viewsData.data) {
                for (const insight of viewsData.data) {
                    if (insight.name === 'views') impressions_28d = insight.total_value?.value || 0;
                }
            }
            if (profileTapsData.data) {
                for (const insight of profileTapsData.data) {
                    if (insight.name === 'accounts_engaged') profile_views_28d = insight.total_value?.value || 0;
                }
            }
            if (websiteClicksData.data) {
                for (const insight of websiteClicksData.data) {
                    if (insight.name === 'website_clicks') website_clicks_28d = insight.total_value?.value || 0;
                }
            }
        } catch { /* insights are best-effort */ }

        // Upsert into DB (with insights + last_synced_at)
        const { data: upsertedAccount, error: dbError } = await serviceClient
            .from('instagram_accounts')
            .upsert({
                client_id: clientId,
                instagram_user_id: igBusinessId,
                username: igProfile.username || '',
                profile_picture_url: igProfile.profile_picture_url || '',
                follower_count: igProfile.followers_count,
                following_count: igProfile.follows_count,
                media_count: igProfile.media_count,
                encrypted_access_token: encryptedToken,
                token_expires_at: expiresAt,
                reach_28d,
                impressions_28d,
                profile_views_28d,
                website_clicks_28d,
                last_synced_at: new Date().toISOString(),
                authorization_status: 'active',
                permissions: Array.isArray(slTokenData.permissions) ? slTokenData.permissions : [],
            }, { onConflict: 'client_id' })
            .select('id')
            .single();

        if (dbError) throw new Error(dbError.message);

        await insertAuditLog(serviceClient, {
          action: 'instagram-link',
          resource_type: 'instagram_account',
          resource_id: String(clientId),
          metadata: { ig_username: igProfile.username || '', ig_business_id: igBusinessId },
        });

        // Save follower history snapshot + fetch posts
        try {
            const accountId = upsertedAccount!.id;
            const today = new Date().toISOString().split('T')[0];

            // Only upsert if no manual entry exists for this date
            const { data: existingEntry } = await serviceClient
                .from('instagram_follower_history')
                .select('source')
                .eq('instagram_account_id', accountId)
                .eq('date', today)
                .maybeSingle();

            if (!existingEntry || existingEntry.source !== 'manual') {
                await serviceClient.from('instagram_follower_history').upsert({
                    instagram_account_id: accountId,
                    date: today,
                    follower_count: igProfile.followers_count || 0,
                    source: 'api',
                }, { onConflict: 'instagram_account_id,date' });
            }

            // Fetch posts
            const mediaRes = await fetch(`https://graph.instagram.com/me/media?fields=id,caption,media_type,permalink,timestamp,comments_count,like_count&limit=50&access_token=${longLivedToken}`);
            const mediaData = await mediaRes.json();

            if (mediaData.data) {
                let savedCount = 0;
                for (const post of mediaData.data) {
                    let reach = 0, impressions = 0, saved = 0, shares = 0;
                    try {
                        let metrics = 'reach,views,saved';
                        if (post.media_type === 'VIDEO') metrics += ',shares';
                        const postInsightsRes = await fetch(`https://graph.instagram.com/${post.id}/insights?metric=${metrics}&access_token=${longLivedToken}`);
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

                    const { error: postErr } = await serviceClient.from('instagram_posts').upsert({
                        instagram_account_id: accountId,
                        instagram_post_id: post.id,
                        caption: post.caption || '',
                        media_type: post.media_type,
                        permalink: post.permalink,
                        posted_at: post.timestamp,
                        likes: post.like_count || 0,
                        comments: post.comments_count || 0,
                        reach, impressions, saved, shares,
                        synced_at: new Date().toISOString()
                    }, { onConflict: 'instagram_post_id' });
                    if (!postErr) savedCount++;
                }
            }
        } catch { /* posts/history fetch is best-effort */ }

        return Response.redirect(`${OAUTH_REDIRECT_BASE}/clientes/${clientId}`, 302);
    }

    // 3. POST /sync/:clientId
    if (req.method === 'POST' && path.startsWith('/sync/')) {
        const clientId = path.split('/')[2];
        if (!clientId || !/^\d+$/.test(clientId)) {
            return new Response(JSON.stringify({ error: true, message: 'Invalid client ID' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
        }
        const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        // Verify caller's workspace owns this client
        const { data: callerProfile } = await serviceClient.from('profiles').select('conta_id').eq('id', user!.id).single();
        if (!callerProfile?.conta_id || !await verifyClientOwnership(serviceClient, clientId, callerProfile.conta_id)) {
            return new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 });
        }

        const { data: accounts, error: accountError } = await serviceClient
            .from('instagram_accounts')
            .select('*')
            .eq('client_id', clientId);
        
        if (accountError || !accounts || accounts.length === 0) throw new Error("Account not found");
        const account = accounts[0];

        // Decrypt Token
        const accessToken = await decryptToken(account.encrypted_access_token);

        try {
            // 3.1 Fetch Account Insights (28 day window) — all calls in parallel
            const nowTimestamp = Math.floor(Date.now() / 1000);
            const sinceDate = nowTimestamp - (28 * 24 * 60 * 60);
            const [reachRes, viewsRes, profileTapsRes, websiteClicksRes, igProfileRes, mediaRes] = await Promise.all([
                fetch(`https://graph.instagram.com/me/insights?metric=reach&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/me/insights?metric=views&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/me/insights?metric=accounts_engaged&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/me/insights?metric=website_clicks&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/me?fields=followers_count,follows_count,media_count,profile_picture_url&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count&limit=50&access_token=${accessToken}`)
            ]);

            const [reachData, viewsData, profileTapsData, websiteClicksData, igProfile, mediaData] = await Promise.all([
                reachRes.json(), viewsRes.json(), profileTapsRes.json(), websiteClicksRes.json(), igProfileRes.json(), mediaRes.json()
            ]);

            // Check if token expired
            if (reachData.error?.code === 190) {
               return new Response(JSON.stringify({ error: true, code: "TOKEN_EXPIRED", message: "Instagram token expired" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 });
            }

            let totalReach = 0; let totalImpressions = 0; let totalViews = 0; let totalWebsiteClicks = 0;
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
            if (profileTapsData.data) {
                for (const insight of profileTapsData.data) {
                    if (insight.name === 'accounts_engaged') totalViews = insight.total_value?.value || 0;
                }
            }
            if (websiteClicksData.data) {
                for (const insight of websiteClicksData.data) {
                    if (insight.name === 'website_clicks') totalWebsiteClicks = insight.total_value?.value || 0;
                }
            }
            if (websiteClicksData.error) {
                console.error('[IG-SYNC] website_clicks error:', JSON.stringify(websiteClicksData));
            }
            console.error('[IG-SYNC] Insights results — reach:', totalReach, 'views:', totalImpressions, 'engaged:', totalViews, 'link_taps:', totalWebsiteClicks);

            // Cache profile picture in Supabase Storage to avoid CDN hotlink issues
            let storedAvatarUrl: string | undefined;
            if (igProfile.profile_picture_url) {
                try {
                    const imgRes = await fetch(igProfile.profile_picture_url);
                    if (imgRes.ok) {
                        const imgBytes = await imgRes.arrayBuffer();
                        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                        const storagePath = `instagram/${account.id}.jpg`;
                        const BUCKET = 'avatars';
                        let { error: uploadError } = await serviceClient.storage
                            .from(BUCKET).upload(storagePath, imgBytes, { contentType, upsert: true });
                        if (uploadError?.message?.includes('Bucket not found')) {
                            await serviceClient.storage.createBucket(BUCKET, { public: true });
                            ({ error: uploadError } = await serviceClient.storage
                                .from(BUCKET).upload(storagePath, imgBytes, { contentType, upsert: true }));
                        }
                        if (!uploadError) {
                            const { data: pub } = serviceClient.storage.from(BUCKET).getPublicUrl(storagePath);
                            storedAvatarUrl = pub.publicUrl;
                        }
                    }
                } catch { /* avatar cache is non-fatal */ }
            }

            const today = new Date().toISOString().split('T')[0];

            // Check if manual follower entry exists for today before syncing
            const { data: existingSyncEntry } = await serviceClient
                .from('instagram_follower_history')
                .select('source')
                .eq('instagram_account_id', account.id)
                .eq('date', today)
                .maybeSingle();

            const shouldUpsertHistory = !existingSyncEntry || existingSyncEntry.source !== 'manual';

            // Update account stats and follower history in parallel
            await Promise.all([
                serviceClient.from('instagram_accounts').update({
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
                    serviceClient.from('instagram_follower_history').upsert({
                        instagram_account_id: account.id,
                        date: today,
                        follower_count: igProfile.followers_count || account.follower_count,
                        source: 'api',
                    }, { onConflict: 'instagram_account_id,date' })
                ] : []),
            ]);

            // 3.2 Fetch Post Insights — batched parallel (10 at a time)
            if (mediaData.data) {
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
                // Single bulk upsert instead of 50 individual ones
                await serviceClient.from('instagram_posts').upsert(allPostData, { onConflict: 'instagram_post_id' });
            }
            
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            
        } catch (error: any) {
            if (error.code === 'TOKEN_EXPIRED') throw error;
            throw new Error('Sync Failed');
        }
    }

     // 4. DELETE /disconnect/:clientId
    if ((req.method === 'POST' || req.method === 'DELETE') && path.startsWith('/disconnect/')) {
         const clientId = path.split('/')[2];
         if (!clientId || !/^\d+$/.test(clientId)) {
             return new Response(JSON.stringify({ error: true, message: 'Invalid client ID' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
         }
         const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

         // Verify caller's workspace owns this client
         const { data: callerProfile } = await serviceClient.from('profiles').select('conta_id').eq('id', user!.id).single();
         if (!callerProfile?.conta_id || !await verifyClientOwnership(serviceClient, clientId, callerProfile.conta_id)) {
             return new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 });
         }

         const { data: account } = await serviceClient.from('instagram_accounts').select('id').eq('client_id', clientId).single();
         if (account) {
           await serviceClient.from('instagram_posts').delete().eq('instagram_account_id', account.id);
           await serviceClient.from('instagram_accounts').update({
             encrypted_access_token: null,
             token_expires_at: null,
             authorization_status: 'disconnected',
             last_synced_at: null,
           }).eq('id', account.id);
         }
         return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    // 5. GET /summary/:clientId
    if (req.method === 'GET' && path.startsWith('/summary/')) {
         const clientId = path.split('/')[2];
         if (!clientId || !/^\d+$/.test(clientId)) {
             return new Response(JSON.stringify({ error: true, message: 'Invalid client ID' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
         }
         const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

         // Verify caller's workspace owns this client
         const { data: callerProfile } = await serviceClient.from('profiles').select('conta_id').eq('id', user!.id).single();
         if (!callerProfile?.conta_id || !await verifyClientOwnership(serviceClient, clientId, callerProfile.conta_id)) {
             return new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 });
         }

         const { data, error } = await serviceClient.from('instagram_accounts').select('*').eq('client_id', clientId).single();
         if (error) return new Response(JSON.stringify({ exists: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

         // Fetch recent 30 day history
         const { data: history } = await serviceClient.from('instagram_follower_history').select('*').eq('instagram_account_id', data.id).order('date', { ascending: true }).limit(30);

         return new Response(JSON.stringify({ account: data, history: history || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 6. GET /posts/:clientId
    if (req.method === 'GET' && path.startsWith('/posts/')) {
         const clientId = path.split('/')[2];
         if (!clientId || !/^\d+$/.test(clientId)) {
             return new Response(JSON.stringify({ error: true, message: 'Invalid client ID' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
         }
         const pageStr = url.searchParams.get('page') || '1';
         const page = Math.max(1, parseInt(pageStr) || 1);
         const limit = 10;
         const offset = (page - 1) * limit;

         const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

         // Verify caller's workspace owns this client
         const { data: callerProfile } = await serviceClient.from('profiles').select('conta_id').eq('id', user!.id).single();
         if (!callerProfile?.conta_id || !await verifyClientOwnership(serviceClient, clientId, callerProfile.conta_id)) {
             return new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 });
         }

         const { data: account } = await serviceClient.from('instagram_accounts').select('id').eq('client_id', clientId).single();
         
         if (!account) return new Response(JSON.stringify({ error: true, message: "Not found" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 });

         const { data, error, count } = await serviceClient
            .from('instagram_posts')
            .select('*', { count: 'exact' })
            .eq('instagram_account_id', account.id)
            .order('posted_at', { ascending: false })
            .range(offset, offset + limit - 1);

         if (error) throw error;
         return new Response(JSON.stringify({ posts: data, total: count }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    return new Response(JSON.stringify({ error: true, message: `Not Found - method: ${req.method}, path: "${path}"` }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[instagram-integration] error:', err?.message ?? 'unknown');

    // If this was a callback (browser redirect), send user back to client page instead of showing JSON
    const isCallback = path === '/callback' || (path === '' && url.searchParams.has('code'));
    if (isCallback) {
      const stateParam = url.searchParams.get('state');
      let redirectClientId: string | undefined;
      try { redirectClientId = (await verifySignedState(stateParam || '')).clientId; } catch { /* ignore */ }
      const target = redirectClientId
        ? `${OAUTH_REDIRECT_BASE}/clientes/${redirectClientId}?ig_error=1`
        : `${OAUTH_REDIRECT_BASE}?ig_error=1`;
      return Response.redirect(target, 302);
    }

    const isAuthError = err.message && err.message.includes("Unauthorized");
    const isTokenExpired = err.message && err.message.includes("expired");
    const statusCode = (isAuthError || isTokenExpired) ? 401 : 400;

    return new Response(JSON.stringify({
      error: true,
      message: isTokenExpired ? "Token expirado" : isAuthError ? "Não autorizado" : "Erro interno",
      code: isTokenExpired ? "TOKEN_EXPIRED" : undefined
    }), {
        status: statusCode,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
