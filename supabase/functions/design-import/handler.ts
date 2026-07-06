// design-import — Estúdio slice C (image → editable design). Turns a post's raw image into a
// design: crop/normalize the clicked image to a preset, extract its text via vision, inpaint the
// background clean (text removed), then compose a fresh .fig with the reconstructed background +
// the extracted text as editable layers + every sibling image as its own frame. Own-auth
// (Bearer JWT verified in application code, verify_jwt = false — file-upload-finalize pattern,
// same as design-manage), NOT the platform gateway.
//
// SEQUENTIAL pipeline (every gate before the next, no provider/vision spend on an earlier
// failure): auth → feature_estudio AND feature_ai_images → eligibility (post exists/editable,
// tipo, no video, no design attached) → resolve link_id (uniform invalid_reference, never reveal
// foreign existence) → burst gate → normalize (doc-service crop) → vision (extractTextBlocks;
// failure aborts BEFORE any provider spend) → inpaint (generateImageCore; its own gates/ledger run
// inside) → compose (doc-service) → putBlob + create_design (p_media_hold=true) → audit
// (metadata only — NEVER extracted text content) → fireRender → 201.
//
// Failure envelope mirrors generate-image/handler.ts's §8 style: {error:{code,message,retryable}}.
// On failure AFTER the inpaint succeeds, the background file row is left as-is (a normal AI-gen
// asset; the idempotency key makes a retry free) — log and return the mapped error, never try to
// unwind quota or delete it.
import { createJsonResponder } from "../_shared/http.ts";
import {
  generateImageCore,
  ImageGenError,
  type ImageGenCoreDeps,
  type ImageGenInput,
} from "../_shared/image-gen/core.ts";
import { extractTextBlocks, VisionError, type TextBlock } from "../_shared/image-gen/vision.ts";
import { DocServiceError, type ComposeSpec } from "../_shared/doc-service.ts";

// Mirrors design-manage's EDITABLE_STATUSES (20260706000001: design work may continue while the
// post awaits client review). Duplicated here rather than exported from design-manage/handler.ts
// to avoid coupling two independently-deployed functions to one shared private constant.
const EDITABLE_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente", "enviado_cliente"];

// v1: reels are unsupported here (design-manage's create-attached path uses a distinct
// reel_cover format with its own single-image semantics; image-import targets feed/carrossel).
// Mirrors design-manage's TIPO_TO_FORMAT (duplicated per the constraint: prefer a small private
// copy here over restructuring a shared module for one constant).
const TIPO_TO_FORMAT: Record<string, "feed" | "carrossel"> = { feed: "feed", carrossel: "carrossel" };

