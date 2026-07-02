// Estúdio design-document schema + validation pipeline (docs/estudio-design.md §2).
//
// Canonical, runtime-neutral module: imports only bare "zod" (resolved to npm:zod@4.3.6 via
// supabase/functions/deno.json in Deno, and via node_modules in Vite/vitest/tsc — see §3),
// zero Deno globals, zero npm: specifiers. Aliased into the CRM as `@mesaas/design-doc`.
//
// This file is DB-free by design: business rules that need data (file ownership, font
// manifest, post tipo) take the data as injected arguments/callbacks rather than querying
// anything themselves, so the same pure pipeline runs identically in post-design-manage
// (Deno, service-role DB) and in tests (fakes) without a dual implementation to drift.

import { z } from "zod";

// ============================================================
// Primitives (§2.1)
// ============================================================

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
export const ID_RE = /^[a-z0-9_-]{1,40}$/;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Server-minted id for layers/pages left unspecified by an author. No external dep (decision:
 * no nanoid). Not cryptographically sensitive — collision-resistant within one document only. */
export function generateDesignId(prefix: string): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ID_ALPHABET[b % ID_ALPHABET.length];
  return `${prefix}-${s}`;
}

const Hex = z.string().regex(HEX_COLOR_RE, "use #rrggbb[aa]");
const OptionalId = z.string().regex(ID_RE, "id must match ^[a-z0-9_-]{1,40}$")
  .optional();

const FontWeight = z.union([
  z.literal(400),
  z.literal(500),
  z.literal(600),
  z.literal(700),
  z.literal(800),
  z.literal(900),
]);
export type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;

const FontStyle = z.enum(["normal", "italic"]);
const Align = z.enum(["left", "center", "right"]);
const Fit = z.enum(["cover", "contain"]);

// ============================================================
// Fill (§2.2)
// ============================================================

const GradientStop = z.object({ color: Hex, at: z.number().min(0).max(1) })
  .strict();

const SolidFill = z.object({ type: z.literal("solid"), color: Hex }).strict();
const LinearGradientFill = z
  .object({
    type: z.literal("linear_gradient"),
    angle: z.number(),
    stops: z.array(GradientStop).min(2).max(8),
  })
  .strict();

// SolidOrGradient — used for image-fill overlays and shape fills (scrims, per critic_product #5).
const SolidOrGradient = z.discriminatedUnion("type", [
  SolidFill,
  LinearGradientFill,
]);

const ImageFill = z
  .object({
    type: z.literal("image"),
    file_id: z.number().int().positive(),
    fit: Fit,
    overlay: SolidOrGradient.optional(),
  })
  .strict();

const Fill = z.discriminatedUnion("type", [
  SolidFill,
  LinearGradientFill,
  ImageFill,
]);

// ============================================================
// Layers (§2.2)
// ============================================================

