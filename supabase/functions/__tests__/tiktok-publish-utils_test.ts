// TikTok scheduling validation matrix + post payload builders.
// Mirrors the structure/mocking style of instagram-publish-validate_test.ts and
// instagram-publish-validation_test.ts (createSupabaseQueryMock, per-table `.queue()`
// seeding in call order).
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  validateForTikTokScheduling,
  buildVideoInitPayload,
  buildPhotoInitPayload,
  mapStatusFetch,
  type ClaimedTikTokPost,
} from "../_shared/tiktok-publish-utils.ts";
import { FIELD_PUBLIC_POST_ID } from "../_shared/tiktok.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-tiktok-publish-utils-key-32");

// ============================================================
// Helpers
// ============================================================

function imageLink(i: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sort_order: i,
    files: {
      id: i + 1,
      kind: "image",
      mime_type: "image/jpeg",
      size_bytes: 1_000_000,
      width: 1080,
      height: 1080,
      duration_seconds: null,
      r2_key: `img/${i}.jpg`,
      ...overrides,
    },
  };
}

function videoLink(i: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sort_order: i,
    files: {
      id: i + 1,
      kind: "video",
      mime_type: "video/mp4",
      size_bytes: 5_000_000,
      width: 1080,
      height: 1920,
      duration_seconds: 20,
      r2_key: `vid/${i}.mp4`,
      ...overrides,
    },
  };
}

const VALID_SETTINGS = {
  privacy_level: "SELF_ONLY",
  disable_comment: false,
  disable_duet: false,
  disable_stitch: false,
  brand_organic_toggle: false,
  brand_content_toggle: false,
  auto_add_music: false,
  photo_cover_index: 0,
  is_aigc: false,
  video_cover_timestamp_ms: 0,
};

interface SeedOpts {
  tipo?: string;
  platform?: string;
  tiktok_caption?: string | null;
  ig_caption?: string | null;
  tiktok_title?: string | null;
  tiktok_settings?: Record<string, unknown> | null;
  links?: unknown[];
  scheduled_at?: string | null;
  account?: Record<string, unknown> | null;
  workflowId?: number | null;
  clienteId?: number;
}

// Queues every select validateForTikTokScheduling issues, in call order, for the
// non-early-return (non-stories) path: workflow_posts -> post_file_links ->
// tiktok_accounts (by the post's own cliente_id — no workflow join).
function seed(db: ReturnType<typeof createSupabaseQueryMock>, opts: SeedOpts = {}) {
  const {
    tipo = "carrossel",
    platform = "tiktok",
    tiktok_caption = "legenda",
    ig_caption = null,
    tiktok_title = null,
    tiktok_settings = VALID_SETTINGS,
    links = [imageLink(0)],
    scheduled_at = "2030-01-01T12:00:00Z",
    account = {
      id: "acct-1",
      encrypted_access_token: "enc-access",
      encrypted_refresh_token: "enc-refresh",
      tiktok_open_id: "open-1",
      authorization_status: "active",
    },
    workflowId = 9,
    clienteId = 5,
  } = opts;

  db.queue("workflow_posts", "select", {
    data: {
      id: 1,
      platform,
      tipo,
      tiktok_caption,
      ig_caption,
      tiktok_title,
      tiktok_settings,
      scheduled_at,
      workflow_id: workflowId,
      cliente_id: clienteId,
    },
    error: null,
  });
  db.queue("post_file_links", "select", { data: links, error: null });
  db.queue("tiktok_accounts", "select", { data: account, error: null });
}

// account has no real key material, so decryptTikTokToken would throw on a genuine
// decrypt attempt — tests that need the account section to PASS therefore stub
// decryptTikTokToken indirectly by encrypting real tokens via encryptTikTokToken first
// isn't necessary: we only assert decrypt is attempted; for the "passes" tests we
// pre-encrypt real values so decrypt succeeds for real.
import { encryptTikTokToken } from "../_shared/tiktok.ts";

async function accountWithRealTokens() {
  return {
    id: "acct-1",
    encrypted_access_token: await encryptTikTokToken("access-tok", "access"),
    encrypted_refresh_token: await encryptTikTokToken("refresh-tok", "refresh"),
    tiktok_open_id: "open-1",
    authorization_status: "active",
  };
}

// ============================================================
// Rule 1: stories rejection
// ============================================================

