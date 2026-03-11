import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID")!;
const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;
const META_REDIRECT_URI = Deno.env.get("META_REDIRECT_URI")!;
const OAUTH_REDIRECT_BASE = Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:3000";
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();

// --- Token Encryption Utility ---
async function encryptToken(token: string): Promise<string> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(token)
  );

  const encryptedArray = new Uint8Array(encryptedBuf);
  // Combine IV and encrypted data as base64
  const combined = new Uint8Array(iv.length + encryptedArray.length);
  combined.set(iv);
  combined.set(encryptedArray, iv.length);
  return btoa(String.fromCharCode.apply(null, Array.from(combined)));
}

async function decryptToken(encryptedBase64: string): Promise<string> {
  const enc = new TextEncoder();
  const rawKey = enc.encode(TOKEN_ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  return new TextDecoder().decode(decryptedBuf);
}

// --- Main Handler ---
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace('/instagram-integration', '');

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
        
        const oauthUrl = `https://www.instagram.com/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${META_REDIRECT_URI}&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights&state=${state}`;

        return new Response(JSON.stringify({ url: oauthUrl }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
    }

    // 2. GET /callback (also handle callback at root when META_REDIRECT_URI doesn't include /callback)
    if (req.method === 'GET' && (path === '/callback' || (path === '' && url.searchParams.has('code')))) {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code) throw new Error("Missing auth code");

        const decodedState = JSON.parse(atob(state || ''));
        const clientId = decodedState.clientId;
        if (!clientId || !/^\d+$/.test(String(clientId))) throw new Error("Invalid client ID in state parameter");

        // Exchange code for short-lived token (Instagram Business Login)
        const exchangeRes = await fetch('https://api.instagram.com/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: META_APP_ID,
                client_secret: META_APP_SECRET,
                grant_type: 'authorization_code',
                redirect_uri: META_REDIRECT_URI,
                code: code
            })
        });
        const slTokenData = await exchangeRes.json();
        if (slTokenData.error) throw new Error(slTokenData.error_description || slTokenData.error);

        const shortLivedToken = slTokenData.access_token;
        const igBusinessId = String(slTokenData.user_id); // Instagram Business account ID returned directly

        // Exchange for long-lived token
        const llExchangeUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${META_APP_SECRET}&access_token=${shortLivedToken}`;
        const llTokenRes = await fetch(llExchangeUrl);
        const llTokenData = await llTokenRes.json();
        if (llTokenData.error) throw new Error(llTokenData.error.message || 'Failed to get long-lived token');

        const longLivedToken = llTokenData.access_token;
        const expiresInSeconds = llTokenData.expires_in || (60 * 60 * 24 * 60);
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

        const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        // Get basic profile data
        const igProfileRes = await fetch(`https://graph.instagram.com/me?fields=username,profile_picture_url,followers_count,follows_count,media_count&access_token=${longLivedToken}`);
        const igProfile = await igProfileRes.json();

        // Encrypt Long Lived Token
        const encryptedToken = await encryptToken(longLivedToken);

        // Fetch 28-day account insights
        let reach_28d = 0, impressions_28d = 0, profile_views_28d = 0;
        try {
            const sinceDate = Math.floor(Date.now() / 1000 - (28 * 24 * 60 * 60));
            // Daily metric: reach
            const insightsRes = await fetch(`https://graph.instagram.com/v21.0/${igBusinessId}/insights?metric=reach&period=day&since=${sinceDate}&access_token=${longLivedToken}`);
            const insightsData = await insightsRes.json();
            if (insightsData.data) {
                for (const insight of insightsData.data) {
                    if (insight.name === 'reach') reach_28d = insight.values.reduce((sum: number, v: any) => sum + v.value, 0);
                }
            }
            // Total value metrics: views, profile_views
            try {
                const totalRes = await fetch(`https://graph.instagram.com/v21.0/${igBusinessId}/insights?metric=views,profile_views&metric_type=total_value&period=day&since=${sinceDate}&access_token=${longLivedToken}`);
                const totalData = await totalRes.json();
                if (totalData.data) {
                    for (const insight of totalData.data) {
                        const val = insight.total_value?.value || 0;
                        if (insight.name === 'views') impressions_28d = val;
                        if (insight.name === 'profile_views') profile_views_28d = val;
                    }
                }
            } catch (_) { /* ignore */ }
        } catch (_) { /* ignore insights fetch errors */ }

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
                last_synced_at: new Date().toISOString()
            }, { onConflict: 'client_id' })
            .select('id')
            .single();

        if (dbError) throw new Error(dbError.message);

        // Save follower history snapshot + fetch posts
        try {
            const accountId = upsertedAccount!.id;
            const today = new Date().toISOString().split('T')[0];

            await serviceClient.from('instagram_follower_history').upsert({
                instagram_account_id: accountId,
                date: today,
                follower_count: igProfile.followers_count || 0
            }, { onConflict: 'instagram_account_id,date' });

            // Fetch posts
            const mediaRes = await fetch(`https://graph.instagram.com/v21.0/${igBusinessId}/media?fields=id,caption,media_type,permalink,timestamp,comments_count,like_count&limit=50&access_token=${longLivedToken}`);
            const mediaData = await mediaRes.json();

            if (mediaData.data) {
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
                        }
                    } catch (_) { /* ignore per-post insight errors */ }

                    await serviceClient.from('instagram_posts').upsert({
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
                }
            }
        } catch (_) { /* ignore posts/history fetch errors */ }

        return Response.redirect(`${OAUTH_REDIRECT_BASE}/#/cliente/${clientId}`, 302);
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
            // 3.1 Fetch Account Insights (28 day window) — all 3 calls in parallel
            const sinceDate = Math.floor(Date.now() / 1000 - (28 * 24 * 60 * 60));
            const [insightsRes, totalRes, igProfileRes, mediaRes] = await Promise.all([
                fetch(`https://graph.instagram.com/v21.0/${account.instagram_user_id}/insights?metric=reach&period=day&since=${sinceDate}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/v21.0/${account.instagram_user_id}/insights?metric=views,profile_views&metric_type=total_value&period=day&since=${sinceDate}&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/v21.0/${account.instagram_user_id}?fields=followers_count,follows_count,media_count&access_token=${accessToken}`),
                fetch(`https://graph.instagram.com/v21.0/${account.instagram_user_id}/media?fields=id,caption,media_type,permalink,timestamp,comments_count,like_count&limit=50&access_token=${accessToken}`)
            ]);

            const [insightsData, totalData, igProfile, mediaData] = await Promise.all([
                insightsRes.json(), totalRes.json(), igProfileRes.json(), mediaRes.json()
            ]);

            // Check if token expired
            if (insightsData.error?.code === 190) {
               return new Response(JSON.stringify({ error: true, code: "TOKEN_EXPIRED", message: "Instagram token expired" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 });
            }

            let totalReach = 0; let totalImpressions = 0; let totalViews = 0;
            if (insightsData.data) {
                for (const insight of insightsData.data) {
                    const value = insight.values.reduce((sum: number, v: any) => sum + v.value, 0);
                    if (insight.name === 'reach') totalReach = value;
                }
            }

            if (totalData.data) {
                for (const insight of totalData.data) {
                    const val = insight.total_value?.value || 0;
                    if (insight.name === 'views') totalImpressions = val;
                    if (insight.name === 'profile_views') totalViews = val;
                }
            }

            const today = new Date().toISOString().split('T')[0];
            // Update account stats and follower history in parallel
            await Promise.all([
                serviceClient.from('instagram_accounts').update({
                    follower_count: igProfile.followers_count || account.follower_count,
                    following_count: igProfile.follows_count || account.following_count,
                    media_count: igProfile.media_count || account.media_count,
                    reach_28d: totalReach,
                    impressions_28d: totalImpressions,
                    profile_views_28d: totalViews,
                    last_synced_at: new Date().toISOString()
                }).eq('id', account.id),
                serviceClient.from('instagram_follower_history').upsert({
                    instagram_account_id: account.id,
                    date: today,
                    follower_count: igProfile.followers_count || account.follower_count
                }, { onConflict: 'instagram_account_id,date' })
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
                        return {
                            instagram_account_id: account.id,
                            instagram_post_id: post.id,
                            caption: post.caption || '',
                            media_type: post.media_type,
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


    return new Response('Not Found', { status: 404, headers: corsHeaders });

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
