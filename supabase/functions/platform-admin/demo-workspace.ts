// Conta demo criada pelo Admin (spec docs/superpowers/specs/2026-10-26-conta-demo-admin-design.md
// §2 and §8): actions `create-demo-workspace` and `resend-demo-access`.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";
import { coerceHasPassword } from "../_shared/invite-classify.ts";
import type { DemoSeedCounts, sendDemoAccessEmail } from "../_shared/invite-email.ts";

/**
 * Plans a demo can never use. Mirrors `INTERNAL_PLAN_IDS` in
 * apps/crm/src/pages/configuracao/cobranca/plan-display.ts:11 (plans that can never be
 * subscribed to from the CRM, so the demo could never convert). Keep both in sync by hand.
 * The default (free) plan is refused separately by reading `plans.is_default`.
 */
export const DEMO_EXCLUDED_PLAN_IDS = new Set(["lifetime"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same normalisation as the on_auth_user_created_zz_affiliate_referral trigger.
const REF_CODE_RE = /^[a-z0-9]{4,32}$/;
const DEFAULT_EMPRESA = "Minha agência";

const MSG_EMAIL = "E-mail inválido.";
const MSG_PLAN_REQUIRED = "Escolha um plano.";
const MSG_PLAN_INVALID = "Este plano não pode ser usado em uma conta demo.";
const MSG_AFFILIATE = "Código de afiliado não encontrado ou inativo.";
const MSG_AFFILIATE_SELF = "O afiliado não pode indicar o próprio e-mail.";
const MSG_DUPLICATE = "Já existe uma conta Mesaas com este e-mail.";
const MSG_CREATE_FAILED = "Não foi possível criar a conta demo. Nada foi criado.";
const MSG_PASSWORD_SET = "O dono já definiu a senha.";
const MSG_NOT_DEMO = "Este workspace não é uma conta demo.";
const MSG_RESEND_FAILED = "Não foi possível reenviar o acesso.";

export type DemoInput =
  | { ok: true; email: string; planId: string; nome: string | null; empresa: string; refCode: string | null }
  | { ok: false; status: 400; error: string };

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function validateDemoInput(body: unknown): DemoInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const email = trimmed(b.email).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, status: 400, error: MSG_EMAIL };
  const planId = trimmed(b.plan_id);
  if (!planId) return { ok: false, status: 400, error: MSG_PLAN_REQUIRED };
  const nome = trimmed(b.nome) || null;
  const empresa = trimmed(b.empresa) || DEFAULT_EMPRESA;
  const ref = trimmed(b.ref_code).toLowerCase();
  if (ref && !REF_CODE_RE.test(ref)) return { ok: false, status: 400, error: MSG_AFFILIATE };
  return { ok: true, email, planId, nome, empresa, refCode: ref || null };
}

export interface DemoDeps {
  db: SupabaseClient;
  /** `invite` creates the (unconfirmed) user and fires the signup trigger; `recovery` only mints a link. */
  generateLink(
    type: "invite" | "recovery",
    email: string,
    data: Record<string, string>,
    redirectTo: string,
  ): Promise<{ userId: string; actionLink: string }>;
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  getUserEmail(userId: string): Promise<string | null>;
  deleteUser(userId: string): Promise<void>;
  sendEmail: typeof sendDemoAccessEmail;
  redirectBase: string;
}

/**
 * Two ids because they reference different tables: `workspace_plan_overrides.updated_by`
 * references platform_admins(id); `workspaces.demo_created_by` and `audit_log.actor_user_id`
 * reference auth.users(id).
 */
export interface DemoActor {
  adminId: string;
  userId: string;
}

type Result = { status: number; body: Record<string, unknown> };

const ZERO_COUNTS: DemoSeedCounts = { membros: 0, clientes: 0, workflows: 0, posts: 0, ideias: 0, leads: 0, eventos: 0 };

function toCounts(raw: unknown): DemoSeedCounts {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof DemoSeedCounts) => (typeof r[k] === "number" ? (r[k] as number) : 0);
  return {
    membros: n("membros"),
    clientes: n("clientes"),
    workflows: n("workflows"),
    posts: n("posts"),
    ideias: n("ideias"),
    leads: n("leads"),
    eventos: n("eventos"),
  };
}

function ensureOk(error: unknown, step: string): void {
  if (error) {
    console.error(`[platform-admin:create-demo] ${step} failed`, error);
    throw new Error(`demo_step_failed:${step}`);
  }
}

