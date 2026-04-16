import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ?? (() => { throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required"); })();
const GRAPH_API_VERSION = "v22.0";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || '';
const INTERNAL_FUNCTION_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET') ?? (() => { throw new Error('INTERNAL_FUNCTION_SECRET is required'); })();

// --- Token Decryption ---
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

// --- Caching Helper ---
async function getCachedOrFetch<T>(
  serviceClient: any,
  accountId: number,
  cacheKey: string,
  fetchFn: () => Promise<T>,
  maxAgeHours = 6
): Promise<{ data: T; fromCache: boolean; fetchedAt: string }> {
  const { data: cached } = await serviceClient
    .from('instagram_analytics_cache')
    .select('data, fetched_at')
    .eq('instagram_account_id', accountId)
    .eq('cache_key', cacheKey)
    .single();

  if (cached && cached.data) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (age < maxAgeHours * 60 * 60 * 1000) {
      return { data: cached.data as T, fromCache: true, fetchedAt: cached.fetched_at };
    }
  }

  const freshData = await fetchFn();
  const now = new Date().toISOString();

  if (freshData) {
    await serviceClient.from('instagram_analytics_cache').upsert({
      instagram_account_id: accountId,
      cache_key: cacheKey,
      data: freshData,
      fetched_at: now,
    }, { onConflict: 'instagram_account_id,cache_key' });
  }

  return { data: freshData, fromCache: false, fetchedAt: now };
}

// --- Graph API fetch with retry ---
async function graphFetch(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url);
    const data = await res.json();

    if (data.error?.code === 190) {
      throw { code: 'TOKEN_EXPIRED', message: 'Instagram token expired' };
    }
    if (data.error?.code === 4 && i < retries) {
      // Rate limit - wait and retry
      await new Promise(r => setTimeout(r, 60000));
      continue;
    }
    if (data.error) {
      throw new Error(data.error.message || 'Graph API error');
    }
    return data;
  }
}

// --- Helper: get account + decrypted token ---
async function getAccountWithToken(serviceClient: any, clientId: string) {
  const { data: account, error } = await serviceClient
    .from('instagram_accounts')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !account) throw new Error("Account not found");

  const accessToken = await decryptToken(account.encrypted_access_token);
  return { account, accessToken };
}

// --- Helper: get account by clientId (no token needed) ---
async function getAccount(serviceClient: any, clientId: string) {
  const { data: account, error } = await serviceClient
    .from('instagram_accounts')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (error || !account) throw new Error("Account not found");
  return account;
}

// --- Helper: verify that clientId belongs to contaId ---
async function verifyClientOwnership(serviceClient: any, clientId: string, contaId: string): Promise<void> {
  const { data: clientRow } = await serviceClient
    .from('clientes')
    .select('conta_id')
    .eq('id', clientId)
    .single();
  if (!clientRow || clientRow.conta_id !== contaId) {
    throw new Error('Unauthorized');
  }
}

// --- Helper: verify that a post's account belongs to contaId ---
async function verifyPostOwnership(serviceClient: any, postId: string, contaId: string): Promise<void> {
  const { data: post } = await serviceClient
    .from('instagram_posts')
    .select('instagram_account_id, instagram_accounts!inner(client_id, clientes!inner(conta_id))')
    .eq('id', parseInt(postId))
    .single();
  const postContaId = (post as any)?.instagram_accounts?.clientes?.conta_id;
  if (!post || postContaId !== contaId) {
    throw new Error('Unauthorized');
  }
}

// --- Fetch daily insights for a period ---
async function fetchDailyInsights(_igUserId: string, accessToken: string, since: number, until: number) {
  // Use /me and updated metrics (views replaces impressions, accounts_engaged replaces profile_views)
  const [reachRes, viewsRes, engagedRes] = await Promise.allSettled([
    graphFetch(`https://graph.instagram.com/${GRAPH_API_VERSION}/me/insights?metric=reach&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${accessToken}`),
    graphFetch(`https://graph.instagram.com/${GRAPH_API_VERSION}/me/insights?metric=views&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${accessToken}`),
    graphFetch(`https://graph.instagram.com/${GRAPH_API_VERSION}/me/insights?metric=accounts_engaged&metric_type=total_value&period=day&since=${since}&until=${until}&access_token=${accessToken}`),
  ]);

  const result: Record<string, number> = { reach: 0, impressions: 0, profile_views: 0 };
  if (reachRes.status === 'fulfilled' && reachRes.value?.data) {
    for (const insight of reachRes.value.data) if (insight.name === 'reach') result.reach = insight.total_value?.value || 0;
  }
  if (viewsRes.status === 'fulfilled' && viewsRes.value?.data) {
    for (const insight of viewsRes.value.data) if (insight.name === 'views') result.impressions = insight.total_value?.value || 0;
  }
  if (engagedRes.status === 'fulfilled' && engagedRes.value?.data) {
    for (const insight of engagedRes.value.data) if (insight.name === 'accounts_engaged') result.profile_views = insight.total_value?.value || 0;
  }
  return result;
}

