import { tagValue } from "./email-tag.ts";
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

/** Lead-in of the welcome email when the workspace qualifies for the reverse trial. */
export const WELCOME_REVERSE_TRIAL_LEAD = "Ao entrar, seu workspace fica no Pro por 14 dias, sem cartão.";

export function buildWelcomeEmail(
  p: {
    firstName: string | null;
    appBaseUrl: string;
    /** Workspace qualifies for the automatic 14-day Pro (keyed on the offer, not on plan_source). */
    reverseTrialOffer?: boolean;
  },
): string {
  const base = p.appBaseUrl.replace(/\/+$/, "");
  // The 30-day card trial block, or the reverse-trial one: the email can go out
  // before the first app visit starts the trial, so it promises what that visit
  // will do, and links straight into the app instead of /comecar.
  const trialLead = p.reverseTrialOffer
    ? `${WELCOME_REVERSE_TRIAL_LEAD} Nesse período você também tem:`
    : "No teste grátis de 30 dias dos planos pagos você também tem:";
  const trialButton = p.reverseTrialOffer
    ? button(`${base}/dashboard`, "Entrar no Mesaas", "outline")
    : button(`${base}/comecar`, "Começar meu teste grátis", "outline");
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
          "O Mesaas é uma <strong>plataforma de gestão para agências de social media</strong>: clientes, entregas e calendário editorial em um lugar só.",
          "body",
          "0",
        ),
      sectionTitle("Comece em 3 passos") +
        steps([
          "Cadastre seu primeiro cliente.",
          `<strong>Importe seus dados</strong>: trazemos tudo do Notion, Trello, ClickUp ou CSV em poucos cliques.${spacer(14)}${button(`${base}/importar`, "Importar meus dados")}`,
          "Crie sua primeira entrega e organize o calendário editorial.",
        ]),
      featureGrid([
        { title: "Clientes & CRM", text: "Todos os seus clientes, briefings e contratos organizados." },
        { title: "Entregas", text: "kanban de workflows + calendário editorial." },
      ]) +
        spacer(8) +
        paragraph(trialLead, "body", "0 0 12px") +
        featureGrid([
          { title: "Aprovações pelo Hub do cliente", text: "Portal whitelabel, sem login, com a sua marca." },
          { title: "Equipe", text: "Convide seu time e trabalhe junto nas entregas." },
          { title: "Analytics de Instagram", text: "Métricas e relatórios prontos para enviar." },
        ]) +
        trialButton,
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

export interface FirstChargeInput {
  provider: string;
  amount_cents: number | null;
  amount_interval: string | null;
  billing_interval: string | null;
}

/**
 * The first-charge amount as the trial reminder states it, or null when the
 * subscription row carries no amount. Pagar.me stores the ANNUAL total in
 * amount_cents and bills it in 12 installments; Stripe is month or year.
 */
export function formatFirstCharge(c: FirstChargeInput): string | null {
  if (c.amount_cents == null) return null;
  if (c.provider === "pagarme") {
    return `12x de ${formatMoney(Math.round(c.amount_cents / 12), "brl")} (total de ${
      formatMoney(c.amount_cents, "brl")
    })`;
  }
  const yearly = c.amount_interval === "year" || c.billing_interval === "year";
  return `${formatMoney(c.amount_cents, "brl")} ${yearly ? "por ano" : "por mês"}`;
}

/** "26 de novembro", in the São Paulo calendar (not UTC). */
export function formatChargeDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/** Subject of the trial reminder. Shared with the e-mail classifier. */
export function trialReminderSubject(planName: string | null, daysLeft: number): string {
  const name = planName ? sanitizeSubjectValue(planName) : "";
  return `Seu teste do Mesaas${name ? ` ${name}` : ""} termina em ${daysLeft} dias`;
}