Deno.test("validateForTikTokScheduling: stories tipo → single exact error, no further checks", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", {
    data: { id: 1, platform: "tiktok", tipo: "stories", workflow_id: 9 },
    error: null,
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok, "stories must fail validation");
  assertEquals(res.errors, ["Stories não são suportados no TikTok."]);
});

// ============================================================
// Rule 1b: a Supabase read `error` is an infra failure and must THROW — never get
// swallowed into the PT-BR errors[] array. `data: null` with NO error keeps its
// existing domain meaning ("Post não encontrado."). One pattern (workflow_posts) is
// enough to pin the contract; the other two reads (post_file_links, tiktok_accounts)
// follow the identical `if (error) throw` shape.
// ============================================================

Deno.test("validateForTikTokScheduling: workflow_posts read error THROWS (infra failure, not a PT-BR domain error)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: null, error: { message: "boom" } });
  let threw = false;
  let thrownMessage = "";
  try {
    await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  } catch (e) {
    threw = true;
    thrownMessage = (e as Error).message;
  }
  assert(threw, "an infra read error must throw the validation function, not resolve to ok:false");
  assert(
    thrownMessage.includes("workflow_posts") && thrownMessage.includes("boom"),
    `expected the thrown message to name the table and carry the original error, got: ${thrownMessage}`,
  );
});

Deno.test("validateForTikTokScheduling: workflow_posts data:null with NO error still yields the domain 'not found' error (no throw)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: null, error: null });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res !== undefined, "must resolve, not throw, when there is simply no error");
  assert(!res.ok);
  assertEquals(res.errors, ["Post não encontrado."]);
});

// ============================================================
// Posts avulsos (workflow_id null): the post's own cliente_id is the only client
// pointer now — there is no separate "Workflow não encontrado." step anymore, the
// tiktok_accounts lookup by cliente_id carries every failure mode on its own.
// ============================================================

Deno.test("validateForTikTokScheduling: avulso post (workflow_id null) with connected account and media passes", async () => {
  const db = createSupabaseQueryMock();
  const account = await accountWithRealTokens();
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    seed(db, {
      tipo: "carrossel",
      workflowId: null,
      clienteId: 30,
      account,
      tiktok_settings: { ...VALID_SETTINGS, privacy_level: "SELF_ONLY" },
    });
    const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
    assert(res.ok, `expected ok, got: ${JSON.stringify(res.errors)}`);
    assertEquals(res.errors, []);
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

Deno.test("validateForTikTokScheduling: avulso post (workflow_id null) with no connected TikTok account fails with the account-missing error", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { workflowId: null, clienteId: 30, account: null });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok);
  assert(
    res.errors.some((e) => e.toLowerCase().includes("conta")),
    `expected the account-missing error, got: ${JSON.stringify(res.errors)}`,
  );
  assert(
    !res.errors.some((e) => e.includes("Workflow")),
    "there must be no separate workflow-not-found error path anymore",
  );
});

// ============================================================
// Rule 2: caption limits per tipo
// ============================================================

Deno.test("validateForTikTokScheduling: video caption over 2200 UTF-16 code units errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "reels",
    tiktok_caption: "a".repeat(2201),
    links: [videoLink(0)],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    res.errors.some((e) => e.includes("2200")),
    "must mention the 2200-limit",
  );
});

Deno.test("validateForTikTokScheduling: video caption exactly 2200 does not trigger the limit error", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "reels",
    tiktok_caption: "a".repeat(2200),
    links: [videoLink(0)],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    !res.errors.some((e) => e.includes("2200")),
    "2200 exactly must not trigger the caption-limit error",
  );
});

Deno.test("validateForTikTokScheduling: photo description over 4000 errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    tiktok_caption: "a".repeat(4001),
    links: [imageLink(0)],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    res.errors.some((e) => e.includes("4000")),
    "must mention the 4000-limit",
  );
});

Deno.test("validateForTikTokScheduling: photo description exactly 4000 does not trigger the limit error", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    tiktok_caption: "a".repeat(4000),
    links: [imageLink(0)],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.errors.some((e) => e.includes("4000")));
});

Deno.test("validateForTikTokScheduling: tiktok_title over 90 on photo tipo errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    tiktok_title: "t".repeat(91),
    links: [imageLink(0)],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    res.errors.some((e) => e.includes("90")),
    "must mention the 90-limit",
  );
});

