// Image-generation core (design §8, plan T5.4): ONE pipeline shared by the MCP tool
// `generate_image` (slice 5) and the CRM's `generate-image` edge function (slice 6). Owns every
// gate and side effect in order:
//   feature_ai_images → burst limit → idempotency replay → monthly quota (RESERVATION
//   predicate: succeeded OR pending<10min — counting only succeeded lets N concurrent requests
//   all reserve spend) → tenant-verify every supplied id → ledger row INSERTED 'pending'
//   BEFORE the provider call (spend is never unlogged) → provider → R2 put → files row
//   (storage quota; on rejection AFTER spend: delete the R2 object, cost stays logged) →
//   ledger 'succeeded'.
// A supplied post_id is recorded on the LEDGER ONLY — generated images are design assets and
// never become post_file_links rows (§5.2). The prompt lives exclusively in the ledger row
// (tenant content class, RLS-scoped) — callers must NEVER copy it into audit logs.
//
// Failures throw ImageGenError with the §8 envelope fields (code / PT message / retryable /
// retry_after) — entrypoints map it to their own error shapes; provider internals are logged
// here and never surfaced.
import {
  ImageAspectRatio,
  ImageGenProvider,
  ImageSize,
  ProviderSafetyError,
  ProviderTimeoutError,
} from "./provider.ts";

export type ImageGenErrorCode =
  | "feature_disabled"
  | "quota_exhausted"
  | "rate_limited"
  | "generation_in_progress"
  | "provider_timeout"
  | "provider_error"
  | "safety_refusal"
  | "storage_quota_exceeded"
  | "storage_error"
  | "invalid_reference";

export class ImageGenError extends Error {
  constructor(
    public code: ImageGenErrorCode,
    message: string,
    public retryable: boolean,
    public retryAfter?: string,
  ) {
    super(message);
  }
}

// Burst limits (§8): the rate table auto-purges >1h, so windows must stay ≤3600s.
export const BURST_CONTA_PER_HOUR = 20;
export const BURST_MCP_KEY_PER_10MIN = 10;
export const RESERVATION_WINDOW_MIN = 10;

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

export interface ImageGenCoreDeps {
  db: Db;
  provider: ImageGenProvider | undefined;
  isFeatureEnabled: (contaId: string, feature: string) => Promise<boolean>;
  monthlyLimit: (contaId: string) => Promise<number | null>; // null = unlimited
  checkRateLimit: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  putObject: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  deleteObject: (key: string) => Promise<void>;
  /** file_insert_with_quota — throws with "quota_exceeded" in the message on storage quota. */
  insertFile: (p: Record<string, unknown>) => Promise<{ id: number }>;
  /** R2 bytes for reference images (and the brand logo). */
  resolveFileBytes: (r2Key: string) => Promise<Uint8Array | null>;
  signUrl: (key: string) => Promise<string>;
  randomUUID: () => string;
  now?: () => Date;
  logError: (context: string, error: unknown) => void;
}

export interface ImageGenInput {
  contaId: string;
  source: "crm" | "mcp";
  createdBy: string;
  createdVia: "human" | "agent";
  mcpKeyId?: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  /** 'background' keys the 2K default (1K's 928-wide 4:5 would upscale into a 1080 canvas);
   * 'element' keys 1K. Explicit `quality` overrides. */
  placement?: "background" | "element";
  quality?: ImageSize;
  clientId?: number;
  postId?: number;
  referenceFileIds?: number[];
  useBrandLogo?: boolean;
  idempotencyKey?: string;
}

export interface ImageGenOutput {
  file_id: number;
  preview_url: string;
  width: number;
  height: number;
  model: string;
  cost_usd_estimate: number;
  quota: { used: number; limit: number | null; resets_at: string };
  /** True when this call replayed an earlier successful generation (no provider spend). */
  replayed?: boolean;
}

export function resolveImageSize(input: Pick<ImageGenInput, "placement" | "quality">): ImageSize {
  if (input.quality) return input.quality;
  return input.placement === "background" ? "2K" : "1K";
}

function monthBoundsUtc(now: Date): { start: string; resetsAt: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), resetsAt: next.toISOString() };
}