export function buildTrialReminderEmail(p: {
  firstName: string | null;
  workspaceName: string;
  // plan_name is coalesce(plans.name, plan_id) and can still be NULL.
  planName: string | null;
  firstCharge: string | null;
  firstChargeDate: string;
  daysLeft: number;
  appBaseUrl: string;
}): { subject: string; html: string } {
  const base = p.appBaseUrl.replace(/\/+$/, "");
  const billingUrl = `${base}/configuracao/cobranca`;
  const subject = trialReminderSubject(p.planName, p.daysLeft);
  const trialLead = p.planName?.trim()
    ? `Seu teste grátis do plano ${p.planName.trim()} no workspace`
    : "Seu teste grátis no workspace";
  const chargeLine = p.firstCharge
    ? `Nesse dia fazemos a primeira cobrança de ${p.firstCharge} no cartão cadastrado.`
    : "Nesse dia fazemos a primeira cobrança do valor do seu plano no cartão cadastrado.";
  const html = mesaasEmail({
    preheader: `Sua primeira cobrança será em ${p.firstChargeDate}.`,
    eyebrow: "Seu teste grátis",
    sections: [
      paragraph(p.firstName ? `Oi, ${p.firstName},` : "Oi,") +
        paragraph(
          `${trialLead} ${p.workspaceName} termina em ${p.firstChargeDate}.`,
        ) +
        paragraph(chargeLine) +
        paragraph("Se quiser continuar, não precisa fazer nada.", "body", "0 0 20px") +
        button(billingUrl, "Ver meu plano"),
      paragraphHtml(
        `Se preferir cancelar ou trocar de plano, é só acessar Plano e cobrança antes dessa data: ${
          link(billingUrl, billingUrl)
        }.`,
        "small",
        "0 0 10px",
      ) +
        paragraph(
          "No plano Free você volta a ter 2 clientes, só você na conta e nenhum portal de aprovação ou relatório.",
          "small",
          "0",
        ),
    ],
    footerLines: [`Você recebeu este e-mail porque o workspace ${p.workspaceName} está em teste grátis no Mesaas.`],
  });
  return { subject, html };
}

// ─── Reverse trial (14 days of Pro without a card) ──────────────────────────

export type ReverseTrialEmailType =
  | "reverse_trial_ending"
  | "reverse_trial_ended"
  | "reverse_trial_hub_pausing";

export const REVERSE_TRIAL_EMAIL_TYPES: readonly ReverseTrialEmailType[] = [
  "reverse_trial_ending",
  "reverse_trial_ended",
  "reverse_trial_hub_pausing",
];

export const REVERSE_TRIAL_ENDED_SUBJECT = "Seu workspace voltou para o plano Free";
export const REVERSE_TRIAL_HUB_PAUSING_SUBJECT = "Os links do portal dos seus clientes pausam amanhã";

/** Subject of `reverse_trial_ending`. Shared with the e-mail classifier. */
export function reverseTrialEndingSubject(dateLabel: string): string {
  return `Seu teste do Pro termina em ${sanitizeSubjectValue(dateLabel)}`;
}

export interface ReverseTrialEmailInput {
  type: ReverseTrialEmailType;
  firstName: string | null;
  workspaceName: string;
  planName: string | null;
  /** Monthly price of the trial plan, in centavos; null drops the amount. */
  priceCents: number | null;
  endsAt: string | null;
  endedAt: string | null;
  hubPauseAt: string | null;
  appBaseUrl: string;
}

function requireDate(value: string | null, type: ReverseTrialEmailType, field: string): string {
  if (!value) throw new Error(`${type}: missing ${field}`);
  return formatChargeDate(value);
}

/**
 * The three reverse-trial emails. Every date is the São Paulo calendar day; the
 * add-card link is Plano e cobrança. Throws when the date the email is about is
 * missing, so a malformed candidate is reported instead of sent half-empty.
 */
