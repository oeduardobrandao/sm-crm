// =============================================
// Mesaas - Google Integration Service (YouTube + Google Meu Negócio)
// =============================================
// Phase 1: connect / summary / GMN unit picker / YouTube disconnect
// (google-integration edge function), plus the workspace-level account list / disconnect. Mirrors tiktok.ts's session-token fetch
// helper. No cache: the summary changes right after the OAuth round trip.
import { supabase } from '../lib/supabase';

const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/google-integration';

// ─── Response types (mirror supabase/functions/google-integration) ────

export type GoogleProduct = 'youtube' | 'gbp';

export interface YouTubeChannelSummary {
  channelId: string;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  authorizationStatus: 'active' | 'revoked';
  connectionEmail: string | null;
  lastSyncedAt: string | null;
}

export interface GbpLocationSummary {
  id: string;
  title: string | null;
  addressLine: string | null;
  averageRating: number | null;
  totalReviewCount: number | null;
  status: 'active' | 'disconnected' | 'revoked';
}

export interface GbpConnectionSummary {
  id: string;
  email: string;
  status: 'active' | 'revoked';
}

export interface GoogleSummary {
  youtube: YouTubeChannelSummary | null;
  gmn: {
    locations: GbpLocationSummary[];
    connections: GbpConnectionSummary[];
  } | null;
}

export interface GbpLocationOptionView {
  locationName: string;
  accountName: string;
  title: string;
  addressLine: string | null;
  website: string | null;
  hasVoiceOfMerchant: boolean;
  linkedClientId: number | null;
  linkedClientName: string | null;
  /** The connection the link goes through; another connection's unit is read-only here. */
  linkedConnectionId: string | null;
  eligible: boolean;
}

/** One YouTube channel fed by a workspace Google account (GET /accounts). */
export interface GoogleAccountYouTubeChannel {
  channelId: string;
  title: string | null;
  handle: string | null;
  clientId: number;
  clientName: string | null;
  authorizationStatus: 'active' | 'revoked';
}

/** One GMN unit fed by a workspace Google account. `disconnected` units are never listed. */
export interface GoogleAccountGbpLocation {
  id: string;
  title: string | null;
  addressLine: string | null;
  clientId: number;
  clientName: string | null;
  status: 'active' | 'revoked';
}

/** A Google identity connected to the active workspace and what it feeds. */
export interface GoogleAccount {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'revoked';
  connectedAt: string;
  youtube: GoogleAccountYouTubeChannel[];
  gbp: GoogleAccountGbpLocation[];
}

/** POST /accounts/:id/disconnect. Never says whether the grant was revoked at Google. */
export interface GoogleAccountDisconnectResult {
  ok: true;
  youtubeChannelsUnlinked: number;
  gbpLocationsUnlinked: number;
}

export interface GbpLocationOptionsPage {
  options: GbpLocationOptionView[];
  /** Google listed only part of the account; this client's linked units are always included. */
  truncated: boolean;
}

// ─── Errors ───────────────────────────────────────────────────────────

export const GOOGLE_SERVICE_ERROR_CODES = [
  'feature_disabled',
  'gmn_not_approved',
  'reconnect',
  'location_unavailable',
  'rate_limited',
  /** Manual sync: the unit's authorization expired before the call (same handling as `reconnect`). */
  'revoked',
  /** Manual sync: the client has no unit of that product any more. */
  'not_connected',
  /** The caller lacks the permission the route checks (e.g. `configuracoes:editar`). */
  'forbidden',
  /** Account disconnect: the connection is already gone (treated as done by the UI). */
  'not_found',
  /** Account disconnect: a concurrent link interleaved; nothing was committed, retry. */
  'conflict',
  'unknown',
] as const;

export type GoogleServiceErrorCode = (typeof GOOGLE_SERVICE_ERROR_CODES)[number];

export class GoogleServiceError extends Error {
  code: GoogleServiceErrorCode;

  constructor(code: GoogleServiceErrorCode, message?: string) {
    super(message || code);
    this.name = 'GoogleServiceError';
    this.code = code;
  }
}

