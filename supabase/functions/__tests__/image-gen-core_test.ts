// T5.4 image-gen core matrix (design §8): gates short-circuit BEFORE provider spend,
// pending-before-provider ledger ordering, failure statuses that never count quota,
// storage-quota → R2 delete (cost still logged), idempotent replay, reservation predicate,
// tenant checks, brand context, IHDR parsing, placement-keyed sizes.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  generateImageCore,
  ImageGenError,
  resolveImageSize,
  type ImageGenCoreDeps,
  type ImageGenInput,
} from "../_shared/image-gen/core.ts";
import { parsePngIhdr, type ImageGenRequest } from "../_shared/image-gen/provider.ts";

const CONTA = "workspace-A";

function baseInput(overrides: Partial<ImageGenInput> = {}): ImageGenInput {
  return {
    contaId: CONTA,
    source: "mcp",
    createdBy: "user-1",
    createdVia: "agent",
    mcpKeyId: "key-1",
    prompt: "um fundo abstrato dourado",
    aspectRatio: "4:5",
    ...overrides,
  };
}

interface Harness {
  deps: ImageGenCoreDeps;
  db: ReturnType<typeof createSupabaseQueryMock>;
  providerCalls: ImageGenRequest[];
  puts: Array<{ key: string; bytes: Uint8Array; contentType: string }>;
  deletes: string[];
  fileInserts: Array<Record<string, unknown>>;
}

function makeHarness(overrides: Partial<ImageGenCoreDeps> = {}): Harness {
  const db = createSupabaseQueryMock();
  const providerCalls: ImageGenRequest[] = [];
  const puts: Array<{ key: string; bytes: Uint8Array; contentType: string }> = [];
  const deletes: string[] = [];
  const fileInserts: Array<Record<string, unknown>> = [];
  const deps: ImageGenCoreDeps = {
    db: db as never,
    provider: {
      generate: (req) => {
        providerCalls.push(req);
        return Promise.resolve({
          bytes: new Uint8Array(2048),
          mime: "image/png",
          width: 928,
          height: 1152,
          model: "fake-model",
          outputTokens: 42,
          costEstimateUsd: 0.067,
        });
      },
    },
    isFeatureEnabled: async () => true,
    monthlyLimit: async () => 50,
    checkRateLimit: async () => true,
    putObject: async (key, bytes, contentType) => {
      puts.push({ key, bytes, contentType });
    },
    deleteObject: async (key) => {
      deletes.push(key);
    },
    insertFile: async (p) => {
      fileInserts.push(p);
      return { id: 900 };
    },
    resolveFileBytes: async () => new Uint8Array([1, 2, 3]),
    signUrl: async (key) => `https://signed.example/${key}`,
    randomUUID: () => "fixed-uuid",
    logError: () => {},
    ...overrides,
  };
  return { deps, db, providerCalls, puts, deletes, fileInserts };
}

/** Queue the pre-pipeline reads for a bare (no client/refs) call: reservation count + insert. */
function queueBare(db: ReturnType<typeof createSupabaseQueryMock>, opts: {
  monthRows?: Array<{ status: string; created_at: string }>;
  insertId?: number;
} = {}) {
  db.queue("ai_image_generations", "select", {
    data: (opts.monthRows ?? []).map((r, i) => ({ id: i + 1, ...r })),
    error: null,
  });
  db.queue("ai_image_generations", "insert", { data: { id: opts.insertId ?? 55 }, error: null });
}

async function expectError(
  run: Promise<unknown>,
): Promise<ImageGenError> {
  try {
    await run;
  } catch (e) {
    assert(e instanceof ImageGenError, `expected ImageGenError, got ${e}`);
    return e as ImageGenError;
  }
  throw new Error("expected an ImageGenError, none thrown");
}

// ── unit: sizes + IHDR ───────────────────────────────────────────────────────

Deno.test("resolveImageSize: placement keys the default; explicit quality wins", () => {
  assertEquals(resolveImageSize({ placement: "background" }), "2K");
  assertEquals(resolveImageSize({ placement: "element" }), "1K");
  assertEquals(resolveImageSize({}), "1K");
  assertEquals(resolveImageSize({ placement: "background", quality: "1K" }), "1K");
});

