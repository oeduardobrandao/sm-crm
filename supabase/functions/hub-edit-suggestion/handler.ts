import { createJsonResponder } from "../_shared/http.ts";
import { resolveHubToken } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import { CONTENT_FORMATS, type ContentFormat, captionMaxFor } from "../_shared/platform-registry.ts";

type DbClient = {
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

interface HubEditSuggestionHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
}

function extractR2Keys(content: any): string[] {
  const keys: string[] = [];
  function walk(node: any) {
    if (node?.type === "inlineImage" && node.attrs?.r2Key) {
      keys.push(node.attrs.r2Key);
    }
    if (Array.isArray(node?.content)) node.content.forEach(walk);
  }
  walk(content);
  return keys;
}

function stripSignedUrls(content: any): any {
  function walk(node: any): any {
    if (node?.type === "inlineImage" && node.attrs) {
      const { src: _src, ...restAttrs } = node.attrs;
      return { ...node, attrs: restAttrs };
    }
    if (Array.isArray(node?.content)) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(content);
}

function hasNewInlineImages(content: any, originalContent: any): boolean {
  const originalKeys = new Set(extractR2Keys(originalContent));
  const suggestedKeys = extractR2Keys(content);
  return suggestedKeys.some((key) => !originalKeys.has(key));
}

// Logical fields the Hub reports as edited: `texto` = conteudo + conteudo_plain,
// `legenda` = ig_caption, `legenda_tiktok` = tiktok_caption, `legenda_geral` = the
// caption of the post's `geral` row in post_targets.
type SuggestionField = "texto" | "legenda" | "legenda_tiktok" | "legenda_geral";

const SUGGESTION_FIELDS: readonly SuggestionField[] = ["texto", "legenda", "legenda_tiktok", "legenda_geral"];

// The destination a per-platform caption field needs in post_targets.
const FIELD_TARGET: Partial<Record<SuggestionField, "tiktok" | "geral">> = {
  legenda_tiktok: "tiktok",
  legenda_geral: "geral",
};

const TARGET_GONE_MESSAGE = "Este destino não está mais no post. Recarregue para ver a versão atual.";
const RETRY_MESSAGE = "Não deu para salvar agora. Tente de novo.";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Returns undefined when `touched_fields` is absent (old Hub: legacy RPC path), the
// validated list otherwise, or null when the value is malformed.
function parseTouchedFields(value: unknown): SuggestionField[] | undefined | null {
  if (value == null) return undefined;
  if (!Array.isArray(value)) return null;
  if (!value.every((f): f is SuggestionField => SUGGESTION_FIELDS.includes(f as SuggestionField))) {
    return null;
  }
  return value;
}

interface SuggestionBases {
  conteudo?: unknown;
  conteudo_plain?: string | null;
  ig_caption?: string | null;
  tiktok_caption?: string | null;
  geral_caption?: string | null;
}

const BASE_TEXT_KEYS = ["conteudo_plain", "ig_caption", "tiktok_caption", "geral_caption"] as const;

// `suggested_tiktok_caption` / `suggested_geral_caption`: absent (undefined), null or a string.
function isOptionalCaption(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function isContentFormat(value: unknown): value is ContentFormat {
  return typeof value === "string" && (CONTENT_FORMATS as readonly string[]).includes(value);
}

// Returns undefined when `bases` is absent, the known keys it carries otherwise, or null
// when the value is malformed. A key present with `null` is meaningful (the Hub saw a
// null base), so presence is tested with `in`, not truthiness.
function parseBases(value: unknown): SuggestionBases | undefined | null {
  if (value == null) return undefined;
  if (!isPlainObject(value)) return null;
  const out: SuggestionBases = {};
  if ("conteudo" in value) {
    if (value.conteudo !== null && !isPlainObject(value.conteudo)) return null;
    out.conteudo = value.conteudo;
  }
  for (const key of BASE_TEXT_KEYS) {
    if (key in value) {
      const v = value[key];
      if (v !== null && typeof v !== "string") return null;
      out[key] = v as string | null;
    }
  }
  return out;
}

// Rejects media keys outside the workspace's prefix. Returns true when all keys are fine.
function hasOnlyWorkspaceKeys(content: any, contaId: string): boolean {
  const prefix = `contas/${contaId}/`;
  return extractR2Keys(content).every((k: string) => k.startsWith(prefix));
}

export function createHubEditSuggestionHandler(deps: HubEditSuggestionHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json();
    const {
      token,
      post_id,
      suggested_conteudo,
      suggested_conteudo_plain,
      suggested_ig_caption,
      suggested_tiktok_caption,
      suggested_geral_caption,
    } = body;

    if (!token || !post_id) {
      return json({ error: "token and post_id required" }, 400);
    }
    if (
      suggested_conteudo_plain == null && suggested_ig_caption == null &&
      suggested_tiktok_caption == null && suggested_geral_caption == null
    ) {
      return json({ error: "No content provided" }, 400);
    }

    const touchedFields = parseTouchedFields(body.touched_fields);
    const bases = parseBases(body.bases);
    if (
      touchedFields === null || bases === null ||
      !isOptionalCaption(suggested_tiktok_caption) || !isOptionalCaption(suggested_geral_caption)
    ) {
      return json({ error: "Campos inválidos." }, 400);
    }
    // Sent only when the body carries a per-platform caption, so an old Hub's call is unchanged.
    const hasPlatformCaptions = "suggested_tiktok_caption" in body || "suggested_geral_caption" in body;

    const db = deps.createDb();

    // Verify token and enforce feature_hub_portal
    const hubToken = await resolveHubToken(db as any, token, deps.now());
    if (!hubToken) {
      const okBadToken = await deps.rateLimit(db, `hub-badtoken:${getClientIP(req)}`, 30, 600);
      if (!okBadToken) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
      return json({ error: "Link inválido." }, 404);
    }

    // No `hub-read` debit here: that key is one pool shared by every Hub
    // function, and this endpoint only writes. Charging it too would cap
    // autosave at half the shared read pool.
    // Autosave budget (120 per 5 min), not the 30/h budget of discrete actions:
    // the Hub editor saves ~1.5s after each typing pause, and 30/h locked clients
    // out of saving for the rest of the hour (Sep 2026). Same value as the
    // hub-briefing text answer.
    const okWrite = await deps.rateLimit(
      db, `hub-write:hub-edit-suggestion:${hubToken.conta_id}:${hubToken.cliente_id}`, 120, 300,
    );
    if (!okWrite) return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);

    // Verify post exists and belongs to this token's client/workspace
    const { data: post } = await db
      .from("workflow_posts")
      .select("id, workflow_id, status, tipo, conteudo, conta_id, cliente_id")
      .eq("id", post_id)
      .maybeSingle();

    if (!post) return json({ error: "Post não encontrado." }, 404);

    // Verify post is in enviado_cliente status
    if (post.status !== "enviado_cliente") {
      return json({ error: "Post não está aguardando aprovação." }, 409);
    }

    // Verify ownership via the post's own cliente_id/conta_id: an avulso post
    // (workflow_id null) has no workflow to authorize through.
    if (post.cliente_id !== hubToken.cliente_id || post.conta_id !== hubToken.conta_id) {
      return json({ error: "Não autorizado." }, 403);
    }

    // Per-platform captions: the destination must still be on the post (the TikTok one
    // leaves when the post becomes Stories; the team can remove the Geral one). The RPC
    // re-checks under its locks.
    const touchedTargets = (touchedFields ?? [])
      .map((f) => FIELD_TARGET[f])
      .filter((p): p is "tiktok" | "geral" => p !== undefined);
    if (touchedTargets.length > 0) {
      const { data: targetRows, error: targetsError } = await db
        .from("post_targets")
        .select("platform")
        .eq("post_id", post_id)
        .in("platform", touchedTargets);
      if (targetsError) {
        console.error("[hub-edit-suggestion] post_targets read failed:", targetsError);
        return json({ error: "Erro ao salvar sugestão." }, 500);
      }
      const present = new Set((targetRows ?? []).map((r: { platform: string }) => r.platform));
      if (touchedTargets.some((p) => !present.has(p))) {
        return json({ error: TARGET_GONE_MESSAGE, code: "target_gone" }, 409);
      }
    }

    // Length limit only on a touched TikTok caption. Geral has none, and Instagram is not
    // checked here so a live caption already over the limit is never refused.
    if (touchedFields?.includes("legenda_tiktok") && isContentFormat(post.tipo)) {
      const max = captionMaxFor("tiktok", post.tipo);
      if (max !== null && (suggested_tiktok_caption ?? "").length > max) {
        return json({ error: `A legenda do TikTok passa de ${max} caracteres.`, code: "caption_too_long" }, 400);
      }
    }

    // Sanitize TipTap JSON: reject new inline images, strip signed URLs. The new-image
    // check only applies when the client edited the text: a legenda-only save carries the
    // Hub's copy of conteudo untouched, and the team may have removed an image from the
    // live post since, which would look like a "new" image here and block the caption.
    // The workspace-prefix check stays unconditional: it guards the key itself.
    let sanitizedConteudo = suggested_conteudo;
    if (sanitizedConteudo) {
      if ((touchedFields === undefined || touchedFields.includes("texto")) &&
        hasNewInlineImages(sanitizedConteudo, post.conteudo)) {
        return json({ error: "Não é permitido adicionar imagens." }, 400);
      }

      if (!hasOnlyWorkspaceKeys(sanitizedConteudo, post.conta_id)) {
        return json({ error: "Referência de mídia inválida." }, 400);
      }

      sanitizedConteudo = stripSignedUrls(sanitizedConteudo);
    }

    // The base conteudo is the Hub's copy of post.conteudo, so it carries the signed `src`
    // hub-posts injects; unstripped, the RPC's jsonb comparison would never match.
    let sanitizedBases = bases;
    if (sanitizedBases?.conteudo) {
      if (!hasOnlyWorkspaceKeys(sanitizedBases.conteudo, post.conta_id)) {
        return json({ error: "Referência de mídia inválida." }, 400);
      }
      sanitizedBases = { ...sanitizedBases, conteudo: stripSignedUrls(sanitizedBases.conteudo) };
    }

    // Call the upsert RPC
    const { data: result, error: rpcError } = await db.rpc("upsert_edit_suggestion", {
      p_post_id: post_id,
      p_conta_id: post.conta_id,
      p_token: token,
      p_suggested_conteudo: sanitizedConteudo ?? null,
      p_suggested_conteudo_plain: suggested_conteudo_plain ?? null,
      p_suggested_ig_caption: suggested_ig_caption ?? null,
      // Omitted (not null) for an old Hub, so the RPC takes its legacy path.
      ...(touchedFields !== undefined && { p_touched_fields: touchedFields }),
      ...(sanitizedBases !== undefined && { p_bases: sanitizedBases }),
      ...(hasPlatformCaptions && {
        p_suggested_captions: {
          tiktok_caption: suggested_tiktok_caption ?? null,
          geral_caption: suggested_geral_caption ?? null,
        },
      }),
    });

    if (rpcError) {
      // upsert_edit_suggestion re-checks the status under a row lock (migration
      // 20260928150001): the team accepted/rejected/moved the post after the check above.
      const message = (rpcError as { message?: unknown }).message;
      const code = (rpcError as { code?: unknown }).code;
      if (typeof message === "string" && message.includes("post_not_pending")) {
        return json({ error: "Post não está aguardando aprovação." }, 409);
      }
      // The destination left between the check above and the RPC's locks.
      if (typeof message === "string" && message.includes("target_gone")) {
        return json({ error: TARGET_GONE_MESSAGE, code: "target_gone" }, 409);
      }
      // Deadlock with a concurrent destination removal (post_targets -> workflow_posts
      // lock order). The save is safe to repeat.
      if (code === "40P01") {
        console.error("[hub-edit-suggestion] deadlock:", rpcError);
        return json({ error: RETRY_MESSAGE, code: "retry" }, 409);
      }
      // A touched field arrived without its base key: a Hub bug, not a server fault.
      if (typeof message === "string" && message.includes("base_required")) {
        console.error("[hub-edit-suggestion] base_required:", rpcError);
        return json({ error: "Erro ao salvar sugestão." }, 400);
      }
      console.error("[hub-edit-suggestion] upsert failed:", rpcError);
      return json({ error: "Erro ao salvar sugestão." }, 500);
    }

    const rpcResult = result as { action: string; is_new: boolean; suggestion: unknown };

    // Notify on every save that leaves a pending suggestion: the first one and each later
    // update (the RPC flags updates via metadata.updated and no-ops if the row was resolved
    // in between). A revert to the original (`deleted`) sends nothing.
    if (rpcResult.action !== "deleted") {
      const { error: notifErr } = await db.rpc("create_edit_suggestion_notification", {
        p_post_id: post_id,
      });
      if (notifErr) {
        console.error("[hub-edit-suggestion] notification creation failed:", notifErr);
      }
    }

    return json({
      ok: true,
      pending_suggestion: rpcResult.suggestion ?? null,
    });
  };
}