Deno.test("validateForTikTokScheduling: tiktok_title exactly 90 on photo tipo passes the length check", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    tiktok_title: "t".repeat(90),
    links: [imageLink(0)],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.errors.some((e) => e.includes("90")));
});

Deno.test("validateForTikTokScheduling: tiktok_title set on video tipo errors regardless of length", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "reels",
    tiktok_title: "short",
    links: [videoLink(0)],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    res.errors.some((e) => e.toLowerCase().includes("título") && e.toLowerCase().includes("vídeo")),
    `expected a title-on-video error, got: ${JSON.stringify(res.errors)}`,
  );
});

// ============================================================
// Rule 3: carrossel — image-only, count caps, video rejection
// ============================================================

Deno.test("validateForTikTokScheduling: carrossel with a video item errors (video item + TikTok target)", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tipo: "carrossel", links: [imageLink(0), videoLink(1)] });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok);
  assert(res.errors.some((e) => e.toLowerCase().includes("vídeo")));
});

Deno.test("validateForTikTokScheduling: carrossel with 21 images errors for platform=tiktok (cap 20)", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    platform: "tiktok",
    links: Array.from({ length: 21 }, (_, i) => imageLink(i)),
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.includes("20")));
});

Deno.test("validateForTikTokScheduling: carrossel with exactly 20 images passes the count cap for platform=tiktok", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    platform: "tiktok",
    links: Array.from({ length: 20 }, (_, i) => imageLink(i)),
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.errors.some((e) => e.includes("máximo")));
});

Deno.test("validateForTikTokScheduling: carrossel with 11 images errors for platform=both (cap 10)", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    platform: "both",
    links: Array.from({ length: 11 }, (_, i) => imageLink(i)),
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.includes("10")));
});

Deno.test("validateForTikTokScheduling: carrossel with exactly 10 images passes the count cap for platform=both", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    platform: "both",
    links: Array.from({ length: 10 }, (_, i) => imageLink(i)),
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.errors.some((e) => e.includes("máximo")));
});

// ── Additional (context section, not its own numbered rule): TikTok photo MIME/size ──

Deno.test("validateForTikTokScheduling: TikTok-targeted photo with PNG mime errors (JPEG/WebP only)", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    links: [imageLink(0, { mime_type: "image/png" })],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.includes("JPEG") || e.includes("WebP")));
});

Deno.test("validateForTikTokScheduling: TikTok-targeted photo over 20MB errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    tipo: "carrossel",
    links: [imageLink(0, { size_bytes: 21 * 1024 * 1024 })],
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.includes("20 MB")));
});

// ============================================================
// Rule 3b: feed — exactly 1 image (design doc "feed single image → Photo post (1 image)")
// ============================================================

Deno.test("validateForTikTokScheduling: feed with exactly 1 image passes the media check", async () => {
  const db = createSupabaseQueryMock();
  const account = await accountWithRealTokens();
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    seed(db, {
      tipo: "feed",
      links: [imageLink(0)],
      account,
      tiktok_settings: { ...VALID_SETTINGS, privacy_level: "SELF_ONLY" },
    });
    const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
    assert(res.ok, `expected ok, got: ${JSON.stringify(res.errors)}`);
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

Deno.test("validateForTikTokScheduling: feed with 0 media fires the generic media-presence error, not the feed-count message", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tipo: "feed", links: [] });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.includes("mídia")), `expected the media-presence error, got: ${JSON.stringify(res.errors)}`);
  assert(
    !res.errors.some((e) => e.includes("exatamente 1 imagem")),
    "zero media must not additionally fire the feed-count message",
  );
});

Deno.test("validateForTikTokScheduling: feed with 2 images fails with the feed single-image message", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tipo: "feed", links: [imageLink(0), imageLink(1)] });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    res.errors.includes("Posts de feed no TikTok devem ter exatamente 1 imagem."),
    `expected the exact feed single-image message, got: ${JSON.stringify(res.errors)}`,
  );
});

Deno.test("validateForTikTokScheduling: feed with a video file fails (photo route rejects any video item)", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tipo: "feed", links: [videoLink(0)] });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok);
  assert(
    res.errors.some((e) => e.toLowerCase().includes("vídeo")),
    `expected a video-rejection error, got: ${JSON.stringify(res.errors)}`,
  );
});

// ============================================================
// Rule 4 + 5: privacy_level required/enum + unaudited SELF_ONLY gate
// ============================================================

