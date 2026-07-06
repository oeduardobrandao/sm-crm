import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  checkDesignReadiness,
  validateForScheduling,
  validateMedia,
} from "../_shared/instagram-publish-utils.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-token-key");

function media(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    kind: "image",
    mime_type: "image/jpeg",
    size_bytes: 1024,
    width: 1080,
    height: 1920,
    duration_seconds: null,
    r2_key: "media/1.jpg",
    sort_order: 0,
    ...overrides,
  };
}

async function encryptedToken(value = "ig-token") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("test-token-key".padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value)),
  );
  const combined = new Uint8Array(iv.length + data.length);
  combined.set(iv);
  combined.set(data, iv.length);
  return btoa(String.fromCharCode(...combined));
}

function queueSchedulingReads(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts: {
    tipo?: string;
    igCaption?: string | null;
    links?: Array<{ sort_order: number; files: Record<string, unknown> }>;
    encryptedAccessToken?: string;
    /** designs row (attached) for the T4.1 readiness gate. Defaults to null (no design). MUST be
     * seeded explicitly — the mock's default select returns `[]`, which is truthy and would
     * read as a design row with undefined fields (the documented trap). */
    design?:
      | { id: number; rev: number; render_status: string; is_stale: boolean; media_apply_held?: boolean }
      | null;
  },
) {
  db.queue("workflow_posts", "select", {
    data: {
      id: 1,
      scheduled_at: "2030-01-01T12:00:00Z",
      ig_caption: opts.igCaption ?? null,
      workflow_id: 10,
      tipo: opts.tipo ?? "stories",
    },
    error: null,
  });
  db.queue("post_file_links", "select", { data: opts.links ?? [], error: null });
  db.queue("designs", "select", { data: opts.design ?? null, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 20 }, error: null });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: opts.encryptedAccessToken ?? "",
      instagram_user_id: "ig-user",
      token_expires_at: "2030-01-01T12:00:00Z",
      authorization_status: "connected",
    },
    error: null,
  });
}

Deno.test("validateMedia: story 9:16 image passes while feed rules reject it", () => {
  const storyImage = media({ width: 1080, height: 1920 });
  assertEquals(validateMedia([storyImage as never], { forStories: true }), []);
  assertEquals(validateMedia([storyImage as never]).length, 1);
});

Deno.test("validateMedia: story video over 60 seconds fails", () => {
  const errors = validateMedia([
    media({
      kind: "video",
      mime_type: "video/mp4",
      r2_key: "media/1.mp4",
      duration_seconds: 61,
    }) as never,
  ], { forStories: true });
  assertEquals(errors.length, 1);
  assert(errors[0].message.includes("3–60 segundos"));
});

Deno.test("validateMedia: story wrong format fails", () => {
  const errors = validateMedia([
    media({ mime_type: "image/gif" }) as never,
  ], { forStories: true });
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message, "Imagens devem estar em formato JPEG");
});

Deno.test("validateForScheduling: story with no caption and valid connected account passes", async () => {
  const db = createSupabaseQueryMock();
  queueSchedulingReads(db, {
    igCaption: null,
    encryptedAccessToken: await encryptedToken(),
    links: [{
      sort_order: 0,
      files: media({ sort_order: undefined }),
    }],
  });

  const result = await validateForScheduling(db as never, 1);
  assertEquals(result.ok, true);
  assertEquals(result.errors, []);
  assertEquals(result.media?.length, 1);
  assertEquals(result.account?.instagram_user_id, "ig-user");
});

Deno.test("validateForScheduling: multi-media story validates each segment (no count cap)", async () => {
  const db = createSupabaseQueryMock();
  await queueSchedulingReads(db, {
    tipo: "stories",
    igCaption: null,
    links: [
      { sort_order: 0, files: media({ id: 1, width: 1080, height: 1920 }) },
      { sort_order: 1, files: media({ id: 2, width: 1080, height: 1920 }) },
    ],
    encryptedAccessToken: await encryptedToken(),
  });
  // deno-lint-ignore no-explicit-any
  const res = await validateForScheduling(db as any, 1);
  assert(res.ok, `expected ok, got: ${res.errors.join("; ")}`);
});

Deno.test("validateForScheduling: multi-media story rejects a bad segment", async () => {
  const db = createSupabaseQueryMock();
  await queueSchedulingReads(db, {
    tipo: "stories",
    igCaption: null,
    links: [
      { sort_order: 0, files: media({ id: 1, width: 1080, height: 1920 }) },
      { sort_order: 1, files: media({ id: 2, mime_type: "image/gif" }) }, // bad MIME
    ],
    encryptedAccessToken: await encryptedToken(),
  });
  // deno-lint-ignore no-explicit-any
  const res = await validateForScheduling(db as any, 1);
  assert(!res.ok);
  assert(res.errors.some((e) => e.includes("JPEG")), res.errors.join("; "));
});

// ============================================================
// T4.1 — Estúdio design-readiness gate (design §5.3)
// ============================================================

Deno.test("checkDesignReadiness: no design row → ready (ordinary post)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: null, error: null });
  const res = await checkDesignReadiness(db as never, 1);
  assertEquals(res, { ready: true, design: null });
});

