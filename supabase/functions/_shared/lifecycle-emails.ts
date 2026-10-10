import { escapeHtml } from "./report-template/escape.ts";
import { fetchStripeAmount } from "./stripe-amount.ts";
import { whatsAppSupportUrl } from "./whatsapp.ts";
import { mesaasEmail } from "./email/shell.ts";
import { button, callout, featureGrid, heading, link, paragraph, paragraphHtml, sectionTitle, signature, spacer, steps } from "./email/blocks.ts";

export const WELCOME_SUBJECT = "Boas-vindas ao Mesaas 👋";
export const THANKYOU_SUBJECT = "Obrigado pela confiança 💚";

/** First whitespace-separated word of profiles.nome; null when absent/blank. */
export function firstNameFrom(nome: string | null | undefined): string | null {
  const first = (nome ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

export function buildWelcomeEmail(p: { firstName: string | null; appBaseUrl: string }): string {
  const base = p.appBaseUrl.replace(/\/+$/, "");
  const waUrl = whatsAppSupportUrl({ firstName: p.firstName });
  // Gated by the same waUrl as the button, so the sentence never mentions a missing button.
  const closingLine = waUrl
    ? `Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente, e se preferir WhatsApp, é só clicar no botão abaixo.`
    : `Qualquer dúvida, é só <strong>responder este e-mail</strong>. Eu leio e respondo pessoalmente.`;
  return mesaasEmail({
    preheader: "Três passos para deixar sua agência rodando.",
    eyebrow: "Boas-vindas",
    sections: [
      heading(p.firstName ? `Olá, ${p.firstName}! Que bom ter você aqui.` : "Olá! Que bom ter você aqui.") +
        paragraph("Aqui é o Eduardo, do Mesaas. Obrigado por criar sua conta.") +
        paragraphHtml(
          "O Mesaas é uma <strong>plataforma de gestão para agências de social media</strong>: clientes, entregas, aprovações e analytics em um lugar só, com um portal whitelabel para o seu cliente final.",
          "body",
          "0",
        ),
      sectionTitle("Comece em 3 passos") +
        steps([
          "Cadastre seu primeiro cliente.",
          `<strong>Importe seus dados</strong>: trazemos tudo do Notion, Trello, ClickUp ou CSV em poucos cliques.${spacer(14)}${button(`${base}/importar`, "Importar meus dados")}`,
          "Convide sua equipe e compartilhe o Hub com o cliente.",
        ]),
      featureGrid([
        { title: "Clientes & CRM", text: "Todos os seus clientes, briefings e contratos organizados." },
        { title: "Entregas", text: "kanban de workflows + calendário editorial." },
        { title: "Aprovações pelo Hub do cliente", text: "Portal whitelabel, sem login, com a sua marca." },
        { title: "Analytics de Instagram", text: "Métricas e relatórios prontos para enviar." },
      ]),
      callout(`Dúvidas? A ${link(`${base}/ajuda`, "Central de Ajuda")} tem guias passo a passo, e as ${link(`${base}/novidades`, "Novidades")} mostram o que estamos lançando.`),
      paragraphHtml(closingLine, "body", "0 0 18px") +
        (waUrl ? button(waUrl, "Falar no WhatsApp", "outline") + spacer(24) : "") +
        signature(),
    ],
    footerLines: ["Você recebeu este e-mail porque criou uma conta no Mesaas."],
  });
}

export function buildThankYouEmail(
  p: { firstName: string | null; workspaceName: string; appBaseUrl: string },
): string {
  const base = p.appBaseUrl.replace(/\/+$/, "");
  return mesaasEmail({
    preheader: "Obrigado pela confiança no Mesaas.",
    eyebrow: "Assinatura",
    sections: [
      heading(p.firstName ? `Olá, ${p.firstName}!` : "Olá!") +
        paragraphHtml(`Aqui é o Eduardo, do Mesaas. Vi que o <strong>${escapeHtml(p.workspaceName)}</strong> acabou de ativar um plano e queria agradecer pessoalmente.`) +
        paragraph("Obrigado por depositar essa confiança no Mesaas. Vamos trabalhar todos os dias para merecer essa escolha e cuidar bem da operação da sua agência.", "body", "0"),
      sectionTitle("Para aproveitar ao máximo") +
        steps([
          "Conecte o Instagram dos seus clientes e acompanhe as métricas.",
          `Traga seus dados de outras ferramentas: ${link(`${base}/importar`, "importe do Notion, Trello, ClickUp ou CSV")}.`,
          "Ative o Hub para os seus clientes aprovarem posts sem precisar de login.",
        ]),
      paragraphHtml(`Seu plano fica em ${link(`${base}/configuracao`, "Configurações")}, e você pode ajustá-lo quando quiser.`, "small", "0"),
      paragraphHtml("Me conta: o que faria o Mesaas ser ainda melhor para a sua agência? É só <strong>responder este e-mail</strong>.", "body", "0 0 24px") +
        signature(),
    ],
    footerLines: [`Você recebeu este e-mail porque o workspace ${p.workspaceName} ativou um plano no Mesaas.`],
  });
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
export function sanitizeSubjectValue(value: string): string {
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

/** Resend API attachment shape (`content` is base64). */
export interface ResendAttachment {
  filename: string;
  content: string;
  content_type: string;
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
export async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  idempotencyKey: string,
  from: string = LIFECYCLE_FROM,
  replyTo?: string,
  headers?: Record<string, string>,
  /** Resend attachment objects; `content` is base64. Omitted from the request
   *  body entirely when absent or empty, so existing callers send the same
   *  payload as before. */
  attachments?: ResendAttachment[],
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
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      ...(replyTo ? { reply_to: [replyTo] } : {}),
      ...(headers ? { headers } : {}),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    }),
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
