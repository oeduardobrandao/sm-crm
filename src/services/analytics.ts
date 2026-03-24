// =============================================
// Mesaas - Analytics Service
// Direct Supabase queries for DB-resident data.
// Edge function calls only for Instagram API data.
// =============================================
import { supabase, getCurrentProfile } from '../lib/supabase';

const EDGE_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/instagram-analytics';

// ---- Edge function helper (for demographics/online-followers only) ----

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json'
  };
}

async function fetchEdge<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const headers = await getAuthHeaders();
    console.log('[fetchEdge] auth:', headers.Authorization?.slice(0, 20) + '...', 'method:', options?.method || 'GET');
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      console.error(`[fetchEdge] ${res.status} ${res.statusText} — ${url}`);
      const text = await res.text().catch(() => '');
      console.error(`[fetchEdge] body:`, text);
      return null;
    }
    return res.json();
  } catch (_e) {
    console.error(`[fetchEdge] exception:`, _e);
    return null;
  }
}

// ---- Helpers ----

async function getContaId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile?.conta_id) throw new Error('Conta não encontrada');
  return profile.conta_id;
}

async function getAccountByClientId(clientId: number) {
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select('*')
    .eq('client_id', clientId)
    .single();
  if (error || !data) throw new Error('Conta Instagram não encontrada');
  return data;
}

function makeDelta(current: number, previous: number): KpiDelta {
  return {
    current,
    previous,
    delta: current - previous,
    deltaPercent: previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : (current > 0 ? 100 : 0),
    direction: current > previous ? 'up' : current < previous ? 'down' : 'stable',
  };
}

// ---- Types ----

export interface KpiDelta {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number;
  direction: 'up' | 'down' | 'stable';
}

export interface AnalyticsOverview {
  data: {
    followers: KpiDelta;
    reach: KpiDelta;
    impressions: KpiDelta;
    profileViews: KpiDelta;
    websiteClicks: KpiDelta;
    engagement: KpiDelta;
    savesRate: KpiDelta;
    postsPublished: KpiDelta;
    followerCount: number;
  };
  fromCache: boolean;
  fetchedAt: string;
}

export interface PostAnalytics {
  id: number;
  instagram_post_id: string;
  caption: string;
  media_type: string;
  permalink: string;
  posted_at: string;
  likes: number;
  comments: number;
  reach: number;
  impressions: number;
  saved: number;
  shares: number;
  thumbnail_url: string | null;
  engagement_rate: number;
  saves_rate: number;
  tags: PostTag[];
}

export interface AudienceDemographics {
  age_gender: { age_range: string; male: number; female: number }[];
  cities: { name: string; count: number }[];
  countries: { code: string; count: number }[];
  gender_split: { male: number; female: number };
}

export interface BestPostingTimes {
  heatmap: number[][];
  counts: number[][];
  topSlots: { day: number; hour: number; value: number; postCount: number }[];
  totalPosts: number;
  labels_days: string[];
  labels_hours: string[];
}

export interface PortfolioAccount {
  client_id: number;
  client_name: string;
  client_sigla: string;
  client_cor: string;
  client_especialidade: string;
  instagram_account_id: number;
  username: string;
  profile_picture_url: string;
  follower_count: number;
  follower_delta: number;
  reach_28d: number;
  impressions_28d: number;
  profile_views_28d: number;
  website_clicks_28d: number;
  media_count: number;
  last_synced_at: string;
  last_post_at: string | null;
  posts_last_30d: number;
  engagement_rate_avg: number;
}

export interface PortfolioSummary {
  accounts: PortfolioAccount[];
  summary: {
    total: number;
    connected: number;
    growing: number;
    stagnant: number;
    declining: number;
    bestByEngagement: { client_name: string; engagement_rate_avg: number } | null;
    mostImproved: { client_name: string; follower_delta: number } | null;
  };
}

export interface PostTag {
  id: number;
  tag_name: string;
  color: string;
}

export interface FollowerHistory {
  history: { date: string; follower_count: number; source: string }[];
  postDates: { date: string; media_type: string }[];
}

