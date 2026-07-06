// generate-image — the CRM's in-editor AI image path (design §8, plan T6.1). JWT ON (gateway
// verifies; the handler still resolves the user itself, file-upload-finalize pattern). It is a
// THIN entrypoint: the entire pipeline (feature/burst/quota gates, ledger, provider, R2, files)
// lives in the shared image-gen core — NO double-enforcement here, the core owns every gate.
// The only edge-specific work is auth, request shaping (source:'crm', createdVia:'human'), the
// §8 failure envelope, and the prompt-free spend audit.
import { createJsonResponder } from "../_shared/http.ts";
import {
  generateImageCore,
  ImageGenError,
  type ImageGenCoreDeps,
  type ImageGenInput,
} from "../_shared/image-gen/core.ts";

const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
const PLACEMENTS = ["background", "element"] as const;
const QUALITIES = ["1K", "2K"] as const;

export interface GenerateImageDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  getUser: (token: string) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<{ conta_id: string } | null>;
  imageGen: ImageGenCoreDeps;
  insertAuditLog: (entry: {
    conta_id: string;
    actor_user_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  logError: (context: string, error: unknown) => void;
}

export function createGenerateImageHandler(deps: GenerateImageDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const user = await deps.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "unauthorized" }, 401);

    const profile = await deps.getProfile(user.id);
    if (!profile?.conta_id) return json({ error: "profile_not_found" }, 403);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    // Light request validation (the CRM UI never sends bad shapes, but the boundary re-checks;
    // heavy business gating is the core's job, not ours).
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > 2000) return json({ error: "invalid_prompt" }, 400);
    const aspectRatio = body.aspect_ratio;
    if (!ASPECT_RATIOS.includes(aspectRatio as never)) {
      return json({ error: "invalid_aspect_ratio" }, 400);
    }
    if (body.placement !== undefined && !PLACEMENTS.includes(body.placement as never)) {
      return json({ error: "invalid_placement" }, 400);
    }
    if (body.quality !== undefined && !QUALITIES.includes(body.quality as never)) {
      return json({ error: "invalid_quality" }, 400);
    }

    const input: ImageGenInput = {
      contaId: profile.conta_id,
      source: "crm",
      createdBy: user.id,
      createdVia: "human",
      prompt,
      aspectRatio: aspectRatio as ImageGenInput["aspectRatio"],
      placement: body.placement as ImageGenInput["placement"],
      quality: body.quality as ImageGenInput["quality"],
      clientId: typeof body.client_id === "number" ? body.client_id : undefined,
      postId: typeof body.post_id === "number" ? body.post_id : undefined,
      referenceFileIds: Array.isArray(body.reference_file_ids)
        ? (body.reference_file_ids as unknown[]).filter((n): n is number => typeof n === "number")
        : undefined,
      useBrandLogo: body.use_brand_logo === true,
      idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : undefined,
    };

    let result;
    try {
      result = await generateImageCore(deps.imageGen, input);
    } catch (e) {
      if (e instanceof ImageGenError) {
        // §8 failure envelope — generic PT message, provider internals already logged in the core.
        return json({
          error: {
            code: e.code,
            message: e.message,
            retryable: e.retryable,
            ...(e.retryAfter ? { retry_after: e.retryAfter } : {}),
          },
        }, statusForCode(e.code));
      }
      deps.logError("generate-image", e);
      return json({ error: { code: "provider_error", message: "Erro interno.", retryable: true } }, 500);
    }

    // Spend audit (§8): model / AR / cost / file_id — NEVER the prompt (ledger-only, RLS-scoped).
    await deps.insertAuditLog({
      conta_id: profile.conta_id,
      actor_user_id: user.id,
      action: "estudio.generate_image",
      resource_type: "ai_image",
      resource_id: String(result.file_id),
      metadata: {
        file_id: result.file_id,
        aspect_ratio: input.aspectRatio,
        placement: input.placement ?? null,
        model: result.model,
        cost_usd_estimate: result.cost_usd_estimate,
        prompt_len: prompt.length,
        reference_count: (input.referenceFileIds?.length ?? 0) + (input.useBrandLogo ? 1 : 0),
        replayed: result.replayed ?? false,
      },
    });

    return json(result, 200);
  };
}

/** Maps the §8 error taxonomy onto HTTP status so the CRM's callFn surfaces the right class. */
function statusForCode(code: ImageGenError["code"]): number {
  switch (code) {
    case "feature_disabled":
      return 403;
    case "quota_exhausted":
      return 402; // Payment Required — over the plan's monthly AI-image allowance
    case "storage_quota_exceeded":
      return 413; // matches every other storage-quota path in the repo (file-upload-finalize, …)
    case "rate_limited":
    case "generation_in_progress":
      return 429;
    case "invalid_reference":
      return 400;
    case "safety_refusal":
      return 422;
    default:
      return 502; // provider_timeout / provider_error / storage_error — upstream/infra
  }
}