Deno.test("validateForTikTokScheduling: missing privacy_level errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tiktok_settings: { ...VALID_SETTINGS, privacy_level: undefined } });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.toLowerCase().includes("privacidade")));
});

Deno.test("validateForTikTokScheduling: invalid privacy_level enum value errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tiktok_settings: { ...VALID_SETTINGS, privacy_level: "NOT_A_REAL_VALUE" } });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.toLowerCase().includes("privacidade")));
});

for (const level of ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]) {
  Deno.test(`validateForTikTokScheduling: privacy_level ${level} is a recognized enum value`, async () => {
    const db = createSupabaseQueryMock();
    Deno.env.set("TIKTOK_APP_AUDITED", "true"); // avoid the unaudited gate masking this check
    try {
      seed(db, { tiktok_settings: { ...VALID_SETTINGS, privacy_level: level } });
      const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
      assert(!res.errors.some((e) => e.toLowerCase().includes("inválid")));
    } finally {
      Deno.env.delete("TIKTOK_APP_AUDITED");
    }
  });
}

Deno.test("validateForTikTokScheduling: unaudited app + non-SELF_ONLY privacy → EXACT PT-BR error message", async () => {
  const db = createSupabaseQueryMock();
  Deno.env.delete("TIKTOK_APP_AUDITED"); // unset = unaudited
  seed(db, { tiktok_settings: { ...VALID_SETTINGS, privacy_level: "PUBLIC_TO_EVERYONE" } });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    res.errors.includes(
      "App TikTok em modo de teste: apenas publicação privada (SELF_ONLY) é permitida até a auditoria do TikTok",
    ),
    `expected the exact unaudited-gate message, got: ${JSON.stringify(res.errors)}`,
  );
});

Deno.test("validateForTikTokScheduling: unaudited app + SELF_ONLY passes the unaudited gate", async () => {
  const db = createSupabaseQueryMock();
  Deno.env.delete("TIKTOK_APP_AUDITED");
  Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-tiktok-publish-utils-key-32");
  const account = await accountWithRealTokens();
  seed(db, { tiktok_settings: { ...VALID_SETTINGS, privacy_level: "SELF_ONLY" }, account });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    !res.errors.some((e) => e.includes("modo de teste")),
    `SELF_ONLY must not trip the unaudited gate, got: ${JSON.stringify(res.errors)}`,
  );
});

Deno.test("validateForTikTokScheduling: TIKTOK_APP_AUDITED=true allows non-SELF_ONLY privacy", async () => {
  const db = createSupabaseQueryMock();
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    const account = await accountWithRealTokens();
    seed(db, { tiktok_settings: { ...VALID_SETTINGS, privacy_level: "PUBLIC_TO_EVERYONE" }, account });
    const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
    assert(!res.errors.some((e) => e.includes("modo de teste")));
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

// ============================================================
// Rule 6: account exists, active, tokens decryptable
// ============================================================

Deno.test("validateForTikTokScheduling: no TikTok account connected errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { account: null });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.toLowerCase().includes("conta")));
});

Deno.test("validateForTikTokScheduling: account authorization_status != active errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, {
    account: {
      id: "acct-1",
      encrypted_access_token: "x",
      encrypted_refresh_token: "y",
      tiktok_open_id: "open-1",
      authorization_status: "expired",
    },
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.toLowerCase().includes("ativa") || e.toLowerCase().includes("reconecte")));
});

Deno.test("validateForTikTokScheduling: account tokens fail to decrypt errors", async () => {
  const db = createSupabaseQueryMock();
  // encrypted_access_token isn't validly-encrypted ciphertext -> decrypt throws.
  seed(db, {
    account: {
      id: "acct-1",
      encrypted_access_token: "not-really-encrypted",
      encrypted_refresh_token: "also-not-encrypted",
      tiktok_open_id: "open-1",
      authorization_status: "active",
    },
  });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.toLowerCase().includes("token")));
});