export async function createDemoWorkspace(deps: DemoDeps, body: unknown, actor: DemoActor): Promise<Result> {
  const input = validateDemoInput(body);
  if (!input.ok) return { status: input.status, body: { error: input.error } };
  const { db } = deps;

  // ── Checks, before anything is written ──
  const { data: plan, error: planErr } = await db
    .from("plans").select("id, name, is_active, is_default").eq("id", input.planId).maybeSingle();
  if (planErr) {
    console.error("[platform-admin:create-demo] plan lookup failed", planErr);
    return { status: 500, body: { error: MSG_CREATE_FAILED } };
  }
  if (!plan || plan.is_active !== true || plan.is_default === true || DEMO_EXCLUDED_PLAN_IDS.has(plan.id)) {
    return { status: 400, body: { error: MSG_PLAN_INVALID } };
  }

  let affiliateId: string | null = null;
  if (input.refCode) {
    const { data: aff, error: affErr } = await db
      .from("affiliates").select("id, code, email").eq("code", input.refCode).eq("status", "active").maybeSingle();
    if (affErr) {
      console.error("[platform-admin:create-demo] affiliate lookup failed", affErr);
      return { status: 500, body: { error: MSG_CREATE_FAILED } };
    }
    if (!aff) return { status: 400, body: { error: MSG_AFFILIATE } };
    if (typeof aff.email === "string" && aff.email.trim().toLowerCase() === input.email) {
      return { status: 400, body: { error: MSG_AFFILIATE_SELF } };
    }
    affiliateId = aff.id;
  }

  try {
    if (await deps.findUserByEmail(input.email)) return { status: 409, body: { error: MSG_DUPLICATE } };
  } catch (e) {
    console.error("[platform-admin:create-demo] user lookup failed", e);
    return { status: 500, body: { error: MSG_CREATE_FAILED } };
  }

  // ── Step 1: create the user WITHOUT conta_id (fresh-signup trigger branch). ──
  // Metadata carries nome/empresa only; never ref_code (the affiliate row is written below).
  const meta: Record<string, string> = input.nome
    ? { nome: input.nome, empresa: input.empresa }
    : { empresa: input.empresa };
  let userId: string;
  let actionLink: string;
  try {
    ({ userId, actionLink } = await deps.generateLink(
      "invite",
      input.email,
      meta,
      deps.redirectBase + "/configurar-senha",
    ));
  } catch (e) {
    // Two requests racing for the same new e-mail: Auth answers code email_exists (422).
    if ((e as { code?: unknown })?.code === "email_exists") return { status: 409, body: { error: MSG_DUPLICATE } };
    console.error("[platform-admin:create-demo] generateLink failed", e);
    return { status: 500, body: { error: MSG_CREATE_FAILED } };
  }

  // ── Steps 2-4 (+ affiliate row): any failure rolls everything back. ──
  let workspaceId: string | null = null;
  let counts: DemoSeedCounts;
  try {
    const { data: member, error: mErr } = await db
      .from("workspace_members").select("workspace_id").eq("user_id", userId).eq("role", "owner").maybeSingle();
    ensureOk(mErr, "workspace_lookup");
    if (!member?.workspace_id) throw new Error("demo_step_failed:workspace_missing");
    workspaceId = member.workspace_id as string;

    // Plan before seeding: the posts limit triggers count against the plan.
    const { error: wErr } = await db.from("workspaces").update({
      plan_id: plan.id,
      plan_source: "demo",
      demo_created_at: new Date().toISOString(),
      demo_created_by: actor.userId,
    }).eq("id", workspaceId);
    ensureOk(wErr, "workspace_update");

    // Same create/reset as handleSetWorkspacePlan (platform-admin/index.ts).
    const { data: existing, error: oSelErr } = await db
      .from("workspace_plan_overrides").select("id").eq("workspace_id", workspaceId).maybeSingle();
    ensureOk(oSelErr, "overrides_lookup");
    if (existing) {
      const { error } = await db.from("workspace_plan_overrides").update({
        resource_overrides: null,
        feature_overrides: null,
        notes: null,
        updated_by: actor.adminId,
        updated_at: new Date().toISOString(),
      }).eq("workspace_id", workspaceId);
      ensureOk(error, "overrides_update");
    } else {
      const { error } = await db.from("workspace_plan_overrides")
        .insert({ workspace_id: workspaceId, updated_by: actor.adminId });
      ensureOk(error, "overrides_insert");
    }

    const { data: seeded, error: seedErr } = await db.rpc("demo_workspace_seed", {
      p_conta: workspaceId,
      p_owner: userId,
    });
    ensureOk(seedErr, "seed");
    counts = toCounts(seeded);

    if (affiliateId && input.refCode) {
      const { error } = await db.from("affiliate_referrals").insert({
        workspace_id: workspaceId,
        affiliate_id: affiliateId,
        ref_code: input.refCode,
      });
      ensureOk(error, "affiliate_referral");
    }
  } catch (e) {
    console.error("[platform-admin:create-demo] creation failed, rolling back", e);
    await rollback(deps, userId, workspaceId, input.email, plan.id, actor);
    return { status: 500, body: { error: MSG_CREATE_FAILED } };
  }

  // ── Step 5: from here on the account exists for good. ──
  await insertAuditLog(db, {
    conta_id: workspaceId,
    actor_user_id: actor.userId,
    action: "admin-create-demo",
    resource_type: "workspace",
    resource_id: workspaceId,
    metadata: { email: input.email, plan_id: plan.id },
  });

  // ── Step 6: e-mail. A failure never rolls back (Resend is not transactional). ──
  let emailSent = true;
  try {
    await deps.sendEmail({ to: input.email, actionLink, nome: input.nome, planName: plan.name, counts });
  } catch (e) {
    emailSent = false;
    console.error("[platform-admin:create-demo] e-mail send failed", { workspaceId, error: e });
  }

  return { status: 200, body: { workspace_id: workspaceId, email: input.email, email_sent: emailSent } };
}

