import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID")!;
const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;
const META_REDIRECT_URI = Deno.env.get("META_REDIRECT_URI")!;
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

// --- Main Handler ---
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace('/instagram-integration', '').replace(/\/$/, '');
  // Derive the function's own base URL to use as redirect_uri (avoids META_REDIRECT_URI mismatch)
  // Force HTTPS: edge functions run behind a reverse proxy that terminates SSL,
  // so url.origin reports http:// but the public URL is always https://
  const origin = url.origin.replace(/^http:\/\//, 'https://');
  const functionBaseUrl = `${origin}/functions/v1/instagram-integration`;

  // Setup Supabase Client
  const authHeader = req.headers.get('Authorization');
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader || '' } },
  });

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };

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
        if (!clientId) throw new Error("Client ID required");

        // Pass clientId in state
        const state = btoa(JSON.stringify({ clientId }));
        
        const oauthUrl = `https://www.instagram.com/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(functionBaseUrl)}&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights&state=${state}`;

        return new Response(JSON.stringify({ url: oauthUrl }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
    }

    // 2. GET /callback (also handle callback at root when META_REDIRECT_URI doesn't include /callback)
    if (req.method === 'GET' && (path === '/callback' || (path === '' && url.searchParams.has('code')))) {
        const code = url.searchParams.get('code')?.replace(/#_$/, '');
        const state = url.searchParams.get('state');

        if (!code) throw new Error("Missing auth code");

        const decodedState = JSON.parse(atob(state || ''));
        const clientId = decodedState.clientId;
        if (!clientId || !/^\d+$/.test(String(clientId))) throw new Error("Invalid client ID in state parameter");

        // Exchange code for short-lived token (Instagram Business Login)
        console.log('[IG-CALLBACK] Exchanging code for short-lived token...');
        console.log('[IG-CALLBACK] redirect_uri used:', functionBaseUrl);
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
        console.log('[IG-CALLBACK] Short-lived token response status:', exchangeRes.status);
        console.log('[IG-CALLBACK] Short-lived token response keys:', Object.keys(slTokenData));
        console.log('[IG-CALLBACK] Permissions granted:', JSON.stringify(slTokenData.permissions));

        // Handle both error formats: {error: "string"} and {error: {message: "...", type: "...", code: N}}
        if (slTokenData.error || slTokenData.error_type) {
            const errMsg = slTokenData.error_message
                || (typeof slTokenData.error === 'object' ? (slTokenData.error.message || JSON.stringify(slTokenData.error)) : null)
                || slTokenData.error_description
                || slTokenData.error
                || 'Unknown OAuth error';
            console.error('[IG-CALLBACK] Short-lived token error:', errMsg);
            throw new Error(errMsg);
        }

        const shortLivedToken = slTokenData.access_token;
        const igBusinessId = String(slTokenData.user_id); // Instagram Business account ID returned directly

        if (!shortLivedToken) {
            console.error('[IG-CALLBACK] No access_token in response:', JSON.stringify(slTokenData));
            throw new Error('Instagram did not return an access token');
        }
        console.log('[IG-CALLBACK] Got short-lived token, user_id:', igBusinessId);

        // Exchange for long-lived token — try multiple approaches
        let llTokenData: any = null;
        const llParams = `grant_type=ig_exchange_token&client_secret=${META_APP_SECRET}&access_token=${shortLivedToken}`;
        
        // Attempt 1: POST to graph.instagram.com/access_token
        try {
            console.log('[IG-CALLBACK] LL Attempt 1: POST graph.instagram.com/access_token');
            const res1 = await fetch('https://graph.instagram.com/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'ig_exchange_token',
                    client_secret: META_APP_SECRET,
                    access_token: shortLivedToken
                })
            });
            const data1 = await res1.json();
            console.log('[IG-CALLBACK] Attempt 1 status:', res1.status, 'keys:', Object.keys(data1));
            if (data1.access_token) { llTokenData = data1; console.log('[IG-CALLBACK] Attempt 1 SUCCESS'); }
            else console.log('[IG-CALLBACK] Attempt 1 failed:', JSON.stringify(data1));
        } catch (e: any) { console.log('[IG-CALLBACK] Attempt 1 exception:', e.message); }

        // Attempt 2: GET to graph.instagram.com/access_token (no version)
        if (!llTokenData) {
            try {
                console.log('[IG-CALLBACK] LL Attempt 2: GET graph.instagram.com/access_token');
                const res2 = await fetch(`https://graph.instagram.com/access_token?${llParams}`);
                const data2 = await res2.json();
                console.log('[IG-CALLBACK] Attempt 2 status:', res2.status, 'keys:', Object.keys(data2));
                if (data2.access_token) { llTokenData = data2; console.log('[IG-CALLBACK] Attempt 2 SUCCESS'); }
                else console.log('[IG-CALLBACK] Attempt 2 failed:', JSON.stringify(data2));
            } catch (e: any) { console.log('[IG-CALLBACK] Attempt 2 exception:', e.message); }
        }

        // Attempt 3: GET to graph.facebook.com/v21.0/oauth/access_token (Facebook Graph endpoint)
        if (!llTokenData) {
            try {
                console.log('[IG-CALLBACK] LL Attempt 3: GET graph.facebook.com/v21.0/oauth/access_token');
                const fbParams = `grant_type=ig_exchange_token&client_secret=${META_APP_SECRET}&access_token=${shortLivedToken}`;
                const res3 = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${fbParams}`);
                const data3 = await res3.json();
                console.log('[IG-CALLBACK] Attempt 3 status:', res3.status, 'keys:', Object.keys(data3));
                if (data3.access_token) { llTokenData = data3; console.log('[IG-CALLBACK] Attempt 3 SUCCESS'); }
                else console.log('[IG-CALLBACK] Attempt 3 failed:', JSON.stringify(data3));
            } catch (e: any) { console.log('[IG-CALLBACK] Attempt 3 exception:', e.message); }
        }

        // Attempt 4: GET to graph.instagram.com/v22.0/access_token
        if (!llTokenData) {
            try {
                console.log('[IG-CALLBACK] LL Attempt 4: GET graph.instagram.com/v22.0/access_token');
                const res4 = await fetch(`https://graph.instagram.com/v22.0/access_token?${llParams}`);
                const data4 = await res4.json();
                console.log('[IG-CALLBACK] Attempt 4 status:', res4.status, 'keys:', Object.keys(data4));
                if (data4.access_token) { llTokenData = data4; console.log('[IG-CALLBACK] Attempt 4 SUCCESS'); }
                else console.log('[IG-CALLBACK] Attempt 4 failed:', JSON.stringify(data4));
            } catch (e: any) { console.log('[IG-CALLBACK] Attempt 4 exception:', e.message); }
        }

        // If all attempts failed, use the short-lived token directly (it may already be long-lived for new API)
        if (!llTokenData) {
            console.log('[IG-CALLBACK] All long-lived token attempts failed. Using short-lived token directly.');
            llTokenData = { access_token: shortLivedToken, expires_in: 3600 };
        }


        const longLivedToken = llTokenData.access_token;
        const expiresInSeconds = llTokenData.expires_in || (60 * 60 * 24 * 60);
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

        const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        // Get basic profile data — try /{user_id} first (for non-test/Advanced Access),
        // then fall back to /me (for test accounts)
        const profileFields = 'username,profile_picture_url,followers_count,follows_count,media_count';
        let igProfile: any = null;

        // Attempt 1: /{user_id} (required for non-test IGAA tokens with Advanced Access)
        console.log('[IG-CALLBACK] Profile attempt 1: /{user_id}');
        const res1 = await fetch(`https://graph.instagram.com/v21.0/${igBusinessId}?fields=${profileFields}&access_token=${longLivedToken}`);
        const data1 = await res1.json();
        console.log('[IG-CALLBACK] Profile attempt 1 status:', res1.status, 'keys:', Object.keys(data1));
        if (data1.username || data1.id) {
            igProfile = data1;
            console.log('[IG-CALLBACK] Profile attempt 1 SUCCESS');
        } else {
            console.log('[IG-CALLBACK] Profile attempt 1 failed:', JSON.stringify(data1).substring(0, 200));
        }

        // Attempt 2: /me (works for test accounts)
        if (!igProfile) {
            console.log('[IG-CALLBACK] Profile attempt 2: /me');
            const res2 = await fetch(`https://graph.instagram.com/v21.0/me?fields=${profileFields}&access_token=${longLivedToken}`);
            const data2 = await res2.json();
            console.log('[IG-CALLBACK] Profile attempt 2 status:', res2.status, 'keys:', Object.keys(data2));
            if (data2.username || data2.id) {
                igProfile = data2;
                console.log('[IG-CALLBACK] Profile attempt 2 SUCCESS');
            } else {
                console.log('[IG-CALLBACK] Profile attempt 2 failed:', JSON.stringify(data2).substring(0, 200));
            }
        }

        // Attempt 3: /me without version prefix (legacy fallback)
        if (!igProfile) {
            console.log('[IG-CALLBACK] Profile attempt 3: /me (unversioned)');
            const res3 = await fetch(`https://graph.instagram.com/me?fields=${profileFields}&access_token=${longLivedToken}`);
            const data3 = await res3.json();
            console.log('[IG-CALLBACK] Profile attempt 3 status:', res3.status, 'keys:', Object.keys(data3));
            if (data3.username || data3.id) {
                igProfile = data3;
                console.log('[IG-CALLBACK] Profile attempt 3 SUCCESS');
            } else {
                console.log('[IG-CALLBACK] Profile attempt 3 failed:', JSON.stringify(data3).substring(0, 200));
                const errMsg = data3.error?.message || data3.error || 'All profile fetch attempts failed';
                throw new Error(`Profile fetch failed: ${errMsg}`);
            }
        }

        // Encrypt Long Lived Token
        const encryptedToken = await encryptToken(longLivedToken);

        // Fetch 28-day account insights
        let reach_28d = 0, impressions_28d = 0, profile_views_28d = 0, website_clicks_28d = 0;
        try {
            console.log('[IG-CALLBACK] Fetching 28-day insights...');
            const nowTimestamp = Math.floor(Date.now() / 1000);
            const sinceDate = nowTimestamp - (28 * 24 * 60 * 60);
            // Fetch reach, views, accounts_engaged and website_clicks via total_value
            const [reachRes, viewsRes, profileTapsRes, websiteClicksRes] = await Promise.all([
                fetch(`https://graph.instagram.com/v21.0/me/insights?metric=reach&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${longLivedToken}`),
                fetch(`https://graph.instagram.com/v21.0/me/insights?metric=views&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${longLivedToken}`),
                fetch(`https://graph.instagram.com/v21.0/me/insights?metric=accounts_engaged&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${longLivedToken}`),
                fetch(`https://graph.instagram.com/v21.0/me/insights?metric=website_clicks&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${longLivedToken}`)
            ]);
            const [reachData, viewsData, profileTapsData, websiteClicksData] = await Promise.all([reachRes.json(), viewsRes.json(), profileTapsRes.json(), websiteClicksRes.json()]);
            console.log('[IG-CALLBACK] Insights reach FULL:', JSON.stringify(reachData).substring(0, 500));
            console.log('[IG-CALLBACK] Insights views FULL:', JSON.stringify(viewsData).substring(0, 500));
            console.log('[IG-CALLBACK] Insights profile_links_taps FULL:', JSON.stringify(profileTapsData).substring(0, 500));
            console.log('[IG-CALLBACK] Insights website_clicks FULL:', JSON.stringify(websiteClicksData).substring(0, 500));
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
            console.log('[IG-CALLBACK] Insights result: reach=', reach_28d, 'impressions(views)=', impressions_28d, 'accounts_engaged=', profile_views_28d, 'website_clicks=', website_clicks_28d);
        } catch (e: any) { console.log('[IG-CALLBACK] Insights fetch error:', e.message); }

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
                last_synced_at: new Date().toISOString()
            }, { onConflict: 'client_id' })
            .select('id')
            .single();

        if (dbError) throw new Error(dbError.message);
        console.log('[IG-CALLBACK] Account upserted successfully, id:', upsertedAccount?.id);

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
            console.log('[IG-CALLBACK] Follower history saved.');

            // Fetch posts
            console.log('[IG-CALLBACK] Fetching media...');
            const mediaRes = await fetch(`https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,permalink,timestamp,comments_count,like_count&limit=50&access_token=${longLivedToken}`);
            const mediaData = await mediaRes.json();
            console.log('[IG-CALLBACK] Media fetch status:', mediaRes.status, 'posts:', mediaData.data?.length || 0, 'error:', mediaData.error?.message || 'none');

            if (mediaData.data) {
                let savedCount = 0;
                for (const post of mediaData.data) {
                    let reach = 0, impressions = 0, saved = 0, shares = 0;
                    try {
                        let metrics = 'reach,views,saved';
                        if (post.media_type === 'VIDEO') metrics += ',shares';
                        const postInsightsRes = await fetch(`https://graph.instagram.com/v21.0/${post.id}/insights?metric=${metrics}&access_token=${longLivedToken}`);
                        const postInsightsData = await postInsightsRes.json();
                        if (postInsightsData.data) {
                            for (const insight of postInsightsData.data) {
                                if (insight.name === 'reach') reach = insight.values[0].value;
                                if (insight.name === 'views') impressions = insight.values[0].value;
                                if (insight.name === 'saved') saved = insight.values[0].value;
                                if (insight.name === 'shares') shares = insight.values[0].value;
                            }
                        } else if (postInsightsData.error && savedCount === 0) {
                            console.log('[IG-CALLBACK] Post insight error (first):', postInsightsData.error.message);
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
                    if (postErr && savedCount === 0) console.log('[IG-CALLBACK] Post upsert error (first):', postErr.message);
                    else savedCount++;
                }
                console.log('[IG-CALLBACK] Posts saved:', savedCount, '/', mediaData.data.length);
            } else {
                console.log('[IG-CALLBACK] No media data returned');
            }
        } catch (e: any) { console.log('[IG-CALLBACK] Posts/history fetch error:', e.message); }

        return Response.redirect(`${OAUTH_REDIRECT_BASE}/clientes/${clientId}`, 302);
    }

    // 3. POST /sync/:clientId
    if (req.method === 'POST' && path.startsWith('/sync/')) {
        const clientId = path.split('/')[2];
        const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

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
                fetch(`https://graph.instagram.com/v21.0/me/insights?metric=reach&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/v21.0/me/insights?metric=views&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/v21.0/me/insights?metric=accounts_engaged&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/v21.0/me/insights?metric=website_clicks&metric_type=total_value&period=day&since=${sinceDate}&until=${nowTimestamp}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/v21.0/me?fields=followers_count,follows_count,media_count,profile_picture_url&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count&limit=50&access_token=${accessToken}`)
            ]);

            const [reachData, viewsData, profileTapsData, websiteClicksData, igProfile, mediaData] = await Promise.all([
                reachRes.json(), viewsRes.json(), profileTapsRes.json(), websiteClicksRes.json(), igProfileRes.json(), mediaRes.json()
            ]);

            console.log('[IG-SYNC] Insights reach FULL:', JSON.stringify(reachData).substring(0, 500));
            console.log('[IG-SYNC] Insights views FULL:', JSON.stringify(viewsData).substring(0, 500));
            console.log('[IG-SYNC] Insights profile_links_taps FULL:', JSON.stringify(profileTapsData).substring(0, 500));
            console.log('[IG-SYNC] Insights website_clicks FULL:', JSON.stringify(websiteClicksData).substring(0, 500));

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
                } catch (e) { console.log('[IG-SYNC] Avatar cache failed (non-fatal):', e); }
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
                            const postInsightsRes = await fetch(`https://graph.instagram.com/v21.0/${post.id}/insights?metric=${metrics}&access_token=${accessToken}`);
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
                                const childRes = await fetch(`https://graph.instagram.com/v21.0/${post.id}/children?fields=media_url,media_type&limit=1&access_token=${accessToken}`);
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
         const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

         // Get account id first to clean up child tables
         const { data: account } = await serviceClient.from('instagram_accounts').select('id').eq('client_id', clientId).single();
         if (account) {
           await serviceClient.from('instagram_posts').delete().eq('instagram_account_id', account.id);
           await serviceClient.from('instagram_follower_history').delete().eq('instagram_account_id', account.id);
           await serviceClient.from('instagram_accounts').delete().eq('id', account.id);
         }
         return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    // 5. GET /summary/:clientId
    if (req.method === 'GET' && path.startsWith('/summary/')) {
         const clientId = path.split('/')[2];
         const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

         const { data, error } = await serviceClient.from('instagram_accounts').select('*').eq('client_id', clientId).single();
         if (error) return new Response(JSON.stringify({ exists: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

         // Fetch recent 30 day history
         const { data: history } = await serviceClient.from('instagram_follower_history').select('*').eq('instagram_account_id', data.id).order('date', { ascending: true }).limit(30);

         return new Response(JSON.stringify({ account: data, history: history || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 6. GET /posts/:clientId
    if (req.method === 'GET' && path.startsWith('/posts/')) {
         const clientId = path.split('/')[2];
         const pageStr = url.searchParams.get('page') || '1';
         const page = Math.max(1, parseInt(pageStr) || 1);
         const limit = 10;
         const offset = (page - 1) * limit;

         const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

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
    const isAuthError = err.message && err.message.includes("Unauthorized");
    const isTokenExpired = err.message && err.message.includes("expired");
    
    const statusCode = (isAuthError || isTokenExpired) ? 401 : 400;
    
    return new Response(JSON.stringify({ 
      error: true, 
      message: err.message,
      code: isTokenExpired ? "TOKEN_EXPIRED" : undefined
    }), { 
        status: statusCode, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