export function buildReverseTrialEmail(p: ReverseTrialEmailInput): { subject: string; html: string } {
  const base = p.appBaseUrl.replace(/\/+$/, "");
  const billingUrl = `${base}/configuracao/cobranca`;
  const plan = p.planName?.trim() || "Pro";
  const greet = paragraph(p.firstName ? `Oi, ${p.firstName},` : "Oi,");
  const footerLines = [`Você recebeu este e-mail porque é dono do workspace ${p.workspaceName} no Mesaas.`];

  switch (p.type) {
    case "reverse_trial_ending": {
      const date = requireDate(p.endsAt, p.type, "ends_at");
      const price = p.priceCents != null ? `${formatMoney(p.priceCents, "brl")} por mês` : null;
      const html = mesaasEmail({
        preheader: `Sem cartão, o workspace volta para o plano Free em ${date}.`,
        eyebrow: "Seu teste do Pro",
        sections: [
          greet +
          paragraph(`O teste grátis do ${plan} no workspace ${p.workspaceName} termina em ${date}.`) +
          paragraph(
            price
              ? `Para continuar no ${plan}, adicione um cartão. A primeira cobrança, de ${price}, só acontece em ${date}.`
              : `Para continuar no ${plan}, adicione um cartão. A primeira cobrança só acontece em ${date}.`,
            "body",
            "0 0 20px",
          ) +
          button(billingUrl, "Adicionar cartão"),
          paragraph(
            "Sem cartão, o workspace volta para o plano Free nesse dia: até 2 clientes, só você na conta, sem portal do cliente e sem relatórios. Nada é apagado.",
            "small",
            "0",
          ),
        ],
        footerLines,
      });
      return { subject: reverseTrialEndingSubject(date), html };
    }
    case "reverse_trial_ended": {
      const endedDate = requireDate(p.endedAt, p.type, "ended_at");
      const pauseDate = p.hubPauseAt ? formatChargeDate(p.hubPauseAt) : null;
      const html = mesaasEmail({
        preheader: "Nada foi apagado. Adicione um cartão para recuperar o Pro.",
        eyebrow: "Plano Free",
        sections: [
          greet +
          paragraph(
            `O teste grátis do ${plan} no workspace ${p.workspaceName} terminou em ${endedDate}, e o workspace voltou para o plano Free.`,
          ) +
          paragraph(
            "Nada foi apagado: seus clientes, posts, entregas e relatórios continuam lá. No Free, cadastrar além dos limites do plano fica bloqueado, e Financeiro e Contratos ficam só para consulta.",
            "body",
            "0 0 20px",
          ) +
          (pauseDate
            ? callout(
              escapeHtml(
                `Os links do portal dos seus clientes pausam em ${pauseDate}. Recuperando o ${plan} antes disso, eles continuam funcionando.`,
              ),
            ) + spacer(20)
            : "") +
          button(billingUrl, `Recuperar o ${plan}`),
          paragraph(`Para recuperar o ${plan}, é só adicionar um cartão em Plano e cobrança.`, "small", "0"),
        ],
        footerLines,
      });
      return { subject: REVERSE_TRIAL_ENDED_SUBJECT, html };
    }
    case "reverse_trial_hub_pausing": {
      const pauseDate = requireDate(p.hubPauseAt, p.type, "hub_pause_at");
      const html = mesaasEmail({
        preheader: `A partir de ${pauseDate}, os links do portal deixam de abrir.`,
        eyebrow: "Portal do cliente",
        sections: [
          greet +
          paragraph(
            `Amanhã, ${pauseDate}, os links do portal dos clientes do workspace ${p.workspaceName} deixam de abrir. Seus clientes vão ver um aviso de que o portal está pausado.`,
          ) +
          paragraph(
            `Nada foi apagado. Assim que você recuperar o ${plan}, os mesmos links voltam a funcionar, sem precisar enviar links novos.`,
            "body",
            "0 0 20px",
          ) +
          button(billingUrl, `Recuperar o ${plan}`),
        ],
        footerLines,
      });
      return { subject: REVERSE_TRIAL_HUB_PAUSING_SUBJECT, html };
    }
  }
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
  /** Resend tags (`type` classifies the email for the metrics webhook). Omitted
   *  from the request body when absent or empty. Values are sanitized to
   *  Resend's allowed charset. */
  tags?: Record<string, string>,
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
      ...(tags && Object.keys(tags).length > 0
        ? { tags: Object.entries(tags).map(([name, value]) => ({ name, value: tagValue(value) })) }
        : {}),
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
  p: {
    to: string;
    firstName: string | null;
    appBaseUrl: string;
    idempotencyKey: string;
    reverseTrialOffer?: boolean;
  },
): Promise<void> {
  await sendViaResend(
    p.to,
    WELCOME_SUBJECT,
    buildWelcomeEmail({
      firstName: p.firstName,
      appBaseUrl: p.appBaseUrl,
      reverseTrialOffer: p.reverseTrialOffer === true,
    }),
    p.idempotencyKey,
    LIFECYCLE_FROM,
    undefined,
    undefined,
    undefined,
    { type: "welcome" },
  );
}

/** Trial reminder: the handler builds subject/html (so it can log and test them); this only ships. */
export async function sendTrialReminderEmail(
  p: { to: string; subject: string; html: string; idempotencyKey: string },
): Promise<void> {
  await sendViaResend(
    p.to,
    p.subject,
    p.html,
    p.idempotencyKey,
    LIFECYCLE_FROM,
    undefined,
    undefined,
    undefined,
    { type: "trial_reminder" },
  );
}

/** Reverse-trial emails: the handler builds subject/html; this ships them tagged with their type. */
export async function sendReverseTrialEmail(
  p: { to: string; subject: string; html: string; idempotencyKey: string; type: ReverseTrialEmailType },
): Promise<void> {
  await sendViaResend(
    p.to,
    p.subject,
    p.html,
    p.idempotencyKey,
    LIFECYCLE_FROM,
    undefined,
    undefined,
    undefined,
    { type: p.type },
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
    LIFECYCLE_FROM,
    undefined,
    undefined,
    undefined,
    { type: "thank_you" },
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
  await sendViaResend(to, subject, html, p.idempotencyKey, FOUNDER_NOTICE_FROM, undefined, undefined, undefined, { type: "founder_signup" });
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
  await sendViaResend(to, subject, html, p.idempotencyKey, FOUNDER_NOTICE_FROM, undefined, undefined, undefined, { type: "founder_subscription" });
}