const Run = z
  .object({
    text: z.string().min(1),
    font_weight: FontWeight.optional(),
    font_style: FontStyle.optional(),
    color: Hex.optional(),
    highlight: z
      .object({
        color: Hex,
        padding_x: z.number().nonnegative().optional(),
        radius: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const LayerBaseShape = {
  id: OptionalId,
  name: z.string().max(80).optional(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  locked: z.boolean().optional(),
};

const TextLayer = z
  .object({
    ...LayerBaseShape,
    type: z.literal("text"),
    text: z.string().max(2000).optional(),
    runs: z.array(Run).min(1).optional(),
    font_key: z.string().min(1),
    font_weight: FontWeight,
    font_style: FontStyle.optional(),
    font_size: z.number().positive(),
    line_height: z.number().positive().optional(),
    letter_spacing: z.number().optional(),
    color: Hex,
    align: Align.optional(),
    shadow: z
      .object({
        x: z.number(),
        y: z.number(),
        blur: z.number().nonnegative(),
        color: Hex,
      })
      .strict()
      .optional(),
    pill: z
      .object({
        color: Hex,
        padding_x: z.number().nonnegative(),
        padding_y: z.number().nonnegative(),
        radius: z.number().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

const ImageLayer = z
  .object({
    ...LayerBaseShape,
    type: z.literal("image"),
    h: z.number().positive(),
    file_id: z.number().int().positive(),
    fit: Fit,
    radius: z.number().nonnegative().optional(),
    border: z.object({ width: z.number().positive(), color: Hex }).strict()
      .optional(),
  })
  .strict();

const ShapeLayer = z
  .object({
    ...LayerBaseShape,
    type: z.literal("shape"),
    h: z.number().positive(),
    shape: z.enum(["rect", "ellipse"]),
    fill: SolidOrGradient.optional(),
    radius: z.number().nonnegative().optional(),
    stroke: z.object({ width: z.number().positive(), color: Hex }).strict()
      .optional(),
  })
  .strict();

// discriminatedUnion members cannot carry cross-field .refine() (it turns the member into a
// non-discriminable ZodEffects) — the text/runs XOR rule is applied via .superRefine() on the
// union itself instead.
const Layer = z.discriminatedUnion("type", [TextLayer, ImageLayer, ShapeLayer])
  .superRefine((layer, ctx) => {
    if (layer.type === "text") {
      const hasText = layer.text != null;
      const hasRuns = layer.runs != null;
      if (hasText === hasRuns) {
        ctx.addIssue({
          message: "text layers must set exactly one of `text` or `runs`",
          path: ["text"],
        });
      }
    }
  });

// ============================================================
// Page + top-level document (§2.2) — authoring schema
// ============================================================

const Page = z
  .object({
    id: OptionalId,
    background: Fill,
    layers: z.array(Layer).max(40),
  })
  .strict();

export const FORMATS = ["feed", "carrossel", "reel_cover"] as const;
export type DesignFormat = (typeof FORMATS)[number];

export const ASPECT_RATIOS = ["1:1", "4:5", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

// `canvas` is deliberately NOT part of the authoring schema (§2.2) — an author-supplied
// `canvas` key is rejected by .strict() as an unknown key. It is injected at normalization
// (Stage 2) from format + aspect_ratio via CANVAS_DIMENSIONS below.
export const DesignDocInputSchema = z
  .object({
    version: z.literal(1),
    format: z.enum(FORMATS),
    aspect_ratio: z.enum(ASPECT_RATIOS),
    pages: z.array(Page).min(1).max(10),
  })
  .strict();

export type DesignDocInput = z.infer<typeof DesignDocInputSchema>;

// Serialized-size cap (§2.3) — checked on the raw JSON string, not the parsed object.
export const MAX_DESIGN_DOC_BYTES = 256 * 1024;

// ============================================================
// Normalized output types — produced by normalize() below, not zod-validated on the way out
// (normalize() is the single writer of this shape; dual-runtime fixture tests are the guard
// against drift, not a second schema).
// ============================================================

export interface NormalizedFillSolid {
  type: "solid";
  color: string;
}
export interface NormalizedFillGradient {
  type: "linear_gradient";
  angle: number;
  stops: Array<{ color: string; at: number }>;
}
export interface NormalizedFillImage {
  type: "image";
  file_id: number;
  fit: "cover" | "contain";
  overlay?: NormalizedFillSolid | NormalizedFillGradient;
}
export type NormalizedFill =
  | NormalizedFillSolid
  | NormalizedFillGradient
  | NormalizedFillImage;
export type NormalizedSolidOrGradient =
  | NormalizedFillSolid
  | NormalizedFillGradient;

export interface NormalizedRun {
  text: string;
  font_weight?: FontWeight;
  font_style?: "normal" | "italic";
  color?: string;
  highlight?: { color: string; padding_x?: number; radius?: number };
}

interface NormalizedLayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  rotation: number;
  opacity: number;
  locked: boolean;
}

export interface NormalizedTextLayer extends NormalizedLayerBase {
  type: "text";
  text?: string;
  runs?: NormalizedRun[];
  font_key: string;
  font_weight: FontWeight;
  font_style?: "normal" | "italic";
  font_size: number;
  line_height: number;
  letter_spacing: number;
  color: string;
  align: "left" | "center" | "right";
  shadow?: { x: number; y: number; blur: number; color: string };
  pill?: {
    color: string;
    padding_x: number;
    padding_y: number;
    radius: number;
  };
}

export interface NormalizedImageLayer extends NormalizedLayerBase {
  type: "image";
  h: number;
  file_id: number;
  fit: "cover" | "contain";
  radius?: number;
  border?: { width: number; color: string };
}

export interface NormalizedShapeLayer extends NormalizedLayerBase {
  type: "shape";
  h: number;
  shape: "rect" | "ellipse";
  fill?: NormalizedSolidOrGradient;
  radius?: number;
  stroke?: { width: number; color: string };
}

export type NormalizedLayer =
  | NormalizedTextLayer
  | NormalizedImageLayer
  | NormalizedShapeLayer;

export interface NormalizedPage {
  id: string;
  background: NormalizedFill;
  layers: NormalizedLayer[];
}

export interface DesignDoc {
  version: 1;
  format: DesignFormat;
  aspect_ratio: AspectRatio;
  canvas: { width: 1080; height: 1080 | 1350 | 1920 };
  pages: NormalizedPage[];
  // The distinct set of file_id values referenced anywhere in the doc (background image
  // fills + image layers) — exposed so callers (the save RPC's asset-refs diff) don't have
  // to re-walk the tree themselves.
  fileIds: number[];
}

// ============================================================
// Format <-> tipo / canvas mapping (§2.4 rule 1, §5.4 tipo sync — kept here as the single
// source both the app-layer validator and the SQL RPC's own copy must stay consistent with;
// the SQL side is necessarily a hand-mirrored CASE per post_design_check_and_sync, since SQL
// cannot import TS).
// ============================================================

export const FORMAT_TO_TIPO: Record<DesignFormat, string> = {
  feed: "feed",
  carrossel: "carrossel",
  reel_cover: "reels",
};

const ALLOWED_ASPECT_RATIOS_BY_FORMAT: Record<
  DesignFormat,
  readonly AspectRatio[]
> = {
  feed: ["1:1", "4:5"],
  carrossel: ["1:1", "4:5"],
  reel_cover: ["9:16"],
};

const CANVAS_DIMENSIONS: Record<
  AspectRatio,
  { width: 1080; height: 1080 | 1350 | 1920 }
> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

// RTL detection (§2.4 rule 5) — Hebrew + Arabic (+ Arabic Presentation Forms) blocks.
const RTL_RE = /[֐-׿؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

// ============================================================
// Issues / warnings (§2.4 structured error shape)
// ============================================================

export interface DesignIssue {
  path: string;
  code: string;
  message: string;
  allowed?: string[];
}

export interface DesignWarning {
  path: string;
  // "text_overflow" is a valid code in the wire contract but this module never emits it —
  // detecting it requires satori text measurement (§2.5), which lives in the render-core
  // slice, not here. A future normalize() caller with access to a measurer can add it; a
  // consumer pattern-matching on `code` should not assume this arm is reachable yet.
  code: "layer_off_canvas" | "empty_text" | "text_overflow";
  message: string;
}

export const MAX_ISSUES = 20;

export interface DesignValidationError {
  error: "design_invalid";
  doc_version: 1;
  issues: DesignIssue[];
  issue_count: number;
  truncated: boolean;
}

// ============================================================
// Font manifest lookup — decoupled interface (the real manifest ships in a later PR; any
// object satisfying this shape works, in production or in tests).
// ============================================================

export interface FontVariantLookup {
  /** Every font_key the catalog currently ships. */
  allowedKeys(): string[];
  /** True iff (key, weight, style) is a real, renderable variant. */
  hasVariant(
    key: string,
    weight: FontWeight,
    style: "normal" | "italic",
  ): boolean;
  /** The variants actually shipped for a (presumably known) key — for the error hint. */
  variantsFor(
    key: string,
  ): Array<{ weight: FontWeight; style: "normal" | "italic" }>;
}

// ============================================================
// File tenancy lookup — injected so this module stays DB-free. Returns the SUBSET of the
// requested ids that exist, belong to the caller's workspace, and are kind='image'.
// ============================================================

export type CheckFileIds = (ids: number[]) => Promise<Set<number>>;

export interface ValidationContext {
  /** workflow_posts.tipo for the target post, BEFORE any sync — 'stories' always rejects. */
  postTipo: string;
  /** Whether the target post currently has any video-kind media linked (rule 6). */
  postHasVideoMedia: boolean;
  fonts: FontVariantLookup;
  checkFileIds: CheckFileIds;
}

export type ValidationResult =
  | { ok: true; doc: DesignDoc; warnings: DesignWarning[] }
  | {
    ok: false;
    issues: DesignIssue[];
    issueCount: number;
    truncated: boolean;
  };

// ============================================================
// Path formatting — zod issue paths and hand-built Stage-1 paths share one format:
// "pages[0].layers[2].font_key"
// ============================================================

function formatPath(segments: Array<string | number>): string {
  let out = "";
  for (const seg of segments) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${seg}` : seg;
  }
  return out;
}

// ============================================================
// Stage 0 — structural (zod parse)
// ============================================================

function runStage0(
  raw: unknown,
): { ok: true; doc: DesignDocInput } | { ok: false; issues: DesignIssue[] } {
  const result = DesignDocInputSchema.safeParse(raw);
  if (result.success) return { ok: true, doc: result.data };
  const issues: DesignIssue[] = result.error.issues.map((issue) => ({
    path: formatPath(issue.path as Array<string | number>),
    code: issue.code === "custom" ? "invalid" : issue.code,
    message: issue.message,
  }));
  return { ok: false, issues };
}

// ============================================================
// Stage 1 — business rules, aggregated (never fail-fast)
// ============================================================

async function runStage1(
  doc: DesignDocInput,
  ctx: ValidationContext,
): Promise<DesignIssue[]> {
  const issues: DesignIssue[] = [];

  // Rule 1a: a 'stories' post can never receive a design (no format maps to it).
  if (ctx.postTipo === "stories") {
    issues.push({
      path: "format",
      code: "unsupported_post_tipo",
      message: "Posts do tipo Stories não são suportados pelo Estúdio.",
    });
  }

  // Rule 1b/1c: page count + aspect_ratio must be valid for the declared format.
  const allowedARs = ALLOWED_ASPECT_RATIOS_BY_FORMAT[doc.format];
  if (!allowedARs.includes(doc.aspect_ratio)) {
    issues.push({
      path: "aspect_ratio",
      code: "invalid_aspect_ratio_for_format",
      message:
        `Proporção '${doc.aspect_ratio}' não é válida para o formato '${doc.format}'.`,
      allowed: [...allowedARs],
    });
  }
  if (doc.format !== "carrossel" && doc.pages.length !== 1) {
    issues.push({
      path: "pages",
      code: "invalid_page_count",
      message:
        `O formato '${doc.format}' aceita exatamente 1 página (recebido: ${doc.pages.length}).`,
    });
  }

  // Rule 6: feed/carrossel designs cannot coexist with video media on the post.
  if (doc.format !== "reel_cover" && ctx.postHasVideoMedia) {
    issues.push({
      path: "format",
      code: "post_has_video_media",
      message:
        "Este post já tem mídia em vídeo — remova-a antes de criar um design de imagem, ou use o formato de capa de reel.",
    });
  }

  // Rule 4: id uniqueness (regex validity already enforced by Stage 0 when an id IS present).
  const seenPageIds = new Set<string>();
  const seenLayerIds = new Set<string>();
  const fileIds = new Set<number>();

  doc.pages.forEach((page, pi) => {
    if (page.id) {
      if (seenPageIds.has(page.id)) {
        issues.push({
          path: formatPath(["pages", pi, "id"]),
          code: "duplicate_id",
          message: `Id de página duplicado: '${page.id}'.`,
        });
      }
      seenPageIds.add(page.id);
    }

    if (page.background.type === "image") fileIds.add(page.background.file_id);

    page.layers.forEach((layer, li) => {
      if (layer.id) {
        if (seenLayerIds.has(layer.id)) {
          issues.push({
            path: formatPath(["pages", pi, "layers", li, "id"]),
            code: "duplicate_id",
            message: `Id de camada duplicado: '${layer.id}'.`,
          });
        }
        seenLayerIds.add(layer.id);
      }

      if (layer.type === "image") fileIds.add(layer.file_id);

      // Rule 5: RTL text is rejected outright — satori cannot lay it out.
      const textToCheck = layer.type === "text"
        ? layer.text ?? (layer.runs ?? []).map((r) => r.text).join("")
        : "";
      if (textToCheck && RTL_RE.test(textToCheck)) {
        issues.push({
          path: formatPath(["pages", pi, "layers", li, "text"]),
          code: "rtl_unsupported",
          message:
            "Texto com script da direita para a esquerda (RTL) não é suportado.",
        });
      }

      // Rule 3: font manifest membership.
      if (layer.type === "text") {
        const style = layer.font_style ?? "normal";
        if (!ctx.fonts.allowedKeys().includes(layer.font_key)) {
          issues.push({
            path: formatPath(["pages", pi, "layers", li, "font_key"]),
            code: "unknown_font",
            message: `Fonte '${layer.font_key}' não está no catálogo.`,
            allowed: ctx.fonts.allowedKeys(),
          });
        } else if (
          !ctx.fonts.hasVariant(layer.font_key, layer.font_weight, style)
        ) {
          const variants = ctx.fonts.variantsFor(layer.font_key);
          issues.push({
            path: formatPath(["pages", pi, "layers", li, "font_weight"]),
            code: "unsupported_font_variant",
            message:
              `A fonte '${layer.font_key}' não tem a variante peso ${layer.font_weight}${
                style === "italic" ? " itálico" : ""
              }.`,
            allowed: variants.map((v) =>
              `${v.weight}${v.style === "italic" ? "i" : ""}`
            ),
          });
        }
      }
    });
  });

  // Rule 2: every referenced file_id — exists, tenant-owned, kind='image' — in ONE query.
  if (fileIds.size > 0) {
    const valid = await ctx.checkFileIds([...fileIds]);
    for (const id of fileIds) {
      if (!valid.has(id)) {
        issues.push({
          path: "pages[].background|layers[].file_id",
          code: "file_not_found",
          message:
            `Arquivo ${id} não encontrado neste workspace (ou não é uma imagem).`,
        });
      }
    }
  }

  return issues;
}

// ============================================================
// Stage 2 — normalization (only after Stage 0 + Stage 1 pass clean)
// ============================================================

function normalizeFill(
  fill: DesignDocInput["pages"][number]["background"],
): NormalizedFill {
  if (fill.type === "solid") return { type: "solid", color: fill.color };
  if (fill.type === "linear_gradient") {
    return {
      type: "linear_gradient",
      angle: fill.angle,
      stops: [...fill.stops].sort((a, b) => a.at - b.at),
    };
  }
  return {
    type: "image",
    file_id: fill.file_id,
    fit: fill.fit,
    overlay: fill.overlay
      ? (normalizeFill(fill.overlay) as NormalizedSolidOrGradient)
      : undefined,
  };
}

function normalizeRun(run: z.infer<typeof Run>): NormalizedRun {
  return {
    text: run.text,
    font_weight: run.font_weight,
    font_style: run.font_style,
    color: run.color,
    highlight: run.highlight,
  };
}

let autoNameCounters: Record<string, number>;

function autoName(type: "text" | "image" | "shape"): string {
  autoNameCounters[type] = (autoNameCounters[type] ?? 0) + 1;
  const label = type === "text"
    ? "Texto"
    : type === "image"
    ? "Imagem"
    : "Forma";
  return `${label} ${autoNameCounters[type]}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeLayer(layer: z.infer<typeof Layer>): NormalizedLayer {
  const base: NormalizedLayerBase = {
    id: layer.id ?? generateDesignId("layer"),
    name: layer.name ?? autoName(layer.type),
    x: round2(layer.x),
    y: round2(layer.y),
    w: round2(layer.w),
    rotation: round2(layer.rotation ?? 0),
    opacity: layer.opacity ?? 1,
    locked: layer.locked ?? false,
  };

  if (layer.type === "text") {
    return {
      ...base,
      type: "text",
      text: layer.text,
      runs: layer.runs?.map(normalizeRun),
      font_key: layer.font_key,
      font_weight: layer.font_weight,
      font_style: layer.font_style,
      font_size: layer.font_size,
      line_height: layer.line_height ?? 1.2,
      letter_spacing: layer.letter_spacing ?? 0,
      color: layer.color,
      align: layer.align ?? "left",
      shadow: layer.shadow,
      pill: layer.pill,
    };
  }

  if (layer.type === "image") {
    return {
      ...base,
      type: "image",
      h: round2(layer.h),
      file_id: layer.file_id,
      fit: layer.fit,
      radius: layer.radius,
      border: layer.border,
    };
  }

  return {
    ...base,
    type: "shape",
    h: round2(layer.h),
    shape: layer.shape,
    fill: layer.fill
      ? (normalizeFill(
        layer.fill as DesignDocInput["pages"][number]["background"],
      ) as NormalizedSolidOrGradient)
      : undefined,
    radius: layer.radius,
    stroke: layer.stroke,
  };
}

function collectWarnings(doc: DesignDoc): DesignWarning[] {
  const warnings: DesignWarning[] = [];
  doc.pages.forEach((page, pi) => {
    page.layers.forEach((layer, li) => {
      const path = formatPath(["pages", pi, "layers", li]);
      if (
        layer.x >= doc.canvas.width || layer.y >= doc.canvas.height ||
        layer.x + layer.w <= 0
      ) {
        warnings.push({
          path,
          code: "layer_off_canvas",
          message: "Camada totalmente fora do canvas.",
        });
      }
      if (layer.type === "text") {
        const text = layer.text ??
          (layer.runs ?? []).map((r) => r.text).join("");
        if (!text.trim()) {
          warnings.push({
            path,
            code: "empty_text",
            message: "Camada de texto vazia.",
          });
        }
      }
    });
  });
  return warnings;
}

function normalize(doc: DesignDocInput): DesignDoc {
  autoNameCounters = {};
  const fileIds = new Set<number>();

  const pages: NormalizedPage[] = doc.pages.map((page) => {
    const background = normalizeFill(page.background);
    if (background.type === "image") fileIds.add(background.file_id);
    const layers = page.layers.map((layer) => {
      const normalized = normalizeLayer(layer);
      if (normalized.type === "image") fileIds.add(normalized.file_id);
      return normalized;
    });
    return { id: page.id ?? generateDesignId("page"), background, layers };
  });

  const normalized: DesignDoc = {
    version: 1,
    format: doc.format,
    aspect_ratio: doc.aspect_ratio,
    canvas: CANVAS_DIMENSIONS[doc.aspect_ratio],
    pages,
    fileIds: [...fileIds],
  };

  return normalized;
}

// ============================================================
// Orchestrator
// ============================================================

/**
 * Validates + normalizes a raw (untrusted) design document against a specific post's context.
 * Never fail-fast within Stage 1 — every business-rule violation is collected before
 * returning, so one corrective retry can fix everything the caller (human or LLM) got wrong.
 */
export async function validateDesignDoc(
  raw: unknown,
  ctx: ValidationContext,
): Promise<ValidationResult> {
  // JSON.stringify throws synchronously on circular references, BigInt values, or (via its
  // own recursive walk) sufficiently deep nesting — well before the size check below ever
  // runs, since a cheap-looking deep chain can blow the call stack under 256 KB serialized.
  // Caught here so a crafted `raw` always produces a clean issue, never an unhandled
  // rejection (this fn is async, so an uncaught throw here rejects the promise instead of
  // returning a ValidationResult, and CLAUDE.md forbids leaking raw error details to clients).
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return {
      ok: false,
      issues: [{
        path: "",
        code: "doc_unserializable",
        message: "Documento não pôde ser processado (estrutura inválida).",
      }],
      issueCount: 1,
      truncated: false,
    };
  }
  if (serialized.length > MAX_DESIGN_DOC_BYTES) {
    return {
      ok: false,
      issues: [{
        path: "",
        code: "doc_too_large",
        message: `Documento excede o limite de ${MAX_DESIGN_DOC_BYTES} bytes.`,
      }],
      issueCount: 1,
      truncated: false,
    };
  }

  const stage0 = runStage0(raw);
  if (!stage0.ok) {
    const truncated = stage0.issues.length > MAX_ISSUES;
    return {
      ok: false,
      issues: stage0.issues.slice(0, MAX_ISSUES),
      issueCount: stage0.issues.length,
      truncated,
    };
  }

  const stage1Issues = await runStage1(stage0.doc, ctx);
  if (stage1Issues.length > 0) {
    const truncated = stage1Issues.length > MAX_ISSUES;
    return {
      ok: false,
      issues: stage1Issues.slice(0, MAX_ISSUES),
      issueCount: stage1Issues.length,
      truncated,
    };
  }

  const doc = normalize(stage0.doc);
  return { ok: true, doc, warnings: collectWarnings(doc) };
}

/** Build the §2.4 structured error envelope from a failed ValidationResult. */
export function toDesignValidationError(
  result: Extract<ValidationResult, { ok: false }>,
): DesignValidationError {
  return {
    error: "design_invalid",
    doc_version: 1,
    issues: result.issues,
    issue_count: result.issueCount,
    truncated: result.truncated,
  };
}
