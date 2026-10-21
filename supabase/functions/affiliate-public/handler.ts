/**
 * affiliate-public: API pública do programa de afiliados (sem sessão Supabase, deploy com
 * --no-verify-jwt). Qualquer pessoa se cadastra; o acesso ao painel é por link mágico: o
 * e-mail leva um token de login (15 min, uso único) que o front troca por um token de sessão
 * (30 dias) guardado no navegador. Tokens são 32 bytes base64url; só o hash SHA-256 fica no
 * banco (affiliate_access_tokens, kind 'login' | 'session').
 *
 * Ações (POST { action, ... }):
 *   signup            { nome, email, telefone?, aceite_termos } → cria (ou reaproveita) e manda o link
 *   send_link         { email }       → manda um link novo, se o e-mail existir
 *   exchange          { login_token } → gasta o link (uma vez) e devolve { session_token }
 *   logout            { token }       → apaga a sessão
 *   dashboard         { token }       → painel do afiliado (relê no Stripe a conta ainda não apta)
 *   connect_start     { token }       → cria a conta Express (uma vez) e devolve o link de onboarding
 *   connect_dashboard { token }       → link de login no painel Express (repasses, dados bancários)
 *
 * Nas ações do painel, `token` é o token de SESSÃO; um token de login nunca abre o painel.
 *
 * O repasse em si é do affiliate-payout-cron (transfer mensal por Stripe Connect).
 *
 * signup e send_link respondem igual exista ou não o e-mail, para não revelar quem é afiliado.
 *
 * Spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createJsonResponder, type JsonResponder } from "../_shared/http.ts";
import {
  ACCESS_TOKEN_RE,
  base64Url,
  buildAffiliateCode,
  commissionSituacao,
  normalizeEmail,
  referralSituacao,
  loginExpiry,
  sessionExpiry,
  sha256Hex,
  shapeSummary,
  validateSignup,
} from "./logic.ts";
import {
  type AffiliateConnectGateway,
  ConnectError,
  refreshAffiliateStripeStatus,
} from "../_shared/affiliate-connect.ts";

export interface AffiliatePublicDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  db: SupabaseClient;
  rateLimit: (key: string, max: number, windowSeconds: number) => Promise<boolean>;
  getClientIP: (req: Request) => string;
  sendLinkEmail: (params: { to: string; nome: string; link: string }) => Promise<void>;
  appBaseUrl: () => string;
  now: () => Date;
  randomBytes: (n: number) => Uint8Array;
  /** null = Stripe não configurado neste ambiente: as ações de Connect respondem 503. */
  connect: AffiliateConnectGateway | null;
  /** Repasse mínimo (centavos), só para exibir no painel. */
  minPayoutCents: number;
}

const MSG_RATE = "Muitas tentativas. Tente de novo em alguns minutos.";
const MSG_INVALID_LINK = "Link inválido ou expirado. Peça um novo link de acesso.";
const MSG_EMAIL_FAILED = "Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos.";
const MSG_STRIPE_UNAVAILABLE = "Não foi possível falar com o Stripe agora. Tente de novo em alguns minutos.";
const DB_TIMEOUT_MS = 10_000;
const CODE_ATTEMPTS = 5;

interface AffiliateRow {
  id: string;
  nome: string;
  email: string;
  code: string;
  status: string;
  stripe_account_id: string | null;
  stripe_details_submitted: boolean;
  stripe_transfers_active: boolean;
}

const AFFILIATE_COLUMNS =
  "id, nome, email, code, status, stripe_account_id, stripe_details_submitted, stripe_transfers_active";

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