Deno.test("parsePngIhdr: real dims win; garbage returns null", () => {
  const png = new Uint8Array(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  view.setUint32(16, 512);
  view.setUint32(20, 640);
  assertEquals(parsePngIhdr(png), { width: 512, height: 640 });
  assertEquals(parsePngIhdr(new TextEncoder().encode("not a png at all........")), null);
  assertEquals(parsePngIhdr(new Uint8Array(4)), null);
});

// ── gates before spend ───────────────────────────────────────────────────────

Deno.test("feature gate short-circuits: no provider call, no ledger row", async () => {
  const h = makeHarness({ isFeatureEnabled: async () => false });
  const err = await expectError(generateImageCore(h.deps, baseInput()));
  assertEquals(err.code, "feature_disabled");
  assertEquals(h.providerCalls.length, 0);
  assertEquals(h.db.calls.length, 0);
});

Deno.test("burst limit short-circuits before quota reads and provider", async () => {
  const h = makeHarness({ checkRateLimit: async () => false });
  const err = await expectError(generateImageCore(h.deps, baseInput()));
  assertEquals(err.code, "rate_limited");
  assertEquals(err.retryable, true);
  assertEquals(h.providerCalls.length, 0);
});

Deno.test("monthly quota: reservation predicate counts succeeded + FRESH pending only", async () => {
  const h = makeHarness({ monthlyLimit: async () => 3 });
  const now = new Date("2026-07-04T12:00:00Z");
  h.deps.now = () => now;
  const fresh = new Date(now.getTime() - 5 * 60_000).toISOString();
  const stale = new Date(now.getTime() - 30 * 60_000).toISOString();
  queueBare(h.db, {
    monthRows: [
      { status: "succeeded", created_at: stale }, // counts
      { status: "pending", created_at: fresh }, // counts (reservation)
      { status: "pending", created_at: stale }, // stranded — self-healed, does NOT count
      { status: "safety_refused", created_at: fresh }, // failures never count
      { status: "provider_error", created_at: fresh },
    ],
  });
  // used = 2 of 3 → allowed; the run should reach the provider.
  const out = await generateImageCore(h.deps, baseInput());
  assertEquals(h.providerCalls.length, 1);
  assertEquals(out.quota.used, 3); // 2 counted + this success
  assertEquals(out.quota.limit, 3);
});

Deno.test("monthly quota exhausted: friendly 403 BEFORE paying the provider, retry_after = next month", async () => {
  const h = makeHarness({ monthlyLimit: async () => 1 });
  const now = new Date("2026-07-04T12:00:00Z");
  h.deps.now = () => now;
  h.db.queue("ai_image_generations", "select", {
    data: [{ id: 1, status: "succeeded", created_at: now.toISOString() }],
    error: null,
  });
  const err = await expectError(generateImageCore(h.deps, baseInput()));
  assertEquals(err.code, "quota_exhausted");
  assertEquals(err.retryAfter, "2026-08-01T00:00:00.000Z");
  assertEquals(h.providerCalls.length, 0);
});

// ── ledger ordering + failure statuses ───────────────────────────────────────

Deno.test("ledger row is inserted 'pending' BEFORE the provider call (spend never unlogged)", async () => {
  const h = makeHarness({
    provider: {
      name: "openrouter",
      model: "google/gemini-3.1-flash-lite-image",
      generate: () => Promise.reject(new Error("boom mid-flight")),
    },
  });
  queueBare(h.db);
  const err = await expectError(generateImageCore(h.deps, baseInput()));
  assertEquals(err.code, "provider_error");
  const insert = h.db.calls.find((c) =>
    c.table === "ai_image_generations" && c.operation === "insert"
  );
  assert(insert, "pending row inserted before the provider blew up");
  assertEquals((insert!.payload as { status: string }).status, "pending");
  // Attribution comes from the adapter, so this FAILED row points at the provider/model that
  // actually served the attempt (not a hardcoded gemini default).
  assertEquals((insert!.payload as { provider: string }).provider, "openrouter");
  assertEquals(
    (insert!.payload as { model: string }).model,
    "google/gemini-3.1-flash-lite-image",
  );
  const update = h.db.calls.find((c) =>
    c.table === "ai_image_generations" && c.operation === "update"
  );
  assertEquals((update!.payload as { status: string }).status, "provider_error");
});

Deno.test("OAuth key_id ('oauth:<clientId>', not a uuid) is stored as NULL — the mcp_key_id uuid column never sees it", async () => {
  // Regression: resolveOAuthCtx sets ctx.key_id = `oauth:${clientId}` (mcp-oauth.ts), which is
  // NOT a uuid. Writing it straight into the `mcp_key_id uuid` ledger column made Postgres reject
  // the insert ("invalid input syntax for type uuid") BEFORE any pending row existed, surfacing as
  // an opaque {"error":"Internal error."} on generate_image for every claude.ai web (OAuth) call.
  const h = makeHarness();
  queueBare(h.db);
  await generateImageCore(
    h.deps,
    baseInput({ mcpKeyId: "oauth:df1238a4-84d1-4e06-96c7-0808c6358d15" }),
  );
  const insert = h.db.calls.find((c) =>
    c.table === "ai_image_generations" && c.operation === "insert"
  );
  assertEquals((insert!.payload as { mcp_key_id: string | null }).mcp_key_id, null);
});

Deno.test("API-key key_id (a real uuid) is preserved on the ledger", async () => {
  const h = makeHarness();
  queueBare(h.db);
  const keyUuid = "11111111-2222-3333-4444-555555555555";
  await generateImageCore(h.deps, baseInput({ mcpKeyId: keyUuid }));
  const insert = h.db.calls.find((c) =>
    c.table === "ai_image_generations" && c.operation === "insert"
  );
  assertEquals((insert!.payload as { mcp_key_id: string | null }).mcp_key_id, keyUuid);
});

Deno.test("OAuth session is still per-credential burst-limited on the opaque key_id", async () => {
  // Coercing the ledger value to null must NOT drop the per-credential rate limit: the burst check
  // still keys on the opaque ctx.key_id, so an OAuth client keeps its own 10/10min window.
  const rlKeys: string[] = [];
  const h = makeHarness({
    checkRateLimit: (key: string) => {
      rlKeys.push(key);
      return Promise.resolve(true);
    },
  });
  queueBare(h.db);
  await generateImageCore(h.deps, baseInput({ mcpKeyId: "oauth:client-xyz" }));
  assert(rlKeys.includes("imggen:key:oauth:client-xyz"), rlKeys.join(","));
});

Deno.test("safety refusal: ledger 'safety_refused', non-retryable, no storage side effects", async () => {
  const { ProviderSafetyError } = await import("../_shared/image-gen/provider.ts");
  const h = makeHarness({
    provider: { generate: () => Promise.reject(new ProviderSafetyError("blocked")) },
  });
  queueBare(h.db);
  const err = await expectError(generateImageCore(h.deps, baseInput()));
  assertEquals(err.code, "safety_refusal");
  assertEquals(err.retryable, false);
  assertEquals(h.puts.length, 0);
  const update = h.db.calls.find((c) =>
    c.table === "ai_image_generations" && c.operation === "update"
  );
  assertEquals((update!.payload as { status: string }).status, "safety_refused");
});

Deno.test("storage quota after spend: R2 object deleted, ledger failed_storage_quota WITH cost logged", async () => {
  const h = makeHarness({
    insertFile: async () => {
      throw new Error("quota_exceeded storage");
    },
  });
  queueBare(h.db);
  const err = await expectError(generateImageCore(h.deps, baseInput()));
  assertEquals(err.code, "storage_quota_exceeded");
  assertEquals(h.deletes, [`contas/${CONTA}/files/fixed-uuid.png`]);
  const update = h.db.calls.find((c) =>
    c.table === "ai_image_generations" && c.operation === "update"
  );
  const patch = update!.payload as Record<string, unknown>;
  assertEquals(patch.status, "failed_storage_quota");
  assertEquals(patch.cost_usd_estimate, 0.067); // spend happened — cost stays on the ledger
});

// ── happy path ───────────────────────────────────────────────────────────────

Deno.test("happy path: R2 put at the tenant key, files row, ledger succeeded, quota in response", async () => {
  const h = makeHarness();
  queueBare(h.db);
  const out = await generateImageCore(h.deps, baseInput({ placement: "background" }));

  assertEquals(h.providerCalls[0].imageSize, "2K"); // background → 2K default
  assertEquals(h.puts[0].key, `contas/${CONTA}/files/fixed-uuid.png`);
  assertEquals(h.fileInserts[0].kind, "image");
  assertEquals(h.fileInserts[0].uploaded_by, "user-1");
  const update = h.db.calls.filter((c) =>
    c.table === "ai_image_generations" && c.operation === "update"
  ).pop();
  const patch = update!.payload as Record<string, unknown>;
  assertEquals(patch.status, "succeeded");
  assertEquals(patch.file_id, 900);
  assertEquals(patch.tokens_out, 42);

  assertEquals(out.file_id, 900);
  assertEquals(out.width, 928);
  assertEquals(out.height, 1152);
  assert(out.preview_url.startsWith("https://signed.example/"));
  assertEquals(out.quota, { used: 1, limit: 50, resets_at: out.quota.resets_at });
});

Deno.test("the prompt reaches ONLY the ledger insert (and the provider) — no other sink", async () => {
  const h = makeHarness();
  queueBare(h.db);
  const prompt = "SEGREDO-DO-CLIENTE fundo dourado";
  await generateImageCore(h.deps, baseInput({ prompt }));
  const carriers = h.db.calls.filter((c) => JSON.stringify(c.payload ?? {}).includes("SEGREDO"));
  assertEquals(carriers.length, 1, "exactly one DB write carries the prompt");
  assertEquals(carriers[0].table, "ai_image_generations");
  assertEquals(carriers[0].operation, "insert");
  assert(!h.fileInserts.some((p) => JSON.stringify(p).includes("SEGREDO")));
});

// ── idempotency ──────────────────────────────────────────────────────────────

Deno.test("idempotent replay: same key + succeeded row → same file_id, ZERO provider calls", async () => {
  const h = makeHarness();
  h.db.queue("ai_image_generations", "select", {
    data: { id: 7, status: "succeeded", file_id: 900, created_at: "2026-07-04T10:00:00Z" },
    error: null,
  });
  h.db.queue("files", "select", {
    data: { id: 900, r2_key: "contas/x/files/y.png", width: 1024, height: 1024 },
    error: null,
  });
  h.db.queue("ai_image_generations", "select", { data: [], error: null }); // quota recount
  const out = await generateImageCore(h.deps, baseInput({ idempotencyKey: "submission-abc-123" }));
  assertEquals(out.file_id, 900);
  assertEquals(out.replayed, true);
  assertEquals(h.providerCalls.length, 0);
});

Deno.test("idempotency: FRESH pending with the same key → generation_in_progress (retryable)", async () => {
  const h = makeHarness();
  const now = new Date("2026-07-04T12:00:00Z");
  h.deps.now = () => now;
  h.db.queue("ai_image_generations", "select", {
    data: {
      id: 7,
      status: "pending",
      file_id: null,
      created_at: new Date(now.getTime() - 60_000).toISOString(),
    },
    error: null,
  });
  const err = await expectError(
    generateImageCore(h.deps, baseInput({ idempotencyKey: "submission-abc-123" })),
  );
  assertEquals(err.code, "generation_in_progress");
  assertEquals(h.providerCalls.length, 0);
});

Deno.test("idempotency: failed row with the same key is REUSED as the reservation (unique index)", async () => {
  const h = makeHarness();
  h.db.queue("ai_image_generations", "select", {
    data: { id: 7, status: "provider_error", file_id: null, created_at: "2026-07-04T10:00:00Z" },
    error: null,
  });
  h.db.queue("ai_image_generations", "select", { data: [], error: null }); // quota count
  h.db.queue("ai_image_generations", "update", { data: [{ id: 7 }], error: null }); // CAS won
  const out = await generateImageCore(h.deps, baseInput({ idempotencyKey: "submission-abc-123" }));
  assertEquals(out.file_id, 900);
  assertEquals(h.providerCalls.length, 1);
  // No NEW ledger insert — the keyed row was recycled.
  assert(
    !h.db.calls.some((c) => c.table === "ai_image_generations" && c.operation === "insert"),
  );
});

// ── tenant checks + brand context ───────────────────────────────────────────

Deno.test("foreign reference_file_ids: uniform not-found message, provider never called", async () => {
  const h = makeHarness();
  h.db.queue("ai_image_generations", "select", { data: [], error: null }); // quota
  h.db.queue("files", "select", { data: [{ id: 1, r2_key: "a", mime_type: "image/png" }], error: null });
  const err = await expectError(
    generateImageCore(h.deps, baseInput({ referenceFileIds: [1, 999] })),
  );
  assertEquals(err.code, "invalid_reference");
  assertEquals(h.providerCalls.length, 0);
});

Deno.test("brand context (decision 18): colors + especialidade fold into the prompt; logo rides as a reference", async () => {
  const h = makeHarness();
  h.db.queue("ai_image_generations", "select", { data: [], error: null }); // quota
  h.db.queue("clientes", "select", { data: { id: 5 }, error: null }); // tenant check
  h.db.queue("hub_brand", "select", {
    data: { primary_color: "#eab308", secondary_color: "#12151a", logo_file_id: 77 },
    error: null,
  });
  h.db.queue("clientes", "select", { data: { especialidade: "Estética" }, error: null });
  h.db.queue("files", "select", { data: { r2_key: "logo-key", mime_type: "image/png" }, error: null });
  h.db.queue("ai_image_generations", "insert", { data: { id: 60 }, error: null });

  await generateImageCore(h.deps, baseInput({ clientId: 5, useBrandLogo: true }));
  const sent = h.providerCalls[0];
  assert(sent.prompt.includes("#eab308"), sent.prompt);
  assert(sent.prompt.includes("Estética"), sent.prompt);
  assertEquals(sent.references?.length, 1); // the materialized logo
  // The enriched prompt is what lands on the ledger too.
  const insert = h.db.calls.find((c) =>
    c.table === "ai_image_generations" && c.operation === "insert"
  );
  assert(((insert!.payload as { prompt: string }).prompt).includes("#eab308"));
});

Deno.test("use_brand_logo without a materialized logo: actionable error, no spend", async () => {
  const h = makeHarness();
  h.db.queue("ai_image_generations", "select", { data: [], error: null });
  h.db.queue("clientes", "select", { data: { id: 5 }, error: null });
  h.db.queue("hub_brand", "select", { data: { primary_color: null, secondary_color: null, logo_file_id: null }, error: null });
  h.db.queue("clientes", "select", { data: { especialidade: null }, error: null });
  const err = await expectError(
    generateImageCore(h.deps, baseInput({ clientId: 5, useBrandLogo: true })),
  );
  assertEquals(err.code, "invalid_reference");
  assert(err.message.includes("logo"), err.message);
  assertEquals(h.providerCalls.length, 0);
});

Deno.test("idempotency: losing the reuse CAS (another retry claimed the row) → generation_in_progress, NO provider call", async () => {
  const h = makeHarness();
  h.db.queue("ai_image_generations", "select", {
    data: { id: 7, status: "provider_error", file_id: null, created_at: "2026-07-04T10:00:00Z" },
    error: null,
  });
  h.db.queue("ai_image_generations", "select", { data: [], error: null }); // quota count
  h.db.queue("ai_image_generations", "update", { data: [], error: null }); // CAS lost: zero rows
  const err = await expectError(
    generateImageCore(h.deps, baseInput({ idempotencyKey: "submission-abc-123" })),
  );
  assertEquals(err.code, "generation_in_progress");
  assertEquals(err.retryable, true);
  assertEquals(h.providerCalls.length, 0); // the loser NEVER reaches the provider
});