async function rollback(
  deps: DemoDeps,
  userId: string,
  workspaceId: string | null,
  email: string,
  planId: string,
  actor: DemoActor,
): Promise<void> {
  try {
    if (workspaceId) {
      const { error } = await deps.db.rpc("demo_workspace_discard", { p_conta: workspaceId });
      if (error) throw error;
    }
    await deps.deleteUser(userId);
  } catch (e) {
    console.error("[platform-admin:create-demo] CRITICAL rollback failed", { userId, workspaceId, error: e });
    await insertAuditLog(deps.db, {
      conta_id: workspaceId ?? undefined,
      actor_user_id: actor.userId,
      // Distinct action so the workspace history never shows a half-rolled-back demo as created.
      action: "admin-create-demo-failed",
      resource_type: "workspace",
      resource_id: workspaceId ?? undefined,
      metadata: { email, plan_id: planId, user_id: userId, rollback_failed: true },
    });
  }
}

export async function resendDemoAccess(
  deps: DemoDeps,
  body: { workspace_id?: string },
  actor: DemoActor,
): Promise<Result> {
  const workspaceId = typeof body?.workspace_id === "string" ? body.workspace_id.trim() : "";
  if (!workspaceId) return { status: 400, body: { error: "workspace_id obrigatório." } };
  const { db } = deps;

  try {
    const { data: ws, error: wsErr } = await db
      .from("workspaces").select("id, created_by, demo_created_at, plan_id").eq("id", workspaceId).maybeSingle();
    if (wsErr) throw wsErr;
    if (!ws) return { status: 404, body: { error: "Workspace não encontrado." } };
    if (!ws.demo_created_at || !ws.created_by) return { status: 409, body: { error: MSG_NOT_DEMO } };
    const ownerId = ws.created_by as string;

    const { data: pw, error: pwErr } = await db.rpc("user_has_password", { p_user_id: ownerId });
    const hasPassword = coerceHasPassword(pw, pwErr);
    if (hasPassword === true) return { status: 409, body: { error: MSG_PASSWORD_SET } };
    if (hasPassword === null) throw pwErr ?? new Error("user_has_password returned no boolean");

    const email = await deps.getUserEmail(ownerId);
    if (!email) throw new Error("owner e-mail not found");

    const { data: profile } = await db.from("profiles").select("nome").eq("id", ownerId).maybeSingle();
    const { data: plan } = ws.plan_id
      ? await db.from("plans").select("name").eq("id", ws.plan_id).maybeSingle()
      : { data: null };

    const { actionLink } = await deps.generateLink("recovery", email, {}, deps.redirectBase + "/configurar-senha");

    let emailSent = true;
    try {
      // Seed counts are not stored, so the resend omits the examples sentence.
      await deps.sendEmail({
        to: email,
        actionLink,
        nome: (profile?.nome as string | undefined) ?? null,
        planName: (plan?.name as string | undefined) ?? "atual",
        counts: ZERO_COUNTS,
      });
    } catch (e) {
      emailSent = false;
      console.error("[platform-admin:resend-demo] e-mail send failed", { workspaceId, error: e });
    }

    await insertAuditLog(db, {
      conta_id: workspaceId,
      actor_user_id: actor.userId,
      action: "admin-resend-demo-access",
      resource_type: "workspace",
      resource_id: workspaceId,
      metadata: { email, email_sent: emailSent },
    });

    return { status: 200, body: { email, email_sent: emailSent } };
  } catch (e) {
    console.error("[platform-admin:resend-demo] failed", { workspaceId, error: e });
    return { status: 500, body: { error: MSG_RESEND_FAILED } };
  }
}