interface LedgerRow {
  id: number;
  status: string;
  file_id: number | null;
  created_at: string;
}

/** Reservation-predicate count for the current UTC month (mirrors the SQL trigger backstop). */
async function reservedCount(deps: ImageGenCoreDeps, contaId: string, now: Date): Promise<number> {
  const { start } = monthBoundsUtc(now);
  const staleBefore = new Date(now.getTime() - RESERVATION_WINDOW_MIN * 60_000).toISOString();
  const { data, error } = await deps.db
    .from("ai_image_generations")
    .select("id, status, created_at")
    .eq("conta_id", contaId)
    .gte("created_at", start);
  if (error) throw error;
  return ((data ?? []) as Array<{ status: string; created_at: string }>).filter((r) =>
    r.status === "succeeded" ||
    (r.status === "pending" && r.created_at > staleBefore)
  ).length;
}

async function setLedger(
  deps: ImageGenCoreDeps,
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await deps.db.from("ai_image_generations").update(patch).eq("id", id);
  if (error) deps.logError("image-gen:ledger-update", error);
}

/** Quota snapshot for read tools (get_design_capabilities): same reservation predicate as the
 * pipeline, zero side effects. */
export async function quotaSnapshot(
  deps: Pick<ImageGenCoreDeps, "db" | "monthlyLimit">,
  contaId: string,
  nowDate?: Date,
): Promise<{ used: number; limit: number | null; resets_at: string }> {
  const now = nowDate ?? new Date();
  const { resetsAt } = monthBoundsUtc(now);
  return {
    used: await reservedCount(deps as ImageGenCoreDeps, contaId, now),
    limit: await deps.monthlyLimit(contaId),
    resets_at: resetsAt,
  };
}

