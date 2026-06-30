// Client health monitor data service. Calls the get_client_health_aggregates RPC
// (server-side aggregation) and maps each row through the pure scorer.
import { supabase } from '../lib/supabase';
import { scoreClient, type HealthStatus } from '../lib/health/score';

export interface ClientHealth {
  client_id: number;
  client_name: string;
  client_sigla: string;
  client_cor: string;
  username: string | null;
  profile_picture_url: string | null;
  connected: boolean;
  follower_count: number;
  follower_delta: number; // absolute
  follower_delta_pct: number; // percent (drives scoring)
  follower_series: number[];
  engagement_rate: number; // %
  reach_28d: number;
  reach_trend_pct: number;
  days_since_last_post: number | null;
  pipeline: { agendados: number; em_producao: number; agente: number; falha: number };
  authorization_status: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  status: HealthStatus;
  score: number | null;
}

export interface ClientHealthSummary {
  total: number;
  atencao: number;
  saudaveis: number;
  estaveis: number;
  conexao: number;
  precisamAtencao: number;
}

export interface ClientHealthMonitorResult {
  clients: ClientHealth[];
  summary: ClientHealthSummary;
}

interface AggRow {
  client_id: number;
  client_name: string;
  client_sigla: string;
  client_cor: string;
  connected: boolean;
  username: string | null;
  profile_picture_url: string | null;
  follower_count: number;
  authorization_status: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  follower_first: number;
  follower_points: number;
  follower_series: number[];
  interactions_cur: number;
  reach_cur: number;
  posts_cur: number;
  reach_prev: number;
  posts_56d: number;
  last_post_at: string | null;
  pl_agendados: number;
  pl_em_producao: number;
  pl_agente: number;
  pl_falha: number;
}

const EMPTY_SUMMARY: ClientHealthSummary = {
  total: 0,
  atencao: 0,
  saudaveis: 0,
  estaveis: 0,
  conexao: 0,
  precisamAtencao: 0,
};

export function downsample(series: number[], max: number): number[] {
  if (series.length <= max) return series;
  const out: number[] = [];
  const step = (series.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(series[Math.round(i * step)]);
  return out;
}

function mapRow(r: AggRow, nowMs: number): ClientHealth {
  const follower_delta = r.follower_points >= 2 ? r.follower_count - r.follower_first : 0;
  const follower_delta_pct =
    r.follower_first > 0 ? (follower_delta / r.follower_first) * 100 : follower_delta > 0 ? 100 : 0;
  const engagement_rate = r.reach_cur > 0 ? (r.interactions_cur / r.reach_cur) * 100 : 0;
  const reach_trend_pct =
    r.reach_prev > 0
      ? ((r.reach_cur - r.reach_prev) / r.reach_prev) * 100
      : r.reach_cur > 0
        ? 100
        : 0;
  const days_since_last_post = r.last_post_at
    ? Math.floor((nowMs - Date.parse(r.last_post_at)) / 86400000)
    : null;
  const hasMinimumData = r.posts_56d > 0 || r.follower_points >= 2;
  const pipelineActive = r.pl_agendados + r.pl_em_producao > 0;

  const { status, score } = scoreClient({
    connected: r.connected,
    authorizationStatus: r.authorization_status,
    tokenExpiresAt: r.token_expires_at,
    lastSyncedAt: r.last_synced_at,
    followerDeltaPct: follower_delta_pct,
    engagementRate: engagement_rate,
    reachTrendPct: reach_trend_pct,
    daysSinceLastPost: days_since_last_post,
    hasMinimumData,
    pipelineActive,
    nowMs,
  });

  return {
    client_id: r.client_id,
    client_name: r.client_name,
    client_sigla: r.client_sigla,
    client_cor: r.client_cor,
    username: r.username,
    profile_picture_url: r.profile_picture_url,
    connected: r.connected,
    follower_count: r.follower_count,
    follower_delta,
    follower_delta_pct,
    follower_series: downsample(r.follower_series ?? [], 12),
    engagement_rate: Math.round(engagement_rate * 100) / 100,
    reach_28d: r.reach_cur,
    reach_trend_pct: Math.round(reach_trend_pct * 10) / 10,
    days_since_last_post,
    pipeline: {
      agendados: r.pl_agendados,
      em_producao: r.pl_em_producao,
      agente: r.pl_agente,
      falha: r.pl_falha,
    },
    authorization_status: r.authorization_status,
    token_expires_at: r.token_expires_at,
    last_synced_at: r.last_synced_at,
    status,
    score,
  };
}

const ATENCAO: HealthStatus[] = ['em_queda', 'atencao', 'inativo'];
const SAUDAVEIS: HealthStatus[] = ['em_alta', 'saudavel'];
const CONEXAO: HealthStatus[] = [
  'desconectado',
  'reconectar',
  'sem_sincronizar',
  'sincronizando',
  'sem_dados',
];
const PRECISAM: HealthStatus[] = [
  'em_queda',
  'inativo',
  'reconectar',
  'sem_sincronizar',
  'desconectado',
];

function summarize(clients: ClientHealth[]): ClientHealthSummary {
  const has = (set: HealthStatus[], s: HealthStatus) => set.includes(s);
  return {
    total: clients.length,
    atencao: clients.filter((c) => has(ATENCAO, c.status)).length,
    saudaveis: clients.filter((c) => has(SAUDAVEIS, c.status)).length,
    estaveis: clients.filter((c) => c.status === 'estavel').length,
    conexao: clients.filter((c) => has(CONEXAO, c.status)).length,
    precisamAtencao: clients.filter((c) => has(PRECISAM, c.status)).length,
  };
}

export async function getClientHealthMonitor(windowDays = 28): Promise<ClientHealthMonitorResult> {
  const { data, error } = await supabase.rpc('get_client_health_aggregates', {
    p_window_days: windowDays,
  });
  if (error || !data) {
    if (error) console.error('[clientHealth] RPC error', error.message);
    return { clients: [], summary: { ...EMPTY_SUMMARY } };
  }
  const nowMs = Date.now();
  const clients = (data as AggRow[]).map((r) => mapRow(r, nowMs));
  return { clients, summary: summarize(clients) };
}