Deno.test("validateForTikTokScheduling: active account with decryptable tokens passes account section and is returned", async () => {
  const db = createSupabaseQueryMock();
  const account = await accountWithRealTokens();
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    seed(db, { account, tiktok_settings: { ...VALID_SETTINGS, privacy_level: "SELF_ONLY" } });
    const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
    assert(res.ok, `expected ok, got errors: ${JSON.stringify(res.errors)}`);
    assertEquals(res.account?.id, "acct-1");
    assertEquals(res.account?.tiktok_open_id, "open-1");
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

// ============================================================
// Rule 8: media presence + video tipo exactly 1 video file
// ============================================================

Deno.test("validateForTikTokScheduling: zero media files errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { links: [] });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.includes("mídia")));
});

Deno.test("validateForTikTokScheduling: reels (video tipo) with exactly 1 video file passes the media check", async () => {
  const db = createSupabaseQueryMock();
  const account = await accountWithRealTokens();
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    seed(db, {
      tipo: "reels",
      links: [videoLink(0)],
      account,
      tiktok_settings: { ...VALID_SETTINGS, privacy_level: "SELF_ONLY" },
    });
    const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
    assert(res.ok, `expected ok, got: ${JSON.stringify(res.errors)}`);
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

Deno.test("validateForTikTokScheduling: reels with 2 video files errors (must be exactly 1)", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tipo: "reels", links: [videoLink(0), videoLink(1)] });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.toLowerCase().includes("vídeo")));
});

Deno.test("validateForTikTokScheduling: reels with 1 image file (wrong kind) errors", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { tipo: "reels", links: [imageLink(0)] });
  const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.errors.some((e) => e.toLowerCase().includes("vídeo")));
});

// ============================================================
// skipDateCheck / scheduled_at (mirrors validateForScheduling's structure)
// ============================================================

Deno.test("validateForTikTokScheduling: missing scheduled_at errors when skipDateCheck is not set", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { scheduled_at: null });
  const res = await validateForTikTokScheduling(db as never, 1, {});
  assert(res.errors.some((e) => e.toLowerCase().includes("data")));
});

Deno.test("validateForTikTokScheduling: scheduled_at in the past errors when skipDateCheck is not set", async () => {
  const db = createSupabaseQueryMock();
  seed(db, { scheduled_at: "2000-01-01T00:00:00Z" });
  const res = await validateForTikTokScheduling(db as never, 1, {});
  assert(res.errors.some((e) => e.toLowerCase().includes("futuro")));
});

// ============================================================
// Full happy-path scenarios
// ============================================================