export async function generateImageCore(
  deps: ImageGenCoreDeps,
  input: ImageGenInput,
): Promise<ImageGenOutput> {
  const now = deps.now ? deps.now() : new Date();
  const { resetsAt } = monthBoundsUtc(now);

  // ── Gates (all BEFORE any provider spend) ──────────────────────────────────
  if (!(await deps.isFeatureEnabled(input.contaId, "feature_ai_images"))) {
    throw new ImageGenError(
      "feature_disabled",
      "Geração de imagens com IA não está disponível no plano deste workspace.",
      false,
    );
  }

  const burstOk = input.source === "mcp" && input.mcpKeyId
    ? await deps.checkRateLimit(`imggen:key:${input.mcpKeyId}`, BURST_MCP_KEY_PER_10MIN, 600)
    : true;
  const contaBurstOk = await deps.checkRateLimit(
    `imggen:conta:${input.contaId}`,
    BURST_CONTA_PER_HOUR,
    3600,
  );
  if (!burstOk || !contaBurstOk) {
    throw new ImageGenError(
      "rate_limited",
      "Muitas gerações em sequência — aguarde alguns minutos e tente novamente.",
      true,
    );
  }

  // ── Idempotency replay (before quota: a replay never spends) ──────────────
  if (input.idempotencyKey) {
    const { data } = await deps.db
      .from("ai_image_generations")
      .select("id, status, file_id, created_at")
      .eq("conta_id", input.contaId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    const existing = data as LedgerRow | null;
    if (existing) {
      const replay = await replayExisting(deps, existing, resetsAt, now, input.contaId);
      if (replay) return replay;
      // Failed/stale row with the same key: reuse it as the pending reservation (the partial
      // unique index forbids a second insert with this key). The reuse itself is CAS-guarded
      // inside runPipeline — two racers can't both flip it to pending.
      return await runPipeline(deps, input, now, resetsAt, existing);
    }
  }

  return await runPipeline(deps, input, now, resetsAt, null);
}

async function replayExisting(
  deps: ImageGenCoreDeps,
  existing: LedgerRow,
  resetsAt: string,
  now: Date,
  contaId: string,
): Promise<ImageGenOutput | null> {
  if (existing.status === "succeeded" && existing.file_id) {
    const { data: file } = await deps.db
      .from("files")
      .select("id, r2_key, width, height")
      .eq("id", existing.file_id)
      .maybeSingle();
    if (!file) return null; // file deleted since — fall through to a fresh attempt
    const f = file as { id: number; r2_key: string; width: number | null; height: number | null };
    return {
      file_id: f.id,
      preview_url: await deps.signUrl(f.r2_key),
      width: f.width ?? 0,
      height: f.height ?? 0,
      model: "replay",
      cost_usd_estimate: 0,
      quota: {
        used: await reservedCount(deps, contaId, now),
        limit: await deps.monthlyLimit(contaId),
        resets_at: resetsAt,
      },
      replayed: true,
    };
  }
  const staleBefore = new Date(now.getTime() - RESERVATION_WINDOW_MIN * 60_000).toISOString();
  if (existing.status === "pending" && existing.created_at > staleBefore) {
    throw new ImageGenError(
      "generation_in_progress",
      "Uma geração com esta idempotency_key ainda está em andamento — aguarde e repita.",
      true,
    );
  }
  return null;
}

async function runPipeline(
  deps: ImageGenCoreDeps,
  input: ImageGenInput,
  now: Date,
  resetsAt: string,
  reuseRow: LedgerRow | null,
): Promise<ImageGenOutput> {
  // ── Monthly quota (reservation predicate, friendly pre-check) ─────────────
  const limit = await deps.monthlyLimit(input.contaId);
  const used = await reservedCount(deps, input.contaId, now);
  if (limit !== null && used >= limit) {
    throw new ImageGenError(
      "quota_exhausted",
      `Cota mensal de imagens atingida (${limit}). Renova em ${resetsAt.slice(0, 10)}.`,
      false,
      resetsAt,
    );
  }

  // ── Tenant verification of EVERY supplied id ───────────────────────────────
  if (input.clientId !== undefined) {
    const { data } = await deps.db
      .from("clientes")
      .select("id")
      .eq("id", input.clientId)
      .eq("conta_id", input.contaId)
      .maybeSingle();
    if (!data) {
      throw new ImageGenError("invalid_reference", "Cliente não encontrado neste workspace.", false);
    }
  }
  if (input.postId !== undefined) {
    const { data } = await deps.db
      .from("workflow_posts")
      .select("id")
      .eq("id", input.postId)
      .eq("conta_id", input.contaId)
      .maybeSingle();
    if (!data) {
      throw new ImageGenError("invalid_reference", "Post não encontrado neste workspace.", false);
    }
  }

  const references: Array<{ bytes: Uint8Array; mime: string }> = [];
  const refIds = input.referenceFileIds ?? [];
  if (refIds.length > 0) {
    const { data } = await deps.db
      .from("files")
      .select("id, r2_key, mime_type")
      .eq("conta_id", input.contaId)
      .eq("kind", "image")
      .in("id", refIds);
    const rows = (data ?? []) as Array<{ id: number; r2_key: string; mime_type: string }>;
    if (rows.length !== refIds.length) {
      // Uniform message for missing vs foreign — never reveal foreign existence (§2.4 rule 2).
      throw new ImageGenError(
        "invalid_reference",
        "Uma ou mais imagens de referência não foram encontradas neste workspace.",
        false,
      );
    }
    for (const row of rows) {
      const bytes = await deps.resolveFileBytes(row.r2_key);
      if (!bytes) {
        throw new ImageGenError(
          "invalid_reference",
          "Não foi possível carregar uma imagem de referência.",
          false,
        );
      }
      references.push({ bytes, mime: row.mime_type });
    }
  }

  // ── Brand context (decision 18) ────────────────────────────────────────────
  let prompt = input.prompt;
  if (input.clientId !== undefined) {
    const [{ data: brand }, { data: cliente }] = await Promise.all([
      deps.db.from("hub_brand")
        .select("primary_color, secondary_color, logo_file_id")
        .eq("cliente_id", input.clientId)
        .maybeSingle(),
      deps.db.from("clientes")
        .select("especialidade")
        .eq("id", input.clientId)
        .eq("conta_id", input.contaId)
        .maybeSingle(),
    ]);
    const b = brand as
      | { primary_color: string | null; secondary_color: string | null; logo_file_id: number | null }
      | null;
    const context: string[] = [];
    const especialidade = (cliente as { especialidade?: string | null } | null)?.especialidade;
    if (especialidade) context.push(`Segmento do cliente: ${especialidade}.`);
    const colors = [b?.primary_color, b?.secondary_color].filter(Boolean);
    if (colors.length) context.push(`Cores da marca: ${colors.join(", ")}.`);
    if (context.length) prompt = `${input.prompt}\n\n(${context.join(" ")})`;

    if (input.useBrandLogo) {
      if (!b?.logo_file_id) {
        throw new ImageGenError(
          "invalid_reference",
          "Este cliente não tem logo materializado — importe-o primeiro (rota /brand-logo ou upload no Hub).",
          false,
        );
      }
      const { data: logoFile } = await deps.db
        .from("files")
        .select("r2_key, mime_type")
        .eq("id", b.logo_file_id)
        .eq("conta_id", input.contaId)
        .maybeSingle();
      const lf = logoFile as { r2_key: string; mime_type: string } | null;
      const bytes = lf ? await deps.resolveFileBytes(lf.r2_key) : null;
      if (!bytes) {
        throw new ImageGenError(
          "invalid_reference",
          "Não foi possível carregar o logo da marca.",
          false,
        );
      }
      references.push({ bytes, mime: lf!.mime_type });
    }
  } else if (input.useBrandLogo) {
    throw new ImageGenError(
      "invalid_reference",
      "use_brand_logo exige client_id.",
      false,
    );
  }

  if (!deps.provider) {
    throw new ImageGenError(
      "provider_error",
      "Geração de imagens não está configurada neste ambiente.",
      false,
    );
  }

  const imageSize = resolveImageSize(input);

  // ── Ledger reservation BEFORE the provider call (spend is never unlogged) ──
  let ledgerId: number;
  if (reuseRow !== null) {
    // Compare-and-swap on (status, created_at): two concurrent retries of the same key both
    // read the same failed/stale row, but only ONE update matches — the loser sees zero rows
    // and backs off WITHOUT calling the provider (the BEFORE-INSERT quota trigger never fires
    // on updates, so this guard is what keeps the reuse path double-spend-safe).
    const { data: claimed, error } = await deps.db
      .from("ai_image_generations")
      .update({
        status: "pending",
        created_at: now.toISOString(),
        aspect_ratio: input.aspectRatio,
        image_size: imageSize,
        prompt,
        reference_count: references.length,
        file_id: null,
      })
      .eq("id", reuseRow.id)
      .eq("status", reuseRow.status)
      .eq("created_at", reuseRow.created_at)
      .select("id");
    if (error) throw error;
    if (!claimed || (claimed as unknown[]).length === 0) {
      throw new ImageGenError(
        "generation_in_progress",
        "Outra tentativa com esta idempotency_key acabou de assumir — aguarde e repita.",
        true,
      );
    }
    ledgerId = reuseRow.id;
  } else {
    const { data, error } = await deps.db
      .from("ai_image_generations")
      .insert({
        conta_id: input.contaId,
        cliente_id: input.clientId ?? null,
        post_id: input.postId ?? null, // ledger ONLY — never post_file_links (§5.2)
        source: input.source,
        mcp_key_id: input.mcpKeyId ?? null,
        // Attribution from the adapter itself, so failed rows point at the provider/model that
        // actually served the attempt (success rows are later overwritten with the result's).
        provider: deps.provider.name ?? "unknown",
        model: deps.provider.model ?? "unknown",
        aspect_ratio: input.aspectRatio,
        image_size: imageSize,
        prompt,
        reference_count: references.length,
        idempotency_key: input.idempotencyKey ?? null,
        status: "pending",
        created_by: input.createdBy,
        created_via: input.createdVia,
      })
      .select("id")
      .single();
    if (error) {
      const message = (error as { message?: string }).message ?? "";
      // Trigger backstop (quota race) or idempotency-key race — both are clean client errors.
      if (message.includes("plan_limit")) {
        throw new ImageGenError(
          "quota_exhausted",
          `Cota mensal de imagens atingida. Renova em ${resetsAt.slice(0, 10)}.`,
          false,
          resetsAt,
        );
      }
      if (message.includes("duplicate") || message.includes("unique")) {
        throw new ImageGenError(
          "generation_in_progress",
          "Uma geração com esta idempotency_key já existe — repita a chamada para obter o resultado.",
          true,
        );
      }
      throw error;
    }
    ledgerId = (data as { id: number }).id;
  }

  // ── Provider ───────────────────────────────────────────────────────────────
  const startedAt = Date.now();
  let generated;
  try {
    generated = await deps.provider.generate({
      prompt,
      aspectRatio: input.aspectRatio,
      imageSize,
      references,
    });
  } catch (e) {
    const latency = Date.now() - startedAt;
    if (e instanceof ProviderSafetyError) {
      await setLedger(deps, ledgerId, { status: "safety_refused", provider_latency_ms: latency });
      throw new ImageGenError(
        "safety_refusal",
        "O provedor recusou este prompt por segurança — tente outro prompt.",
        false,
      );
    }
    if (e instanceof ProviderTimeoutError) {
      await setLedger(deps, ledgerId, { status: "provider_timeout", provider_latency_ms: latency });
      throw new ImageGenError(
        "provider_timeout",
        "O provedor demorou demais — tente novamente em instantes.",
        true,
      );
    }
    deps.logError("image-gen:provider", e);
    await setLedger(deps, ledgerId, { status: "provider_error", provider_latency_ms: latency });
    throw new ImageGenError(
      "provider_error",
      "Falha na geração de imagem — tente novamente em instantes.",
      true,
    );
  }
  const latency = Date.now() - startedAt;
  const spendPatch = {
    provider_latency_ms: latency,
    tokens_out: generated.outputTokens ?? null,
    cost_usd_estimate: generated.costEstimateUsd,
  };

  // ── Store: R2 → files (storage quota) → ledger succeeded ──────────────────
  const r2Key = `contas/${input.contaId}/files/${deps.randomUUID()}.png`;
  try {
    await deps.putObject(r2Key, generated.bytes, generated.mime);
  } catch (e) {
    deps.logError("image-gen:r2-put", e);
    await setLedger(deps, ledgerId, { status: "failed_storage", ...spendPatch });
    throw new ImageGenError(
      "storage_error",
      "A imagem foi gerada mas não pôde ser armazenada — tente novamente.",
      true,
    );
  }

  let fileId: number;
  try {
    const inserted = await deps.insertFile({
      conta_id: input.contaId,
      folder_id: "",
      r2_key: r2Key,
      thumbnail_r2_key: "",
      name: `ai-${input.aspectRatio.replace(":", "x")}-${ledgerId}.png`,
      kind: "image",
      mime_type: generated.mime,
      size_bytes: generated.bytes.byteLength,
      width: generated.width || "",
      height: generated.height || "",
      duration_seconds: "",
      uploaded_by: input.createdBy,
    });
    fileId = inserted.id;
  } catch (e) {
    await deps.deleteObject(r2Key).catch((err) => deps.logError("image-gen:r2-cleanup", err));
    const message = (e as Error)?.message ?? "";
    if (message.includes("quota_exceeded")) {
      await setLedger(deps, ledgerId, { status: "failed_storage_quota", ...spendPatch });
      throw new ImageGenError(
        "storage_quota_exceeded",
        "Limite de armazenamento do plano atingido — libere espaço e tente novamente.",
        false,
      );
    }
    deps.logError("image-gen:file-insert", e);
    await setLedger(deps, ledgerId, { status: "failed_storage", ...spendPatch });
    throw new ImageGenError(
      "storage_error",
      "A imagem foi gerada mas não pôde ser registrada — tente novamente.",
      true,
    );
  }

  await setLedger(deps, ledgerId, { status: "succeeded", file_id: fileId, ...spendPatch });

  return {
    file_id: fileId,
    preview_url: await deps.signUrl(r2Key),
    width: generated.width,
    height: generated.height,
    model: generated.model,
    cost_usd_estimate: generated.costEstimateUsd,
    quota: {
      used: used + 1,
      limit,
      resets_at: resetsAt,
    },
  };
}
