import { escapeHtml } from "./report-template/escape.ts";
import { fetchStripeAmount } from "./stripe-amount.ts";
import { whatsAppSupportUrl } from "./whatsapp.ts";

export const WELCOME_SUBJECT = "Bem-vindo ao Mesaas 👋";
export const THANKYOU_SUBJECT = "Obrigado pela confiança 💚";

/** First whitespace-separated word of profiles.nome; null when absent/blank. */
export function firstNameFrom(nome: string | null | undefined): string | null {
  const first = (nome ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Olá, Ana!" or "Olá!" — name already escaped by callers below. */
function greeting(firstNameEscaped: string | null): string {
  return firstNameEscaped ? `Olá, ${firstNameEscaped}!` : "Olá!";
}

/**
 * Shared visual shell so both emails render as one family. Matches the
 * invite/dunning palette: green #1a3d2b on cream #f5f3ee, white 16px card.
 * `bodyHtml` is trusted template HTML built by this module only;
 * `baseEscaped` is the already-escaped app base URL. The header logo is the
 * one external image (email clients don't render SVG, so it's a hosted PNG);
 * its alt text is styled white/bold so blocked-image clients still show the
 * brand on the green header.
 */
function layout(bodyHtml: string, footerLine: string, baseEscaped: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#1a3d2b;padding:26px 28px;text-align:center">
        <img src="${baseEscaped}/logo-white-email.png" width="221" height="28" alt="Mesaas" style="display:block;margin:0 auto;border:0;color:#ffffff;font-size:22px;font-weight:700">
      </td></tr>
      <tr><td style="padding:32px 28px;font-size:14px;line-height:1.7;color:#444441">
${bodyHtml}
      </td></tr>
      <tr><td style="padding:18px 28px;background:#f5f3ee;text-align:center;font-size:11px;color:#888780;line-height:1.5">
        ${footerLine}<br>Mesaas · gestão inteligente para social media managers
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** One feature card cell (used in a 2x2 table). Args are pre-escaped. */
function featureCard(emoji: string, title: string, text: string): string {
  return `<td width="50%" style="padding:6px" valign="top">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;border-radius:12px">
      <tr><td style="padding:14px 16px">
        <div style="font-size:20px;line-height:1">${emoji}</div>
        <div style="font-size:13px;font-weight:700;color:#1a3d2b;margin-top:6px">${title}</div>
        <div style="font-size:12px;color:#444441;margin-top:2px;line-height:1.5">${text}</div>
      </td></tr>
    </table>
  </td>`;
}

/** Numbered step row for the "Comece em 3 passos" block. Args pre-escaped except ctaHtml. */
function stepRow(n: number, html: string): string {
  return `<tr><td style="padding:8px 0" valign="top" width="34">
      <div style="width:24px;height:24px;border-radius:12px;background:#1a3d2b;color:#ffffff;font-size:13px;font-weight:700;text-align:center;line-height:24px">${n}</div>
    </td><td style="padding:8px 0;font-size:13px;line-height:1.6;color:#444441">${html}</td></tr>`;
}

function ctaButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#1a3d2b;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;font-size:13px">${label}</a>`;
}

export function buildWelcomeEmail(p: { firstName: string | null; appBaseUrl: string }): string {
  const name = p.firstName ? escapeHtml(p.firstName) : null;
  const base = escapeHtml(p.appBaseUrl);
  // Empty string when unconfigured, so the paragraph simply does not exist
  // rather than rendering an empty button.
  const waUrl = whatsAppSupportUrl({ firstName: p.firstName });
  const waBlock = waUrl
    ? `<p style="margin:0 0 18px">${ctaButton(escapeHtml(waUrl), "Falar no WhatsApp")}</p>`
    : "";
  const body = `
<p style="font-size:16px;font-weight:700;color:#1a3d2b;margin:0 0 12px">${greeting(name)}</p>
<p style="margin:0 0 8px">Aqui é o Eduardo, do Mesaas. Que bom ter você por aqui. Obrigado por criar sua conta.</p>
<p style="margin:0 0 20px">O Mesaas é uma <strong>plataforma de gestão para agências de social media</strong>: clientes, entregas, aprovações e analytics em um lugar só, com um portal whitelabel para o seu cliente final.</p>

<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
  <tr>
    ${featureCard("👥", "Clientes &amp; CRM", "Todos os seus clientes, briefings e contratos organizados.")}
    ${featureCard("📋", "Entregas", "kanban de workflows + calendário editorial.")}
  </tr>
  <tr>
    ${featureCard("✅", "Aprovações pelo Hub do cliente", "Portal whitelabel, sem login, com a sua marca.")}
    ${featureCard("📈", "Analytics de Instagram", "Métricas e relatórios prontos para enviar.")}
  </tr>
</table>

<p style="font-size:15px;font-weight:700;color:#1a3d2b;margin:0 0 4px">Comece em 3 passos</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
  ${stepRow(1, "Cadastre seu primeiro cliente.")}
  ${
    stepRow(
      2,
      `<strong>Importe seus dados</strong>: trazemos tudo do Notion, Trello, ClickUp ou CSV em poucos cliques.<br>
       <span style="display:inline-block;margin-top:10px">${ctaButton(`${base}/importar`, "Importar meus dados")}</span>`,
    )
  }
  ${stepRow(3, "Convide sua equipe e compartilhe o Hub com o cliente.")}
</table>

<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
  <tr><td style="padding:14px 16px;background:#f5f3ee;border-radius:12px;font-size:12px;line-height:1.6">
    📚 Dúvidas? A <a href="${base}/ajuda" style="color:#1a3d2b;font-weight:700">Central de Ajuda</a> tem guias passo a passo,
    e as <a href="${base}/novidades" style="color:#1a3d2b;font-weight:700">Novidades</a> mostram o que estamos lançando.
  </td></tr>
</table>

<p style="margin:0 0 12px">Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente, e se preferir WhatsApp, é só clicar aqui.</p>
${waBlock}
<p style="margin:0">Um abraço,<br><strong>Eduardo</strong> · Mesaas</p>`;
  return layout(body, "Você recebeu este e-mail porque criou uma conta no Mesaas.", base);
}

export function buildThankYouEmail(
  p: { firstName: string | null; workspaceName: string; appBaseUrl: string },
): string {
  const name = p.firstName ? escapeHtml(p.firstName) : null;
  const ws = escapeHtml(p.workspaceName);
  const base = escapeHtml(p.appBaseUrl);
  const body = `
<p style="font-size:16px;font-weight:700;color:#1a3d2b;margin:0 0 12px">${greeting(name)}</p>
<p style="margin:0 0 8px">Aqui é o Eduardo, do Mesaas. Vi que o <strong>${ws}</strong> acabou de ativar um plano e queria agradecer pessoalmente.</p>
<p style="margin:0 0 20px">Obrigado por depositar essa confiança no Mesaas. Vamos trabalhar todos os dias para merecer essa escolha e cuidar bem da operação da sua agência.</p>

<p style="font-size:15px;font-weight:700;color:#1a3d2b;margin:0 0 4px">Para aproveitar ao máximo</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
  ${stepRow(1, "Conecte o Instagram dos seus clientes e acompanhe as métricas.")}
  ${
    stepRow(
      2,
      `Traga seus dados de outras ferramentas: <a href="${base}/importar" style="color:#1a3d2b;font-weight:700">importe do Notion, Trello, ClickUp ou CSV</a>.`,
    )
  }
  ${stepRow(3, "Ative o Hub para os seus clientes aprovarem posts sem precisar de login.")}
</table>

<p style="margin:0 0 20px;font-size:12px;color:#888780">Seu plano fica em <a href="${base}/configuracao" style="color:#1a3d2b;font-weight:700">Configurações</a>, e você pode ajustá-lo quando quiser.</p>

<p style="margin:0 0 4px">Me conta: o que faria o Mesaas ser ainda melhor para a sua agência? É só <strong>responder este e-mail</strong>.</p>
<p style="margin:0">Um abraço,<br><strong>Eduardo</strong> · Mesaas</p>`;
  return layout(body, `Você recebeu este e-mail porque o workspace ${ws} ativou um plano no Mesaas.`, base);
}

export const LIFECYCLE_FROM = "Eduardo do Mesaas <eduardo@mesaas.com.br>";

/** Internal founder notices ship from the alerts sender, not the founder one. */
export const FOUNDER_NOTICE_FROM = "Mesaas Alerts <alertas@mesaas.com.br>";

/**
 * Subjects interpolate user-controlled values (workspace/plan names, emails).
 * escapeHtml protects only the body; a control character in a subject can make
 * Resend reject the send, stranding the claim and re-retrying the already-sent
 * user-facing email. Strip controls, collapse whitespace, bound the length.
 */
function sanitizeSubjectValue(value: string): string {
  // deno-lint-ignore no-control-regex
  const cleaned = value.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 79)}…` : cleaned;
}

/** Two-column detail row for the internal notices. Args pre-escaped. */
function noticeRow(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;font-weight:700;white-space:nowrap;color:#1a3d2b">${label}</td><td style="padding:4px 0">${value}</td></tr>`;
}

