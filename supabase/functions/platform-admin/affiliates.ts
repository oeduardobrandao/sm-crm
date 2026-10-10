// Programa de afiliados no Admin: listar, detalhar, suspender/reativar e editar a tabela de
// comissões por plano. Os repasses saem pelo Stripe Connect (affiliate-payout-cron); aqui só
// são lidos. Spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Headers = Record<string, string>;

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

/** bigint do PostgREST chega como string. */
function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export function shapeAffiliateSummary(row: Record<string, unknown> | null | undefined) {
  return {
    referrals_count: num(row?.referrals_count),
    trialing_count: num(row?.trialing_count),
    paying_count: num(row?.paying_count),
    pending_cents: num(row?.pending_cents),
    available_cents: num(row?.available_cents),
    paid_out_cents: num(row?.paid_out_cents),
    lifetime_cents: num(row?.lifetime_cents),
  };
}

export type AffiliateUpdate = { status: "active" | "suspended" };

export function validateAffiliateUpdate(
  body: Record<string, unknown>,
): { ok: true; id: string; patch: AffiliateUpdate } | { ok: false; error: string } {
  const id = body.affiliate_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "affiliate_id is required" };
  if (body.status !== "active" && body.status !== "suspended") return { ok: false, error: "Invalid status" };
  return { ok: true, id, patch: { status: body.status } };
}

export type CommissionRuleInput = { plan_id: string; rate_bps: number; months: number };

export function validateCommissionRule(
  body: Record<string, unknown>,
): { ok: true; value: CommissionRuleInput } | { ok: false; error: string } {
  const planId = body.plan_id;
  if (typeof planId !== "string" || !/^[a-z0-9_-]{1,40}$/.test(planId)) {
    return { ok: false, error: "plan_id is required" };
  }
  const rate = body.rate_bps;
  if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 0 || rate > 10_000) {
    return { ok: false, error: "Percentual inválido (0 a 100%)." };
  }
  const months = body.months;
  if (typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 120) {
    return { ok: false, error: "Meses inválidos (1 a 120)." };
  }
  return { ok: true, value: { plan_id: planId, rate_bps: rate, months } };
}

/** Regras + nome/preço do plano, na ordem dos planos. Planos pagos sem regra vêm com rate 0. */
async function loadCommissionTable(svc: SupabaseClient) {
  const [{ data: plans, error: plansErr }, { data: rules, error: rulesErr }] = await Promise.all([
    svc.from("plans").select("id, name, price_brl, sort_order").eq("is_active", true).order("sort_order"),
    svc.from("affiliate_commission_rules").select("plan_id, rate_bps, months"),
  ]);
  if (plansErr) throw plansErr;
  if (rulesErr) throw rulesErr;
  const byPlan = new Map<string, { rate_bps: number; months: number }>();
  for (const r of (rules ?? []) as Array<{ plan_id: string; rate_bps: number; months: number }>) {
    byPlan.set(r.plan_id, r);
  }
  return ((plans ?? []) as Array<{ id: string; name: string; price_brl: number | null }>)
    .filter((p) => (p.price_brl ?? 0) > 0 || byPlan.has(p.id))
    .map((p) => ({
      plan_id: p.id,
      plan_name: p.name,
      price_brl: p.price_brl,
      rate_bps: byPlan.get(p.id)?.rate_bps ?? 0,
      months: byPlan.get(p.id)?.months ?? 0,
      configured: byPlan.has(p.id),
    }));
}

const AFFILIATE_LIST_COLS =
  "id, code, nome, email, status, stripe_account_id, stripe_details_submitted, stripe_transfers_active, created_at";

export async function handleListAffiliates(svc: SupabaseClient, headers: Headers): Promise<Response> {
  const [{ data: affiliates, error }, { data: summaries, error: sumErr }, rules] = await Promise.all([
    svc.from("affiliates").select(AFFILIATE_LIST_COLS).order("created_at", { ascending: false }).limit(1000),
    svc.rpc("affiliate_summaries", { p_affiliate_id: null }),
    loadCommissionTable(svc),
  ]);
  if (error) throw error;
  if (sumErr) throw sumErr;
  const byId = new Map<string, Record<string, unknown>>();
  for (const s of (summaries ?? []) as Array<Record<string, unknown>>) byId.set(String(s.affiliate_id), s);
  const rows = ((affiliates ?? []) as Array<Record<string, unknown>>).map((a) => ({
    ...a,
    summary: shapeAffiliateSummary(byId.get(String(a.id))),
  }));
  return json({ affiliates: rows, rules }, 200, headers);
}