Deno.test("validateForTikTokScheduling: fully valid tiktok-only carrossel post → ok true, no errors", async () => {
  const db = createSupabaseQueryMock();
  const account = await accountWithRealTokens();
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    seed(db, {
      tipo: "carrossel",
      platform: "tiktok",
      links: [imageLink(0), imageLink(1), imageLink(2)],
      account,
      tiktok_settings: { ...VALID_SETTINGS, privacy_level: "PUBLIC_TO_EVERYONE" },
    });
    const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
    assertEquals(res.errors, []);
    assert(res.ok);
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

Deno.test("validateForTikTokScheduling: fully valid both-platform reels post → ok true, no errors", async () => {
  const db = createSupabaseQueryMock();
  const account = await accountWithRealTokens();
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    seed(db, {
      tipo: "reels",
      platform: "both",
      links: [videoLink(0)],
      account,
      tiktok_settings: { ...VALID_SETTINGS, privacy_level: "SELF_ONLY" },
    });
    const res = await validateForTikTokScheduling(db as never, 1, { skipDateCheck: true });
    assertEquals(res.errors, []);
    assert(res.ok);
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

// ============================================================
// Payload builders
// ============================================================

const FULL_SETTINGS_POST: ClaimedTikTokPost = {
  tipo: "reels",
  caption: "Legenda completa do vídeo",
  tiktok_title: null,
  tiktok_settings: {
    privacy_level: "SELF_ONLY",
    disable_comment: true,
    disable_duet: true,
    disable_stitch: true,
    brand_organic_toggle: true,
    brand_content_toggle: true,
    auto_add_music: true,
    photo_cover_index: 2,
    is_aigc: true,
    video_cover_timestamp_ms: 1500,
  },
};

Deno.test("buildVideoInitPayload: video with all settings populated → exact snapshot", () => {
  const payload = buildVideoInitPayload(FULL_SETTINGS_POST, "https://r2.example.com/video.mp4");
  assertEquals(payload, {
    post_info: {
      title: "Legenda completa do vídeo",
      privacy_level: "SELF_ONLY",
      disable_comment: true,
      disable_duet: true,
      disable_stitch: true,
      brand_organic_toggle: true,
      brand_content_toggle: true,
      is_aigc: true,
      video_cover_timestamp_ms: 1500,
    },
    source_info: {
      source: "PULL_FROM_URL",
      video_url: "https://r2.example.com/video.mp4",
    },
  });
});

Deno.test("buildVideoInitPayload: minimal settings → optional keys are genuinely ABSENT (not undefined/null)", () => {
  const minimalPost: ClaimedTikTokPost = {
    tipo: "reels",
    caption: "cap",
    tiktok_title: null,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
  };
  const payload = buildVideoInitPayload(minimalPost, "https://r2.example.com/v.mp4") as {
    post_info: Record<string, unknown>;
    source_info: Record<string, unknown>;
  };
  assertEquals(Object.keys(payload.post_info).sort(), ["privacy_level", "title"].sort());
  assertEquals(
    Object.keys(payload.post_info).includes("disable_comment"),
    false,
  );
  assertEquals(Object.keys(payload.post_info).includes("video_cover_timestamp_ms"), false);
  // Photo-only fields must never appear in a video payload.
  assertEquals(JSON.stringify(payload).includes("auto_add_music"), false);
  assertEquals(JSON.stringify(payload).includes("photo_cover_index"), false);
});

Deno.test("buildVideoInitPayload: settings lacking privacy_level → key genuinely ABSENT (same guard as other optional fields)", () => {
  const post: ClaimedTikTokPost = {
    tipo: "reels",
    caption: "cap",
    tiktok_title: null,
    tiktok_settings: { disable_comment: true },
  };
  const payload = buildVideoInitPayload(post, "https://r2.example.com/v.mp4") as {
    post_info: Record<string, unknown>;
  };
  assertEquals(Object.keys(payload.post_info).includes("privacy_level"), false);
  assertEquals(JSON.stringify(payload).includes("privacy_level"), false);
});

const FULL_PHOTO_POST: ClaimedTikTokPost = {
  tipo: "carrossel",
  caption: "Descrição completa das fotos",
  tiktok_title: "Título opcional",
  tiktok_settings: {
    privacy_level: "SELF_ONLY",
    disable_comment: true,
    auto_add_music: true,
    brand_organic_toggle: true,
    brand_content_toggle: true,
    photo_cover_index: 1,
    // Video-only settings, deliberately present on a photo post's tiktok_settings — the
    // cross-contamination self-check below must prove buildPhotoInitPayload actually
    // filters these out, not merely that a fixture happening to omit them produced no
    // trace of them.
    disable_duet: true,
    disable_stitch: true,
    is_aigc: true,
    video_cover_timestamp_ms: 1000,
  },
};

Deno.test("buildPhotoInitPayload: photo with all settings populated (incl. tiktok_title) → exact snapshot", () => {
  const payload = buildPhotoInitPayload(FULL_PHOTO_POST, [
    "https://r2.example.com/1.jpg",
    "https://r2.example.com/2.jpg",
  ]);
  assertEquals(payload, {
    post_info: {
      title: "Título opcional",
      description: "Descrição completa das fotos",
      privacy_level: "SELF_ONLY",
      disable_comment: true,
      auto_add_music: true,
      brand_organic_toggle: true,
      brand_content_toggle: true,
    },
    source_info: {
      source: "PULL_FROM_URL",
      photo_images: ["https://r2.example.com/1.jpg", "https://r2.example.com/2.jpg"],
      photo_cover_index: 1,
    },
    post_mode: "DIRECT_POST",
    media_type: "PHOTO",
  });
});

Deno.test("buildPhotoInitPayload: minimal settings (no tiktok_title) → title key genuinely ABSENT", () => {
  const minimalPost: ClaimedTikTokPost = {
    tipo: "carrossel",
    caption: "desc",
    tiktok_title: null,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
  };
  const payload = buildPhotoInitPayload(minimalPost, ["https://r2.example.com/1.jpg"]) as {
    post_info: Record<string, unknown>;
    source_info: Record<string, unknown>;
  };
  assertEquals(Object.keys(payload.post_info).includes("title"), false);
  assertEquals(Object.keys(payload.post_info).sort(), ["description", "privacy_level"].sort());
  // Video-only fields must never appear in a photo payload.
  assertEquals(JSON.stringify(payload).includes("disable_duet"), false);
  assertEquals(JSON.stringify(payload).includes("disable_stitch"), false);
  assertEquals(JSON.stringify(payload).includes("is_aigc"), false);
  assertEquals(JSON.stringify(payload).includes("video_cover_timestamp_ms"), false);
});

Deno.test("buildPhotoInitPayload: photo_cover_index defaults to 0 when unset in settings", () => {
  const post: ClaimedTikTokPost = {
    tipo: "carrossel",
    caption: "desc",
    tiktok_title: undefined,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
  };
  const payload = buildPhotoInitPayload(post, ["https://r2.example.com/1.jpg"]) as {
    source_info: { photo_cover_index: number };
  };
  assertEquals(payload.source_info.photo_cover_index, 0);
});

Deno.test("buildPhotoInitPayload: settings lacking privacy_level → key genuinely ABSENT (same guard as other optional fields)", () => {
  const post: ClaimedTikTokPost = {
    tipo: "carrossel",
    caption: "desc",
    tiktok_title: null,
    tiktok_settings: { disable_comment: true },
  };
  const payload = buildPhotoInitPayload(post, ["https://r2.example.com/1.jpg"]) as {
    post_info: Record<string, unknown>;
  };
  assertEquals(Object.keys(payload.post_info).includes("privacy_level"), false);
  assertEquals(JSON.stringify(payload).includes("privacy_level"), false);
});

Deno.test("buildVideoInitPayload output never contains a photo-only key (grep-style self-check)", () => {
  const payload = buildVideoInitPayload(FULL_SETTINGS_POST, "https://r2.example.com/v.mp4");
  const json = JSON.stringify(payload);
  for (const photoOnlyKey of ["auto_add_music", "photo_cover_index", "photo_images", "media_type", "post_mode"]) {
    assertEquals(json.includes(photoOnlyKey), false, `video payload must never contain "${photoOnlyKey}"`);
  }
});

Deno.test("buildPhotoInitPayload output never contains a video-only key (grep-style self-check)", () => {
  const payload = buildPhotoInitPayload(FULL_PHOTO_POST, ["https://r2.example.com/1.jpg"]);
  const json = JSON.stringify(payload);
  for (const videoOnlyKey of ["disable_duet", "disable_stitch", "is_aigc", "video_cover_timestamp_ms", "video_url"]) {
    assertEquals(json.includes(videoOnlyKey), false, `photo payload must never contain "${videoOnlyKey}"`);
  }
});

// ============================================================
// mapStatusFetch
// ============================================================

Deno.test("mapStatusFetch: PROCESSING_UPLOAD → processing", () => {
  assertEquals(mapStatusFetch({ status: "PROCESSING_UPLOAD" }), { state: "processing" });
});

Deno.test("mapStatusFetch: PROCESSING_DOWNLOAD → processing", () => {
  assertEquals(mapStatusFetch({ status: "PROCESSING_DOWNLOAD" }), { state: "processing" });
});

Deno.test("mapStatusFetch: SEND_TO_USER_INBOX → processing (inbox mode we don't use)", () => {
  assertEquals(mapStatusFetch({ status: "SEND_TO_USER_INBOX" }), { state: "processing" });
});

Deno.test("mapStatusFetch: PUBLISH_COMPLETE extracts publicPostId from the sic-misspelled field", () => {
  const json = { status: "PUBLISH_COMPLETE", [FIELD_PUBLIC_POST_ID]: ["7154503692641242411"] };
  const result = mapStatusFetch(json);
  assertEquals(result, { state: "published", publicPostId: "7154503692641242411" });
});

Deno.test("mapStatusFetch: PUBLISH_COMPLETE with no public id present → published, publicPostId key ABSENT", () => {
  const result = mapStatusFetch({ status: "PUBLISH_COMPLETE" });
  assertEquals(result, { state: "published" });
  assertEquals(Object.keys(result).includes("publicPostId"), false);
});

Deno.test("mapStatusFetch: FAILED passes through fail_reason", () => {
  const result = mapStatusFetch({ status: "FAILED", fail_reason: "video_pull_failed" });
  assertEquals(result, { state: "failed", failReason: "video_pull_failed" });
});

Deno.test("mapStatusFetch: FAILED with no fail_reason → failed, failReason key ABSENT", () => {
  const result = mapStatusFetch({ status: "FAILED" });
  assertEquals(result, { state: "failed" });
  assertEquals(Object.keys(result).includes("failReason"), false);
});

Deno.test("mapStatusFetch: unrecognized/future status defaults conservatively to processing", () => {
  assertEquals(mapStatusFetch({ status: "SOME_FUTURE_STATUS" }), { state: "processing" });
});
