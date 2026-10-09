// supabase/functions/_shared/tiktok-precheck.ts
// Spec 2026-10-08-tiktok-audit-readiness A10: authoritative creator check right before
// TikTok init. The evaluator is pure; the two fetchers are thin and injectable.
import { TikTokApiError } from "./tiktok.ts";
import {
  isTikTokCannotPostCode,
  TIKTOK_MSG,
  type TikTokCannotPostCode,
  tiktokErrorMessage,
} from "./tiktok-messages.ts";

export type CreatorCheck =
  | { kind: "ok"; privacyLevelOptions: string[] | null; maxVideoPostDurationSec: number | null }
  | { kind: "cannot_post"; code: TikTokCannotPostCode }
  | { kind: "skip" };

export interface PrecheckMedia {
  kind: string;
  duration_seconds: number | null;
  media_lost_at: string | null;
}

type TikTokFetch = (path: string, init: RequestInit & { accessToken: string }) => Promise<unknown>;

/** Rethrows TikTokApiError TOKEN_INVALID / REVOKED (callers fail the account's posts like a
 * token failure). Every other failure is fail-open: the check is a guard, never an outage
 * dependency, and init itself surfaces real problems. */
export async function fetchCreatorCheck(tiktokFetch: TikTokFetch, accessToken: string): Promise<CreatorCheck> {
  try {
    const data = (await tiktokFetch("/post/publish/creator_info/query/", {
      method: "POST",
      accessToken,
      body: JSON.stringify({}),
    })) as Record<string, unknown> | null;
    const options = Array.isArray(data?.privacy_level_options)
      ? (data!.privacy_level_options as unknown[]).filter((o): o is string => typeof o === "string")
      : null;
    const max = typeof data?.max_video_post_duration_sec === "number" ? data.max_video_post_duration_sec : null;
    return { kind: "ok", privacyLevelOptions: options, maxVideoPostDurationSec: max };
  } catch (err) {
    if (err instanceof TikTokApiError) {
      if (isTikTokCannotPostCode(err.code)) return { kind: "cannot_post", code: err.code };
      if (err.code === "TOKEN_INVALID" || err.code === "REVOKED") throw err;
    }
    console.warn("[tiktok-precheck] creator_info unavailable, proceeding:", (err as Error)?.message);
    return { kind: "skip" };
  }
}

// deno-lint-ignore no-explicit-any
export async function fetchPrecheckMedia(svc: any, postId: number): Promise<PrecheckMedia[]> {
  const { data, error } = await svc
    .from("post_file_links")
    .select("sort_order, files!inner(kind, duration_seconds, media_lost_at)")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`fetchPrecheckMedia: post_file_links read failed: ${error.message}`);
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((l: any) => ({
    kind: l.files.kind,
    duration_seconds: l.files.duration_seconds ?? null,
    media_lost_at: l.files.media_lost_at ?? null,
  }));
}

export function evaluateTikTokPrecheck(input: {
  tipo: string;
  settings: { privacy_level?: string } | null | undefined;
  media: PrecheckMedia[];
  creator: CreatorCheck;
}): string | null {
  const privacy = input.settings?.privacy_level;
  if (!privacy) return TIKTOK_MSG.privacyMissing;
  if (input.media.length === 0) return TIKTOK_MSG.mediaMissing;
  if (input.media.some((m) => m.media_lost_at != null)) return TIKTOK_MSG.mediaLost;
  if (input.creator.kind === "cannot_post") return tiktokErrorMessage(input.creator.code);
  if (input.creator.kind === "ok") {
    const opts = input.creator.privacyLevelOptions;
    if (opts && opts.length > 0 && !opts.includes(privacy)) return TIKTOK_MSG.privacyMismatch;
    const max = input.creator.maxVideoPostDurationSec;
    if (input.tipo === "reels" && max != null) {
      const longest = Math.max(0, ...input.media.filter((m) => m.kind === "video").map((m) => m.duration_seconds ?? 0));
      if (longest > max) return TIKTOK_MSG.durationExceeded(longest, max);
    }
  }
  return null;
}
