// Excluir workspace pelo Admin (migration 20261208000001): actions `delete-workspace-preview`
// (leitura: o que some, quem perde o login, o que bloqueia) e `delete-workspace` (exige a
// palavra de confirmação, reconfere tudo e exclui).
//
// Ordem do delete:
//   1. a palavra digitada (DELETE_CONFIRM_WORD) confere aqui também, não só na UI;
//   2. cobrança: o espelho (workspace_subscriptions) primeiro e, se ele deixa passar mas ainda há
//      id de assinatura, a leitura ao vivo na Stripe / no Pagar.me. Falha na leitura = bloqueia
//      (fail closed): o Admin nunca exclui um workspace que segue sendo cobrado;
//   3. a RPC admin_delete_workspace apaga tudo numa transação (e reconfere o espelho sob lock);
//   4. só depois do commit, os logins de quem não participa de outro workspace saem, um por um.
//      Uma falha aqui não desfaz nada: vira auditoria e volta na resposta.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";
import { loadStripe } from "../_shared/stripe-loader.ts";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import { createPagarmeDetailGateway } from "./pagarme-detail.ts";

/** A palavra que o admin digita para confirmar. A UI usa a mesma (apps/admin/src/lib/api.ts). */
export const DELETE_CONFIRM_WORD = "delete";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE_TIMEOUT_MS = 10_000;

const MSG_ID = "workspace_id inválido.";
const MSG_CONFIRM = `Digite ${DELETE_CONFIRM_WORD} para confirmar.`;
const MSG_NOT_FOUND = "Workspace não encontrado.";
const MSG_ACTIVE_SUB =
  "Este workspace tem uma assinatura ativa. Cancele a assinatura na Stripe ou no Pagar.me antes de excluir.";
const MSG_UNVERIFIED =
  "Não foi possível confirmar na Stripe ou no Pagar.me que a assinatura está cancelada. Tente de novo em instantes.";
const MSG_CONFLICT = "O workspace mudou durante a exclusão. Tente de novo.";
const MSG_FAILED = "Não foi possível excluir o workspace. Nada foi apagado.";
const MSG_TIMEOUT = "A exclusão passou do tempo limite. Nada foi apagado. Tente de novo.";

export interface DeletePreviewMember {
  user_id: string;
  role: string;
  email: string | null;
  name: string | null;
  login_deleted: boolean;
}

interface MirrorSubscription {
  provider: string | null;
  status: string | null;
  stripe_subscription_id: string | null;
  pagarme_subscription_id: string | null;
  blocks: boolean;
}

interface PreviewRow {
  workspace: { id: string; name: string };
  subscription: MirrorSubscription | null;
  counts: { clientes: number; posts: number; arquivos: number; membros: number };
  members: DeletePreviewMember[];
}

export type DeleteBlocker =
  | { reason: "active_subscription"; provider: string | null; status: string | null; message: string }
  | { reason: "billing_unverified"; provider: "stripe" | "pagarme"; message: string };

export interface LiveBilling {
  /** Status ao vivo; null quando a assinatura não existe mais no provedor. Lança em qualquer outra falha. */
  stripeStatus(subscriptionId: string): Promise<string | null>;
  pagarmeStatus(subscriptionId: string): Promise<string | null>;
}

export interface DeleteWorkspaceDeps {
  db: SupabaseClient;
  billing: LiveBilling;
  deleteUser(userId: string): Promise<void>;
}

type Result = { status: number; body: Record<string, unknown> };

const STRIPE_ENDED = new Set(["canceled", "incomplete_expired"]);
// Pagar.me: `failed` é assinatura encerrada (normalizePagarmeStatus a trata como canceled).
const PAGARME_ENDED = new Set(["canceled", "failed"]);

function workspaceIdFrom(body: unknown): string | null {
  const id = (body as { workspace_id?: unknown } | null)?.workspace_id;
  return typeof id === "string" && UUID_RE.test(id) ? id : null;
}

function rpcErrorText(error: unknown): string {
  const e = error as { message?: string; code?: string } | null;
  return `${e?.code ?? ""} ${e?.message ?? ""}`;
}

async function loadPreview(db: SupabaseClient, workspaceId: string): Promise<PreviewRow | null> {
  const { data, error } = await db.rpc("admin_delete_workspace_preview", { p_conta: workspaceId });
  if (error) {
    if (rpcErrorText(error).includes("workspace_not_found")) return null;
    throw error;
  }
  return data as PreviewRow;
}

/**
 * O que impede a exclusão agora, ou null. O espelho decide primeiro; se ele deixa passar, cada id
 * de assinatura que sobrou é conferido ao vivo (uma linha pode ter os dois: troca Stripe -> 12x).
 */
export async function billingBlocker(
  sub: MirrorSubscription | null,
  billing: LiveBilling,
): Promise<DeleteBlocker | null> {
  if (!sub) return null;
  if (sub.blocks) {
    return { reason: "active_subscription", provider: sub.provider, status: sub.status, message: MSG_ACTIVE_SUB };
  }
  if (sub.stripe_subscription_id) {
    let live: string | null;
    try {
      live = await billing.stripeStatus(sub.stripe_subscription_id);
    } catch (e) {
      console.error("[platform-admin:delete-workspace] stripe live read failed", e);
      return { reason: "billing_unverified", provider: "stripe", message: MSG_UNVERIFIED };
    }
    if (live !== null && !STRIPE_ENDED.has(live)) {
      return { reason: "active_subscription", provider: "stripe", status: live, message: MSG_ACTIVE_SUB };
    }
  }
  if (sub.pagarme_subscription_id) {
    let live: string | null;
    try {
      live = await billing.pagarmeStatus(sub.pagarme_subscription_id);
    } catch (e) {
      console.error("[platform-admin:delete-workspace] pagarme live read failed", e);
      return { reason: "billing_unverified", provider: "pagarme", message: MSG_UNVERIFIED };
    }
    if (live !== null && !PAGARME_ENDED.has(live)) {
      return { reason: "active_subscription", provider: "pagarme", status: live, message: MSG_ACTIVE_SUB };
    }
  }
  return null;
}

