import { assert } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { validateForScheduling } from "../_shared/instagram-publish-utils.ts";
import { TRIAL_MEDIA_SHAPE_ERROR } from "../_shared/publish-error-codes.ts";

// One valid JPEG post_file_link row (passes per-file validateMedia).
function link(i: number) {
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
    },
  };
}

// Queue the four selects validateForScheduling makes, in any order (keyed by table).
// account has no encrypted token + active status, so no decrypt/network happens.
function seed(db: ReturnType<typeof createSupabaseQueryMock>, count: number, tipo?: string) {
  db.queue("workflow_posts", "select", {
    data: { id: 1, scheduled_at: null, ig_caption: "cap", workflow_id: 9, tipo },
    error: null,
  });
  db.queue("post_file_links", "select", {
    data: Array.from({ length: count }, (_, i) => link(i)),
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 5 }, error: null });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: null,
      instagram_user_id: "ig",
      token_expires_at: null,
      authorization_status: "active",
    },
    error: null,
  });
}

Deno.test("validateForScheduling: 11 media → not ok, carousel message", async () => {
  const db = createSupabaseQueryMock();
  seed(db, 11);
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok, "11 items must fail validation");
  assert(
    res.errors.some((e) => e.includes("máximo 10")),
    "errors must include the 10-item carousel message",
  );
});

Deno.test("validateForScheduling: exactly 10 media → no carousel error", async () => {
  const db = createSupabaseQueryMock();
  seed(db, 10);
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    !res.errors.some((e) => e.includes("máximo 10")),
    "10 items must not produce the carousel error",
  );
  assert(res.ok, "a well-formed 10-item post must fully validate");
});

Deno.test("validateForScheduling: story with >10 media is exempt from the carousel cap", async () => {
  const db = createSupabaseQueryMock();
  // Stories publish as sequential segments, not one carousel container, so the
  // 10-item Graph carousel cap must NOT apply to them.
  seed(db, 11, "stories");
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(
    !res.errors.some((e) => e.includes("máximo 10")),
    "stories must not be blocked by the 10-item carousel cap",
  );
});

function videoLink(i: number) {
  return {
    sort_order: i,
    files: {
      id: i + 1, kind: "video", mime_type: "video/mp4", size_bytes: 10_000_000,
      width: 1080, height: 1920, duration_seconds: 30, r2_key: `vid/${i}.mp4`,
    },
  };
}

function seedTrial(db: ReturnType<typeof createSupabaseQueryMock>, opts: {
  tipo: string; links: unknown[]; strategy: string | null;
}) {
  db.queue("workflow_posts", "select", {
    data: {
      id: 1, scheduled_at: null, ig_caption: "cap", workflow_id: 9,
      tipo: opts.tipo, ig_trial_strategy: opts.strategy,
    },
    error: null,
  });
  db.queue("post_file_links", "select", { data: opts.links, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 5 }, error: null });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: null, instagram_user_id: "ig",
      token_expires_at: null, authorization_status: "active",
    },
    error: null,
  });
}

Deno.test("validateForScheduling: trial em carrossel → erro de formato", async () => {
  const db = createSupabaseQueryMock();
  seedTrial(db, { tipo: "reels", links: [link(0), link(1)], strategy: "auto" });
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.ok, "trial on 2 media must fail");
  assert(res.errors.includes(TRIAL_MEDIA_SHAPE_ERROR), "must carry the trial shape error");
});

Deno.test("validateForScheduling: trial em vídeo único reels → ok", async () => {
  const db = createSupabaseQueryMock();
  seedTrial(db, { tipo: "reels", links: [videoLink(0)], strategy: "manual" });
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(res.ok, `expected ok, got: ${res.errors.join(" | ")}`);
});

Deno.test("validateForScheduling: sem trial não adiciona o erro", async () => {
  const db = createSupabaseQueryMock();
  seedTrial(db, { tipo: "reels", links: [link(0), link(1)], strategy: null });
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true });
  assert(!res.errors.includes(TRIAL_MEDIA_SHAPE_ERROR), "shape error only when flagged");
});
