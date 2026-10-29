// deno-lint-ignore-file no-explicit-any
// Sending a post to the client from the card (spec 2026-10-29-mcp-apps-cards-design.md §4.4, §5).
// `send_post_to_client` is widget-only: registered only with cards on AND an OAuth grant, and it
// sends only with a send nonce, which create_post and update_post put in their result `_meta`
// (delivered to the card, not to the model). preview_post mints none: the card sends only after a
// save made in the same card. The model alone never sends.
import { z } from "npm:zod@3";
import { McpInputError } from "../_shared/mcp-token.ts";
import { signSendNonce, verifySendNonce } from "../_shared/mcp-send-nonce.ts";
import { appOnlyToolMeta, widgetOnly } from "./apps.ts";
import type { Deps } from "./queries.ts";
import { register } from "./register.ts";
import type { ToolMeta } from "./tool-meta.ts";

export const SEND_NONCE_META_KEY = "mesaas/sendNonce";

const SEND_EXPECTED_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente", "aprovado_interno"] as const;

type SendOutcome = "sent" | "already_sent" | "approved" | "failed" | "stale";

const OUTCOME_MESSAGES: Record<SendOutcome, string> = {
  sent: "Post enviado ao cliente para aprovação.",
  already_sent: "Este post já está com o cliente.",
  approved: "O cliente já aprovou este post.",
  failed: "A publicação deste post falhou. Resolva no Mesaas antes de enviar de novo.",
  stale: "O post mudou no Mesaas. Atualize o cartão.",
};

const EXPIRED_CARD = "Este cartão expirou. Peça ao agente para mostrar o post de novo e salve de novo.";
const VIDEO_WITHOUT_COVER = "Este vídeo está sem capa. Adicione a capa no Mesaas antes de enviar.";
// RPC errors (`workspace_unavailable` included) and anything unexpected: never the raw error.
const SEND_FAILED = "Não foi possível enviar o post ao cliente agora. Tente de novo ou envie pelo Mesaas.";

/** TOKEN_ENCRYPTION_KEY has no fallback: missing, registration fails before any tool can write. */
function requireNonceSecret(): string {
  const secret = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
  return secret;
}

/** `resultMeta` factory for the tools whose result carries a send nonce (create_post and
 * update_post only). `undefined` unless widget-only tools are on (cards + OAuth). Called once per
 * registration, so a missing secret throws there, before any write; the returned function never
 * throws, because `register` runs it AFTER the write and the audit (a throw would report a write
 * that already happened as failed, and the model could retry it). */
export function sendNonceMeta(deps: Deps): ((postId: unknown) => Promise<Record<string, unknown> | undefined>) | undefined {
  if (!widgetOnly(deps)) return undefined;
  const secret = requireNonceSecret();
  return async (postId: unknown) => {
    if (typeof postId !== "number" || !Number.isInteger(postId) || postId <= 0) return undefined;
    try {
      const nonce = await signSendNonce(secret, { conta_id: deps.ctx.conta_id, user_id: deps.ctx.created_by, post_id: postId });
      return { [SEND_NONCE_META_KEY]: nonce };
    } catch {
      console.error("[mcp] send nonce failed");
      return undefined;
    }
  };
}

/** Same rule as the CRM's `hasVideoMissingThumbnail` (PostMediaGallery.tsx): a linked video file
 * without `thumbnail_r2_key` blocks the send. */
async function hasVideoWithoutCover(d: Deps, postId: number): Promise<boolean> {
  const { data, error } = await d.db
    .from("post_file_links")
    .select("id, files!inner(kind, thumbnail_r2_key)")
    .eq("conta_id", d.ctx.conta_id)
    .eq("post_id", postId);
  if (error) {
    console.error("[mcp] send_post_to_client media read failed:", error.message ?? "unknown");
    throw new McpInputError(SEND_FAILED);
  }
  return (data ?? []).some((l: any) => l.files?.kind === "video" && !l.files?.thumbnail_r2_key);
}

export async function sendPostToClient(
  d: Deps,
  a: { post_id: number; expected_status: string; nonce: string },
  secret: string,
): Promise<{ card: "send_result"; v: 1; post_id: number; outcome: SendOutcome }> {
  const ok = await verifySendNonce(secret, a.nonce, { conta_id: d.ctx.conta_id, user_id: d.ctx.created_by, post_id: a.post_id });
  if (!ok) {
    // The post id only: never the nonce, its payload or the secret.
    console.warn("[mcp] send nonce rejected", { post_id: a.post_id });
    throw new McpInputError(EXPIRED_CARD);
  }
  if (await hasVideoWithoutCover(d, a.post_id)) throw new McpInputError(VIDEO_WITHOUT_COVER);

  const { data, error } = await d.db.rpc("mcp_send_post_to_client", {
    p_conta_id: d.ctx.conta_id,
    p_post_id: a.post_id,
    p_expected_status: a.expected_status,
    p_actor: d.ctx.created_by,
  });
  if (error) {
    console.error("[mcp] send_post_to_client rpc failed:", (error as any).message ?? "unknown");
    throw new McpInputError(SEND_FAILED);
  }
  if (typeof data !== "string" || !Object.hasOwn(OUTCOME_MESSAGES, data)) {
    console.error("[mcp] send_post_to_client unexpected outcome");
    throw new McpInputError(SEND_FAILED);
  }
  return { card: "send_result", v: 1, post_id: a.post_id, outcome: data as SendOutcome };
}

export function registerSendTools(server: any, deps: Deps): void {
  if (!widgetOnly(deps)) return;
  const secret = requireNonceSecret();
  register(
    server, deps, "send_post_to_client", "posts:write",
    "Envia o post ao cliente para aprovação. Só o cartão chama esta ferramenta, depois do clique do usuário em \"Enviar ao cliente\".",
    {
      post_id: z.number().int().positive(),
      expected_status: z.enum(SEND_EXPECTED_STATUSES),
      nonce: z.string().min(1).max(1000),
    },
    async (a: { post_id: number; expected_status: string; nonce: string }) => {
      const data = await sendPostToClient(deps, a, secret);
      return { summary: OUTCOME_MESSAGES[data.outcome], data };
    },
    // Never the nonce: ids, the expected status and the outcome only.
    (a, data) => ({ post_id: a.post_id, expected_status: a.expected_status, outcome: data.outcome }),
    { card: true, meta: appOnlyToolMeta() },
  );
}

export const SEND_TOOL_META: Record<string, ToolMeta> = {
  send_post_to_client: { title: "Enviar post ao cliente", readOnly: false, openWorld: true },
};