export async function previewWorkspaceDelete(deps: DeleteWorkspaceDeps, body: unknown): Promise<Result> {
  const workspaceId = workspaceIdFrom(body);
  if (!workspaceId) return { status: 400, body: { error: MSG_ID } };
  const preview = await loadPreview(deps.db, workspaceId);
  if (!preview) return { status: 404, body: { error: MSG_NOT_FOUND } };
  const blocker = await billingBlocker(preview.subscription, deps.billing);
  return {
    status: 200,
    body: {
      workspace: preview.workspace,
      counts: preview.counts,
      members: preview.members,
      blocker,
      confirm_word: DELETE_CONFIRM_WORD,
    },
  };
}

/** Ainda sem outro workspace e fora de platform_admins (reconfere depois do commit). */
async function stillOrphan(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data: other, error: e1 } = await db
    .from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1);
  if (e1) throw e1;
  if ((other ?? []).length > 0) return false;
  const { data: admin, error: e2 } = await db
    .from("platform_admins").select("id").eq("user_id", userId).limit(1);
  if (e2) throw e2;
  return (admin ?? []).length === 0;
}

export async function deleteWorkspace(
  deps: DeleteWorkspaceDeps,
  body: unknown,
  actorUserId: string,
): Promise<Result> {
  const workspaceId = workspaceIdFrom(body);
  if (!workspaceId) return { status: 400, body: { error: MSG_ID } };
  const confirm = (body as { confirm?: unknown } | null)?.confirm;
  if (typeof confirm !== "string" || confirm.trim() !== DELETE_CONFIRM_WORD) {
    return { status: 400, body: { error: MSG_CONFIRM } };
  }

  const preview = await loadPreview(deps.db, workspaceId);
  if (!preview) return { status: 404, body: { error: MSG_NOT_FOUND } };
  const blocker = await billingBlocker(preview.subscription, deps.billing);
  if (blocker) return { status: 409, body: { error: blocker.message, blocker } };

  const { data, error } = await deps.db.rpc("admin_delete_workspace", {
    p_conta: workspaceId,
    p_actor: actorUserId,
  });
  if (error) {
    const text = rpcErrorText(error);
    if (text.includes("workspace_not_found")) return { status: 404, body: { error: MSG_NOT_FOUND } };
    if (text.includes("active_subscription")) return { status: 409, body: { error: MSG_ACTIVE_SUB } };
    if (text.includes("40P01") || text.includes("deadlock")) return { status: 409, body: { error: MSG_CONFLICT } };
    // statement_timeout / lock_timeout do authenticator (8 s): a transação inteira volta.
    if (text.includes("57014") || text.includes("55P03")) return { status: 503, body: { error: MSG_TIMEOUT } };
    console.error("[platform-admin:delete-workspace] rpc failed", { workspaceId, error });
    return { status: 500, body: { error: MSG_FAILED } };
  }

  const orphanIds = ((data as { orphan_user_ids?: string[] } | null)?.orphan_user_ids ?? []);
  const emailById = new Map(preview.members.map((m) => [m.user_id, m.email]));
  let loginsDeleted = 0;
  const loginsKept: string[] = [];
  const loginsFailed: string[] = [];
  for (const userId of orphanIds) {
    const label = emailById.get(userId) ?? userId;
    try {
      if (!(await stillOrphan(deps.db, userId))) {
        loginsKept.push(label);
        continue;
      }
      await deps.deleteUser(userId);
      loginsDeleted++;
    } catch (e) {
      console.error("[platform-admin:delete-workspace] login delete failed", { workspaceId, userId, error: e });
      loginsFailed.push(label);
      await insertAuditLog(deps.db, {
        actor_user_id: actorUserId,
        action: "admin-delete-workspace-login-failed",
        resource_type: "user",
        resource_id: userId,
        metadata: { workspace_id: workspaceId, workspace_name: preview.workspace.name, email: emailById.get(userId) ?? null },
      });
    }
  }

  return {
    status: 200,
    body: {
      workspace_id: workspaceId,
      workspace_name: preview.workspace.name,
      logins_deleted: loginsDeleted,
      logins_kept: loginsKept,
      logins_failed: loginsFailed,
    },
  };
}

/** Leitura ao vivo real. Sem cliente Stripe carregado = lança (o chamador bloqueia). */
export function createLiveBilling(): LiveBilling {
  const pagarme = createPagarmeDetailGateway();
  return {
    stripeStatus: async (subscriptionId) => {
      const stripe = await loadStripe();
      if (!stripe) throw new Error("stripe client unavailable");
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: [] }, {
          timeout: STRIPE_TIMEOUT_MS,
        }) as { status?: string };
        return sub.status ?? "";
      } catch (e) {
        const err = e as { statusCode?: number; code?: string };
        if (err.statusCode === 404 || err.code === "resource_missing") return null;
        throw e;
      }
    },
    pagarmeStatus: async (subscriptionId) => {
      try {
        const sub = await pagarme.fetchSubscription(subscriptionId);
        return sub.status;
      } catch (e) {
        if (e instanceof PagarmeApiError && e.status === 404) return null;
        throw e;
      }
    },
  };
}