async function toServiceError(res: Response): Promise<GoogleServiceError> {
  const body = await res.json().catch(() => null);
  const raw = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  const code = GOOGLE_SERVICE_ERROR_CODES.find((c) => c === raw) ?? 'unknown';
  return new GoogleServiceError(code);
}

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}${path}`, { ...init, headers });
  if (!res.ok) throw await toServiceError(res);
  return (await res.json()) as T;
}

// ─── API ──────────────────────────────────────────────────────────────

export async function getGoogleAuthUrl(clientId: number, product: GoogleProduct): Promise<string> {
  const data = await request<{ url: string }>(
    `/auth/${clientId}?product=${encodeURIComponent(product)}`,
  );
  return data.url;
}

export async function getGoogleSummary(clientId: number): Promise<GoogleSummary> {
  return request<GoogleSummary>(`/summary/${clientId}`);
}

export async function listGbpLocationOptions(
  clientId: number,
  connectionId: string,
): Promise<GbpLocationOptionsPage> {
  const data = await request<{ options: GbpLocationOptionView[]; truncated?: boolean }>(
    `/locations/${clientId}?connection=${encodeURIComponent(connectionId)}`,
  );
  return { options: data.options, truncated: data.truncated === true };
}

export async function linkGbpLocations(
  clientId: number,
  connectionId: string,
  locationNames: string[],
): Promise<number> {
  const data = await request<{ linked: number }>(`/locations/${clientId}`, {
    method: 'POST',
    body: JSON.stringify({ connectionId, locationNames }),
  });
  return data.linked;
}

export async function disconnectYouTube(clientId: number): Promise<void> {
  await request<{ ok: true }>(`/disconnect/youtube/${clientId}`, { method: 'POST' });
}

/** Unlinks every GMN unit of the client, on any connection (POST /disconnect/gbp). */
export async function disconnectGbp(clientId: number): Promise<void> {
  await request<{ ok: true }>(`/disconnect/gbp/${clientId}`, { method: 'POST' });
}

/** Google accounts of the active workspace, with the channels and units each one feeds. */
export async function listGoogleAccounts(): Promise<GoogleAccount[]> {
  const data = await request<{ accounts: GoogleAccount[] }>('/accounts');
  return data.accounts;
}

/**
 * "Desconectar conta" (Configurações > Contas conectadas): unlinks every channel and unit of
 * this workspace on the account and drops the workspace's connection. `not_found` means it
 * was already gone; `conflict` means a concurrent link interleaved and nothing changed.
 */
export async function disconnectGoogleAccount(
  connectionId: string,
): Promise<GoogleAccountDisconnectResult> {
  return request<GoogleAccountDisconnectResult>(
    `/accounts/${encodeURIComponent(connectionId)}/disconnect`,
    { method: 'POST' },
  );
}

/** Query key of `listGoogleAccounts` (no conta_id: a workspace switch clears the cache). */
export const GOOGLE_ACCOUNTS_QUERY_KEY = ['googleAccounts'] as const;

/**
 * First segment of every per-client YouTube / GMN analytics query. An account disconnect
 * refreshes all of them; a new analytics tab adds its key here.
 */
export const GOOGLE_DATA_QUERY_PREFIXES: readonly string[] = [
  'yt-overview',
  'yt-daily',
  'yt-traffic',
  'yt-demographics',
  'yt-videos',
  'yt-top-shorts',
  'gbp-overview',
  'gbp-daily',
  'gbp-surfaces',
  'gbp-keywords',
  'gbp-reviews',
  'gbp-rating-distribution',
  'gbp-units',
];

/** Outcome of one unit's manual sync. Anything but `synced` means it did not finish now. */
export type GoogleSyncStatus =
  | 'synced'
  | 'revoked'
  | 'quota_skipped'
  | 'skipped'
  | 'mismatch'
  | 'not_approved'
  | 'failed';

/** POST /sync body: YouTube answers one `status`, GMN one per active location. */
export interface GoogleSyncResult {
  ok: true;
  status?: GoogleSyncStatus;
  locations?: Array<{ id: string; status: GoogleSyncStatus }>;
}

/**
 * Manual "Sincronizar agora" for one product of a client. Rate limited server-side
 * (`rate_limited`); the caller refreshes its `yt-`/`gbp-` queries on success.
 */
export async function syncGoogleProduct(
  product: GoogleProduct,
  clientId: number,
): Promise<GoogleSyncResult> {
  return request<GoogleSyncResult>(`/sync/${product}/${clientId}`, { method: 'POST' });
}

/**
 * True when the sync answered but some unit did not finish (quota, approval, a revoked token
 * mid-run...). A body without statuses (an older server) counts as complete.
 */
export function isGoogleSyncIncomplete(result: GoogleSyncResult | undefined | null): boolean {
  if (!result) return false;
  if (result.status !== undefined && result.status !== 'synced') return true;
  return (result.locations ?? []).some((l) => l.status !== 'synced');
}

/** 403 `feature_disabled` from an analytics read: the workspace plan lacks the product flag. */
export const isGoogleFeatureDisabled = (err: unknown): boolean =>
  err instanceof Error && err.message === 'feature_disabled';
