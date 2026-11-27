/**
 * Fixed inputs for the "pt unchanged" fixture of the owner lifecycle emails
 * (welcome, thank-you, trial reminder, reverse trial, nurture). The fixture
 * `lifecycle-pt.json` was captured from the code BEFORE the language change.
 */
import type { NurtureEmailInput, NurtureStep } from "../../_shared/nurture-emails.ts";
import type { ReverseTrialEmailInput } from "../../_shared/lifecycle-emails.ts";

export const BASE = "https://app.mesaas.com.br/";
export const UNSUB = "https://app.mesaas.com.br/descadastrar/tok";
export const WA = "https://wa.me/5511999999999?text=x";

export const WELCOME_CASES: Record<string, { firstName: string | null; reverseTrialOffer?: boolean; wa: boolean }> = {
  "welcome-card-wa": { firstName: "Ana", wa: true },
  "welcome-card-nowa": { firstName: null, wa: false },
  "welcome-reverse-wa": { firstName: "Ana", reverseTrialOffer: true, wa: true },
};

export const THANKS_INPUT = { firstName: "Ana", workspaceName: "Agência <Aurora>", appBaseUrl: BASE };
export const THANKS_ANON = { firstName: null, workspaceName: "Aurora", appBaseUrl: BASE };

export const CHARGE_DATE_ISO = "2026-12-03T02:30:00Z";

export const FIRST_CHARGE_CASES = {
  "fc-pagarme": { provider: "pagarme", amount_cents: 119000, amount_interval: null, billing_interval: null, currency: "brl" },
  "fc-stripe-month-brl": { provider: "stripe", amount_cents: 11900, amount_interval: "month", billing_interval: null, currency: "brl" },
  "fc-stripe-year-brl": { provider: "stripe", amount_cents: 119000, amount_interval: "year", billing_interval: null, currency: "brl" },
  "fc-stripe-month-usd": { provider: "stripe", amount_cents: 2900, amount_interval: "month", billing_interval: null, currency: "usd" },
  "fc-stripe-year-usd": { provider: "stripe", amount_cents: 129900, amount_interval: "year", billing_interval: null, currency: "usd" },
  "fc-none": { provider: "stripe", amount_cents: null, amount_interval: null, billing_interval: null, currency: "brl" },
};

export const REMINDER_CASES = {
  "reminder-full": {
    firstName: "Ana",
    workspaceName: "Aurora <b>",
    planName: "Pro",
    firstCharge: "R$ 119,00 por mês",
    firstChargeDate: "3 de dezembro",
    daysLeft: 7,
    appBaseUrl: BASE,
  },
  "reminder-bare": {
    firstName: null,
    workspaceName: "Aurora",
    planName: null,
    firstCharge: null,
    firstChargeDate: "3 de dezembro",
    daysLeft: 3,
    appBaseUrl: BASE,
  },
};

const RT = {
  firstName: "Ana",
  workspaceName: "Aurora <b>",
  planName: "Pro",
  priceCents: 11900,
  currency: "brl",
  endsAt: "2026-12-03T15:00:00Z",
  endedAt: "2026-12-03T15:00:00Z",
  hubPauseAt: "2026-12-10T15:00:00Z",
  appBaseUrl: BASE,
};

export const REVERSE_CASES: Record<string, ReverseTrialEmailInput> = {
  "rt-ending-brl": { ...RT, type: "reverse_trial_ending" },
  "rt-ending-usd": { ...RT, type: "reverse_trial_ending", priceCents: 2900, currency: "usd" },
  "rt-ending-noprice": { ...RT, type: "reverse_trial_ending", priceCents: null, firstName: null, planName: null },
  "rt-ended-pause": { ...RT, type: "reverse_trial_ended" },
  "rt-ended-nopause": { ...RT, type: "reverse_trial_ended", hubPauseAt: null },
  "rt-hub": { ...RT, type: "reverse_trial_hub_pausing" },
};

export const NURTURE_BASE: Omit<NurtureEmailInput, "step"> = {
  firstName: "Ana",
  workspaceName: "Agência Aurora",
  workspaceCreatedAt: "2026-11-01",
  clientCount: 2,
  firstClientName: "Studio Bela",
  hasInstagram: true,
  appBaseUrl: BASE,
  unsubUrl: UNSUB,
  whatsappUrl: WA,
};

const STEPS: NurtureStep[] = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];

export const NURTURE_CASES: Record<string, NurtureEmailInput> = {};
for (const step of STEPS) {
  NURTURE_CASES[`n-${step}`] = { ...NURTURE_BASE, step };
  NURTURE_CASES[`n-${step}-ex`] = { ...NURTURE_BASE, step, exReverseTrial: true };
}
NURTURE_CASES["n-a3-old"] = { ...NURTURE_BASE, step: "a3", workspaceCreatedAt: "2026-09-01", firstName: null };
NURTURE_CASES["n-b1-zero"] = { ...NURTURE_BASE, step: "b1", clientCount: 0, workspaceName: "Meu Workspace", firstName: null };
NURTURE_CASES["n-b1-one"] = { ...NURTURE_BASE, step: "b1", clientCount: 1 };
NURTURE_CASES["n-b1-ex-one"] = { ...NURTURE_BASE, step: "b1", clientCount: 1, exReverseTrial: true };
NURTURE_CASES["n-b2-nowho"] = { ...NURTURE_BASE, step: "b2", firstClientName: null, firstName: null };
NURTURE_CASES["n-b3-noig"] = { ...NURTURE_BASE, step: "b3", hasInstagram: false };
NURTURE_CASES["n-b3-ig-ex"] = { ...NURTURE_BASE, step: "b3", exReverseTrial: true };
NURTURE_CASES["n-a4-nowa"] = { ...NURTURE_BASE, step: "a4", whatsappUrl: null };

export const CONFIRM_LINK =
  "https://example.supabase.co/auth/v1/verify?token=abc&type=magiclink&redirect_to=https://app.mesaas.com.br/login";

export const CONFIRM_CASES = {
  "confirm-1h-pt": { type: "confirm_reminder_1h", firstName: "Ana", actionLink: CONFIRM_LINK },
  "confirm-24h-pt": { type: "confirm_reminder_24h", firstName: null, actionLink: CONFIRM_LINK },
} as const;