// --- Main Handler ---
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace('/instagram-analytics', '');

  const authHeader = req.headers.get('Authorization');
  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader || '' } },
  });

  const corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    // Verify auth
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token || token === 'undefined' || token === 'null') {
      throw new Error("Unauthorized: No valid token provided");
    }

    const userRes = await supabaseClient.auth.getUser();
    const user = userRes.data?.user;
    if (userRes.error || !user) throw new Error("Unauthorized: Token verification failed");

    const serviceClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Get user's conta_id
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('conta_id')
      .eq('id', user.id)
      .single();
    const contaId = profile?.conta_id;
    if (!contaId) throw new Error("User profile not found");

    // ==========================================
    // GET /overview/:clientId?days=30
    // ==========================================
    if (req.method === 'GET' && path.match(/^\/overview\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '30') || 30;

      await verifyClientOwnership(serviceClient, clientId, contaId);
      const { account, accessToken } = await getAccountWithToken(serviceClient, clientId);

      const cacheKey = `overview_${days}`;
      const result = await getCachedOrFetch(serviceClient, account.id, cacheKey, async () => {
        const now = Math.floor(Date.now() / 1000);
        const periodStart = now - (days * 86400);
        const prevStart = periodStart - (days * 86400);

        // Current and previous period insights
        const [current, previous] = await Promise.all([
          fetchDailyInsights(account.instagram_user_id, accessToken, periodStart, now),
          fetchDailyInsights(account.instagram_user_id, accessToken, prevStart, periodStart),
        ]);

        // Follower delta from history
        const { data: followerHistory } = await serviceClient
          .from('instagram_follower_history')
          .select('date, follower_count')
          .eq('instagram_account_id', account.id)
          .gte('date', new Date(prevStart * 1000).toISOString().split('T')[0])
          .order('date', { ascending: true });

        const history = followerHistory || [];
        const periodStartDate = new Date(periodStart * 1000).toISOString().split('T')[0];

        const currentFollowers = history.filter((h: any) => h.date >= periodStartDate);
        const previousFollowers = history.filter((h: any) => h.date < periodStartDate);

        const followerDeltaCurrent = currentFollowers.length >= 2
          ? currentFollowers[currentFollowers.length - 1].follower_count - currentFollowers[0].follower_count
          : 0;
        const followerDeltaPrevious = previousFollowers.length >= 2
          ? previousFollowers[previousFollowers.length - 1].follower_count - previousFollowers[0].follower_count
          : 0;

        // Posts in current period for engagement rate and count
        const { data: currentPosts } = await serviceClient
          .from('instagram_posts')
          .select('likes, comments, saved, shares, reach')
          .eq('instagram_account_id', account.id)
          .gte('posted_at', new Date(periodStart * 1000).toISOString());

        const { data: previousPosts } = await serviceClient
          .from('instagram_posts')
          .select('likes, comments, saved, shares, reach')
          .eq('instagram_account_id', account.id)
          .gte('posted_at', new Date(prevStart * 1000).toISOString())
          .lt('posted_at', new Date(periodStart * 1000).toISOString());

        const calcEngagement = (posts: any[]) => {
          if (!posts || posts.length === 0) return 0;
          const totalInteractions = posts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0), 0);
          const totalReach = posts.reduce((s, p) => s + (p.reach || 0), 0);
          return totalReach > 0 ? (totalInteractions / totalReach) * 100 : 0;
        };

        const calcSavesRate = (posts: any[]) => {
          if (!posts || posts.length === 0) return 0;
          const totalSaves = posts.reduce((s, p) => s + (p.saved || 0), 0);
          const totalReach = posts.reduce((s, p) => s + (p.reach || 0), 0);
          return totalReach > 0 ? (totalSaves / totalReach) * 100 : 0;
        };

        const makeDelta = (curr: number, prev: number) => ({
          current: curr,
          previous: prev,
          delta: curr - prev,
          deltaPercent: prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : (curr > 0 ? 100 : 0),
          direction: curr > prev ? 'up' : curr < prev ? 'down' : 'stable',
        });

        return {
          followers: makeDelta(followerDeltaCurrent, followerDeltaPrevious),
          reach: makeDelta(current.reach, previous.reach),
          impressions: makeDelta(current.impressions, previous.impressions),
          profileViews: makeDelta(current.profile_views, previous.profile_views),
          engagement: makeDelta(calcEngagement(currentPosts || []), calcEngagement(previousPosts || [])),
          savesRate: makeDelta(calcSavesRate(currentPosts || []), calcSavesRate(previousPosts || [])),
          postsPublished: makeDelta((currentPosts || []).length, (previousPosts || []).length),
          followerCount: account.follower_count,
        };
      });

      return json(result);
    }

    // ==========================================
    // GET /demographics/:clientId
    // ==========================================
    if (req.method === 'GET' && path.match(/^\/demographics\/\d+$/)) {
      const clientId = path.split('/')[2];
      await verifyClientOwnership(serviceClient, clientId, contaId);
      const { account, accessToken } = await getAccountWithToken(serviceClient, clientId);

      const result = await getCachedOrFetch(serviceClient, account.id, 'demographics', async () => {
        console.log('[demographics] fetching for account', account.instagram_user_id);
        const baseUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value`;

        // Fetch all 3 breakdowns in parallel, tolerating individual failures
        const [ageGenderResult, cityResult, countryResult] = await Promise.allSettled([
          graphFetch(`${baseUrl}&breakdown=age,gender&access_token=${accessToken}`),
          graphFetch(`${baseUrl}&breakdown=city&access_token=${accessToken}`),
          graphFetch(`${baseUrl}&breakdown=country&access_token=${accessToken}`),
        ]);

        const ageGenderData = ageGenderResult.status === 'fulfilled' ? ageGenderResult.value : null;
        const cityData = cityResult.status === 'fulfilled' ? cityResult.value : null;
        const countryData = countryResult.status === 'fulfilled' ? countryResult.value : null;

        if (ageGenderResult.status === 'rejected') console.error('[demographics] age/gender failed:', ageGenderResult.reason);
        if (cityResult.status === 'rejected') console.error('[demographics] city failed:', cityResult.reason);
        if (countryResult.status === 'rejected') console.error('[demographics] country failed:', countryResult.reason);

        console.log('[demographics] ageGender results:', JSON.stringify(ageGenderData).slice(0, 300));
        console.log('[demographics] city results:', JSON.stringify(cityData).slice(0, 300));
        console.log('[demographics] country results:', JSON.stringify(countryData).slice(0, 300));

        // Parse age+gender into structured data
        const ageGenderRaw = ageGenderData?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
        const ageGenderMap: Record<string, { male: number; female: number; unknown: number }> = {};

        for (const item of ageGenderRaw) {
          const dims = item.dimension_values || [];
          const age = dims[0] || 'unknown';
          const gender = dims[1] || 'U';
          const value = item.value || 0;

          if (!ageGenderMap[age]) ageGenderMap[age] = { male: 0, female: 0, unknown: 0 };
          if (gender === 'M') ageGenderMap[age].male += value;
          else if (gender === 'F') ageGenderMap[age].female += value;
          else ageGenderMap[age].unknown += value;
        }

        const ageRanges = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
        const age_gender = ageRanges.map(range => ({
          age_range: range,
          male: ageGenderMap[range]?.male || 0,
          female: ageGenderMap[range]?.female || 0,
        }));

        // Parse cities
        const citiesRaw = cityData?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
        const cities = citiesRaw
          .map((c: any) => ({ name: c.dimension_values?.[0] || '', count: c.value || 0 }))
          .sort((a: any, b: any) => b.count - a.count)
          .slice(0, 10);

        // Parse countries
        const countriesRaw = countryData?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
        const countries = countriesRaw
          .map((c: any) => ({ code: c.dimension_values?.[0] || '', count: c.value || 0 }))
          .sort((a: any, b: any) => b.count - a.count)
          .slice(0, 5);

        // Gender totals
        const totalMale = age_gender.reduce((s, a) => s + a.male, 0);
        const totalFemale = age_gender.reduce((s, a) => s + a.female, 0);
        const totalGender = totalMale + totalFemale;

        // If all 3 calls failed, there's no usable data
        if (!ageGenderData && !cityData && !countryData) {
          throw new Error('All demographic API calls failed');
        }

        return {
          age_gender,
          cities,
          countries,
          gender_split: {
            male: totalGender > 0 ? Math.round((totalMale / totalGender) * 100) : 0,
            female: totalGender > 0 ? Math.round((totalFemale / totalGender) * 100) : 0,
          },
        };
      }, 24); // Cache demographics for 24 hours (changes slowly)

      return json(result);
    }

    // ==========================================
    // GET /best-times/:clientId
    // Analyzes actual post performance to find best posting times
    // ==========================================
    if (req.method === 'GET' && path.match(/^\/best-times\/\d+$/)) {
      const clientId = path.split('/')[2];
      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);

      const result = await getCachedOrFetch(serviceClient, account.id, 'best_times', async () => {
        console.log('[best-times] analyzing posts for account', account.id);

        // Fetch last 90 days of posts
        const sinceDate = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
        const { data: posts } = await serviceClient
          .from('instagram_posts')
          .select('posted_at, likes, comments, saved, shares, reach')
          .eq('instagram_account_id', account.id)
          .gte('posted_at', sinceDate);

        console.log('[best-times] found', posts?.length || 0, 'posts');

        // Build 7x24 heatmap of average engagement rate per slot
        const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
        const counts: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

        for (const p of (posts || [])) {
          const date = new Date(p.posted_at);
          const dayOfWeek = (date.getDay() + 6) % 7; // Monday=0
          const hour = date.getHours();
          const interactions = (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0);
          const engRate = p.reach > 0 ? (interactions / p.reach) * 100 : 0;
          heatmap[dayOfWeek][hour] += engRate;
          counts[dayOfWeek][hour] += 1;
        }

        // Average out
        for (let d = 0; d < 7; d++) {
          for (let h = 0; h < 24; h++) {
            heatmap[d][h] = counts[d][h] > 0 ? Math.round((heatmap[d][h] / counts[d][h]) * 100) / 100 : 0;
          }
        }

        // Find top 3 slots (only slots with posts)
        const slots: { day: number; hour: number; value: number; postCount: number }[] = [];
        for (let d = 0; d < 7; d++) {
          for (let h = 0; h < 24; h++) {
            if (counts[d][h] > 0) {
              slots.push({ day: d, hour: h, value: heatmap[d][h], postCount: counts[d][h] });
            }
          }
        }
        slots.sort((a, b) => b.value - a.value);
        const topSlots = slots.slice(0, 3);

        return {
          heatmap,
          counts,
          topSlots,
          totalPosts: (posts || []).length,
          labels_days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'],
          labels_hours: Array.from({ length: 24 }, (_, i) => `${i}h`),
        };
      }, 12);

      return json(result);
    }

    // ==========================================
    // GET /posts-analytics/:clientId?days=30&sort=engagement_rate
    // ==========================================
    if (req.method === 'GET' && path.match(/^\/posts-analytics\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '30') || 30;
      const sortBy = url.searchParams.get('sort') || 'posted_at';
      const rawDir = url.searchParams.get('dir') || 'desc';
      const sortDir = ['asc', 'desc'].includes(rawDir) ? rawDir : 'desc';

      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);

      const sinceDate = new Date(Date.now() - days * 86400000).toISOString();

      const { data: posts, error } = await serviceClient
        .from('instagram_posts')
        .select('*')
        .eq('instagram_account_id', account.id)
        .gte('posted_at', sinceDate)
        .order('posted_at', { ascending: false });

      if (error) throw error;

      // Get tag assignments for these posts
      const postIds = (posts || []).map((p: any) => p.id);
      let tagAssignments: any[] = [];
      if (postIds.length > 0) {
        const { data: assignments } = await serviceClient
          .from('instagram_post_tag_assignments')
          .select('post_id, tag_id, instagram_post_tags(id, tag_name, color)')
          .in('post_id', postIds);
        tagAssignments = assignments || [];
      }

      // Build tag map
      const tagMap: Record<number, any[]> = {};
      for (const a of tagAssignments) {
        if (!tagMap[a.post_id]) tagMap[a.post_id] = [];
        tagMap[a.post_id].push(a.instagram_post_tags);
      }

      // Compute engagement rate and saves rate per post
      const enrichedPosts = (posts || []).map((p: any) => {
        const interactions = (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0);
        const engRate = p.reach > 0 ? (interactions / p.reach) * 100 : 0;
        const savesRate = p.reach > 0 ? ((p.saved || 0) / p.reach) * 100 : 0;
        return {
          ...p,
          engagement_rate: Math.round(engRate * 100) / 100,
          saves_rate: Math.round(savesRate * 100) / 100,
          tags: tagMap[p.id] || [],
        };
      });

      // Sort
      const validSortCols = ['posted_at', 'reach', 'impressions', 'engagement_rate', 'saves_rate', 'saved', 'likes', 'comments', 'shares'];
      const col = validSortCols.includes(sortBy) ? sortBy : 'posted_at';
      enrichedPosts.sort((a: any, b: any) => {
        const va = a[col] ?? 0;
        const vb = b[col] ?? 0;
        return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
      });

      return json({
        posts: enrichedPosts,
        total: enrichedPosts.length,
        fromCache: false,
        fetchedAt: new Date().toISOString(),
      });
    }

    // ==========================================
    // GET /follower-history/:clientId?days=90
    // ==========================================
    if (req.method === 'GET' && path.match(/^\/follower-history\/\d+$/)) {
      const clientId = path.split('/')[2];
      const days = parseInt(url.searchParams.get('days') || '90') || 90;

      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);

      const sinceDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

      const { data: history } = await serviceClient
        .from('instagram_follower_history')
        .select('date, follower_count')
        .eq('instagram_account_id', account.id)
        .gte('date', sinceDate)
        .order('date', { ascending: true });

      // Get post dates for overlay markers
      const { data: postDates } = await serviceClient
        .from('instagram_posts')
        .select('posted_at, media_type')
        .eq('instagram_account_id', account.id)
        .gte('posted_at', new Date(Date.now() - days * 86400000).toISOString())
        .order('posted_at', { ascending: true });

      return json({
        history: history || [],
        postDates: (postDates || []).map((p: any) => ({
          date: p.posted_at.split('T')[0],
          media_type: p.media_type,
        })),
      });
    }

    // ==========================================
    // GET /portfolio
    // ==========================================
    if (req.method === 'GET' && path === '/portfolio') {
      // Get all clients for this conta_id with their Instagram accounts
      const { data: clients } = await serviceClient
        .from('clientes')
        .select('id, nome, sigla, cor, especialidade, status')
        .eq('conta_id', contaId)
        .eq('status', 'ativo');

      if (!clients || clients.length === 0) {
        return json({ accounts: [], summary: { total: 0, connected: 0, growing: 0, stagnant: 0, declining: 0 } });
      }

      const clientIds = clients.map((c: any) => c.id);

      const { data: igAccounts } = await serviceClient
        .from('instagram_accounts')
        .select('*')
        .in('client_id', clientIds);

      if (!igAccounts || igAccounts.length === 0) {
        return json({ accounts: [], summary: { total: clients.length, connected: 0, growing: 0, stagnant: 0, declining: 0 } });
      }

      // Get latest post date per account
      const accountIds = igAccounts.map((a: any) => a.id);
      const { data: latestPosts } = await serviceClient
        .from('instagram_posts')
        .select('instagram_account_id, posted_at')
        .in('instagram_account_id', accountIds)
        .order('posted_at', { ascending: false });

      const latestPostMap: Record<number, string> = {};
      for (const p of (latestPosts || [])) {
        if (!latestPostMap[p.instagram_account_id]) {
          latestPostMap[p.instagram_account_id] = p.posted_at;
        }
      }

      // Get post counts in last 30 days per account
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: recentPosts } = await serviceClient
        .from('instagram_posts')
        .select('instagram_account_id, likes, comments, saved, shares, reach')
        .in('instagram_account_id', accountIds)
        .gte('posted_at', thirtyDaysAgo);

      // Compute per-account stats
      const accountPostStats: Record<number, { count: number; engagement: number }> = {};
      for (const p of (recentPosts || [])) {
        if (!accountPostStats[p.instagram_account_id]) {
          accountPostStats[p.instagram_account_id] = { count: 0, engagement: 0 };
        }
        accountPostStats[p.instagram_account_id].count++;
        const interactions = (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0);
        const reach = p.reach || 0;
        if (reach > 0) {
          accountPostStats[p.instagram_account_id].engagement += (interactions / reach) * 100;
        }
      }

      // Get follower history for delta (30 days ago vs now)
      const { data: followerHist } = await serviceClient
        .from('instagram_follower_history')
        .select('instagram_account_id, date, follower_count')
        .in('instagram_account_id', accountIds)
        .gte('date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0])
        .order('date', { ascending: true });

      const followerDeltaMap: Record<number, number> = {};
      const followerByAccount: Record<number, any[]> = {};
      for (const f of (followerHist || [])) {
        if (!followerByAccount[f.instagram_account_id]) followerByAccount[f.instagram_account_id] = [];
        followerByAccount[f.instagram_account_id].push(f);
      }
      for (const [accId, entries] of Object.entries(followerByAccount)) {
        if (entries.length >= 2) {
          followerDeltaMap[Number(accId)] = entries[entries.length - 1].follower_count - entries[0].follower_count;
        }
      }

      const clientMap: Record<number, any> = {};
      for (const c of clients) clientMap[c.id] = c;

      let growing = 0, declining = 0, stagnant = 0;

      const accounts = igAccounts.map((a: any) => {
        const client = clientMap[a.client_id];
        const stats = accountPostStats[a.id] || { count: 0, engagement: 0 };
        const avgEngagement = stats.count > 0 ? Math.round((stats.engagement / stats.count) * 100) / 100 : 0;
        const delta = followerDeltaMap[a.id] || 0;

        if (delta > 0) growing++;
        else if (delta < 0) declining++;
        else stagnant++;

        return {
          client_id: a.client_id,
          client_name: client?.nome || '',
          client_sigla: client?.sigla || '',
          client_cor: client?.cor || '',
          client_especialidade: client?.especialidade || '',
          instagram_account_id: a.id,
          username: a.username,
          profile_picture_url: a.profile_picture_url,
          follower_count: a.follower_count || 0,
          follower_delta: delta,
          reach_28d: a.reach_28d || 0,
          impressions_28d: a.impressions_28d || 0,
          profile_views_28d: a.profile_views_28d || 0,
          media_count: a.media_count || 0,
          last_synced_at: a.last_synced_at,
          last_post_at: latestPostMap[a.id] || null,
          posts_last_30d: stats.count,
          engagement_rate_avg: avgEngagement,
        };
      });

      // Find best and most improved
      const bestByEngagement = [...accounts].sort((a, b) => b.engagement_rate_avg - a.engagement_rate_avg)[0] || null;
      const mostImproved = [...accounts].sort((a, b) => b.follower_delta - a.follower_delta)[0] || null;

      return json({
        accounts,
        summary: {
          total: clients.length,
          connected: igAccounts.length,
          growing,
          stagnant,
          declining,
          bestByEngagement: bestByEngagement ? { client_name: bestByEngagement.client_name, engagement_rate_avg: bestByEngagement.engagement_rate_avg } : null,
          mostImproved: mostImproved ? { client_name: mostImproved.client_name, follower_delta: mostImproved.follower_delta } : null,
        },
      });
    }

    // ==========================================
    // GET /tags
    // ==========================================
    if (req.method === 'GET' && path === '/tags') {
      const { data: tags } = await serviceClient
        .from('instagram_post_tags')
        .select('*')
        .eq('conta_id', contaId)
        .order('tag_name');

      return json({ tags: tags || [] });
    }

    // ==========================================
    // POST /tags
    // ==========================================
    if (req.method === 'POST' && path === '/tags') {
      const body = await req.json();
      const { tag_name, color } = body;
      if (!tag_name) throw new Error("tag_name is required");

      const { data: tag, error } = await serviceClient
        .from('instagram_post_tags')
        .insert({ conta_id: contaId, tag_name: tag_name.trim(), color: color || '#eab308' })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') throw new Error("Tag already exists");
        throw error;
      }
      return json({ tag }, 201);
    }

    // ==========================================
    // DELETE /tags/:tagId
    // ==========================================
    if (req.method === 'DELETE' && path.match(/^\/tags\/\d+$/)) {
      const tagId = path.split('/')[2];
      await serviceClient.from('instagram_post_tag_assignments').delete().eq('tag_id', tagId);
      await serviceClient.from('instagram_post_tags').delete().eq('id', tagId).eq('conta_id', contaId);
      return json({ success: true });
    }

    // ==========================================
    // POST /posts/:postId/tags
    // ==========================================
    if (req.method === 'POST' && path.match(/^\/posts\/\d+\/tags$/)) {
      const postId = path.split('/')[2];
      const body = await req.json();
      const { tag_id } = body;
      if (!tag_id) throw new Error("tag_id is required");

      await verifyPostOwnership(serviceClient, postId, contaId);
      const { error } = await serviceClient
        .from('instagram_post_tag_assignments')
        .insert({ post_id: parseInt(postId), tag_id })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') return json({ success: true }); // Already assigned
        throw error;
      }
      return json({ success: true }, 201);
    }

    // ==========================================
    // DELETE /posts/:postId/tags/:tagId
    // ==========================================
    if (req.method === 'DELETE' && path.match(/^\/posts\/\d+\/tags\/\d+$/)) {
      const parts = path.split('/');
      const postId = parts[2];
      const tagId = parts[4];
      await verifyPostOwnership(serviceClient, postId, contaId);
      await serviceClient
        .from('instagram_post_tag_assignments')
        .delete()
        .eq('post_id', postId)
        .eq('tag_id', tagId);
      return json({ success: true });
    }

    // ==========================================
    // GET /reports/:clientId
    // ==========================================
    if (req.method === 'GET' && path.match(/^\/reports\/\d+$/)) {
      const clientId = path.split('/')[2];
      const { data: reports } = await serviceClient
        .from('analytics_reports')
        .select('*')
        .eq('client_id', clientId)
        .eq('conta_id', contaId)
        .order('report_month', { ascending: false });

      return json({ reports: reports || [] });
    }

    // ==========================================
    // POST /generate-report/:clientId
    // ==========================================
    if (req.method === 'POST' && path.match(/^\/generate-report\/\d+$/)) {
      const clientId = path.split('/')[2];
      const body = await req.json().catch(() => ({}));

      // Default to previous month
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const month = body.month || `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
      const force = body.force === true;

      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);

      // Check if already exists (skip cache when force=true)
      const { data: existing } = await serviceClient
        .from('analytics_reports')
        .select('id, status, report_url')
        .eq('instagram_account_id', account.id)
        .eq('report_month', month)
        .single();

      if (!force && existing?.status === 'ready') {
        return json({ reportId: existing.id, status: 'ready', report_url: existing.report_url });
      }

      // Create or update report record
      const { data: report, error: reportError } = await serviceClient
        .from('analytics_reports')
        .upsert({
          conta_id: contaId,
          client_id: parseInt(clientId),
          instagram_account_id: account.id,
          report_month: month,
          status: 'generating',
          generated_at: new Date().toISOString(),
        }, { onConflict: 'instagram_account_id,report_month' })
        .select()
        .single();

      if (reportError) throw reportError;

      // Trigger report generation via the dedicated function
      const reportGenUrl = `${SUPABASE_URL}/functions/v1/instagram-report-generator/generate/${clientId}?month=${month}`;
      const genRes = await fetch(reportGenUrl, {
        method: 'POST',
        headers: {
          'X-Internal-Token': INTERNAL_FUNCTION_SECRET,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reportId: report.id }),
      });
      const genData = await genRes.json();

      if (!genRes.ok || genData.error) {
        // Mark as failed so it doesn't stay stuck
        await serviceClient.from('analytics_reports').update({ status: 'failed' }).eq('id', report.id);
        throw new Error(genData.message || 'Falha ao gerar relatório PDF');
      }

      if (genData.report_url) {
        return json({ reportId: report.id, status: 'ready', report_url: genData.report_url });
      }

      return json({ reportId: report.id, status: 'generating' });
    }

    // ==========================================
    // POST /ai-analysis/:clientId
    // ==========================================
    if (req.method === 'POST' && path.match(/^\/ai-analysis\/\d+$/)) {
      const clientId = path.split('/')[2];
      const body = await req.json().catch(() => ({}));

      // Verify account belongs to user's conta before fetching any data
      await verifyClientOwnership(serviceClient, clientId, contaId);
      const account = await getAccount(serviceClient, clientId);
      const { data: client } = await serviceClient
        .from('clientes')
        .select('nome, especialidade')
        .eq('id', clientId)
        .eq('conta_id', contaId)
        .single();
      if (!client) throw new Error("Client not found");

      // Gather data for AI
      const days = body.days || 30;
      const sinceDate = new Date(Date.now() - days * 86400000).toISOString();

      const [{ data: posts }, { data: history }] = await Promise.all([
        serviceClient.from('instagram_posts')
          .select('media_type, caption, likes, comments, saved, shares, reach, impressions, posted_at')
          .eq('instagram_account_id', account.id)
          .gte('posted_at', sinceDate)
          .order('posted_at', { ascending: false })
          .limit(50),
        serviceClient.from('instagram_follower_history')
          .select('date, follower_count')
          .eq('instagram_account_id', account.id)
          .order('date', { ascending: false })
          .limit(60),
      ]);

      const postsSummary = (posts || []).map(p => ({
        type: p.media_type,
        caption: (p.caption || '').slice(0, 120),
        likes: p.likes, comments: p.comments, saved: p.saved, shares: p.shares,
        reach: p.reach, date: p.posted_at?.split('T')[0],
        engRate: p.reach > 0 ? (((p.likes||0)+(p.comments||0)+(p.saved||0)+(p.shares||0)) / p.reach * 100).toFixed(2) + '%' : '0%',
      }));

      const followerTrend = (history || []).slice(0, 30).reverse();

      // --- Preparação dos dados antes de montar o prompt ---
      const hasFollowerHistory = followerTrend && followerTrend.length >= 2;

      const followerHistoryBlock = hasFollowerHistory
        ? `Histórico de seguidores (do mais antigo ao mais recente):
${JSON.stringify(followerTrend.map(h => ({ data: h.date, seguidores: h.follower_count })))}`
        : `Histórico de seguidores: INDISPONÍVEL. Apenas o valor atual é conhecido: ${account.follower_count} seguidores.`;

      // --- System Prompt ---
      const systemPrompt = `Você é um estrategista sênior de conteúdo para Instagram especializado em profissionais de saúde no Brasil. Seu trabalho é transformar dados em decisões — não em relatórios genéricos.

REGRAS DE ANÁLISE:
1. Nunca diga "poste mais Reels" ou "seja consistente" — isso é óbvio. Toda recomendação deve ser uma AÇÃO ESPECÍFICA com formato, tema e timing.
2. Quando identificar um post de alto desempenho, explique o MECANISMO por trás (ex: "o hook nos 3 primeiros segundos gerou retenção" ou "o CTA no meio da legenda converteu porque..."), não apenas "esse post foi bem".
3. Compare métricas entre si, não isoladamente. Taxa de engajamento SÓ faz sentido relativa ao número de seguidores e ao tipo de conteúdo.
4. Para a área de saúde, considere: restrições do CFM/CRO sobre publicidade, sazonalidade (Janeiro Branco, Outubro Rosa, etc.), e que o objetivo final quase sempre é agendamento de consulta, não viralizar.

FORMATO DE ESCRITA:
- SEMPRE use bullet points curtos e diretos em vez de parágrafos longos.
- Cada bullet deve ter no máximo 1-2 frases.
- CRÍTICO: Cada bullet point DEVE começar em uma NOVA LINHA com "• ". NUNCA junte múltiplos bullets na mesma linha separados por vírgula ou ponto.
- Priorize dados e ações concretas, elimine preâmbulos e explicações redundantes.
- Exemplo BOM:
"• Reels de 15s com hook de pergunta: 17% eng vs 4% média → replicar formato
• Carrosséis educativos têm 2x mais saves que imagens estáticas
• Melhor horário: terça e quinta entre 18h-20h"
- Exemplo RUIM: "• Reels de 15s com hook de pergunta: 17% eng vs 4% média → replicar formato,• Carrosséis educativos têm 2x mais saves,• Melhor horário: terça e quinta"
- NUNCA use ",•" ou ".," para separar bullets. Sempre use quebra de linha ("\n") antes de cada "•".

BENCHMARKS DE REFERÊNCIA (contas de saúde 5k-50k seguidores):
- Taxa de engajamento saudável: 3-6%
- Proporção ideal Reels/Carrossel/Imagem: 40/40/20
- Crescimento orgânico bom: 2-5% ao mês
- Alcance médio por post: 20-40% da base de seguidores
Ajuste esses benchmarks proporcionalmente se a conta estiver fora dessa faixa de seguidores.

DADOS INCOMPLETOS:
Nem sempre haverá histórico de seguidores. Quando o histórico estiver marcado como INDISPONÍVEL:
- Em growthAnalysis.trajectory: informe que não há dados suficientes para calcular taxa de crescimento. Avalie sinais indiretos (volume de curtidas recentes vs mais antigas, alcance relativo ao tamanho da base).
- Em growthAnalysis.projection: substitua a projeção numérica por uma estimativa qualitativa baseada nos sinais de engajamento disponíveis, deixando explícito que é uma leitura indireta.
- Em healthScore.breakdown.crescimento: atribua null em vez de uma nota inventada, e na justificativa escreva "sem dados de histórico para avaliar".
- NUNCA invente números de crescimento. É melhor dizer que o dado não existe do que fabricar uma tendência.`;

      // --- User Prompt ---
      const userPrompt = `Analise a conta @${account.username} do(a) ${client.nome} (${client.especialidade || 'especialidade não informada'}).

DADOS DOS ÚLTIMOS ${days} DIAS:

Seguidores atuais: ${account.follower_count}
Total de posts no período: ${postsSummary.length}

${followerHistoryBlock}

Posts do período (ordenados por engajamento):
${JSON.stringify(postsSummary)}

---

Responda APENAS com um JSON válido, sem markdown, sem comentários, sem texto fora do JSON. Não use aspas simples nem aspas duplas dentro dos valores de texto — use apenas apóstrofos se necessário.

{
  "performanceMap": {
    "topPerformer": "em 3-4 bullets curtos: qual post, métricas-chave, o MECANISMO (hook, formato, tema, horário), e 2 variações concretas para replicar",
    "worstPerformer": "em 3-4 bullets curtos: qual post, o problema principal (formato errado? legenda fraca? horário?), e como o mesmo tema performaria melhor com outra abordagem",
    "contentMix": "em 2-3 bullets: proporção atual vs benchmark, o que está sobrando e o que está faltando"
  },
  "captionDiagnostic": "em 3-4 bullets: padrão estrutural das 3 melhores legendas (ex: hook + storytelling + CTA) e um template prático de legenda no final",
  "growthAnalysis": {
    "trajectory": "em 2-3 bullets: taxa de crescimento real vs benchmark, classificação (acelerando/estável/desacelerando/queda). Se histórico INDISPONÍVEL, usar sinais indiretos e deixar explícito",
    "projection": "em 2-3 bullets: projeção 30d e 90d, e se o ritmo for ruim, qual taxa precisa atingir. Se histórico INDISPONÍVEL, estimativa qualitativa"
  },
  "healthScore": {
    "score": 0,
    "breakdown": {
      "engajamento": "nota 0-100 com justificativa de 1 frase comparando com benchmark",
      "crescimento": "nota 0-100 com justificativa de 1 frase OU null se histórico indisponível",
      "consistencia": "nota 0-100 baseada em frequência e regularidade de posts",
      "mixDeConteudo": "nota 0-100 baseada na diversidade de formatos"
    },
    "summary": "1 frase direta sobre a saúde geral da conta"
  },
  "actionPlan": [
    {
      "acao": "descrição específica da ação (ex: Criar um Reels de 15s com antes/depois de procedimento X usando áudio trending Y)",
      "porque": "qual métrica essa ação ataca e qual resultado esperado",
      "prioridade": "alta/media/baixa"
    }
  ]
}

O campo actionPlan deve ter entre 3 e 5 ações. Pelo menos 1 deve ser uma ação que o cliente provavelmente NUNCA tentou (ex: collab com outro profissional, série semanal temática, usar comentários como conteúdo, post respondendo dúvida real de paciente).`;

      const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
      });

      const aiData = await aiRes.json();

      if (!aiRes.ok) {
        const errMsg = aiData.error?.message || JSON.stringify(aiData).slice(0, 300);
        return json({ analysis: { error: true, raw: `Gemini API error: ${errMsg}` }, generatedAt: new Date().toISOString() });
      }

      const content = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parse JSON from response
      let analysis;
      try {
        if (typeof content === 'object' && content !== null) {
          analysis = content;
        } else {
          const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
          analysis = JSON.parse(jsonStr);
        }
      } catch (_e) {
        // If parse fails but content looks like JSON, try extracting the object
        try {
          const match = content.match(/\{[\s\S]*\}/);
          if (match) analysis = JSON.parse(match[0]);
          else analysis = { error: true, raw: content || 'Empty AI response' };
        } catch (_e2) {
          analysis = { error: true, raw: content || 'Empty AI response' };
        }
      }

      return json({ analysis, generatedAt: new Date().toISOString() });
    }

    // ==========================================
    // POST /ai-analysis-portfolio
    // ==========================================
    if (req.method === 'POST' && path === '/ai-analysis-portfolio') {
      // Get all accounts for this conta
      const { data: clients } = await serviceClient
        .from('clientes')
        .select('id, nome, especialidade')
        .eq('conta_id', contaId);

      if (!clients || clients.length === 0) {
        return json({ analysis: { error: true, raw: 'Nenhum cliente encontrado' } });
      }

      const clientIds = clients.map(c => c.id);
      const { data: accounts } = await serviceClient
        .from('instagram_accounts')
        .select('id, client_id, username, follower_count, profile_views_28d, reach_28d')
        .in('client_id', clientIds);

      if (!accounts || accounts.length === 0) {
        return json({ analysis: { error: true, raw: 'Nenhuma conta Instagram conectada' } });
      }

      // Get recent posts for all accounts
      const accountIds = accounts.map(a => a.id);
      const sinceDate = new Date(Date.now() - 30 * 86400000).toISOString();

      const [{ data: allPosts }, { data: allHistory }] = await Promise.all([
        serviceClient.from('instagram_posts')
          .select('instagram_account_id, media_type, likes, comments, saved, shares, reach, posted_at')
          .in('instagram_account_id', accountIds)
          .gte('posted_at', sinceDate),
        serviceClient.from('instagram_follower_history')
          .select('instagram_account_id, date, follower_count')
          .in('instagram_account_id', accountIds)
          .order('date', { ascending: false })
          .limit(accounts.length * 30),
      ]);

      // Build per-account summaries
      const accountSummaries = accounts.map(acc => {
        const client = clients.find(c => c.id === acc.client_id);
        const posts = (allPosts || []).filter(p => p.instagram_account_id === acc.id);
        const hist = (allHistory || []).filter(h => h.instagram_account_id === acc.id);
        const totalEng = posts.reduce((s, p) => {
          const interactions = (p.likes||0)+(p.comments||0)+(p.saved||0)+(p.shares||0);
          return s + (p.reach > 0 ? interactions / p.reach * 100 : 0);
        }, 0);
        const avgEng = posts.length > 0 ? (totalEng / posts.length).toFixed(2) : '0';
        const lastPost = posts.length > 0 ? posts.sort((a,b) => b.posted_at.localeCompare(a.posted_at))[0].posted_at.split('T')[0] : null;
        const followerDelta = hist.length >= 2 ? hist[0].follower_count - hist[hist.length - 1].follower_count : 0;

        return {
          name: client?.nome, specialty: client?.especialidade, username: acc.username,
          followers: acc.follower_count, reach28d: acc.reach_28d || 0,
          posts30d: posts.length, avgEngagement: avgEng + '%',
          lastPost, followerDelta,
        };
      });

      const portfolioSystemPrompt = `Você é um estrategista sênior de conteúdo para Instagram especializado em profissionais de saúde no Brasil. Você gerencia múltiplas contas e seu trabalho é fazer análise comparativa do portfólio — identificando padrões cruzados, oportunidades de aprendizado entre contas, e priorizando onde investir esforço.

REGRAS DE ANÁLISE:
1. Nunca dê conselhos genéricos como "poste mais" ou "seja consistente". Toda recomendação deve ser uma AÇÃO ESPECÍFICA vinculada a uma conta e uma métrica.
2. Compare contas entre si: quem está crescendo mais rápido, quem tem melhor engajamento relativo ao tamanho, quem está estagnado.
3. Identifique padrões transferíveis: se uma conta tem engajamento alto com um formato, explique como outra conta do portfólio poderia adaptar isso.
4. Para a área de saúde, considere: restrições do CFM/CRO, sazonalidade, e que o objetivo final é agendamento de consulta.

FORMATO DE ESCRITA:
- SEMPRE use bullet points curtos e diretos em vez de parágrafos longos.
- Cada bullet deve ter no máximo 1-2 frases.
- Priorize dados e ações concretas, elimine preâmbulos e explicações redundantes.

BENCHMARKS DE REFERÊNCIA (contas de saúde 5k-50k seguidores):
- Taxa de engajamento saudável: 3-6%
- Crescimento orgânico bom: 2-5% ao mês
- Alcance médio por post: 20-40% da base de seguidores
Ajuste proporcionalmente para contas fora dessa faixa.

DADOS INCOMPLETOS:
- Se followerDelta for 0, pode significar dados insuficientes — não assuma estagnação sem outros sinais.
- NUNCA invente números. Se um dado não existe, diga explicitamente.`;

      const portfolioUserPrompt = `Analise o portfólio de ${accounts.length} contas Instagram:

${JSON.stringify(accountSummaries, null, 1)}

---

Responda APENAS com um JSON válido, sem markdown, sem comentários. Não use aspas simples nem aspas duplas dentro dos valores de texto.

{
  "portfolioHealth": {
    "score": 0,
    "summary": "1 frase sobre a saúde geral do portfólio"
  },
  "accountRanking": [
    {
      "username": "@conta",
      "status": "destaque/estável/atenção/crítico",
      "keyMetric": "a métrica mais relevante pra essa conta agora e por quê"
    }
  ],
  "crossAccountInsights": "em 3-4 bullets: padrões que funcionam em uma conta e podem ser replicados em outras — cite contas e formatos específicos",
  "resourceAllocation": "em 2-3 bullets: onde concentrar esforço esse mês, quais contas precisam de atenção e quais estão no piloto automático",
  "priorityActions": [
    {
      "conta": "@username",
      "acao": "ação específica com formato, tema e timing",
      "impacto": "qual métrica melhora e resultado esperado",
      "prioridade": "alta/media/baixa"
    }
  ],
  "monthlyDigest": "em 3-4 bullets: resumo comparativo do mês com dados concretos"
}

O campo priorityActions deve ter entre 3 e 5 ações distribuídas entre as contas. O accountRanking deve listar todas as contas.`;

      const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: portfolioSystemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: portfolioUserPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
      });

      const aiData = await aiRes.json();
      const content = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let analysis;
      try {
        if (typeof content === 'object' && content !== null) {
          analysis = content;
        } else {
          const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
          analysis = JSON.parse(jsonStr);
        }
      } catch (_e) {
        try {
          const match = content.match(/\{[\s\S]*\}/);
          if (match) analysis = JSON.parse(match[0]);
          else analysis = { error: true, raw: content };
        } catch (_e2) {
          analysis = { error: true, raw: content };
        }
      }

      return json({ analysis, generatedAt: new Date().toISOString() });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });

  } catch (err: any) {
    console.error('[instagram-analytics] ERROR on path:', new URL(req.url).pathname, '—', err.message || err, err.stack || '');
    const isAuthError = err.message?.includes("Unauthorized");
    const isTokenExpired = err.code === 'TOKEN_EXPIRED' || err.message?.includes("expired");
    const statusCode = (isAuthError || isTokenExpired) ? 401 : 400;

    return json({
      error: true,
      message: err.message || 'Unknown error',
      code: isTokenExpired ? 'TOKEN_EXPIRED' : undefined,
    }, statusCode);
  }
});
