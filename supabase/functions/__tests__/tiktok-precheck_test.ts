import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { TikTokApiError } from "../_shared/tiktok.ts";
import { evaluateTikTokPrecheck, fetchCreatorCheck, fetchPrecheckMedia } from "../_shared/tiktok-precheck.ts";

/** Local stand-in for std's assertRejects — ./assert.ts deliberately stays tiny
 * (same helper as tiktok-shared_test.ts). */
// deno-lint-ignore no-explicit-any
async function assertRejects(fn: () => Promise<unknown>, ErrClass?: new (...a: any[]) => Error): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    if (ErrClass) {
      assert(e instanceof ErrClass, `expected ${ErrClass.name}, got ${(e as Error)?.constructor?.name}`);
    }
    return e as Error;
  }
  throw new Error("expected the function to throw, but it did not");
}

const video = (d: number | null, lost: string | null = null) => ({ kind: "video", duration_seconds: d, media_lost_at: lost });
const ok = (opts: Partial<{ privacyLevelOptions: string[] | null; maxVideoPostDurationSec: number | null }> = {}) =>
  ({ kind: "ok" as const, privacyLevelOptions: ["SELF_ONLY"], maxVideoPostDurationSec: 600, ...opts });

Deno.test("precheck: privacy missing wins first", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: {}, media: [video(10)], creator: ok() }),
    "Configurações do TikTok incompletas. Abra o post e defina a privacidade.",
  );
});

Deno.test("precheck: lost media blocks even when creator check skipped", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(10, "2026-08-14")], creator: { kind: "skip" } }),
    "Uma das mídias deste post foi perdida. Substitua-a antes de publicar.",
  );
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "feed", settings: { privacy_level: "SELF_ONLY" }, media: [], creator: { kind: "skip" } }),
    "Adicione mídia ao post para publicar no TikTok.",
  );
});

Deno.test("precheck: cannot_post maps to pt-BR", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(10)], creator: { kind: "cannot_post", code: "spam_risk_too_many_posts" } }),
    "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.",
  );
});

Deno.test("precheck: privacy no longer offered", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "PUBLIC_TO_EVERYONE" }, media: [video(10)], creator: ok() }),
    "A privacidade escolhida não está disponível para esta conta. Escolha outra e tente novamente.",
  );
  // empty/missing options list never blocks (older creator_info stubs return {})
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "PUBLIC_TO_EVERYONE" }, media: [video(10)], creator: ok({ privacyLevelOptions: null }) }),
    null,
  );
});

Deno.test("precheck: duration over the creator limit (video only)", () => {
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(750)], creator: ok() }),
    "Este vídeo tem 750s. O máximo permitido para esta conta é 600s.",
  );
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(null)], creator: ok() }),
    null,
  );
  assertEquals(
    evaluateTikTokPrecheck({ tipo: "reels", settings: { privacy_level: "SELF_ONLY" }, media: [video(600)], creator: ok() }),
    null,
  );
});

Deno.test("fetchCreatorCheck: ok / cannot_post / fail-open / token errors rethrow", async () => {
  const okFetch = () => Promise.resolve({ privacy_level_options: ["SELF_ONLY"], max_video_post_duration_sec: 300 });
  assertEquals(await fetchCreatorCheck(okFetch as never, "t"), { kind: "ok", privacyLevelOptions: ["SELF_ONLY"], maxVideoPostDurationSec: 300 });

  const cap = () => Promise.reject(new TikTokApiError("x", "reached_active_user_cap", false));
  assertEquals(await fetchCreatorCheck(cap as never, "t"), { kind: "cannot_post", code: "reached_active_user_cap" });

  for (const err of [new Error("network"), new TikTokApiError("rl", "RATE_LIMITED", true), new TikTokApiError("x", "internal_error", false)]) {
    assertEquals(await fetchCreatorCheck((() => Promise.reject(err)) as never, "t"), { kind: "skip" });
  }

  for (const code of ["TOKEN_INVALID", "REVOKED"]) {
    const err = await assertRejects(
      () => fetchCreatorCheck((() => Promise.reject(new TikTokApiError("x", code, false))) as never, "t"),
      TikTokApiError,
    );
    assertEquals((err as TikTokApiError).code, code);
  }
});

Deno.test("fetchPrecheckMedia: selects kind, duration, media_lost_at in order", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_file_links", "select", { data: [
    { sort_order: 0, files: { kind: "video", duration_seconds: 42, media_lost_at: null } },
  ], error: null });
  assertEquals(await fetchPrecheckMedia(db as never, 7), [{ kind: "video", duration_seconds: 42, media_lost_at: null }]);
  const call = db.calls.find((c) => c.table === "post_file_links");
  // supabaseMock records `.select(...)` arguments in `selectArgs: unknown[][]` (test/shared/supabaseMock.ts:14-21).
  assertEquals(String(call?.selectArgs[0]?.[0]), "sort_order, files!inner(kind, duration_seconds, media_lost_at)");
  assertEquals(call?.modifiers.map((m) => m.method), ["eq", "order"]);
});

Deno.test("fetchPrecheckMedia: a DB error throws (never read as 'no media')", async () => {
  const db = createSupabaseQueryMock();
  db.queue("post_file_links", "select", { data: null, error: { message: "boom" } });
  await assertRejects(() => fetchPrecheckMedia(db as never, 7));
});