export async function handleGetAffiliate(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  headers: Headers,
): Promise<Response> {
  const id = body.affiliate_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return json({ error: "affiliate_id is required" }, 400, headers);

  const { data: affiliate, error } = await svc
    .from("affiliates")
    .select(
      "id, code, nome, email, telefone, status, stripe_account_id, stripe_details_submitted, stripe_transfers_active, stripe_status_checked_at, terms_accepted_at, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!affiliate) return json({ error: "Affiliate not found" }, 404, headers);

  const [summaryRes, referralsRes, commissionsRes, payoutsRes] = await Promise.all([
    svc.rpc("affiliate_summaries", { p_affiliate_id: id }).maybeSingle(),
    svc.from("affiliate_referrals").select("workspace_id, ref_code, created_at").eq("affiliate_id", id)
      .order("created_at", { ascending: false }).limit(1000),
    svc.from("affiliate_commissions")
      .select(
        "id, workspace_id, stripe_invoice_id, invoice_amount_cents, plan_id, billing_reason, commissionable_cents, covered_months, rate_bps, commission_cents, refunded_amount_cents, disputed, net_cents, paid_at, available_at",
      )
      .eq("affiliate_id", id).order("paid_at", { ascending: false }).limit(500),
    svc.from("affiliate_payouts")
      .select("id, amount_cents, status, stripe_account_id, stripe_transfer_id, failure_code, created_at, paid_at")
      .eq("affiliate_id", id).order("created_at", { ascending: false }).limit(500),
  ]);
  for (const r of [summaryRes, referralsRes, commissionsRes, payoutsRes]) if (r.error) throw r.error;

  const referrals = (referralsRes.data ?? []) as Array<{ workspace_id: string; ref_code: string; created_at: string }>;
  const commissions = (commissionsRes.data ?? []) as Array<{ workspace_id: string | null } & Record<string, unknown>>;
  const workspaceIds = [
    ...new Set([
      ...referrals.map((r) => r.workspace_id),
      ...commissions.map((c) => c.workspace_id).filter((w): w is string => !!w),
    ]),
  ];

  const names = new Map<string, string>();
  const subs = new Map<string, Record<string, unknown>>();
  if (workspaceIds.length > 0) {
    const [wsRes, subRes] = await Promise.all([
      svc.from("workspaces").select("id, name").in("id", workspaceIds),
      svc.from("workspace_subscriptions").select("workspace_id, provider, status, plan_id, billing_interval")
        .in("workspace_id", workspaceIds),
    ]);
    if (wsRes.error) throw wsRes.error;
    if (subRes.error) throw subRes.error;
    for (const w of (wsRes.data ?? []) as Array<{ id: string; name: string }>) names.set(w.id, w.name);
    for (const s of (subRes.data ?? []) as Array<Record<string, unknown>>) subs.set(String(s.workspace_id), s);
  }

  return json({
    affiliate,
    summary: shapeAffiliateSummary(summaryRes.data as Record<string, unknown> | null),
    referrals: referrals.map((r) => {
      const s = subs.get(r.workspace_id);
      return {
        workspace_id: r.workspace_id,
        workspace_name: names.get(r.workspace_id) ?? null,
        created_at: r.created_at,
        provider: (s?.provider as string | null) ?? null,
        status: (s?.status as string | null) ?? null,
        plan_id: (s?.plan_id as string | null) ?? null,
        billing_interval: (s?.billing_interval as string | null) ?? null,
      };
    }),
    commissions: commissions.map((c) => ({
      ...c,
      workspace_name: c.workspace_id ? names.get(c.workspace_id) ?? null : null,
    })),
    payouts: payoutsRes.data ?? [],
  }, 200, headers);
}

export async function handleUpdateAffiliate(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  adminUserId: string,
  headers: Headers,
): Promise<Response> {
  const input = validateAffiliateUpdate(body);
  if (!input.ok) return json({ error: input.error }, 400, headers);

  const { data, error } = await svc
    .from("affiliates")
    .update({ ...input.patch, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .select("id, status, commission_rate_bps")
    .maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: "Affiliate not found" }, 404, headers);

  await insertAuditLog(svc, {
    action: "admin-update-affiliate",
    actor_user_id: adminUserId,
    resource_type: "affiliate",
    resource_id: input.id,
    metadata: { ...input.patch },
  });
  return json({ affiliate: data }, 200, headers);
}

export async function handleUpdateCommissionRule(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  adminUserId: string,
  headers: Headers,
): Promise<Response> {
  const input = validateCommissionRule(body);
  if (!input.ok) return json({ error: input.error }, 400, headers);
  const r = input.value;

  const { data: plan, error: planErr } = await svc.from("plans").select("id").eq("id", r.plan_id).maybeSingle();
  if (planErr) throw planErr;
  if (!plan) return json({ error: "Plan not found" }, 404, headers);

  const { data, error } = await svc
    .from("affiliate_commission_rules")
    .upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: "plan_id" })
    .select("plan_id, rate_bps, months")
    .single();
  if (error) throw error;

  await insertAuditLog(svc, {
    action: "admin-update-affiliate-commission-rule",
    actor_user_id: adminUserId,
    resource_type: "affiliate_commission_rule",
    resource_id: r.plan_id,
    metadata: { rate_bps: r.rate_bps, months: r.months },
  });
  return json({ rule: data }, 200, headers);
}