export interface AnalyticsReport {
  id: number;
  report_month: string;
  report_url: string | null;
  storage_path: string | null;
  status: string;
  generated_at: string;
}

// ---- Service Functions (Direct Supabase Queries) ----

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  // Get active clients — use RLS-filtered query (same pattern as store.ts getClientes)
  const { data: allClients, error: clientsError } = await supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false });

  if (clientsError) {
    console.error('Analytics: Error fetching clients:', clientsError);
    return { accounts: [], summary: { total: 0, connected: 0, growing: 0, stagnant: 0, declining: 0, bestByEngagement: null, mostImproved: null } };
  }

  const clients = (allClients || []).filter(c => c.status === 'ativo');

  if (clients.length === 0) {
    return { accounts: [], summary: { total: 0, connected: 0, growing: 0, stagnant: 0, declining: 0, bestByEngagement: null, mostImproved: null } };
  }

  const clientIds = clients.map(c => c.id);

  // Get connected Instagram accounts
  const { data: igAccounts, error: igError } = await supabase
    .from('instagram_accounts')
    .select('*')
    .in('client_id', clientIds);

  if (igError) console.error('Analytics: Error fetching IG accounts:', igError);

  if (!igAccounts || igAccounts.length === 0) {
    return { accounts: [], summary: { total: clients.length, connected: 0, growing: 0, stagnant: 0, declining: 0, bestByEngagement: null, mostImproved: null } };
  }

  const accountIds = igAccounts.map(a => a.id);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Get latest post per account + recent posts for engagement
  const { data: allRecentPosts } = await supabase
    .from('instagram_posts')
    .select('instagram_account_id, posted_at, likes, comments, saved, shares, reach')
    .in('instagram_account_id', accountIds)
    .gte('posted_at', thirtyDaysAgo);

  // Get follower history for delta
  const { data: followerHist } = await supabase
    .from('instagram_follower_history')
    .select('instagram_account_id, date, follower_count')
    .in('instagram_account_id', accountIds)
    .gte('date', new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0])
    .order('date', { ascending: true });

  // Get latest post date per account (from all posts, not just recent)
  const { data: latestPosts } = await supabase
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

  // Aggregate post stats per account
  const accountPostStats: Record<number, { count: number; engagement: number }> = {};
  for (const p of (allRecentPosts || [])) {
    if (!accountPostStats[p.instagram_account_id]) accountPostStats[p.instagram_account_id] = { count: 0, engagement: 0 };
    accountPostStats[p.instagram_account_id].count++;
    const interactions = (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0);
    if (p.reach > 0) accountPostStats[p.instagram_account_id].engagement += (interactions / p.reach) * 100;
  }

  // Follower deltas
  const followerByAccount: Record<number, any[]> = {};
  for (const f of (followerHist || [])) {
    if (!followerByAccount[f.instagram_account_id]) followerByAccount[f.instagram_account_id] = [];
    followerByAccount[f.instagram_account_id].push(f);
  }
  const followerDeltaMap: Record<number, number> = {};
  for (const [accId, entries] of Object.entries(followerByAccount)) {
    if (entries.length >= 2) {
      followerDeltaMap[Number(accId)] = entries[entries.length - 1].follower_count - entries[0].follower_count;
    }
  }

  const clientMap: Record<number, any> = {};
  for (const c of clients) clientMap[c.id] = c;

  let growing = 0, declining = 0, stagnant = 0;

  const accounts: PortfolioAccount[] = igAccounts.map(a => {
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
      username: a.username || '',
      profile_picture_url: a.profile_picture_url || '',
      follower_count: a.follower_count || 0,
      follower_delta: delta,
      reach_28d: a.reach_28d || 0,
      impressions_28d: a.impressions_28d || 0,
      profile_views_28d: a.profile_views_28d || 0,
      website_clicks_28d: a.website_clicks_28d || 0,
      media_count: a.media_count || 0,
      last_synced_at: a.last_synced_at || '',
      last_post_at: latestPostMap[a.id] || null,
      posts_last_30d: stats.count,
      engagement_rate_avg: avgEngagement,
    };
  });

  const bestByEngagement = [...accounts].sort((a, b) => b.engagement_rate_avg - a.engagement_rate_avg)[0] || null;
  const mostImproved = [...accounts].sort((a, b) => b.follower_delta - a.follower_delta)[0] || null;

  return {
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
  };
}