export function createAffiliatePublicHandler(deps: AffiliatePublicDeps) {
  const { db } = deps;

  function appBase(): string {
    return deps.appBaseUrl().replace(/\/+$/, "");
  }

  async function findByEmail(email: string): Promise<AffiliateRow | null> {
    const { data, error } = await db
      .from("affiliates")
      .select(AFFILIATE_COLUMNS)
      .eq("email", email)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (error) throw new Error(`affiliate read failed: ${(error as { message?: string }).message}`);
    return (data as AffiliateRow | null) ?? null;
  }

  async function createAffiliate(
    input: { nome: string; email: string; telefone: string | null },
  ): Promise<AffiliateRow> {
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = buildAffiliateCode(input.nome, deps.randomBytes(4));
      const { data, error } = await db
        .from("affiliates")
        .insert({
          code,
          nome: input.nome,
          email: input.email,
          telefone: input.telefone,
          terms_accepted_at: deps.now().toISOString(),
        })
        .select(AFFILIATE_COLUMNS)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
        .single();
      if (!error && data) return data as AffiliateRow;
      if (!isUniqueViolation(error)) {
        throw new Error(`affiliate insert failed: ${(error as { message?: string })?.message}`);
      }
      // Corrida no e-mail: outra requisição criou o mesmo afiliado. Reaproveita.
      const existing = await findByEmail(input.email);
      if (existing) return existing;
      // Senão foi o código que colidiu: tenta outro sufixo.
    }
    throw new Error("affiliate insert failed: could not allocate a unique code");
  }

  async function issueLink(affiliate: AffiliateRow): Promise<string> {
    const token = base64Url(deps.randomBytes(32));
    const { error } = await db
      .from("affiliate_access_tokens")
      .insert({
        token_hash: await sha256Hex(token),
        affiliate_id: affiliate.id,
        expires_at: loginExpiry(deps.now()).toISOString(),
        kind: "login",
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw new Error(`token insert failed: ${(error as { message?: string }).message}`);
    // No fragmento: o navegador não manda o "#..." ao servidor nem no Referer.
    return `${appBase()}/afiliados/entrar#${token}`;
  }

  async function resolveToken(token: unknown): Promise<AffiliateRow | null> {
    if (typeof token !== "string" || !ACCESS_TOKEN_RE.test(token)) return null;
    const { data: tok, error: tokErr } = await db
      .from("affiliate_access_tokens")
      .select("affiliate_id")
      .eq("token_hash", await sha256Hex(token))
      .eq("kind", "session")
      .gt("expires_at", deps.now().toISOString())
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (tokErr) throw new Error(`token read failed: ${(tokErr as { message?: string }).message}`);
    if (!tok?.affiliate_id) return null;
    const { data, error } = await db
      .from("affiliates")
      .select(AFFILIATE_COLUMNS)
      .eq("id", tok.affiliate_id)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (error) throw new Error(`affiliate read failed: ${(error as { message?: string }).message}`);
    return (data as AffiliateRow | null) ?? null;
  }

  async function signup(req: Request, body: Record<string, unknown>, json: JsonResponder) {
    const input = validateSignup(body);
    if (!input.ok) return json({ error: input.error }, 400);
    const { email } = input.value;
    const ip = deps.getClientIP(req);
    if (!(await deps.rateLimit(`affiliate-signup:ip:${ip}`, 5, 3600))) return json({ error: MSG_RATE }, 429);
    if (!(await deps.rateLimit(`affiliate-link:email:${email}`, 3, 3600))) return json({ error: MSG_RATE }, 429);

    const affiliate = (await findByEmail(email)) ?? (await createAffiliate(input.value));
    const link = await issueLink(affiliate);
    try {
      await deps.sendLinkEmail({ to: affiliate.email, nome: affiliate.nome, link });
    } catch (err) {
      console.error("[affiliate-public] signup email failed:", err instanceof Error ? err.message : String(err));
      return json({ error: MSG_EMAIL_FAILED }, 502);
    }
    return json({ ok: true });
  }

  async function sendLink(req: Request, body: Record<string, unknown>, json: JsonResponder) {
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: "Informe um e-mail válido." }, 400);
    const ip = deps.getClientIP(req);
    if (!(await deps.rateLimit(`affiliate-send-link:ip:${ip}`, 5, 3600))) return json({ error: MSG_RATE }, 429);
    if (!(await deps.rateLimit(`affiliate-link:email:${email}`, 3, 3600))) return json({ error: MSG_RATE }, 429);

    const affiliate = await findByEmail(email);
    if (affiliate) {
      const link = await issueLink(affiliate);
      try {
        await deps.sendLinkEmail({ to: affiliate.email, nome: affiliate.nome, link });
      } catch (err) {
        // Mesma resposta de um e-mail inexistente: não revela quem é afiliado.
        console.error("[affiliate-public] send_link email failed:", err instanceof Error ? err.message : String(err));
      }
    }
    return json({ ok: true });
  }

  async function dashboard(req: Request, body: Record<string, unknown>, json: JsonResponder) {
    if (!(await deps.rateLimit(`affiliate-dashboard:ip:${deps.getClientIP(req)}`, 60, 60))) {
      return json({ error: MSG_RATE }, 429);
    }
    const affiliate = await resolveToken(body.token);
    if (!affiliate) return json({ error: MSG_INVALID_LINK }, 404);

    // Conta criada mas ainda não apta (onboarding em andamento ou em análise): relê no Stripe,
    // que é a única fonte do status. Sem webhook de Connect, é aqui e no cron que o flag anda.
    let stripeStatus = {
      detailsSubmitted: affiliate.stripe_details_submitted,
      transfersActive: affiliate.stripe_transfers_active,
    };
    if (affiliate.stripe_account_id && !affiliate.stripe_transfers_active && deps.connect) {
      try {
        stripeStatus = await refreshAffiliateStripeStatus(
          db,
          deps.connect,
          { id: affiliate.id, stripe_account_id: affiliate.stripe_account_id },
          deps.now(),
        );
      } catch (err) {
        console.error("[affiliate-public] stripe status refresh failed:", err instanceof Error ? err.message : String(err));
      }
    }

    const [summaryRes, referralsRes, commissionsRes, payoutsRes] = await Promise.all([
      db.rpc("affiliate_summaries", { p_affiliate_id: affiliate.id }).maybeSingle(),
      db.from("affiliate_referrals")
        .select("workspace_id, created_at")
        .eq("affiliate_id", affiliate.id)
        .order("created_at", { ascending: true })
        .limit(500),
      db.from("affiliate_commissions")
        .select("paid_at, invoice_amount_cents, plan_id, rate_bps, commission_cents, net_cents, disputed, available_at")
        .eq("affiliate_id", affiliate.id)
        .order("paid_at", { ascending: false })
        .limit(200),
      db.from("affiliate_payouts")
        .select("created_at, paid_at, amount_cents, status")
        .eq("affiliate_id", affiliate.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    for (const r of [summaryRes, referralsRes, commissionsRes, payoutsRes]) {
      if (r.error) throw new Error(`dashboard read failed: ${(r.error as { message?: string }).message}`);
    }

    const referrals = (referralsRes.data ?? []) as Array<{ workspace_id: string; created_at: string }>;
    const subsByWorkspace = new Map<string, { provider: string | null; status: string | null }>();
    if (referrals.length > 0) {
      const { data: subs, error: subsErr } = await db
        .from("workspace_subscriptions")
        .select("workspace_id, provider, status")
        .in("workspace_id", referrals.map((r) => r.workspace_id));
      if (subsErr) throw new Error(`dashboard subs read failed: ${(subsErr as { message?: string }).message}`);
      for (const s of (subs ?? []) as Array<{ workspace_id: string; provider: string | null; status: string | null }>) {
        subsByWorkspace.set(s.workspace_id, s);
      }
    }

    const now = deps.now();
    // Indicações sem nome nem e-mail do indicado (LGPD): só ordem, data e situação.
    return json({
      affiliate: {
        nome: affiliate.nome,
        email: affiliate.email,
        code: affiliate.code,
        status: affiliate.status,
        stripe: {
          connected: !!affiliate.stripe_account_id,
          details_submitted: stripeStatus.detailsSubmitted,
          transfers_active: stripeStatus.transfersActive,
        },
      },
      min_payout_cents: deps.minPayoutCents,
      summary: shapeSummary(summaryRes.data as Record<string, unknown> | null),
      referrals: referrals.map((r, i) => ({
        numero: i + 1,
        created_at: r.created_at,
        situacao: referralSituacao(subsByWorkspace.get(r.workspace_id)),
      })),
      commissions: ((commissionsRes.data ?? []) as Array<{
        paid_at: string;
        invoice_amount_cents: number;
        plan_id: string | null;
        rate_bps: number;
        commission_cents: number;
        net_cents: number;
        disputed: boolean;
        available_at: string;
      }>).map((c) => ({
        paid_at: c.paid_at,
        invoice_amount_cents: c.invoice_amount_cents,
        plan_id: c.plan_id,
        rate_bps: c.rate_bps,
        commission_cents: c.commission_cents,
        net_cents: c.net_cents,
        available_at: c.available_at,
        situacao: commissionSituacao(c, now),
      })),
      payouts: payoutsRes.data ?? [],
    });
  }

  async function exchange(req: Request, body: Record<string, unknown>, json: JsonResponder) {
    if (!(await deps.rateLimit(`affiliate-exchange:ip:${deps.getClientIP(req)}`, 20, 3600))) {
      return json({ error: MSG_RATE }, 429);
    }
    const loginToken = body.login_token;
    if (typeof loginToken !== "string" || !ACCESS_TOKEN_RE.test(loginToken)) {
      return json({ error: MSG_INVALID_LINK }, 404);
    }
    const sessionToken = base64Url(deps.randomBytes(32));
    const { data, error } = await db
      .rpc("affiliate_exchange_login", {
        p_login_hash: await sha256Hex(loginToken),
        p_session_hash: await sha256Hex(sessionToken),
        p_session_expires_at: sessionExpiry(deps.now()).toISOString(),
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw new Error(`login exchange failed: ${(error as { message?: string }).message}`);
    // Inválido, vencido ou já usado: mesma resposta nos três casos.
    if (!data) return json({ error: MSG_INVALID_LINK }, 404);
    return json({ session_token: sessionToken });
  }

  async function logout(req: Request, body: Record<string, unknown>, json: JsonResponder) {
    if (!(await deps.rateLimit(`affiliate-dashboard:ip:${deps.getClientIP(req)}`, 60, 60))) {
      return json({ error: MSG_RATE }, 429);
    }
    if (typeof body.token === "string" && ACCESS_TOKEN_RE.test(body.token)) {
      const { error } = await db
        .from("affiliate_access_tokens")
        .delete()
        .eq("token_hash", await sha256Hex(body.token))
        .eq("kind", "session")
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (error) throw new Error(`logout failed: ${(error as { message?: string }).message}`);
    }
    return json({ ok: true });
  }

  async function connectStart(req: Request, body: Record<string, unknown>, json: JsonResponder) {
    if (!(await deps.rateLimit(`affiliate-dashboard:ip:${deps.getClientIP(req)}`, 60, 60))) {
      return json({ error: MSG_RATE }, 429);
    }
    const affiliate = await resolveToken(body.token);
    if (!affiliate) return json({ error: MSG_INVALID_LINK }, 404);
    if (affiliate.status !== "active") {
      return json({ error: "Sua participação no programa está suspensa." }, 403);
    }
    if (!deps.connect) return json({ error: MSG_STRIPE_UNAVAILABLE }, 503);
    if (!(await deps.rateLimit(`affiliate-connect:${affiliate.id}`, 10, 3600))) return json({ error: MSG_RATE }, 429);

    try {
      let accountId = affiliate.stripe_account_id;
      if (!accountId) {
        const created = await deps.connect.createExpressAccount({ email: affiliate.email, affiliateId: affiliate.id });
        // Compare-and-set: só grava se ainda não houver conta. A chave de idempotência do
        // Stripe faz cliques concorrentes devolverem a mesma conta; se outra requisição gravou
        // antes, vale a conta que já está no banco.
        const { data: saved, error } = await db
          .from("affiliates")
          .update({ stripe_account_id: created, updated_at: deps.now().toISOString() })
          .eq("id", affiliate.id)
          .is("stripe_account_id", null)
          .select("stripe_account_id")
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
        if (error) throw new Error(`stripe account write failed: ${(error as { message?: string }).message}`);
        if (saved && saved.length > 0) {
          accountId = created;
        } else {
          const fresh = await resolveToken(body.token);
          accountId = fresh?.stripe_account_id ?? created;
        }
      }
      // Sem token na URL: a sessão fica no navegador, e o Stripe guarda estas URLs.
      const base = `${appBase()}/afiliados/painel`;
      const url = await deps.connect.createOnboardingLink({
        accountId,
        refreshUrl: `${base}?stripe=refresh`,
        returnUrl: `${base}?stripe=retorno`,
      });
      return json({ url });
    } catch (err) {
      if (err instanceof ConnectError) {
        console.error("[affiliate-public] connect_start stripe error:", err.message, err.detail ?? "");
        return json({ error: MSG_STRIPE_UNAVAILABLE }, 502);
      }
      throw err;
    }
  }

  async function connectDashboard(req: Request, body: Record<string, unknown>, json: JsonResponder) {
    if (!(await deps.rateLimit(`affiliate-dashboard:ip:${deps.getClientIP(req)}`, 60, 60))) {
      return json({ error: MSG_RATE }, 429);
    }
    const affiliate = await resolveToken(body.token);
    if (!affiliate) return json({ error: MSG_INVALID_LINK }, 404);
    if (!deps.connect) return json({ error: MSG_STRIPE_UNAVAILABLE }, 503);
    if (!affiliate.stripe_account_id || !affiliate.stripe_details_submitted) {
      return json({ error: "Conclua o cadastro no Stripe primeiro." }, 400);
    }
    try {
      return json({ url: await deps.connect.createDashboardLink(affiliate.stripe_account_id) });
    } catch (err) {
      if (err instanceof ConnectError) {
        console.error("[affiliate-public] connect_dashboard stripe error:", err.message, err.detail ?? "");
        return json({ error: MSG_STRIPE_UNAVAILABLE }, 502);
      }
      throw err;
    }
  }

  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const json = createJsonResponder(cors);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Dados inválidos." }, 400);
    }

    try {
      switch (body.action) {
        case "signup":
          return await signup(req, body, json);
        case "send_link":
          return await sendLink(req, body, json);
        case "exchange":
          return await exchange(req, body, json);
        case "logout":
          return await logout(req, body, json);
        case "dashboard":
          return await dashboard(req, body, json);
        case "connect_start":
          return await connectStart(req, body, json);
        case "connect_dashboard":
          return await connectDashboard(req, body, json);
        default:
          return json({ error: "Invalid action" }, 400);
      }
    } catch (err) {
      console.error("[affiliate-public] error:", err instanceof Error ? err.message : String(err));
      return json({ error: "Internal server error" }, 500);
    }
  };
}