Deno.test("checkDesignReadiness: rendered + fresh → ready; every other state → not ready", async () => {
  const cases = [
    { row: { id: 7, rev: 3, render_status: "rendered", is_stale: false }, ready: true },
    { row: { id: 7, rev: 3, render_status: "rendered", is_stale: true }, ready: false },
    { row: { id: 7, rev: 3, render_status: "pending", is_stale: true }, ready: false },
    { row: { id: 7, rev: 3, render_status: "rendering", is_stale: true }, ready: false },
    { row: { id: 7, rev: 3, render_status: "failed", is_stale: true }, ready: false },
  ];
  for (const c of cases) {
    const db = createSupabaseQueryMock();
    db.queue("designs", "select", { data: c.row, error: null });
    const res = await checkDesignReadiness(db as never, 1);
    assertEquals(res.ready, c.ready, JSON.stringify(c.row));
    assertEquals(res.design, c.row);
  }
});

Deno.test("checkDesignReadiness: media_apply_held → ready regardless of render_status/is_stale (slice C dormant attachment)", async () => {
  const heldCases = [
    { id: 7, rev: 1, render_status: "pending", is_stale: true, media_apply_held: true },
    { id: 7, rev: 1, render_status: "rendering", is_stale: true, media_apply_held: true },
    { id: 7, rev: 1, render_status: "failed", is_stale: true, media_apply_held: true },
    { id: 7, rev: 1, render_status: "rendered", is_stale: false, media_apply_held: true },
  ];
  for (const row of heldCases) {
    const db = createSupabaseQueryMock();
    db.queue("designs", "select", { data: row, error: null });
    const res = await checkDesignReadiness(db as never, 1);
    assertEquals(res, { ready: true, design: null }, JSON.stringify(row));
  }
});

Deno.test("validateForScheduling: pending design blocks with the 'ainda está sendo gerada' message and exposes designBlocked", async () => {
  const db = createSupabaseQueryMock();
  queueSchedulingReads(db, {
    igCaption: null,
    encryptedAccessToken: await encryptedToken(),
    links: [{ sort_order: 0, files: media({ sort_order: undefined }) }],
    design: { id: 7, rev: 4, render_status: "pending", is_stale: true },
  });
  const res = await validateForScheduling(db as never, 1);
  assertEquals(res.ok, false);
  assert(res.errors.some((e) => e.includes("ainda está sendo gerada")), res.errors.join("; "));
  assertEquals(res.designBlocked, { id: 7, rev: 4, render_status: "pending", is_stale: true });
});

Deno.test("validateForScheduling: failed design blocks with the DISTINCT actionable message", async () => {
  const db = createSupabaseQueryMock();
  queueSchedulingReads(db, {
    igCaption: null,
    encryptedAccessToken: await encryptedToken(),
    links: [{ sort_order: 0, files: media({ sort_order: undefined }) }],
    design: { id: 7, rev: 4, render_status: "failed", is_stale: true },
  });
  const res = await validateForScheduling(db as never, 1);
  assertEquals(res.ok, false);
  assert(res.errors.some((e) => e.includes("falhou ao renderizar")), res.errors.join("; "));
});

Deno.test("validateForScheduling: STALE-but-rendered design blocks (edited after last render)", async () => {
  const db = createSupabaseQueryMock();
  queueSchedulingReads(db, {
    igCaption: null,
    encryptedAccessToken: await encryptedToken(),
    links: [{ sort_order: 0, files: media({ sort_order: undefined }) }],
    design: { id: 7, rev: 5, render_status: "rendered", is_stale: true },
  });
  const res = await validateForScheduling(db as never, 1);
  assertEquals(res.ok, false);
  assert(res.errors.some((e) => e.includes("ainda está sendo gerada")), res.errors.join("; "));
});

Deno.test("validateForScheduling: rendered + fresh design passes and designBlocked stays unset", async () => {
  const db = createSupabaseQueryMock();
  queueSchedulingReads(db, {
    igCaption: null,
    encryptedAccessToken: await encryptedToken(),
    links: [{ sort_order: 0, files: media({ sort_order: undefined }) }],
    design: { id: 7, rev: 5, render_status: "rendered", is_stale: false },
  });
  const res = await validateForScheduling(db as never, 1);
  assertEquals(res.ok, true);
  assertEquals(res.designBlocked, undefined);
});

Deno.test("validateForScheduling: HELD design (slice C dormant attachment) schedules like a design-less post — no block, no designBlocked", async () => {
  const db = createSupabaseQueryMock();
  queueSchedulingReads(db, {
    igCaption: null,
    encryptedAccessToken: await encryptedToken(),
    links: [{ sort_order: 0, files: media({ sort_order: undefined }) }],
    // Held design would fail every freshness check on its own (pending + stale) — proves the
    // hold, not a fortunate render state, is what makes this pass.
    design: { id: 7, rev: 1, render_status: "pending", is_stale: true, media_apply_held: true },
  });
  const res = await validateForScheduling(db as never, 1);
  assertEquals(res.ok, true, res.errors.join("; "));
  assert(!res.errors.some((e) => e.includes("Estúdio")), res.errors.join("; "));
  assertEquals(res.designBlocked, undefined);
});