const PRESETS = ["1:1", "4:5", "9:16"] as const;
type Preset = (typeof PRESETS)[number];
const PRESET_RATIOS: Record<Preset, number> = { "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16 };
const FALLBACK_PRESET: Preset = "4:5";

const BURST_MAX = 20;
const BURST_WINDOW_SECONDS = 3600;

// Fixed PT inpaint instruction (decision from the plan): remove ALL text/typography, reconstruct
// the background naturally, change nothing else about the composition/subject/colors.
const INPAINT_PROMPT =
  "Remova TODO o texto e elementos tipográficos desta imagem — títulos, subtítulos, legendas, " +
  "textos pequenos, arrobas/handles (@usuario), rodapés, selos e marcas d'água. Não deixe NENHUMA " +
  "letra, número ou símbolo tipográfico visível. Reconstrua o fundo de forma natural e contínua " +
  "no lugar onde cada texto estava. Não altere mais nada: mantenha exatamente a mesma composição, " +
  "sujeito, cores e estilo do restante da imagem.";

export interface PostRow {
  id: number;
  titulo: string | null;
  tipo: string;
  status: string;
}

export interface PostMediaRow {
  /** post_file_links.id — the value-space the CRM's `link_id` actually lives in (PostMedia.id,
   * see apps/crm/src/store/designs.ts). Distinct PK sequence from file_id; never compare the
   * two. */
  link_id: number;
  file_id: number;
  kind: string;
  r2_key: string;
  sort_order: number;
}

export interface FileRow {
  id: number;
  kind: string;
  r2_key: string;
  width: number | null;
  height: number | null;
}

/** The clicked link resolved against post_file_links JOIN files — link_id + post_id + conta_id
 * all matched in ONE query, uniform null for every mismatch flavor (not-found / foreign conta /
 * not linked to this post / not an image). Never distinguish these to the client (invalid_reference
 * covers all of them). */
export interface ResolvedLink {
  link_id: number;
  file: FileRow;
}

export interface DesignImportDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  getUser: (token: string) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<{ conta_id: string } | null>;
  isFeatureEnabled: (contaId: string, feature: "feature_estudio" | "feature_ai_images") => Promise<boolean>;
  getPost: (postId: number, contaId: string) => Promise<PostRow | null>;
  hasDesignAttached: (postId: number, contaId: string) => Promise<boolean>;
  getPostMedia: (postId: number, contaId: string) => Promise<PostMediaRow[]>;
  getFile: (fileId: number, contaId: string) => Promise<FileRow | null>;
  /** Conta-scoped resolve of the clicked link: post_file_links.id = linkId AND post_id = postId
   * AND conta_id = contaId, joined to files (kind must be 'image'). Null for any mismatch. */
  resolveLink: (postId: number, linkId: number, contaId: string) => Promise<ResolvedLink | null>;
  checkRateLimit: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  signGetUrl: (r2Key: string) => Promise<string>;
  docService: {
    normalize: (spec: { image: { url: string; mime?: string }; preset: Preset }) => Promise<Uint8Array>;
    compose: (spec: ComposeSpec) => Promise<Uint8Array>;
  };
  visionApiKey: () => string | null;
  extractTextBlocks: typeof extractTextBlocks;
  imageGen: ImageGenCoreDeps;
  putBlob: (r2Key: string, bytes: Uint8Array) => Promise<void>;
  createDesign: (
    contaId: string,
    input: { postId: number; format: "feed" | "carrossel"; name: string | null },
    r2Key: string,
    docHash: string,
    docBytes: number,
    createdBy: string,
  ) => Promise<number>;
  fireRender: (designId: number, rev: number) => void;
  randomUUID: () => string;
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function blobKey(deps: DesignImportDeps, contaId: string): string {
  return `designs/${contaId}/${deps.randomUUID()}-r1.fig`;
}

/** Nearest of 1:1 / 4:5 / 9:16 by aspect ratio (width/height). Missing/zero dims fall back to
 * 4:5 — the caller notes the fallback in the audit metadata. */
function choosePreset(width: number | null, height: number | null): { preset: Preset; fallback: boolean } {
  if (!width || !height) return { preset: FALLBACK_PRESET, fallback: true };
  const ratio = width / height;
  let best: Preset = PRESETS[0];
  let bestDelta = Infinity;
  for (const p of PRESETS) {
    const delta = Math.abs(PRESET_RATIOS[p] - ratio);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }
  return { preset: best, fallback: false };
}

interface ErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

function envelope(code: string, message: string, retryable: boolean): { error: ErrorBody } {
  return { error: { code, message, retryable } };
}

/** Maps create_design's raw RPC exception message onto the §8 envelope (mirrors
 * design-manage's mapDesignRpcError string parsing — the RPC's error contract is shared). A
 * post-eligibility race (someone else attaches a design, or the post's status/existence changes)
 * between our pre-check and this final RPC call surfaces here with its proper coded status
 * rather than a generic 502, even though it happens AFTER the inpaint spend succeeded. */
function mapCreateDesignError(message: string): { code: string; message: string; retryable: boolean; status: number } {
  if (message === "post_not_found") {
    return { code: "post_not_found", message: "Post não encontrado.", retryable: false, status: 404 };
  }
  if (message === "cliente_not_found") {
    return { code: "post_not_found", message: "Post não encontrado.", retryable: false, status: 404 };
  }
  if (message.startsWith("post_not_editable:")) {
    return { code: "post_not_editable", message: "Este post não pode ser editado no momento.", retryable: false, status: 403 };
  }
  if (message === "post_already_designed") {
    return { code: "post_already_designed", message: "Este post já tem um design.", retryable: false, status: 409 };
  }
  // Unrecognized RPC exception — never surface raw internals to the client (security rule).
  return { code: "compose_failed", message: "Não foi possível criar o design.", retryable: true, status: 502 };
}

/** §8-style status mapping — extends generate-image's statusForCode with the pipeline's own
 * eligibility / doc-service codes. */
function statusForCode(code: string): number {
  switch (code) {
    case "feature_disabled":
      return 403;
    case "post_not_editable":
      return 403;
    case "post_not_found":
      return 404;
    case "post_tipo_unsupported":
    case "post_has_video":
      return 422;
    case "post_already_designed":
      return 409;
    case "invalid_reference":
      return 400;
    case "quota_exhausted":
      return 402;
    case "storage_quota_exceeded":
      return 413;
    case "rate_limited":
    case "generation_in_progress":
      return 429;
    case "safety_refusal":
      return 422;
    case "doc_too_large":
      return 413;
    case "vision_failed":
    case "vision_unavailable":
    case "normalize_failed":
    case "compose_failed":
      return 502;
    default:
      return 502; // provider_timeout / provider_error / storage_error — upstream/infra
  }
}

export function createDesignImportHandler(deps: DesignImportDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json(envelope("method_not_allowed", "Método não permitido.", false), 405);

    // ── 1. Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(envelope("unauthorized", "Não autenticado.", false), 401);
    const user = await deps.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json(envelope("unauthorized", "Não autenticado.", false), 401);

    const profile = await deps.getProfile(user.id);
    if (!profile?.conta_id) return json(envelope("profile_not_found", "Perfil não encontrado.", false), 403);
    const contaId = profile.conta_id;

    // ── 1b. Feature gates (both required; report which is missing) ───────────
    if (!(await deps.isFeatureEnabled(contaId, "feature_estudio"))) {
      return json(envelope("feature_disabled", "Estúdio não está disponível no plano deste workspace.", false), 403);
    }
    if (!(await deps.isFeatureEnabled(contaId, "feature_ai_images"))) {
      return json(
        envelope("feature_disabled", "Geração de imagens com IA não está disponível no plano deste workspace.", false),
        403,
      );
    }

    let body: { post_id?: unknown; link_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(envelope("invalid_json", "JSON inválido.", false), 400);
    }
    const postId = typeof body.post_id === "number" ? body.post_id : NaN;
    const linkId = typeof body.link_id === "number" ? body.link_id : NaN;
    if (isNaN(postId) || isNaN(linkId)) {
      return json(envelope("invalid_request", "post_id e link_id são obrigatórios.", false), 400);
    }

    // ── 2. Eligibility (mirrors design-manage create-attached) ────────────────
    const post = await deps.getPost(postId, contaId);
    if (!post) return json(envelope("post_not_found", "Post não encontrado.", false), 404);
    const format = TIPO_TO_FORMAT[post.tipo];
    if (!format) {
      return json(envelope("post_tipo_unsupported", "Este tipo de post não suporta importação de imagem.", false), 422);
    }
    if (!EDITABLE_STATUSES.includes(post.status)) {
      return json(envelope("post_not_editable", "Este post não pode ser editado no momento.", false), 403);
    }

    const media = await deps.getPostMedia(postId, contaId);
    if (media.some((m) => m.kind === "video")) {
      return json(envelope("post_has_video", "Posts com vídeo não suportam importação de imagem.", false), 422);
    }
    if (await deps.hasDesignAttached(postId, contaId)) {
      return json(envelope("post_already_designed", "Este post já tem um design.", false), 409);
    }

    // ── 3. Resolve link_id (post_file_links.id — NOT files.id) → the clicked file; ONE
    // conta-scoped query joining post_file_links + files, uniform error for every mismatch
    // flavor (not found / foreign conta / not linked to this post / not an image) so we never
    // reveal foreign existence. ──
    const resolved = await deps.resolveLink(postId, linkId, contaId);
    if (!resolved) {
      return json(envelope("invalid_reference", "Imagem não encontrada neste post.", false), 400);
    }
    const clickedFile = resolved.file;

    // Frames in sort_order: every image link of the post (siblings keep their own URL/no texts).
    const imageFrames = media.filter((m) => m.kind === "image").sort((a, b) => a.sort_order - b.sort_order);

    // ── 4. Burst gate ──────────────────────────────────────────────────────────
    if (!(await deps.checkRateLimit(`imgimport:conta:${contaId}`, BURST_MAX, BURST_WINDOW_SECONDS))) {
      return json(
        envelope("rate_limited", "Muitas importações em sequência — aguarde alguns minutos e tente novamente.", true),
        429,
      );
    }

    // ── 5. Normalize: presign the clicked file's r2_key → doc-service crop ────
    const { preset, fallback: presetFallback } = choosePreset(clickedFile.width, clickedFile.height);
    let croppedBytes: Uint8Array;
    try {
      const clickedUrl = await deps.signGetUrl(clickedFile.r2_key);
      croppedBytes = await deps.docService.normalize({ image: { url: clickedUrl, mime: "image/jpeg" }, preset });
    } catch (e) {
      // NOTE: doc_too_large is unreachable here — normalize's own oversized-input failure surfaces
      // as blob_too_large/image_fetch_failed/image_decode_failed (api/normalize.mjs, lib/normalize.js);
      // doc_too_large is only ever thrown by the COMPOSE step (lib/compose.js), handled below (step 8).
      deps.logError("design-import:normalize", e);
      return json(envelope("normalize_failed", "Não foi possível processar a imagem.", true), 502);
    }

    // ── 6. Vision (abort HERE on failure — before any provider spend) ─────────
    const visionApiKey = deps.visionApiKey();
    if (!visionApiKey) {
      return json(envelope("vision_unavailable", "Extração de texto não está configurada neste ambiente.", false), 502);
    }
    let textBlocks: TextBlock[];
    try {
      textBlocks = await deps.extractTextBlocks({ imageBytes: croppedBytes, mime: "image/jpeg", apiKey: visionApiKey });
    } catch (e) {
      if (e instanceof VisionError) {
        deps.logError("design-import:vision", e);
        return json(envelope("vision_failed", "Não foi possível analisar o texto da imagem.", true), 502);
      }
      throw e;
    }

    // ── 7. Inpaint (generateImageCore owns its own gates/ledger/quota) ────────
    const inpaintInput: ImageGenInput = {
      contaId,
      source: "crm",
      createdBy: user.id,
      createdVia: "human",
      prompt: INPAINT_PROMPT,
      aspectRatio: preset,
      placement: "background",
      postId,
      rawReferences: [{ bytes: croppedBytes, mime: "image/jpeg" }],
      idempotencyKey: `design-import:file:${clickedFile.id}`,
    };
    let inpaintResult;
    try {
      inpaintResult = await generateImageCore(deps.imageGen, inpaintInput);
    } catch (e) {
      if (e instanceof ImageGenError) {
        return json(envelope(e.code, e.message, e.retryable), statusForCode(e.code));
      }
      deps.logError("design-import:inpaint", e);
      return json(envelope("provider_error", "Erro interno.", true), 502);
    }

    // ── 8. Compose: background + texts on the clicked frame, siblings verbatim ──
    const backgroundFile = await deps.getFile(inpaintResult.file_id, contaId);
    if (!backgroundFile) {
      deps.logError("design-import:compose-missing-background", { fileId: inpaintResult.file_id });
      return json(envelope("compose_failed", "Não foi possível montar o design.", true), 502);
    }

    const composeFrames: ComposeSpec["frames"] = [];
    let composedBytes: Uint8Array;
    try {
      const composeTexts: NonNullable<ComposeSpec["texts"]> = [];
      for (let i = 0; i < imageFrames.length; i++) {
        const frame = imageFrames[i];
        // Key on link_id, not file_id: the SAME file can be linked to a post twice (two rows,
        // two link ids) — file_id alone would put texts on every frame sharing that file.
        const isClicked = frame.link_id === resolved.link_id;
        const r2Key = isClicked ? backgroundFile.r2_key : frame.r2_key;
        const url = await deps.signGetUrl(r2Key);
        composeFrames.push({ name: String(i + 1), image: { url, mime: "image/jpeg" } });
        if (isClicked) {
          for (const block of textBlocks) {
            composeTexts.push({
              // 0-based frame INDEX — the doc-service contract (services/estudio-render/lib/compose.js)
              // validates 0 <= frame < frames.length and places via frameNodes[t.frame].
              frame: i,
              text: block.text,
              bbox: block.bbox,
              size: block.size,
              weight: block.weight,
              color: block.color,
              // doc-service only accepts LEFT|CENTER|RIGHT|JUSTIFIED (uppercase); vision.ts emits
              // lowercase left|center|right — uppercase here or every imported text silently
              // falls back to LEFT in compose.js.
              align: block.align.toUpperCase(),
            });
          }
        }
      }
      composedBytes = await deps.docService.compose({ preset, frames: composeFrames, texts: composeTexts });
    } catch (e) {
      if (e instanceof DocServiceError && e.code === "doc_too_large") {
        return json(envelope("doc_too_large", "Documento excede o tamanho máximo suportado.", false), 413);
      }
      // Failure AFTER inpaint succeeded (frame-URL presigning OR doc-service compose itself): the
      // background file row stays (a normal AI-gen asset; the idempotency key makes a retry free)
      // — log and return the mapped error, never unwind quota.
      deps.logError("design-import:compose", e);
      return json(envelope("compose_failed", "Não foi possível montar o design.", true), 502);
    }

    // ── 9. putBlob → create_design (media hold) → audit → fireRender → 201 ───
    const name = post.titulo?.trim() ? `Import — ${post.titulo.trim()}` : `Import — post ${postId}`;
    const key = blobKey(deps, contaId);
    let designId: number;
    try {
      await deps.putBlob(key, composedBytes);
      designId = await deps.createDesign(
        contaId,
        { postId, format, name },
        key,
        await sha256Hex(composedBytes),
        composedBytes.length,
        user.id,
      );
    } catch (e) {
      const mapped = mapCreateDesignError(e instanceof Error ? e.message : String(e));
      if (mapped.status === 502) deps.logError("design-import:create-design", e);
      return json(envelope(mapped.code, mapped.message, mapped.retryable), mapped.status);
    }

    await deps.insertAuditLog({
      conta_id: contaId,
      actor_user_id: user.id,
      action: "estudio.import_image",
      resource_type: "design",
      resource_id: String(designId),
      metadata: {
        post_id: postId,
        link_id: linkId,
        file_id: clickedFile.id,
        background_file_id: backgroundFile.id,
        frame_count: composeFrames.length,
        text_block_count: textBlocks.length,
        model: inpaintResult.model,
        cost_usd_estimate: inpaintResult.cost_usd_estimate,
        preset,
        preset_fallback: presetFallback,
      },
    });

    deps.fireRender(designId, 1);

    return json({ design_id: designId, quota: inpaintResult.quota }, 201);
  };
}