export async function getAnalyticsOverview(clientId: number, days = 30, dateRange?: { start: string; end: string }): Promise<AnalyticsOverview> {
  const account = await getAccountByClientId(clientId);

  let periodStart: string;
  let periodEnd: string | undefined;
  let prevStart: string;

  if (dateRange) {
    // Fixed date range mode (e.g. "último mês")
    periodStart = new Date(dateRange.start).toISOString();
    periodEnd = new Date(dateRange.end + 'T23:59:59.999Z').toISOString();
    const rangeMs = new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime();
    prevStart = new Date(new Date(dateRange.start).getTime() - rangeMs).toISOString();
  } else {
    const now = Date.now();
    periodStart = new Date(now - days * 86400000).toISOString();
    prevStart = new Date(now - days * 2 * 86400000).toISOString();
  }

  // Posts for current and previous periods + follower history — all in parallel
  const currentPostsQuery = supabase
    .from('instagram_posts')
    .select('likes, comments, saved, shares, reach')
    .eq('instagram_account_id', account.id)
    .gte('posted_at', periodStart);
  if (periodEnd) currentPostsQuery.lte('posted_at', periodEnd);

  const followerHistoryStart = dateRange
    ? new Date(new Date(dateRange.start).getTime() - (new Date(dateRange.end).getTime() - new Date(dateRange.start).getTime())).toISOString().split('T')[0]
    : new Date(Date.now() - days * 2 * 86400000).toISOString().split('T')[0];

  const [{ data: currentPosts }, { data: previousPosts }, { data: followerHistory }] = await Promise.all([
    currentPostsQuery,
    supabase
      .from('instagram_posts')
      .select('likes, comments, saved, shares, reach')
      .eq('instagram_account_id', account.id)
      .gte('posted_at', prevStart)
      .lt('posted_at', periodStart),
    supabase
      .from('instagram_follower_history')
      .select('date, follower_count')
      .eq('instagram_account_id', account.id)
      .gte('date', followerHistoryStart)
      .order('date', { ascending: true }),
  ]);

  const history = followerHistory || [];
  const periodStartDate = dateRange ? dateRange.start : new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const currentFollowers = history.filter(h => h.date >= periodStartDate);
  const previousFollowers = history.filter(h => h.date < periodStartDate);

  const followerDeltaCurrent = currentFollowers.length >= 2
    ? currentFollowers[currentFollowers.length - 1].follower_count - currentFollowers[0].follower_count
    : 0;
  const followerDeltaPrevious = previousFollowers.length >= 2
    ? previousFollowers[previousFollowers.length - 1].follower_count - previousFollowers[0].follower_count
    : 0;

  const calcEngagement = (posts: any[]) => {
    if (!posts || posts.length === 0) return 0;
    const totalInteractions = posts.reduce((s: number, p: any) => s + (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0), 0);
    const totalReach = posts.reduce((s: number, p: any) => s + (p.reach || 0), 0);
    return totalReach > 0 ? (totalInteractions / totalReach) * 100 : 0;
  };

  const calcSavesRate = (posts: any[]) => {
    if (!posts || posts.length === 0) return 0;
    const totalSaves = posts.reduce((s: number, p: any) => s + (p.saved || 0), 0);
    const totalReach = posts.reduce((s: number, p: any) => s + (p.reach || 0), 0);
    return totalReach > 0 ? (totalSaves / totalReach) * 100 : 0;
  };

  const cp = currentPosts || [];
  const pp = previousPosts || [];

  const currentReach = cp.reduce((s: number, p: any) => s + (p.reach || 0), 0);
  const previousReach = pp.reduce((s: number, p: any) => s + (p.reach || 0), 0);

  return {
    data: {
      followers: makeDelta(followerDeltaCurrent, followerDeltaPrevious),
      reach: makeDelta(currentReach, previousReach),
      impressions: makeDelta(
        cp.reduce((s: number, p: any) => s + (p.impressions || 0), 0),
        pp.reduce((s: number, p: any) => s + (p.impressions || 0), 0)
      ),
      profileViews: makeDelta(account.profile_views_28d || 0, 0), // No previous period data stored
      websiteClicks: makeDelta(account.website_clicks_28d || 0, 0),
      engagement: makeDelta(calcEngagement(cp), calcEngagement(pp)),
      savesRate: makeDelta(calcSavesRate(cp), calcSavesRate(pp)),
      postsPublished: makeDelta(cp.length, pp.length),
      followerCount: account.follower_count || 0,
    },
    fromCache: false,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getPostsAnalytics(clientId: number, days = 30, sort = 'posted_at', dir = 'desc', dateRange?: { start: string; end: string }): Promise<{ posts: PostAnalytics[]; total: number }> {
  const account = await getAccountByClientId(clientId);

  const query = supabase
    .from('instagram_posts')
    .select('*')
    .eq('instagram_account_id', account.id)
    .gte('posted_at', dateRange ? new Date(dateRange.start).toISOString() : new Date(Date.now() - days * 86400000).toISOString())
    .order('posted_at', { ascending: false });
  if (dateRange) query.lte('posted_at', new Date(dateRange.end + 'T23:59:59.999Z').toISOString());

  const { data: posts, error } = await query;

  if (error) throw error;
  const allPosts = posts || [];

  // Get tag assignments
  const postIds = allPosts.map(p => p.id);
  let tagMap: Record<number, PostTag[]> = {};

  if (postIds.length > 0) {
    try {
      const { data: assignments } = await supabase
        .from('instagram_post_tag_assignments')
        .select('post_id, tag_id, instagram_post_tags(id, tag_name, color)')
        .in('post_id', postIds);

      for (const a of (assignments || [])) {
        if (!tagMap[a.post_id]) tagMap[a.post_id] = [];
        if (a.instagram_post_tags) tagMap[a.post_id].push(a.instagram_post_tags as any);
      }
    } catch (_e) {
      // Tag tables may not exist yet — posts still load without tags
    }
  }

  // Compute engagement + sort
  const enriched: PostAnalytics[] = allPosts.map(p => {
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

  const validCols = ['posted_at', 'reach', 'impressions', 'engagement_rate', 'saves_rate', 'saved', 'likes', 'comments', 'shares'];
  const col = validCols.includes(sort) ? sort : 'posted_at';
  enriched.sort((a: any, b: any) => {
    const va = a[col] ?? 0;
    const vb = b[col] ?? 0;
    return dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  return { posts: enriched, total: enriched.length };
}

export async function getFollowerHistory(clientId: number, days = 90, dateRange?: { start: string; end: string }): Promise<FollowerHistory> {
  const account = await getAccountByClientId(clientId);
  const sinceDate = dateRange ? dateRange.start : new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  const historyQuery = supabase
    .from('instagram_follower_history')
    .select('date, follower_count, source')
    .eq('instagram_account_id', account.id)
    .gte('date', sinceDate)
    .order('date', { ascending: true });
  if (dateRange) historyQuery.lte('date', dateRange.end);

  const postsQuery = supabase
    .from('instagram_posts')
    .select('posted_at, media_type')
    .eq('instagram_account_id', account.id)
    .gte('posted_at', dateRange ? new Date(dateRange.start).toISOString() : new Date(Date.now() - days * 86400000).toISOString())
    .order('posted_at', { ascending: true });
  if (dateRange) postsQuery.lte('posted_at', new Date(dateRange.end + 'T23:59:59.999Z').toISOString());

  const [{ data: history }, { data: postDates }] = await Promise.all([historyQuery, postsQuery]);

  return {
    history: history || [],
    postDates: (postDates || []).map(p => ({
      date: p.posted_at.split('T')[0],
      media_type: p.media_type,
    })),
  };
}

// Demographics and online-followers: try edge function, return null if unavailable
export async function getAudienceDemographics(clientId: number): Promise<{ data: AudienceDemographics; fromCache: boolean; fetchedAt: string } | null> {
  return fetchEdge(`${EDGE_URL}/demographics/${clientId}`);
}

export async function getBestPostingTimes(clientId: number): Promise<{ data: BestPostingTimes; fromCache: boolean; fetchedAt: string } | null> {
  return fetchEdge(`${EDGE_URL}/best-times/${clientId}`);
}

// ---- AI Analysis ----

export interface AccountAIAnalysis {
  contentInsights: string;
  captionAnalysis: string;
  growthForecast: string;
  healthScore: number;
  healthExplanation: string;
  topRecommendations: string[];
  error?: boolean;
  raw?: string;
}

export interface PortfolioAIAnalysis {
  portfolioSummary: string;
  crossAccountInsights: string;
  priorityActions: string[];
  monthlyDigest: string;
  error?: boolean;
  raw?: string;
}

export async function getAccountAIAnalysis(clientId: number, days = 30): Promise<{ analysis: AccountAIAnalysis; generatedAt: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}/ai-analysis/${clientId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ days }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `Error ${res.status}`);
  }
  return res.json();
}

export async function getPortfolioAIAnalysis(): Promise<{ analysis: PortfolioAIAnalysis; generatedAt: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}/ai-analysis-portfolio`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `Error ${res.status}`);
  }
  return res.json();
}

// ---- Tags (Direct Supabase CRUD) ----

export async function getTags(): Promise<PostTag[]> {
  try {
    const contaId = await getContaId();
    const { data, error } = await supabase
      .from('instagram_post_tags')
      .select('id, tag_name, color')
      .eq('conta_id', contaId)
      .order('tag_name');

    if (error) return []; // Table may not exist yet
    return data || [];
  } catch (_e) {
    return [];
  }
}

export async function createTag(tag_name: string, color = '#eab308'): Promise<PostTag> {
  const contaId = await getContaId();
  const { data, error } = await supabase
    .from('instagram_post_tags')
    .insert({ conta_id: contaId, tag_name: tag_name.trim(), color })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Tag já existe');
    if (error.code === '42P01') throw new Error('Tabela de tags não encontrada. Execute a migração do banco de dados.');
    throw error;
  }
  return data;
}

export async function deleteTag(tagId: number): Promise<void> {
  try {
    await supabase.from('instagram_post_tag_assignments').delete().eq('tag_id', tagId);
  } catch (_e) { /* table may not exist */ }
  const { error } = await supabase.from('instagram_post_tags').delete().eq('id', tagId);
  if (error) throw error;
}

export async function assignTagToPost(postId: number, tagId: number): Promise<void> {
  const { error } = await supabase
    .from('instagram_post_tag_assignments')
    .insert({ post_id: postId, tag_id: tagId });

  if (error && error.code !== '23505' && error.code !== '42P01') throw error;
}

export async function removeTagFromPost(postId: number, tagId: number): Promise<void> {
  const { error } = await supabase
    .from('instagram_post_tag_assignments')
    .delete()
    .eq('post_id', postId)
    .eq('tag_id', tagId);

  if (error && error.code !== '42P01') throw error;
}

// ---- Reports ----

export async function generateReport(clientId: number, month?: string): Promise<{ reportId: number; status: string; report_url?: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_URL}/generate-report/${clientId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ month, force: true }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.message || `Erro ao gerar relatório (${res.status})`);
  }
  if (!data) {
    throw new Error('Resposta inválida do servidor');
  }
  return data;
}

export async function upsertManualFollowerCount(clientId: number, date: string, followerCount: number): Promise<void> {
  const account = await getAccountByClientId(clientId);
  const { error } = await supabase
    .from('instagram_follower_history')
    .upsert({
      instagram_account_id: account.id,
      date,
      follower_count: followerCount,
      source: 'manual',
    }, { onConflict: 'instagram_account_id,date' });
  if (error) throw new Error(error.message);
}

export async function getClientReports(clientId: number): Promise<AnalyticsReport[]> {
  try {
    const contaId = await getContaId();
    const { data, error } = await supabase
      .from('analytics_reports')
      .select('*')
      .eq('client_id', clientId)
      .eq('conta_id', contaId)
      .order('report_month', { ascending: false });

    if (error) return []; // Table may not exist yet
    return data || [];
  } catch (_e) {
    return [];
  }
}
