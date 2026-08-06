import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { createSignedState, verifySignedState } from "./oauth-state.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { buildMetricFields, fetchPostInsights } from "../_shared/instagram-metrics.ts";
import { cachePostThumbnail } from "../_shared/instagram-thumbnail-cache.ts";
import { sendCronFailureEmail } from "../_shared/notify.ts";
import { classifyOAuthError, isAppConfigError } from "./oauth-error.ts";
import { consumeConnectLink } from "../instagram-connect-link/gate.ts";
import { sendConnectedNoticeEmail } from "../_shared/instagram-connect-email.ts";
import { appBaseUrl } from "../_shared/app-url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

// --- Workspace Ownership Verification ---
async function verifyClientOwnership(
  // deno-lint-ignore no-explicit-any
  svc: { from: (table: string) => any },
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

  const authHeader = req.headers.get('Authorization');

  const corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Whether the callback flow already consumed the oauth_states nonce in THIS
  // request; the catch block's alert gate must not try to consume it again.
  let callbackNonceConsumed = false;

  try {
    let user;
    // Root-path requests carrying `code` or `error` are OAuth callback redirects from
    // Meta (META_REDIRECT_URI may point at the function root) and carry no JWT.
    const isOAuthCallback =
      path === '/callback' ||
      (path === '' && (url.searchParams.has('code') || url.searchParams.has('error')));
    if (!isOAuthCallback) {
       const token = authHeader?.replace(/^Bearer\s+/i, '');

       if (!token || token === 'undefined' || token === 'null') {
           throw new Error("Unauthorized: No valid token provided in Authorization header");
       }

       const svc = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
         auth: { autoRefreshToken: false, persistSession: false },
       });
       const { data: { user: verifiedUser }, error: authError } = await svc.auth.getUser(token);

       if (authError || !verifiedUser) {
           throw new Error("Unauthorized: Token verification failed");
       }
       user = verifiedUser;
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

        if (!(await effectivePlanFeature(authServiceClient, authCallerProfile.conta_id, "feature_instagram"))) {
            return new Response(JSON.stringify({ error: "feature_disabled", feature: "feature_instagram" }),
                { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        const state = await createSignedState(clientId, user!.id, authCallerProfile.conta_id, authServiceClient);
        
        const oauthUrl = `https://www.instagram.com/oauth/authorize?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(functionBaseUrl)}&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish&state=${state}`;

        return new Response(JSON.stringify({ url: oauthUrl }), { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
    }

    // 2. GET /callback (also handle callback at root when META_REDIRECT_URI doesn't include /callback)
    if (req.method === 'GET' && isOAuthCallback) {
        const code = url.searchParams.get('code')?.replace(/#_$/, '');
        const state = url.searchParams.get('state');

        if (!code) throw new Error("Missing auth code");

        const { clientId, nonce, contaId, userId, linkToken } = await verifySignedState(state || '');
        if (!clientId || !/^\d+$/.test(String(clientId))) throw new Error("Invalid client ID in state parameter");

        const nonceServiceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: oauthState, error: nonceErr } = await nonceServiceClient
          .from('oauth_states')
          .update({ consumed_at: new Date().toISOString() })
          .eq('nonce', nonce)
          .is('consumed_at', null)
          .gt('expires_at', new Date().toISOString())
          .select()
          .single();
        if (nonceErr || !oauthState) {
          throw new Error('OAuth state expired or already used');
        }
        callbackNonceConsumed = true;

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
        let longLivedToken: string | null = null;
        let expiresInSeconds = 60 * 60 * 24 * 60;
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
        if (!longLivedToken) {
            console.error('[IG-CALLBACK] All LL token attempts failed, falling back to short-lived token (~1h expiry)');
            longLivedToken = shortLivedToken;
            expiresInSeconds = 3600;
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

        const REQUESTED_SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights', 'instagram_business_content_publish'];
        const grantedPermissions = Array.isArray(slTokenData.permissions) && slTokenData.permissions.length > 0
            ? slTokenData.permissions
            : REQUESTED_SCOPES;
        console.error('[IG-CALLBACK] Permissions:', JSON.stringify(grantedPermissions), Array.isArray(slTokenData.permissions) ? '(from token response)' : '(from requested scopes)');

        // If Meta reported the actually granted scopes and the user unchecked a
        // required one, refuse the half-working connection and tell them to
        // reconnect keeping every permission checked. Only enforceable when the
        // token response carries a real permissions array.
        if (Array.isArray(slTokenData.permissions) && slTokenData.permissions.length > 0) {
            const missing = REQUESTED_SCOPES.filter(s => !slTokenData.permissions.includes(s));
            if (missing.length > 0) {
                throw new Error(`MISSING_PERMISSIONS: ${missing.join(',')}`);
            }
        }

        // Encrypt Long Lived Token
        const encryptedToken = await encryptToken(longLivedToken!);

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

        // Read before the upsert: afterwards the row exists either way, and the reconnect flow
        // (expired or revoked token, `btn-ig-reconnect`) comes through this same callback. Without
        // this, every re-authorisation would count as a fresh activation. Only needs clientId, which
        // comes from the signed state, so it can run ahead of the link gate below without changing
        // the non-link agency flow (it already ran unconditionally, exactly once, here).
        const { data: priorAccount } = await serviceClient
            .from('instagram_accounts')
            .select('id')
            .eq('client_id', clientId)
            .maybeSingle();
        const isFirstConnection = !priorAccount;

        // Portão do link de conexão. Precisa vir o mais perto possível do upsert: o UPDATE
        // condicional abaixo é atômico só para a SUA PRÓPRIA instrução -- checar revoked_at/
        // expires_at e marcar used_at acontece numa única operação no banco. Mas o lock da
        // linha é liberado assim que essa instrução comita, e o upsert em instagram_accounts
        // é uma chamada HTTP separada ao PostgREST (outra transação). Entre as duas ainda
        // existe uma janela estreita em que uma revogação não seria pega -- não dá pra fechar
        // sem colocar o upsert na mesma transação do portão, o que é um escopo maior. O que dá
        // pra fazer, e este bloco faz, é encolher a janela: tudo que não precisa do retorno do
        // portão (entitlement, priorAccount) já rodou acima, então depois do portão só falta a
        // checagem de mismatch (sem round-trip) antes do upsert.
        if (linkToken) {
            // Reconferir a entitlement aqui, e não só no /start: o state vive 10
            // minutos, e um downgrade dentro dessa janela não pode resultar numa
            // conta ativa gravada para um workspace que perdeu o feature. contaId vem do
            // state assinado (HMAC) -- é o mesmo workspace que o portão devolveria em
            // consumed.conta_id, mas ainda não passamos pelo portão neste ponto.
            if (!(await effectivePlanFeature(serviceClient, contaId, 'feature_instagram'))) {
                throw new Error('CONNECT_LINK_REVOKED');
            }
            const consumed = await consumeConnectLink(serviceClient, linkToken, new Date().toISOString());
            if (!consumed) throw new Error('CONNECT_LINK_REVOKED');
            if (String(consumed.cliente_id) !== String(clientId)) {
                // O state é assinado, então isto não deveria acontecer. Se acontecer,
                // algo está muito errado e não escrevemos nada.
                console.error('[IG-CALLBACK] link/state client mismatch', consumed.cliente_id, clientId);
                throw new Error('CONNECT_LINK_REVOKED');
            }
        }

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
                permissions: grantedPermissions,
            }, { onConflict: 'client_id' })
            .select('id')
            .single();

        if (dbError) throw new Error(dbError.message);

        await insertAuditLog(serviceClient, {
          // Both come from the signed state. Without conta_id the row is unattributable: it is
          // invisible to every per-workspace view of the audit trail, which is how linking an
          // account came to leave no workspace-level trace at all.
          conta_id: contaId,
          actor_user_id: userId,
          action: 'instagram-link',
          resource_type: 'instagram_account',
          resource_id: String(clientId),
          metadata: {
            ig_username: igProfile.username || '',
            ig_business_id: igBusinessId,
            ...(linkToken ? { via: 'connect_link' } : {}),
          },
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
            const mediaRes = await fetch(`https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count&limit=50&access_token=${longLivedToken}`);
            const mediaData = await mediaRes.json();

            if (mediaData.data) {
                let savedCount = 0;
                const existingByPostId = new Map<string, any>();
                {
                    const ids = (mediaData.data ?? []).map((p: any) => p.id);
                    if (ids.length) {
                        const { data: existingRows } = await serviceClient
                            .from('instagram_posts')
                            .select('instagram_post_id, thumbnail_url, reach, impressions, saved, shares, likes, comments')
                            .in('instagram_post_id', ids);
                        for (const r of existingRows ?? []) existingByPostId.set(r.instagram_post_id, r);
                    }
                }
                for (const post of mediaData.data) {
                    const insights = await fetchPostInsights(fetch, post.id, longLivedToken!);
                    const m = buildMetricFields(existingByPostId.get(post.id) ?? null, insights, post);

                    // Cache to durable storage so the Hub feed survives IG CDN url expiry.
                    const cachedThumb = await cachePostThumbnail(
                        { fetch, storage: serviceClient.storage },
                        accountId,
                        post.id,
                        post.thumbnail_url || post.media_url || null,
                        existingByPostId.get(post.id)?.thumbnail_url ?? null,
                    );

                    const { error: postErr } = await serviceClient.from('instagram_posts').upsert({
                        instagram_account_id: accountId,
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
                    }, { onConflict: 'instagram_post_id' });
                    if (!postErr) savedCount++;
                }
            }
        } catch { /* posts/history fetch is best-effort */ }

        // Aviso à agência. Melhor-esforço: a conexão já está persistida e uma falha
        // aqui não pode desfazê-la nem bloquear o redirect do cliente.
        if (linkToken) {
            // Buscado uma vez e usado pelos dois avisos. client_name é o nome do
            // CLIENTE, não o @ do Instagram: notification-config renderiza
            // `${client_name} · @${ig_username}`, e passar o username nos dois
            // campos imprime "clinicax · @clinicax".
            let clienteNome = '';
            try {
                const { data: cliente } = await serviceClient
                    .from('clientes').select('nome').eq('id', clientId).maybeSingle();
                clienteNome = cliente?.nome ?? '';
            } catch (e) {
                console.error('[IG-CALLBACK] cliente lookup for notice failed (non-fatal):', e);
            }
            try {
                await serviceClient.from('notifications').insert({
                    workspace_id: contaId,
                    user_id: userId,
                    type: 'instagram_connected_by_client',
                    metadata: { client_name: clienteNome, ig_username: igProfile.username || '' },
                    link: `/clientes/${clientId}`,
                });
            } catch (e) {
                // created_by pode ter sido removido entre gerar o link e o callback:
                // notifications.user_id tem FK com ON DELETE CASCADE, então o insert falha.
                console.error('[IG-CALLBACK] notification insert failed (non-fatal):', e);
            }
            try {
                // auth.users.email via the Auth admin API -- profiles has no email
                // column. Best-effort: the member may have been deleted between
                // generating the link and the callback, in which case skip silently.
                const { data: userData } = await serviceClient.auth.admin.getUserById(userId);
                const memberEmail = userData?.user?.email;
                if (memberEmail) {
                    const base = appBaseUrl();
                    await sendConnectedNoticeEmail({
                        to: memberEmail,
                        clienteName: clienteNome,
                        igUsername: igProfile.username || '',
                        clienteUrl: `${base.replace(/\/+$/, '')}/clientes/${clientId}`,
                        appBaseUrl: base,
                        idempotencyKey: `ig-connected-notice:${linkToken}:${igBusinessId}`,
                    });
                }
            } catch (e) {
                console.error('[IG-CALLBACK] connected notice email failed (non-fatal):', e);
            }
        }

        // The CRM's activation signal: the only point in the flow where a connection is known to
        // exist. Carries new-vs-reconnect because both reach this line, and only the first is an
        // activation. The page fires `instagram_connected` on it and strips it from the URL
        // (useInstagramActivationEvent).
        const connectedMarker = isFirstConnection ? 'new' : 'reconnect';
        // O cliente final não tem login no CRM: mandá-lo para /clientes/:id o joga
        // na tela de login. OAUTH_REDIRECT_BASE (e não APP_BASE_URL) porque este é
        // o redirect do callback OAuth, não um link enviado por e-mail.
        if (linkToken) {
            return Response.redirect(
                `${OAUTH_REDIRECT_BASE}/conectar/${linkToken}?ig_connected=${connectedMarker}`,
                302,
            );
        }
        return Response.redirect(
            `${OAUTH_REDIRECT_BASE}/clientes/${clientId}?ig_connected=${connectedMarker}`,
            302,
        );
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

        if (!(await effectivePlanFeature(serviceClient, callerProfile.conta_id, "feature_instagram"))) {
            return new Response(JSON.stringify({ error: "feature_disabled", feature: "feature_instagram" }),
                { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        const syncAllowed = await checkRateLimit(serviceClient, `ig-sync:${callerProfile.conta_id}:${clientId}`, 5, 300);
        if (!syncAllowed) {
            return new Response(JSON.stringify({ error: "Rate limit exceeded" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 429 });
        }

        const { data: accounts, error: accountError } = await serviceClient
            .from('instagram_accounts')
            .select('*')
            .eq('client_id', clientId);

        if (accountError || !accounts || accounts.length === 0) throw new Error("Account not found");
        const account = accounts[0];

        if (account.authorization_status === 'disconnected' || account.authorization_status === 'revoked') {
            const code = account.authorization_status === 'revoked' ? 'ACCOUNT_REVOKED' : 'ACCOUNT_DISCONNECTED';
            return new Response(JSON.stringify({ error: true, code, message: 'Instagram account is not active' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
        }

        let accessToken = await decryptToken(account.encrypted_access_token);

        // Proactive token refresh: if token expires within 7 days, refresh before syncing
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const tokenExpiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
        if (tokenExpiresAt > 0 && tokenExpiresAt - Date.now() < sevenDaysMs) {
            try {
                const refreshRes = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${accessToken}`);
                const refreshData = await refreshRes.json();
                if (refreshData.access_token) {
                    accessToken = refreshData.access_token;
                    const expiresIn = refreshData.expires_in || (60 * 60 * 24 * 60);
                    const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
                    const newEncrypted = await encryptToken(accessToken);
                    await serviceClient.from('instagram_accounts').update({
                        encrypted_access_token: newEncrypted,
                        token_expires_at: newExpiresAt,
                        authorization_status: 'active',
                    }).eq('id', account.id);
                    console.error(`[IG-SYNC] Proactively refreshed token for account ${account.id}, new expiry: ${newExpiresAt}`);
                } else if (refreshData.error?.code === 190) {
                    await serviceClient.from('instagram_accounts').update({ authorization_status: 'expired' }).eq('id', account.id);
                    return new Response(JSON.stringify({ error: true, code: 'TOKEN_EXPIRED', message: 'Instagram token expired' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 });
                }
            } catch (e) { console.error('[IG-SYNC] Proactive refresh failed (non-fatal):', e); }
        }

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

            // Check if token expired (any Graph response with code 190)
            const allGraphResponses = [reachData, viewsData, profileTapsData, websiteClicksData, igProfile];
            for (const resp of allGraphResponses) {
                if (resp.error?.code === 190) {
                    await serviceClient.from('instagram_accounts').update({ authorization_status: 'expired' }).eq('id', account.id);
                    return new Response(JSON.stringify({ error: true, code: "TOKEN_EXPIRED", message: "Instagram token expired" }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 });
                }
            }

            // Only overwrite metrics when Graph returned valid data (not errors)
            const insightsUpdate: Record<string, number> = {};

            if (reachData.data) {
                for (const insight of reachData.data) {
                    if (insight.name === 'reach') insightsUpdate.reach_28d = insight.total_value?.value || 0;
                }
            }
            if (viewsData.data) {
                for (const insight of viewsData.data) {
                    if (insight.name === 'views') insightsUpdate.impressions_28d = insight.total_value?.value || 0;
                }
            }
            if (profileTapsData.data) {
                for (const insight of profileTapsData.data) {
                    if (insight.name === 'accounts_engaged') insightsUpdate.profile_views_28d = insight.total_value?.value || 0;
                }
            }
            if (websiteClicksData.data) {
                for (const insight of websiteClicksData.data) {
                    if (insight.name === 'website_clicks') insightsUpdate.website_clicks_28d = insight.total_value?.value || 0;
                }
            } else if (websiteClicksData.error) {
                console.error('[IG-SYNC] website_clicks error:', JSON.stringify(websiteClicksData));
            }
            console.error('[IG-SYNC] Insights results —', JSON.stringify(insightsUpdate));

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
                    ...insightsUpdate,
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
                const existingByPostId = new Map<string, any>();
                {
                    const ids = (mediaData.data ?? []).map((p: any) => p.id);
                    if (ids.length) {
                        const { data: existingRows } = await serviceClient
                            .from('instagram_posts')
                            .select('instagram_post_id, thumbnail_url, reach, impressions, saved, shares, likes, comments')
                            .in('instagram_post_id', ids);
                        for (const r of existingRows ?? []) existingByPostId.set(r.instagram_post_id, r);
                    }
                }
                const allPostData: any[] = [];
                const BATCH_SIZE = 10;
                for (let i = 0; i < mediaData.data.length; i += BATCH_SIZE) {
                    const batch = mediaData.data.slice(i, i + BATCH_SIZE);
                    const batchResults = await Promise.all(batch.map(async (post: any) => {
                        const insights = await fetchPostInsights(fetch, post.id, accessToken);
                        const m = buildMetricFields(existingByPostId.get(post.id) ?? null, insights, post);

                        // Get thumbnail: VIDEO has thumbnail_url, IMAGE has media_url, CAROUSEL needs first child
                        let thumbUrl = post.thumbnail_url || post.media_url || null;
                        if (!thumbUrl && post.media_type === 'CAROUSEL_ALBUM') {
                            try {
                                const childRes = await fetch(`https://graph.instagram.com/${post.id}/children?fields=media_url,media_type&limit=1&access_token=${accessToken}`);
                                const childData = await childRes.json();
                                if (childData.data?.[0]?.media_url) thumbUrl = childData.data[0].media_url;
                            } catch (_) { /* ignore */ }
                        }
                        // Cache to durable storage so the Hub feed survives IG CDN url expiry.
                        const cachedThumb = await cachePostThumbnail(
                            { fetch, storage: serviceClient.storage },
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
                // Single bulk upsert instead of 50 individual ones
                await serviceClient.from('instagram_posts').upsert(allPostData, { onConflict: 'instagram_post_id' });
            }
            
            return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            
        } catch (error: any) {
            if (error.code === 'TOKEN_EXPIRED') throw error;
            throw new Error('Sync Failed');
        }
    }

    // 4. POST /refresh/:clientId — attempt to refresh the Instagram token without full OAuth
    if (req.method === 'POST' && path.startsWith('/refresh/')) {
        const clientId = path.split('/')[2];
        if (!clientId || !/^\d+$/.test(clientId)) {
            return new Response(JSON.stringify({ error: true, message: 'Invalid client ID' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
        }
        const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

        const { data: callerProfile } = await serviceClient.from('profiles').select('conta_id').eq('id', user!.id).single();
        if (!callerProfile?.conta_id || !await verifyClientOwnership(serviceClient, clientId, callerProfile.conta_id)) {
            return new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 });
        }

        const { data: account, error: accountError } = await serviceClient
            .from('instagram_accounts')
            .select('id, encrypted_access_token, token_expires_at, authorization_status')
            .eq('client_id', clientId)
            .single();

        if (accountError || !account || !account.encrypted_access_token) {
            return new Response(JSON.stringify({ error: true, message: 'Account not found' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 });
        }

        const currentToken = await decryptToken(account.encrypted_access_token);

        const refreshRes = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`);
        const refreshData = await refreshRes.json();

        if (refreshData.error) {
            const code = refreshData.error.code;
            if (code === 190) {
                await serviceClient.from('instagram_accounts').update({ authorization_status: 'expired' }).eq('id', account.id);
            } else if (code === 10) {
                await serviceClient.from('instagram_accounts').update({ authorization_status: 'revoked' }).eq('id', account.id);
            }
            return new Response(JSON.stringify({
                error: true,
                code: code === 190 ? 'TOKEN_EXPIRED' : 'REFRESH_FAILED',
                message: code === 190 ? 'Token expirado — necessário reconectar' : 'Falha ao atualizar token',
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: code === 190 ? 401 : 400 });
        }

        const newToken = refreshData.access_token;
        const expiresInSeconds = refreshData.expires_in || (60 * 60 * 24 * 60);
        const newExpiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
        const newEncryptedToken = await encryptToken(newToken);

        await serviceClient.from('instagram_accounts').update({
            encrypted_access_token: newEncryptedToken,
            token_expires_at: newExpiresAt,
            authorization_status: 'active',
        }).eq('id', account.id);

        return new Response(JSON.stringify({ success: true, token_expires_at: newExpiresAt }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

     // 5. DELETE /disconnect/:clientId
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
           const { error: updateErr } = await serviceClient.from('instagram_accounts').update({
             encrypted_access_token: '',
             token_expires_at: new Date(0).toISOString(),
             authorization_status: 'disconnected',
             last_synced_at: null,
           }).eq('id', account.id);
           if (updateErr) throw new Error(updateErr.message);
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

         const SUMMARY_FIELDS = 'id,client_id,instagram_user_id,username,profile_picture_url,follower_count,following_count,media_count,token_expires_at,reach_28d,impressions_28d,profile_views_28d,website_clicks_28d,last_synced_at,created_at,authorization_status,permissions,auto_sync_enabled';
         const { data, error } = await serviceClient.from('instagram_accounts').select(SUMMARY_FIELDS).eq('client_id', clientId).single();
         if (error || !data || data.authorization_status === 'disconnected') return new Response(JSON.stringify({ exists: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

         const { data: history } = await serviceClient.from('instagram_follower_history').select('*').eq('instagram_account_id', data.id).order('date', { ascending: false }).limit(30);

         return new Response(JSON.stringify({ account: data, history: (history || []).reverse() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
    const isCallback =
      path === '/callback' ||
      (path === '' && (url.searchParams.has('code') || url.searchParams.has('error')));
    if (isCallback) {
      const stateParam = url.searchParams.get('state');
      let redirectClientId: string | undefined;
      let stateNonce: string | undefined;
      let redirectLinkToken: string | undefined;
      try {
        const parsedState = await verifySignedState(stateParam || '');
        redirectClientId = parsedState.clientId;
        stateNonce = parsedState.nonce;
        redirectLinkToken = parsedState.linkToken;
      } catch { /* ignore */ }
      // Classify known Meta OAuth failures into a code the CRM can turn into
      // actionable guidance. Only the code travels in the URL — never the raw message.
      // Meta may report the failure either via the token exchange (err.message) or
      // directly as error/error_description/error_message params on the callback redirect.
      const rawMsg = [
        err?.message,
        url.searchParams.get('error_description'),
        url.searchParams.get('error_message'),
        url.searchParams.get('error_reason'),
      ]
        .filter(Boolean)
        .join(' ');
      const igErrorCode = classifyOAuthError(rawMsg, url.searchParams);

      // App misconfiguration (development mode, inactive app) is on us, not the
      // user: alert internally, keep the generic code outward. The alert only
      // fires after consuming the state nonce, so a signed state (obtainable by
      // any authenticated member and replayable for its 10-minute signature
      // lifetime) yields at most one email — no spamming the alert channel.
      if (stateNonce && isAppConfigError(rawMsg)) {
        try {
          // If this request already consumed the nonce in the main callback
          // flow (error after a valid `code`), the replay protection is done —
          // consuming again would find no row and swallow the alert.
          let shouldAlert = callbackNonceConsumed;
          if (!shouldAlert) {
            const alertClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
            const { data: consumed } = await alertClient
              .from('oauth_states')
              .update({ consumed_at: new Date().toISOString() })
              .eq('nonce', stateNonce)
              .is('consumed_at', null)
              .gt('expires_at', new Date().toISOString())
              .select()
              .single();
            shouldAlert = Boolean(consumed);
          }
          // Nonce consumption stops replay of ONE state, but /auth mints fresh
          // states on demand, so a member (or a buggy client) could still emit
          // one email per request. The alert is app-global — cap it at 1/hour.
          if (shouldAlert) {
            const rlClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
            shouldAlert = await checkRateLimit(rlClient, 'ig-oauth-app-config-alert', 1, 3600);
          }
          if (shouldAlert) {
            await sendCronFailureEmail('instagram-oauth-callback (app config)', {
              errors: [{ error: rawMsg.slice(0, 500) }],
            });
          }
        } catch { /* never block the redirect on the alert */ }
      }
      const target = redirectLinkToken
        ? `${OAUTH_REDIRECT_BASE}/conectar/${redirectLinkToken}?ig_error=${igErrorCode}`
        : redirectClientId
          ? `${OAUTH_REDIRECT_BASE}/clientes/${redirectClientId}?ig_error=${igErrorCode}`
          : `${OAUTH_REDIRECT_BASE}?ig_error=${igErrorCode}`;
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
