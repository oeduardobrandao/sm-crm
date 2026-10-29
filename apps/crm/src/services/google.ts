// =============================================
// Mesaas - Google Integration Service (YouTube + Google Meu Negócio)
// =============================================
// Phase 1: connect / summary / GMN unit picker / YouTube disconnect
// (google-integration edge function). Mirrors tiktok.ts's session-token fetch
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
