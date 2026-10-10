// Programa de afiliados no Admin: listar, detalhar, suspender/reativar, mudar percentual e
// registrar repasse PIX. Spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAYOUT_CENTS = 100_000_000; // R$ 1.000.000,00, só um teto contra digitação errada

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

export type AffiliateUpdate = { status?: "active" | "suspended"; commission_rate_bps?: number };

export function validateAffiliateUpdate(
  body: Record<string, unknown>,
): { ok: true; id: string; patch: AffiliateUpdate } | { ok: false; error: string } {
  const id = body.affiliate_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "affiliate_id is required" };
  const patch: AffiliateUpdate = {};
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "suspended") return { ok: false, error: "Invalid status" };
    patch.status = body.status;
  }
  if (body.commission_rate_bps !== undefined) {
    const rate = body.commission_rate_bps;
    if (typeof rate !== "number" || !Number.isInteger(rate) || rate < 0 || rate > 10_000) {
      return { ok: false, error: "Percentual inválido (0 a 100%)." };
    }
    patch.commission_rate_bps = rate;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to update" };
  return { ok: true, id, patch };
}

export type PayoutInput = {
  affiliate_id: string;
  amount_cents: number;
  reference: string | null;
  note: string | null;
  paid_at: string;
};

export function validatePayout(
  body: Record<string, unknown>,
  now: Date,
): { ok: true; value: PayoutInput } | { ok: false; error: string } {
  const id = body.affiliate_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "affiliate_id is required" };
  const amount = body.amount_cents;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > MAX_PAYOUT_CENTS) {
    return { ok: false, error: "Valor inválido." };
  }
  const text = (v: unknown, max: number): string | null | undefined => {
    if (v == null || v === "") return null;
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    if (t.length > max) return undefined;
    return t || null;
  };
  const reference = text(body.reference, 200);
  if (reference === undefined) return { ok: false, error: "Referência inválida." };
  const note = text(body.note, 500);
  if (note === undefined) return { ok: false, error: "Observação inválida." };

  let paidAt = now;
  if (body.paid_at != null && body.paid_at !== "") {
    if (typeof body.paid_at !== "string" || Number.isNaN(Date.parse(body.paid_at))) {
      return { ok: false, error: "Data inválida." };
    }
    paidAt = new Date(body.paid_at);
    if (paidAt.getTime() > now.getTime() + 60_000) return { ok: false, error: "A data não pode ser futura." };
  }
  return { ok: true, value: { affiliate_id: id, amount_cents: amount, reference, note, paid_at: paidAt.toISOString() } };
}

const AFFILIATE_LIST_COLS = "id, code, nome, email, status, commission_rate_bps, pix_key_type, created_at";

export async function handleListAffiliates(svc: SupabaseClient, headers: Headers): Promise<Response> {
  const [{ data: affiliates, error }, { data: summaries, error: sumErr }] = await Promise.all([
    svc.from("affiliates").select(AFFILIATE_LIST_COLS).order("created_at", { ascending: false }).limit(1000),
    svc.rpc("affiliate_summaries", { p_affiliate_id: null }),
  ]);
  if (error) throw error;
  if (sumErr) throw sumErr;
  const byId = new Map<string, Record<string, unknown>>();
  for (const s of (summaries ?? []) as Array<Record<string, unknown>>) byId.set(String(s.affiliate_id), s);
  const rows = ((affiliates ?? []) as Array<Record<string, unknown>>).map((a) => ({
    ...a,
    has_pix: a.pix_key_type != null,
    summary: shapeAffiliateSummary(byId.get(String(a.id))),
  }));
  return json({ affiliates: rows }, 200, headers);
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
      "id, code, nome, email, telefone, status, commission_rate_bps, pix_key_type, pix_key, documento, titular_nome, terms_accepted_at, created_at, updated_at",
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
        "id, workspace_id, stripe_invoice_id, invoice_amount_cents, rate_bps, commission_cents, refunded_amount_cents, disputed, net_cents, paid_at, available_at",
      )
      .eq("affiliate_id", id).order("paid_at", { ascending: false }).limit(500),
    svc.from("affiliate_payouts").select("id, amount_cents, method, reference, note, paid_at, created_by")
      .eq("affiliate_id", id).order("paid_at", { ascending: false }).limit(500),
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

export async function handleCreateAffiliatePayout(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  adminUserId: string,
  headers: Headers,
  now: Date = new Date(),
): Promise<Response> {
  const input = validatePayout(body, now);
  if (!input.ok) return json({ error: input.error }, 400, headers);
  const p = input.value;

  const { data: summary, error: sumErr } = await svc
    .rpc("affiliate_summaries", { p_affiliate_id: p.affiliate_id })
    .maybeSingle();
  if (sumErr) throw sumErr;
  if (!summary) return json({ error: "Affiliate not found" }, 404, headers);
  const available = shapeAffiliateSummary(summary as Record<string, unknown>).available_cents;
  if (p.amount_cents > available) {
    return json({ error: "Valor maior que o saldo disponível do afiliado." }, 400, headers);
  }

  const { data, error } = await svc
    .from("affiliate_payouts")
    .insert({
      affiliate_id: p.affiliate_id,
      amount_cents: p.amount_cents,
      method: "pix",
      reference: p.reference,
      note: p.note,
      paid_at: p.paid_at,
      created_by: adminUserId,
    })
    .select("id, amount_cents, method, reference, note, paid_at, created_by")
    .single();
  if (error) throw error;

  await insertAuditLog(svc, {
    action: "admin-create-affiliate-payout",
    actor_user_id: adminUserId,
    resource_type: "affiliate",
    resource_id: p.affiliate_id,
    metadata: { payout_id: (data as { id?: string } | null)?.id ?? null, amount_cents: p.amount_cents },
  });
  return json({ payout: data }, 201, headers);
}
