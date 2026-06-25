import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { validateForScheduling, validateMedia } from "../_shared/instagram-publish-utils.ts";

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

Deno.test("validateForScheduling: story with two media is rejected", async () => {
  const db = createSupabaseQueryMock();
  queueSchedulingReads(db, {
    igCaption: null,
    links: [
      { sort_order: 0, files: media({ id: 1, sort_order: undefined }) },
      { sort_order: 1, files: media({ id: 2, r2_key: "media/2.jpg", sort_order: undefined }) },
    ],
  });

  const result = await validateForScheduling(db as never, 1);
  assertEquals(result.ok, false);
  assert(result.errors.includes("Stories aceitam apenas uma mídia."));
  assert(!result.errors.includes("Legenda do Instagram não definida."));
});
