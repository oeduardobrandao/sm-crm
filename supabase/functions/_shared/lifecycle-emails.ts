import { tagValue } from "./email-tag.ts";
import { escapeHtml } from "./report-template/escape.ts";
import { fetchStripeAmount } from "./stripe-amount.ts";
import { whatsAppSupportUrl } from "./whatsapp.ts";
import { mesaasEmail } from "./email/shell.ts";
import { button, callout, featureGrid, heading, link, paragraph, paragraphHtml, sectionTitle, signature, spacer, steps } from "./email/blocks.ts";
import { lifecycleText } from "./i18n/catalogs/lifecycle.ts";
import { formatDate, formatMoney as formatMoneyIntl, type Lang } from "./i18n/lang.ts";

// pt subjects stay exported as constants: the e-mail classifier matches them
// as a fallback when a send carries no `type` tag.
export const WELCOME_SUBJECT = lifecycleText("pt").welcome.subject;
export const THANKYOU_SUBJECT = lifecycleText("pt").thanks.subject;

/** First whitespace-separated word of profiles.nome; null when absent/blank. */
export function firstNameFrom(nome: string | null | undefined): string | null {
  const first = (nome ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Lead-in of the welcome email when the workspace qualifies for the reverse trial (pt). */
export const WELCOME_REVERSE_TRIAL_LEAD = lifecycleText("pt").welcome.reverseLead;

export function buildWelcomeEmail(
  p: {
    firstName: string | null;
    appBaseUrl: string;
    /** Workspace qualifies for the automatic 14-day Pro (keyed on the offer, not on plan_source). */
    reverseTrialOffer?: boolean;
    lang: Lang;
  },
): string {
  const lang = p.lang;
  const t = lifecycleText(lang).welcome;
  const base = p.appBaseUrl.replace(/\/+$/, "");
  // The 30-day card trial block, or the reverse-trial one: the email can go out
  // before the first app visit starts the trial, so it promises what that visit
  // will do, and links straight into the app instead of /comecar.
  const trialLead = p.reverseTrialOffer ? t.trialLeadReverse : t.trialLeadCard;
  const trialButton = p.reverseTrialOffer
    ? button(`${base}/dashboard`, t.enterApp, "outline")
    : button(`${base}/comecar`, t.startTrial, "outline");
  const waUrl = whatsAppSupportUrl({ firstName: p.firstName, lang });
  // Gated by the same waUrl as the button, so the sentence never mentions a missing button.
  const closingLine = waUrl ? t.closingWa : t.closingNoWa;
  return mesaasEmail({
    lang,
    preheader: t.preheader,
    eyebrow: t.eyebrow,
    sections: [
      heading(p.firstName ? t.greetNamed(p.firstName) : t.greetAnon) +
        paragraph(t.intro1) +
        paragraphHtml(t.intro2Html, "body", "0"),
      sectionTitle(t.stepsTitle) +
        steps([
          t.step1,
          `${t.step2Html}${spacer(14)}${button(`${base}/importar`, t.importButton)}`,
          t.step3,
        ]),
      featureGrid([
        { title: t.featClientsTitle, text: t.featClientsText },
        { title: t.featDeliveriesTitle, text: t.featDeliveriesText },
      ]) +
        spacer(8) +
        paragraph(trialLead, "body", "0 0 12px") +
        featureGrid([
          { title: t.featHubTitle, text: t.featHubText },
          { title: t.featTeamTitle, text: t.featTeamText },
          { title: t.featIgTitle, text: t.featIgText },
        ]) +
        trialButton,
      callout(t.callout(link(`${base}/ajuda`, t.helpLabel), link(`${base}/novidades`, t.newsLabel))),
      paragraphHtml(closingLine, "body", "0 0 18px") +
        (waUrl ? button(waUrl, t.waButton, "outline") + spacer(24) : "") +
        signature(lang),
    ],
    footerLines: [t.footer],
  });
}

export function buildThankYouEmail(
  p: { firstName: string | null; workspaceName: string; appBaseUrl: string; lang: Lang },
): string {
  const lang = p.lang;
  const t = lifecycleText(lang).thanks;
  const base = p.appBaseUrl.replace(/\/+$/, "");
  return mesaasEmail({
    lang,
    preheader: t.preheader,
    eyebrow: t.eyebrow,
    sections: [
      heading(p.firstName ? t.greetNamed(p.firstName) : t.greetAnon) +
        paragraphHtml(t.introHtml(escapeHtml(p.workspaceName))) +
        paragraph(t.thanks, "body", "0"),
      sectionTitle(t.stepsTitle) +
        steps([
          t.step1,
          t.step2Html(link(`${base}/importar`, t.importLabel)),
          t.step3,
        ]),
      paragraphHtml(t.settingsHtml(link(`${base}/configuracao`, t.settingsLabel)), "small", "0"),
      paragraphHtml(t.askHtml, "body", "0 0 24px") +
        signature(lang),
    ],
    footerLines: [t.footer(p.workspaceName)],
  });
}

export interface FirstChargeInput {
  provider: string;
  amount_cents: number | null;
  amount_interval: string | null;
  billing_interval: string | null;
  /** ISO-ish currency of amount_cents ("brl" | "usd"); a missing value reads as brl. */
  currency: string;
}

/**
 * The first-charge amount as the trial reminder states it, or null when the
 * subscription row carries no amount. Pagar.me stores the ANNUAL total in
 * amount_cents and bills it in 12 installments; Stripe is month or year.
 * pt keeps the hand-rolled formatting (regular space after "R$", which Intl
 * pt-BR renders as a no-break space); en uses Intl.
 */
export function formatFirstCharge(c: FirstChargeInput, lang: Lang = "pt"): string | null {
  if (c.amount_cents == null) return null;
  const yearly = c.amount_interval === "year" || c.billing_interval === "year";
  if (lang === "en") {
    const money = (cents: number, cur: string) => formatMoneyIntl(cents, cur.toLowerCase() === "usd" ? "usd" : "brl", "en");
    if (c.provider === "pagarme") {
      return `12 installments of ${money(Math.round(c.amount_cents / 12), "brl")} (total ${money(c.amount_cents, "brl")})`;
    }
    return `${money(c.amount_cents, c.currency ?? "brl")} ${yearly ? "per year" : "per month"}`;
  }
  if (c.provider === "pagarme") {
    // Pagar.me only bills in reais.
    return `12x de ${formatMoney(Math.round(c.amount_cents / 12), "brl")} (total de ${
      formatMoney(c.amount_cents, "brl")
    })`;
  }
  return `${formatPlanMoney(c.amount_cents, c.currency ?? "brl")} ${yearly ? "por ano" : "por mês"}`;
}

/** "26 de novembro" / "November 26", in the workspace language's calendar (not UTC). */
export function formatChargeDate(iso: string, lang: Lang = "pt"): string {
  return formatDate(iso, lang, { day: "numeric", month: "long" });
}

/** Subject of the trial reminder. Shared with the e-mail classifier. */
export function trialReminderSubject(planName: string | null, daysLeft: number, lang: Lang = "pt"): string {
  const name = planName ? sanitizeSubjectValue(planName) : "";
  return lifecycleText(lang).reminder.subject(name, daysLeft);
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
  lang: Lang;
}): { subject: string; html: string } {
  const lang = p.lang;
  const t = lifecycleText(lang).reminder;
  const base = p.appBaseUrl.replace(/\/+$/, "");
  const billingUrl = `${base}/configuracao/cobranca`;
  const subject = trialReminderSubject(p.planName, p.daysLeft, lang);
  const trialLead = p.planName?.trim() ? t.leadPlan(p.planName.trim()) : t.leadNoPlan;
  const chargeLine = p.firstCharge ? t.chargeAmount(p.firstCharge) : t.chargeNoAmount;
  const html = mesaasEmail({
    lang,
    preheader: t.preheader(p.firstChargeDate),
    eyebrow: t.eyebrow,
    sections: [
      paragraph(p.firstName ? t.greetNamed(p.firstName) : t.greetAnon) +
        paragraph(t.ends(trialLead, p.workspaceName, p.firstChargeDate)) +
        paragraph(chargeLine) +
        paragraph(t.keepGoing, "body", "0 0 20px") +
        button(billingUrl, t.button),
      paragraphHtml(t.cancelHtml(link(billingUrl, billingUrl)), "small", "0 0 10px") +
        paragraph(t.freeNote, "small", "0"),
    ],
    footerLines: [t.footer(p.workspaceName)],
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

export const REVERSE_TRIAL_ENDED_SUBJECT = lifecycleText("pt").reverse.endedSubject;
export const REVERSE_TRIAL_HUB_PAUSING_SUBJECT = lifecycleText("pt").reverse.hubPausingSubject;

/** Subject of `reverse_trial_ending`. Shared with the e-mail classifier. */
export function reverseTrialEndingSubject(dateLabel: string, lang: Lang = "pt"): string {
  return lifecycleText(lang).reverse.endingSubject(sanitizeSubjectValue(dateLabel));
}

export interface ReverseTrialEmailInput {
  type: ReverseTrialEmailType;
  firstName: string | null;
  workspaceName: string;
  planName: string | null;
  /** Monthly price of the trial plan, in centavos; null drops the amount. */
  priceCents: number | null;
  /** Currency of priceCents; absent or null reads as brl. */
  currency?: string | null;
  endsAt: string | null;
  endedAt: string | null;
  hubPauseAt: string | null;
  appBaseUrl: string;
  lang: Lang;
}

function requireDate(value: string | null, type: ReverseTrialEmailType, field: string, lang: Lang): string {
  if (!value) throw new Error(`${type}: missing ${field}`);
  return formatChargeDate(value, lang);
}

/**
 * The three reverse-trial emails. Every date is the São Paulo (pt) or New York
 * (en) calendar day; the add-card link is Plano e cobrança. Throws when the date
 * the email is about is missing, so a malformed candidate is reported instead
 * of sent half-empty.
 */
export function buildReverseTrialEmail(p: ReverseTrialEmailInput): { subject: string; html: string } {
  const lang = p.lang;
  const t = lifecycleText(lang).reverse;
  const base = p.appBaseUrl.replace(/\/+$/, "");
  const billingUrl = `${base}/configuracao/cobranca`;
  const plan = p.planName?.trim() || "Pro";
  const greet = paragraph(p.firstName ? t.greetNamed(p.firstName) : t.greetAnon);
  const footerLines = [t.footer(p.workspaceName)];

  switch (p.type) {
    case "reverse_trial_ending": {
      const date = requireDate(p.endsAt, p.type, "ends_at", lang);
      const price = p.priceCents != null
        ? t.perMonth(formatPlanMoney(p.priceCents, p.currency ?? "brl", lang))
        : null;
      const html = mesaasEmail({
        lang,
        preheader: t.endingPreheader(date),
        eyebrow: t.endingEyebrow,
        sections: [
          greet +
          paragraph(t.endingLead(plan, p.workspaceName, date)) +
          paragraph(
            // No charge date here: a card added in the last 48h is charged
            // later than the trial end (Stripe floor, Pagar.me rounding); the
            // checkout shows the exact date.
            price ? t.endingPrice(plan, price) : t.endingNoPrice(plan),
            "body",
            "0 0 20px",
          ) +
          button(billingUrl, t.addCard),
          paragraph(t.endingSmall, "small", "0"),
        ],
        footerLines,
      });
      return { subject: reverseTrialEndingSubject(date, lang), html };
    }
    case "reverse_trial_ended": {
      const endedDate = requireDate(p.endedAt, p.type, "ended_at", lang);
      const pauseDate = p.hubPauseAt ? formatChargeDate(p.hubPauseAt, lang) : null;
      const html = mesaasEmail({
        lang,
        preheader: t.endedPreheader,
        eyebrow: t.endedEyebrow,
        sections: [
          greet +
          paragraph(t.endedLead(plan, p.workspaceName, endedDate)) +
          paragraph(t.endedBody, "body", "0 0 20px") +
          (pauseDate ? callout(escapeHtml(t.endedHubCallout(pauseDate, plan))) + spacer(20) : "") +
          button(billingUrl, t.recover(plan)),
          paragraph(t.endedSmall(plan), "small", "0"),
        ],
        footerLines,
      });
      return { subject: t.endedSubject, html };
    }
    case "reverse_trial_hub_pausing": {
      const pauseDate = requireDate(p.hubPauseAt, p.type, "hub_pause_at", lang);
      const html = mesaasEmail({
        lang,
        preheader: t.hubPreheader(pauseDate),
        eyebrow: t.hubEyebrow,
        sections: [
          greet +
          paragraph(t.hubLead(pauseDate, p.workspaceName)) +
          paragraph(t.hubBody(plan), "body", "0 0 20px") +
          button(billingUrl, t.recover(plan)),
        ],
        footerLines,
      });
      return { subject: t.hubPausingSubject, html };
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
 * Plan prices in the customer-facing emails: "R$ 119,00" for brl, "US$ 29,00" for usd
 * (pt-BR digits; the email language is a later part). formatMoney keeps its generic
 * "14,90 USD" form for the founder notice.
 */
function formatPlanMoney(cents: number, currency: string, lang: Lang = "pt"): string {
  if (lang === "en") return formatMoneyIntl(cents, currency.toLowerCase() === "usd" ? "usd" : "brl", "en");
  if (currency.toLowerCase() === "usd") return `US$ ${formatMoney(cents, "brl").slice(3)}`;
  return formatMoney(cents, currency);
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
    lang: Lang;
  },
): Promise<void> {
  await sendViaResend(
    p.to,
    lifecycleText(p.lang).welcome.subject,
    buildWelcomeEmail({
      firstName: p.firstName,
      appBaseUrl: p.appBaseUrl,
      reverseTrialOffer: p.reverseTrialOffer === true,
      lang: p.lang,
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
    lang: Lang;
  },
): Promise<void> {
  await sendViaResend(
    p.to,
    lifecycleText(p.lang).thanks.subject,
    buildThankYouEmail({
      firstName: p.firstName,
      workspaceName: p.workspaceName,
      appBaseUrl: p.appBaseUrl,
      lang: p.lang,
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
