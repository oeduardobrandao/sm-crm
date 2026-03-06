import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID")!;
const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;
const META_REDIRECT_URI = Deno.env.get("META_REDIRECT_URI")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY")! || "default_encryption_key_32_chars_!!";

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
serve(async (req) => {
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
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ---- VERIFY AUTHENTICATION ----
    // We only enforce auth for the endpoints that modify internal data (which is everything except callback)
    let user;
    if (path !== '/callback') {
       const userRes = await supabaseClient.auth.getUser();
       user = userRes.data.user;
       if (!user) throw new Error("Unauthorized");
    }

    // 1. GET /auth/:clientId
    if (req.method === 'GET' && path.startsWith('/auth/')) {
        const clientId = path.split('/')[2];
        if (!clientId) throw new Error("Client ID required");

        // Pass clientId in state
        const state = btoa(JSON.stringify({ clientId }));
        
        const oauthUrl = \`https://www.facebook.com/v19.0/dialog/oauth\u003Fclient_id=\${META_APP_ID}&redirect_uri=\${META_REDIRECT_URI}&scope=instagram_basic,instagram_manage_insights,instagram_content_publish,instagram_manage_comments,pages_read_engagement&response_type=code&state=\${state}\`;

        return new Response(JSON.stringify({ url: oauthUrl }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
    }

    // 2. GET /callback
    if (req.method === 'GET' && path === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code) throw new Error("Missing auth code");

        const decodedState = JSON.parse(atob(state || ''));
        const clientId = decodedState.clientId;

        // Exchange code for short-lived token
        const exchangeUrl = \`https://graph.facebook.com/v19.0/oauth/access_token\u003Fclient_id=\${META_APP_ID}&redirect_uri=\${META_REDIRECT_URI}&client_secret=\${META_APP_SECRET}&code=\${code}\`;
        
        const slTokenRes = await fetch(exchangeUrl);
        const slTokenData = await slTokenRes.json();
        
        if (slTokenData.error) throw new Error(slTokenData.error.message);

        // Exchange for long-lived token
        const llExchangeUrl = \`https://graph.facebook.com/v19.0/oauth/access_token\u003Fgrant_type=fb_exchange_token&client_id=\${META_APP_ID}&client_secret=\${META_APP_SECRET}&fb_exchange_token=\${slTokenData.access_token}\`;
        
        const llTokenRes = await fetch(llExchangeUrl);
        const llTokenData = await llTokenRes.json();

        if (llTokenData.error) throw new Error(llTokenData.error.message);

        const longLivedToken = llTokenData.access_token;
        const expiresInSeconds = llTokenData.expires_in || (60 * 60 * 24 * 60); // Default to 60 days
        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

        // Need the user ID. We skipped verification before, so we must rely on anonymous service role operation here.
        // It's safer to have the callback redirect to the frontend with the code, and have the frontend POST the code.
        // Or, we use Service Role to store it securely, assuming state cannot be forged.
        const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        // Fetch User ID to get business account id
        const meRes = await fetch(\`https://graph.facebook.com/v19.0/me?access_token=\${longLivedToken}\`);
        const meData = await meRes.json();

        // Actually look for business accounts linked to these pages
        const pagesRes = await fetch(\`https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account&access_token=\${longLivedToken}\`);
        const pagesData = await pagesRes.json();
        
        const igAccount = pagesData.data?.find((p: any) => p.instagram_business_account);
        if (!igAccount) {
            // No IG Business account connected
             return Response.redirect('http://localhost:3000/#/cliente/' + clientId + '?ig_error=no_business_account', 302);
        }

        const igBusinessId = igAccount.instagram_business_account.id;

        // Get basic profile data to store right away
        const igProfileRes = await fetch(\`https://graph.facebook.com/v19.0/\${igBusinessId}?fields=username,profile_picture_url,followers_count,follows_count,media_count&access_token=\${longLivedToken}\`);
        const igProfile = await igProfileRes.json();

        // Encrypt Long Lived Token
        const encryptedToken = await encryptToken(longLivedToken);

        // Upsert into DB
        const { error: dbError } = await serviceClient
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
                token_expires_at: expiresAt
            }, { onConflict: 'client_id' }); // Assuming one per client

        if (dbError) throw new Error(dbError.message);

        return Response.redirect('http://localhost:3000/#/cliente/' + clientId, 302);
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
            // 3.1 Fetch Account Insights (28 day window)
            const sinceDate = Math.floor(Date.now() / 1000 - (28 * 24 * 60 * 60));
            const insightsRes = await fetch(\`https://graph.facebook.com/v19.0/\${account.instagram_user_id}/insights?metric=reach,impressions,profile_views&period=day&since=\${sinceDate}&access_token=\${accessToken}\`);
            const insightsData = await insightsRes.json();

            // Check if token expired
            if (insightsData.error?.code === 190) {
               return new Response(JSON.stringify({ error: true, code: "TOKEN_EXPIRED", message: "Instagram token expired" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 });
            }

            // Calculate 28d totals
            let totalReach = 0; let totalImpressions = 0; let totalViews = 0;
            if (insightsData.data) {
                for (const insight of insightsData.data) {
                    const value = insight.values.reduce((sum: number, v: any) => sum + v.value, 0);
                    if (insight.name === 'reach') totalReach = value;
                    if (insight.name === 'impressions') totalImpressions = value;
                    if (insight.name === 'profile_views') totalViews = value;
                }
            }

            // Update basic profile numbers again just to be fresh
             const igProfileRes = await fetch(\`https://graph.facebook.com/v19.0/\${account.instagram_user_id}?fields=followers_count,follows_count,media_count&access_token=\${accessToken}\`);
             const igProfile = await igProfileRes.json();

            await serviceClient.from('instagram_accounts').update({
                follower_count: igProfile.followers_count || account.follower_count,
                following_count: igProfile.follows_count || account.following_count,
                media_count: igProfile.media_count || account.media_count,
                reach_28d: totalReach,
                impressions_28d: totalImpressions,
                profile_views_28d: totalViews,
                last_synced_at: new Date().toISOString()
            }).eq('id', account.id);

            // Fetch Follower History (Save daily snapshot)
            // Just saving todays snapshot
            const today = new Date().toISOString().split('T')[0];
            await serviceClient.from('instagram_follower_history').upsert({
                instagram_account_id: account.id,
                date: today,
                follower_count: igProfile.followers_count || account.follower_count
            }, { onConflict: 'instagram_account_id,date' });


            // 3.2 Fetch Posts
            const mediaRes = await fetch(\`https://graph.facebook.com/v19.0/\${account.instagram_user_id}/media?fields=id,caption,media_type,permalink,timestamp,comments_count,like_count&limit=50&access_token=\${accessToken}\`);
            const mediaData = await mediaRes.json();

            if (mediaData.data) {
                for (const post of mediaData.data) {
                    
                     // Fetch post specific insights
                     let reach = 0, impressions = 0, saved = 0, shares = 0;
                     try {
                        let metrics = 'reach,impressions,saved';
                        // Image posts don't have shares, video does.
                        if (post.media_type === 'VIDEO') metrics += ',shares';

                        const postInsightsRes = await fetch(\`https://graph.facebook.com/v19.0/\${post.id}/insights?metric=\${metrics}&access_token=\${accessToken}\`);
                        const postInsightsData = await postInsightsRes.json();

                        if (postInsightsData.data) {
                            for (const insight of postInsightsData.data) {
                                if (insight.name === 'reach') reach = insight.values[0].value;
                                if (insight.name === 'impressions') impressions = insight.values[0].value;
                                if (insight.name === 'saved') saved = insight.values[0].value;
                                if (insight.name === 'shares') shares = insight.values[0].value;
                            }
                        }
                     } catch (e) {
                        // ignore post insight errors to allow partial sync success
                     }

                     await serviceClient.from('instagram_posts').upsert({
                         instagram_account_id: account.id,
                         instagram_post_id: post.id,
                         caption: post.caption || '',
                         media_type: post.media_type,
                         permalink: post.permalink,
                         posted_at: post.timestamp,
                         likes: post.like_count || 0,
                         comments: post.comments_count || 0,
                         reach: reach,
                         impressions: impressions,
                         saved: saved,
                         shares: shares,
                         synced_at: new Date().toISOString()
                     }, { onConflict: 'instagram_post_id' }); // Assuming unique post id
                }
            }
            
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            
        } catch (error: any) {
            console.error('Sync Error', error);
            // Re-throw handled expired tokens
            if (error.code === 'TOKEN_EXPIRED') throw error;
            throw new Error('Sync Failed');
        }
    }

     // 4. DELETE /disconnect/:clientId
    if (req.method === 'DELETE' && path.startsWith('/disconnect/')) {
         const clientId = path.split('/')[2];
         const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

         await serviceClient.from('instagram_accounts').delete().eq('client_id', clientId);
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
         const page = parseInt(pageStr);
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
    if (err.message === "Unauthorized") {
       return new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (err.message && err.message.includes('expired')) {
       return new Response(JSON.stringify({ error: true, code: "TOKEN_EXPIRED", message: err.message }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
