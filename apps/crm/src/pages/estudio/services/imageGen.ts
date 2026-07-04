// CRM client for the generate-image edge function (design §8, plan T6.3). Unlike the shared
// callFn (which flattens errors to a string message), this preserves the §8 failure envelope
// {error: {code, message, retryable, retry_after?}} as a typed ImageGenClientError so the panel
// can branch on code (feature/quota → entitlement toast; transient → retry hint; safety → copy).
import { supabase } from '@/lib/supabase';

export interface GenerateImageRequest {
  prompt: string;
  aspect_ratio: '1:1' | '4:5' | '9:16' | '16:9';
  placement?: 'background' | 'element';
  quality?: '1K' | '2K';
  client_id?: number;
  post_id?: number;
  reference_file_ids?: number[];
  use_brand_logo?: boolean;
  /** Per-submission UUID — safe retries never double-spend (the server replays on the key). */
  idempotency_key: string;
}

export interface GenerateImageResponse {
  file_id: number;
  preview_url: string;
  width: number;
  height: number;
  model: string;
  cost_usd_estimate: number;
  quota: { used: number; limit: number | null; resets_at: string };
  replayed?: boolean;
}

export type ImageGenErrorCode =
  | 'feature_disabled'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'generation_in_progress'
  | 'provider_timeout'
  | 'provider_error'
  | 'safety_refusal'
  | 'storage_quota_exceeded'
  | 'storage_error'
  | 'invalid_reference'
  | 'unknown';

export class ImageGenClientError extends Error {
  constructor(
    public code: ImageGenErrorCode,
    message: string,
    public retryable: boolean,
    public retryAfter?: string,
  ) {
    super(message);
    this.name = 'ImageGenClientError';
  }
}

export async function generateImage(req: GenerateImageRequest): Promise<GenerateImageResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new ImageGenClientError('unknown', 'Não autenticado.', false);

  const url = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/generate-image`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req),
    });
  } catch {
    // Network failure never reached the server — safe to retry (no spend).
    throw new ImageGenClientError('provider_error', 'Falha de conexão. Tente novamente.', true);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const env = (body as { error?: unknown })?.error;
    if (env && typeof env === 'object') {
      const e = env as {
        code?: string;
        message?: string;
        retryable?: boolean;
        retry_after?: string;
      };
      throw new ImageGenClientError(
        (e.code as ImageGenErrorCode) ?? 'unknown',
        e.message ?? 'Não foi possível gerar a imagem.',
        e.retryable ?? false,
        e.retry_after,
      );
    }
    // Non-envelope error (shape validation 400s emit a bare {error: string}).
    throw new ImageGenClientError('unknown', 'Não foi possível gerar a imagem.', false);
  }
  return body as GenerateImageResponse;
}
