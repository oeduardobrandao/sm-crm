// Affiliate attribution edited by the Admin (spec 2026-10-26-conta-demo-admin §8).
// Shared by `create-demo-workspace` (demo-workspace.ts) and `set-workspace-affiliate`.
// Never writes affiliate_commissions: commissions already recorded stay with whoever earned
// them, and the commission window is sum(covered_months) per workspace
// (_shared/affiliate-commission.ts), so changing the affiliate does not restart it.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";

// Same normalisation as the on_auth_user_created_zz_affiliate_referral trigger.
const REF_CODE_RE = /^[a-z0-9]{4,32}$/;

export const MSG_AFFILIATE_NOT_FOUND = "Código de afiliado não encontrado ou inativo.";
export const MSG_AFFILIATE_SELF = "O afiliado não pode indicar o próprio e-mail.";

export interface ActiveAffiliate {
  id: string;
  code: string;
  nome: string;
  email: string | null;
}

export interface WorkspaceAffiliate {
  id: string;
  name: string;
  code: string;
}

/** Blank/null/undefined → `code: null` (no affiliate); otherwise trim + lowercase + format check. */
export function normalizeRefCode(raw: unknown): { ok: true; code: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, code: null };
  if (typeof raw !== "string") return { ok: false };
  const code = raw.trim().toLowerCase();
  if (!code) return { ok: true, code: null };
  return REF_CODE_RE.test(code) ? { ok: true, code } : { ok: false };
}

/** Active affiliate for an already-normalised code, or null. Throws on a read error. */
export async function findActiveAffiliate(db: SupabaseClient, code: string): Promise<ActiveAffiliate | null> {
  const { data, error } = await db
    .from("affiliates").select("id, code, nome, email").eq("code", code).eq("status", "active").maybeSingle();
  if (error) throw error;
  return (data as ActiveAffiliate | null) ?? null;
}

export function isSelfReferral(affiliate: ActiveAffiliate, email: string | null | undefined): boolean {
  if (!email || typeof affiliate.email !== "string") return false;
  return affiliate.email.trim().toLowerCase() === email.trim().toLowerCase();
}

/** The detail payload's `affiliate`: `{ id, name, code }` or null. */
export async function loadWorkspaceAffiliate(db: SupabaseClient, workspaceId: string): Promise<WorkspaceAffiliate | null> {
  const { data, error } = await db
    .from("affiliate_referrals").select("affiliate_id, affiliates(id, nome, code)").eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[platform-admin:workspace-affiliate] referral read failed", error);
    return null;
  }
  const aff = (data as { affiliates?: { id: string; nome: string; code: string } | null } | null)?.affiliates;
  return aff ? { id: aff.id, name: aff.nome, code: aff.code } : null;
}

async function ownerEmails(db: SupabaseClient, workspaceId: string): Promise<string[]> {
  const { data, error } = await db
    .from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner");
  if (error) throw error;
  const ids = ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
  const emails: string[] = [];
  for (const id of ids) {
    const { data: u, error: uErr } = await db.auth.admin.getUserById(id);
    if (uErr) throw uErr;
    if (u?.user?.email) emails.push(u.user.email);
  }
  return emails;
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleSetWorkspaceAffiliate(
  svc: SupabaseClient,
  body: { workspace_id?: unknown; ref_code?: unknown },
  actorUserId: string,
  headers: Record<string, string>,
) {
  const workspaceId = typeof body?.workspace_id === "string" ? body.workspace_id.trim() : "";
  if (!workspaceId) return json({ error: "workspace_id obrigatório." }, 400, headers);
  const norm = normalizeRefCode(body?.ref_code);
  if (!norm.ok) return json({ error: MSG_AFFILIATE_NOT_FOUND }, 400, headers);

  try {
    const { data: ws, error: wsErr } = await svc.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
    if (wsErr) throw wsErr;
    if (!ws) return json({ error: "Workspace não encontrado." }, 404, headers);

    const { data: current, error: curErr } = await svc
      .from("affiliate_referrals").select("affiliate_id").eq("workspace_id", workspaceId).maybeSingle();
    if (curErr) throw curErr;
    const oldId = (current as { affiliate_id?: string } | null)?.affiliate_id ?? null;

    let next: ActiveAffiliate | null = null;
    if (norm.code) {
      next = await findActiveAffiliate(svc, norm.code);
      if (!next) return json({ error: MSG_AFFILIATE_NOT_FOUND }, 400, headers);
      const emails = await ownerEmails(svc, workspaceId);
      if (emails.some((e) => isSelfReferral(next!, e))) return json({ error: MSG_AFFILIATE_SELF }, 400, headers);
    }
    const newId = next?.id ?? null;
    const payload = { affiliate: next ? { id: next.id, name: next.nome, code: next.code } : null };
    if (oldId === newId) return json(payload, 200, headers);

    if (!next) {
      const { error } = await svc.from("affiliate_referrals").delete().eq("workspace_id", workspaceId);
      if (error) throw error;
    } else if (oldId) {
      // Update in place so created_at (the original attribution date) is preserved.
      const { error } = await svc.from("affiliate_referrals")
        .update({ affiliate_id: next.id, ref_code: next.code }).eq("workspace_id", workspaceId);
      if (error) throw error;
    } else {
      const { error } = await svc.from("affiliate_referrals")
        .insert({ workspace_id: workspaceId, affiliate_id: next.id, ref_code: next.code });
      if (error) throw error;
    }

    await insertAuditLog(svc, {
      conta_id: workspaceId,
      actor_user_id: actorUserId,
      action: "admin-set-affiliate",
      resource_type: "workspace",
      resource_id: workspaceId,
      metadata: { old_affiliate_id: oldId, new_affiliate_id: newId },
    });
    return json(payload, 200, headers);
  } catch (e) {
    console.error("[platform-admin:set-workspace-affiliate] failed", { workspaceId, error: e });
    return json({ error: "Não foi possível alterar o afiliado." }, 500, headers);
  }
}