// Backgrounds are pinned (cream page, white card) like the user-facing family:
// without them the body inherits the client theme, and dark-mode clients render
// the dark-green text on near-black.
function noticeLayout(title: string, rowsHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;padding:24px 16px;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b;font-size:14px;line-height:1.6">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:20px 24px">
    <p style="margin:0 0 10px;font-size:16px;font-weight:700;color:#1a3d2b">${title}</p>
    <table cellpadding="0" cellspacing="0" style="color:#444441">${rowsHtml}</table>
  </div>
</body></html>`;
}

export function buildFounderSignupNotice(
  p: { userEmail: string; nome: string | null },
): { subject: string; html: string } {
  const email = escapeHtml(p.userEmail);
  const nome = escapeHtml(p.nome?.trim() || "(sem nome)");
  return {
    subject: `[Mesaas] Novo cadastro: ${sanitizeSubjectValue(p.userEmail)}`,
    html: noticeLayout(
      "🆕 Novo cadastro no Mesaas",
      noticeRow("Nome", nome) + noticeRow("E-mail", email),
    ),
  };
}

/** trialing/active get friendly labels; anything else passes through raw. */
function subscriptionStatusLabel(status: string | null | undefined): string {
  if (status === "trialing") return "Trial";
  if (status === "active") return "Ativa";
  return status?.trim() || "(desconhecido)";
}

/** month/year get friendly labels; anything else passes through raw. */
function billingIntervalLabel(interval: string): string {
  if (interval === "month") return "Mensal";
  if (interval === "year") return "Anual";
  return interval;
}

/** What the workspace actually pays, net of coupons (priced live from Stripe). */
export interface SubscriptionAmount {
  netCents: number;
  grossCents: number | null;
  currency: string;
  interval: string | null;
  discountLabel: string | null;
}

/** "R$ 1.490,00" for brl; "14,90 USD" otherwise. Hand-rolled so output is deterministic. */
function formatMoney(cents: number, currency: string): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const intPart = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const num = `${sign}${intPart},${String(abs % 100).padStart(2, "0")}`;
  return currency.toLowerCase() === "brl" ? `R$ ${num}` : `${num} ${currency.toUpperCase()}`;
}

/**
 * "R$ 119,20/mês (após o trial) · cupom LANC20 −20%, de R$ 149,00".
 * During a trial Stripe already reports the post-trial price, hence the suffix.
 */
export function subscriptionValueLine(
  amount: SubscriptionAmount | null,
  subStatus: string | null | undefined,
): string {
  if (!amount) return "(indisponível)";
  const suffix = amount.interval === "month"
    ? "/mês"
    : amount.interval === "year"
    ? "/ano"
    : amount.interval
    ? `/${amount.interval}`
    : "";
  let line = `${formatMoney(amount.netCents, amount.currency)}${suffix}`;
  if (subStatus === "trialing") line += " (após o trial)";
  if (amount.discountLabel) {
    line += ` · cupom ${amount.discountLabel}`;
    if (amount.grossCents != null) line += `, de ${formatMoney(amount.grossCents, amount.currency)}`;
  }
  return line;
}

export function buildFounderSubscriptionNotice(p: {
  workspaceName: string;
  ownerEmail: string;
  ownerNome: string | null;
  planName: string | null;
  subStatus: string | null;
  billingInterval: string | null;
  amount: SubscriptionAmount | null;
}): { subject: string; html: string } {
  const plan = p.planName?.trim() || "(plano desconhecido)";
  const interval = p.billingInterval?.trim();
  const rows = noticeRow("Workspace", escapeHtml(p.workspaceName)) +
    noticeRow("Plano", escapeHtml(plan)) +
    noticeRow("Valor", escapeHtml(subscriptionValueLine(p.amount, p.subStatus))) +
    noticeRow("Status", escapeHtml(subscriptionStatusLabel(p.subStatus))) +
    (interval ? noticeRow("Cobrança", escapeHtml(billingIntervalLabel(interval))) : "") +
    noticeRow("Dono", escapeHtml(p.ownerNome?.trim() || "(sem nome)")) +
    noticeRow("E-mail", escapeHtml(p.ownerEmail));
  const subject = `[Mesaas] Nova assinatura: ${sanitizeSubjectValue(p.workspaceName)} (${
    sanitizeSubjectValue(plan)
  })`;
  return { subject, html: noticeLayout("💰 Nova assinatura no Mesaas", rows) };
}

/**
 * Throwing Resend POST. The Idempotency-Key makes retries after ambiguous
 * failures (lost response, crash after acceptance) safe: Resend dedupes the
 * same key for 24h. Callers pass a key deterministic per subject
 * (welcome/<user_id>, subscription_thanks/<workspace_id>).
 *
 * Bounded by AbortSignal: the edge runtime kills isolates on unbounded I/O in
 * ways that bypass catch entirely (repo-documented failure mode) — a timeout
 * must surface as a normal retryable throw instead.
 */
async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  idempotencyKey: string,
  from: string = LIFECYCLE_FROM,
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(10_000),
  });
  // 409 invalid_idempotent_request: this key was already accepted with a
  // different payload (name/email drifted between attempts). The original
  // send happened — success, so the caller marks the claim delivered.
  if (res.status === 409) return;
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}

export async function sendWelcomeEmail(
  p: { to: string; firstName: string | null; appBaseUrl: string; idempotencyKey: string },
): Promise<void> {
  await sendViaResend(
    p.to,
    WELCOME_SUBJECT,
    buildWelcomeEmail({ firstName: p.firstName, appBaseUrl: p.appBaseUrl }),
    p.idempotencyKey,
  );
}

export async function sendThankYouEmail(
  p: {
    to: string;
    firstName: string | null;
    workspaceName: string;
    appBaseUrl: string;
    idempotencyKey: string;
  },
): Promise<void> {
  await sendViaResend(
    p.to,
    THANKYOU_SUBJECT,
    buildThankYouEmail({
      firstName: p.firstName,
      workspaceName: p.workspaceName,
      appBaseUrl: p.appBaseUrl,
    }),
    p.idempotencyKey,
  );
}

/**
 * Internal founder notices. ALERT_EMAIL unset (e.g. staging) is a silent
 * no-op so a missing internal recipient can never block or fail the
 * user-facing email path. When configured, Resend errors THROW: the caller's
 * claim stays undelivered and the stale retry re-sends with the same key.
 */
export async function sendFounderSignupNotice(
  p: { userEmail: string; nome: string | null; idempotencyKey: string },
): Promise<void> {
  const to = Deno.env.get("ALERT_EMAIL");
  if (!to) return;
  const { subject, html } = buildFounderSignupNotice(p);
  await sendViaResend(to, subject, html, p.idempotencyKey, FOUNDER_NOTICE_FROM);
}

/**
 * Best-effort live pricing (net of coupons) for the notice. Returns null on any
 * failure — missing STRIPE_SECRET_KEY (the ./stripe.ts import throws), Stripe
 * down, unknown subscription — so the value renders "(indisponível)" instead of
 * stranding the claim and re-retrying the already-sent user-facing email.
 */
async function fetchSubscriptionAmount(
  stripeSubscriptionId: string | null,
  fallbackInterval: string | null,
): Promise<SubscriptionAmount | null> {
  if (!stripeSubscriptionId) return null;
  try {
    const { stripe } = await import("./stripe.ts");
    const amt = await fetchStripeAmount(stripe, stripeSubscriptionId, fallbackInterval);
    return {
      netCents: amt.amount_cents,
      grossCents: amt.gross_cents,
      currency: amt.currency,
      interval: amt.interval,
      discountLabel: amt.discount_label,
    };
  } catch (e) {
    console.error(
      "[lifecycle-emails] stripe amount fetch failed:",
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

export async function sendFounderSubscriptionNotice(p: {
  workspaceName: string;
  ownerEmail: string;
  ownerNome: string | null;
  planName: string | null;
  subStatus: string | null;
  billingInterval: string | null;
  stripeSubscriptionId: string | null;
  idempotencyKey: string;
}): Promise<void> {
  const to = Deno.env.get("ALERT_EMAIL");
  if (!to) return;
  const amount = await fetchSubscriptionAmount(p.stripeSubscriptionId, p.billingInterval);
  const { subject, html } = buildFounderSubscriptionNotice({ ...p, amount });
  await sendViaResend(to, subject, html, p.idempotencyKey, FOUNDER_NOTICE_FROM);
}
