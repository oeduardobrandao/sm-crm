/**
 * Sweep logic for the lifecycle-email cron, dependency-injected so tests can
 * drive it without a network.
 *
 * Protocol per candidate (every sweep):
 *   claim-upsert (refresh sent_at) → send with a deterministic Resend
 *   Idempotency-Key → set delivered_at.
 * No ownership check and no delete-on-failure: the candidate RPCs exclude
 * delivered and fresh (<1h) claims, so a failed/crashed attempt goes stale
 * and retries with the SAME key — Resend dedupes keys for 24h, making
 * overlapping runs and ambiguous failures safe.
 */

import {
  buildTrialReminderEmail,
  firstNameFrom,
  formatChargeDate,
  formatFirstCharge,
} from "../_shared/lifecycle-emails.ts";
import { buildNurtureEmail, NURTURE_SAMPLE, type NurtureStep } from "../_shared/nurture-emails.ts";

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/** The supabase-js surfaces this handler touches. */
export interface LifecycleDb {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
  from(table: "nurture_emails"): {
    update(patch: { delivered_at: string }): {
      eq(col: "workspace_id", val: string): {
        eq(col: "step", val: string): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
  from(table: "lifecycle_emails"): {
    upsert(
      row: {
        email_type: string;
        user_id?: string;
        workspace_id?: string;
        sent_at: string;
        attempts: number;
        ref_at?: string;
        delivered_at?: null;
        meta?: Record<string, unknown>;
      },
      opts: { onConflict: string },
    ): PromiseLike<{ error: { message: string } | null }>;
    update(patch: { delivered_at: string }): {
      eq(col: string, val: string): {
        eq(col: string, val: string): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
}

export interface CronReportDetail {
  failed: number;
  errors: Array<{ accountId?: string; error?: string }>;
}

export interface LifecycleCronDeps {
  db: LifecycleDb;
  appBaseUrl: string;
  now: () => Date;
  sendWelcome: (p: {
    to: string;
    firstName: string | null;
    appBaseUrl: string;
    idempotencyKey: string;
  }) => Promise<void>;
  sendThanks: (p: {
    to: string;
    firstName: string | null;
    workspaceName: string;
    appBaseUrl: string;
    idempotencyKey: string;
  }) => Promise<void>;
  // Internal founder notices, sent AFTER the user-facing email and BEFORE
  // markDelivered: a notice failure leaves the claim undelivered, so the stale
  // retry re-sends both (the user-facing email deduped by its unchanged
  // Resend idempotency key).
  sendFounderSignup: (p: {
    userEmail: string;
    nome: string | null;
    idempotencyKey: string;
  }) => Promise<void>;
  sendFounderSubscription: (p: {
    workspaceName: string;
    ownerEmail: string;
    ownerNome: string | null;
    planName: string | null;
    subStatus: string | null;
    billingInterval: string | null;
    stripeSubscriptionId: string | null;
    idempotencyKey: string;
  }) => Promise<void>;
  // Trial reminder: the handler builds subject/html (pure, testable) and the
  // dep only ships it from LIFECYCLE_FROM.
  sendTrialReminder: (p: {
    to: string;
    subject: string;
    html: string;
    idempotencyKey: string;
  }) => Promise<void>;
  // Nurture (owners who never subscribed). Read per run from NURTURE_EMAILS;
  // false skips the sweep entirely (no RPC call).
  nurtureEnabled: boolean;
  /**
   * Signed unsubscribe links for a profile id: `page` is the CRM confirmation
   * page linked from the footer (the Supabase gateway serves function HTML as
   * text/plain, so a person cannot use the function URL directly); `oneClick`
   * is the function URL for the List-Unsubscribe header (RFC 8058 POST).
   */
  nurtureUnsubLinks: (userId: string) => Promise<{ page: string; oneClick: string }>;
  whatsappUrl: string | null;
  sendNurture: (p: {
    to: string;
    subject: string;
    html: string;
    idempotencyKey: string;
    headers: Record<string, string>;
  }) => Promise<void>;
  report: (detail: CronReportDetail) => Promise<void>;
}

interface WelcomeCandidate {
  user_id: string;
  email: string;
  nome: string | null;
  attempts: number;
}

interface ThankCandidate {
  workspace_id: string;
  workspace_name: string;
  owner_email: string;
  owner_nome: string | null;
  attempts: number;
  // Added by migration 20260730000003; optional so the function tolerates
  // running against the pre-migration RPC (deploy-order safety).
  plan_name?: string | null;
  sub_status?: string | null;
  billing_interval?: string | null;
  stripe_subscription_id?: string | null;
}

interface TrialReminderCandidate {
  workspace_id: string;
  workspace_name: string;
  owner_email: string;
  owner_nome: string | null;
  plan_name: string | null;
  provider: string;
  amount_cents: number | null;
  amount_interval: string | null;
  billing_interval: string | null;
  first_charge_at: string;
  attempts: number;
}

interface NurtureCandidate {
  user_id: string;
  workspace_id: string;
  email: string | null;
  nome: string | null;
  workspace_name: string;
  workspace_created_at: string;
  email_type: string;
  step: string;
  attempts: number;
  client_count: number;
  first_client_name: string | null;
  has_instagram: boolean;
}

const NURTURE_STEPS: readonly NurtureStep[] = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];

function isNurtureStep(s: string): s is NurtureStep {
  return (NURTURE_STEPS as readonly string[]).includes(s);
}

/** Fixed profile id for preview unsubscribe links (matches no real profile). */
const PREVIEW_USER_ID = "00000000-0000-0000-0000-000000000000";

function unsubHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The amount and interval the reminder tells the owner they will be charged
 * (the ledger audit of what was announced). Pagar.me stores the annual total
 * and the email shows 12 monthly installments, so the ledger records the
 * installment; Stripe is month or year. Both null when no amount is announced.
 */
function announcedCharge(
  c: TrialReminderCandidate,
): { amount_cents: number | null; amount_interval: string | null } {
  if (c.amount_cents == null) return { amount_cents: null, amount_interval: null };
  if (c.provider === "pagarme") {
    return { amount_cents: Math.round(c.amount_cents / 12), amount_interval: "month" };
  }
  const yearly = c.amount_interval === "year" || c.billing_interval === "year";
  return { amount_cents: c.amount_cents, amount_interval: yearly ? "year" : "month" };
}

/** Claim refresh: bumps sent_at and writes attempts = prior + 1 (RPC-supplied). */
async function claim(
  deps: LifecycleCronDeps,
  row: {
    email_type: string;
    user_id?: string;
    workspace_id?: string;
    attempts: number;
    ref_at?: string;
    delivered_at?: null;
    meta?: Record<string, unknown>;
  },
  onConflict: string,
): Promise<void> {
  const { error } = await deps.db
    .from("lifecycle_emails")
    .upsert({ ...row, sent_at: deps.now().toISOString() }, { onConflict });
  if (error) throw new Error(`claim failed: ${error.message}`);
}

async function markDelivered(
  deps: LifecycleCronDeps,
  emailType: string,
  keyCol: "user_id" | "workspace_id",
  keyVal: string,
): Promise<void> {
  const { error } = await deps.db
    .from("lifecycle_emails")
    .update({ delivered_at: deps.now().toISOString() })
    .eq("email_type", emailType)
    .eq(keyCol, keyVal);
  // A failed update leaves an undelivered claim: the stale retry re-sends with
  // the same idempotency key and Resend dedupes. Log, don't throw.
  if (error) {
    console.error(
      `[lifecycle-email-cron] delivered_at update failed for ${emailType}/${keyVal}:`,
      error.message,
    );
  }
}

async function markNurtureDelivered(
  deps: LifecycleCronDeps,
  workspaceId: string,
  step: NurtureStep,
  nowIso: string,
): Promise<void> {
  const { error } = await deps.db
    .from("nurture_emails")
    .update({ delivered_at: nowIso })
    .eq("workspace_id", workspaceId)
    .eq("step", step);
  // Same as markDelivered: the stale claim retries with the same key.
  if (error) {
    console.error(
      `[lifecycle-email-cron] nurture delivered_at update failed for ${workspaceId}/${step}:`,
      error.message,
    );
  }
}

/** First 12 hex chars of sha256(lowercased, trimmed address). */
async function recipientHash(to: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(to.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

/**
 * Manual preview: the 8 nurture emails with sample data to one address. Never
 * reads the kill switch nor touches the database, so it works with the sweep
 * off (deploy step 5). The day and a recipient hash in the key dedupe a double
 * click to the same address without blocking a same-day preview to another one
 * (Resend answers 409 on a reused key and sendViaResend treats it as success).
 */
export async function runNurturePreview(
  deps: LifecycleCronDeps,
  to: string,
): Promise<{ previewSent: number }> {
  const day = deps.now().toISOString().slice(0, 10);
  const who = await recipientHash(to);
  const unsub = await deps.nurtureUnsubLinks(PREVIEW_USER_ID);
  let previewSent = 0;
  for (const step of NURTURE_STEPS) {
    const { subject, html } = buildNurtureEmail({
      ...NURTURE_SAMPLE,
      step,
      appBaseUrl: deps.appBaseUrl,
      unsubUrl: unsub.page,
      whatsappUrl: deps.whatsappUrl,
    });
    await deps.sendNurture({
      to,
      subject,
      html,
      idempotencyKey: `nurture_preview/${step}/${day}/${who}`,
      headers: unsubHeaders(unsub.oneClick),
    });
    previewSent++;
  }
  return { previewSent };
}

export async function runLifecycleEmailCron(
  deps: LifecycleCronDeps,
): Promise<
  {
    welcomeSent: number;
    thanksSent: number;
    trialRemindersSent: number;
    nurtureSent: number;
    failed: number;
  }
> {
  let welcomeSent = 0;
  let thanksSent = 0;
  let trialRemindersSent = 0;
  let nurtureSent = 0;
  const errors: Array<{ accountId?: string; error?: string }> = [];

  // --- Welcome sweep -------------------------------------------------------
  const welcome = await deps.db.rpc("get_welcome_email_candidates");
  if (welcome.error) {
    errors.push({ error: `welcome candidates: ${welcome.error.message}` });
  } else {
    for (const c of (welcome.data ?? []) as WelcomeCandidate[]) {
      try {
        await claim(
          deps,
          { email_type: "welcome", user_id: c.user_id, attempts: c.attempts + 1 },
          "email_type,user_id",
        );
        await deps.sendWelcome({
          to: c.email,
          firstName: firstNameFrom(c.nome),
          appBaseUrl: deps.appBaseUrl,
          idempotencyKey: `welcome/${c.user_id}`,
        });
        await deps.sendFounderSignup({
          userEmail: c.email,
          nome: c.nome,
          idempotencyKey: `founder_signup/${c.user_id}`,
        });
        await markDelivered(deps, "welcome", "user_id", c.user_id);
        welcomeSent++;
      } catch (e) {
        errors.push({
          accountId: c.user_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // --- Thank-you sweep -----------------------------------------------------
  const thanks = await deps.db.rpc("get_thankyou_email_candidates");
  if (thanks.error) {
    errors.push({ error: `thank-you candidates: ${thanks.error.message}` });
  } else {
    for (const c of (thanks.data ?? []) as ThankCandidate[]) {
      try {
        await claim(
          deps,
          {
            email_type: "subscription_thanks",
            workspace_id: c.workspace_id,
            attempts: c.attempts + 1,
          },
          "email_type,workspace_id",
        );
        await deps.sendThanks({
          to: c.owner_email,
          firstName: firstNameFrom(c.owner_nome),
          workspaceName: c.workspace_name,
          appBaseUrl: deps.appBaseUrl,
          idempotencyKey: `subscription_thanks/${c.workspace_id}`,
        });
        await deps.sendFounderSubscription({
          workspaceName: c.workspace_name,
          ownerEmail: c.owner_email,
          ownerNome: c.owner_nome,
          planName: c.plan_name ?? null,
          subStatus: c.sub_status ?? null,
          billingInterval: c.billing_interval ?? null,
          stripeSubscriptionId: c.stripe_subscription_id ?? null,
          idempotencyKey: `founder_subscription/${c.workspace_id}`,
        });
        await markDelivered(deps, "subscription_thanks", "workspace_id", c.workspace_id);
        thanksSent++;
      } catch (e) {
        errors.push({
          accountId: c.workspace_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // --- Trial reminder sweep ------------------------------------------------
  // One reminder per workspace, ~7 days before the first charge. The claim
  // resets delivered_at and records ref_at (the charge date it was sent for).
  const reminders = await deps.db.rpc("get_trial_reminder_candidates");
  if (reminders.error) {
    errors.push({ error: `trial reminder candidates: ${reminders.error.message}` });
  } else {
    for (const c of (reminders.data ?? []) as TrialReminderCandidate[]) {
      try {
        const now = deps.now();
        const untilCharge = new Date(c.first_charge_at).getTime() - now.getTime();
        // Round, not ceil: a normal send at 7d00m-7d59m must read "7 dias".
        const daysLeft = Math.round(untilCharge / DAY_MS);
        if (untilCharge < 7 * DAY_MS) {
          console.warn(
            `[lifecycle-email-cron] trial-reminder:late workspace ${c.workspace_id} daysLeft=${daysLeft}`,
          );
        }
        const firstCharge = formatFirstCharge(c);
        if (firstCharge === null) {
          console.warn(
            `[lifecycle-email-cron] trial-reminder:no-amount workspace ${c.workspace_id}`,
          );
        }
        const { subject, html } = buildTrialReminderEmail({
          firstName: firstNameFrom(c.owner_nome),
          workspaceName: c.workspace_name,
          planName: c.plan_name,
          firstCharge,
          firstChargeDate: formatChargeDate(c.first_charge_at),
          daysLeft,
          appBaseUrl: deps.appBaseUrl,
        });
        await claim(
          deps,
          {
            email_type: "trial_reminder",
            workspace_id: c.workspace_id,
            attempts: c.attempts + 1,
            ref_at: c.first_charge_at,
            delivered_at: null,
            meta: {
              to: c.owner_email,
              ...announcedCharge(c),
              provider: c.provider,
              first_charge_at: c.first_charge_at,
            },
          },
          "email_type,workspace_id",
        );
        await deps.sendTrialReminder({
          to: c.owner_email,
          subject,
          html,
          idempotencyKey: `trial_reminder/${c.workspace_id}/${c.first_charge_at}`,
        });
        await markDelivered(deps, "trial_reminder", "workspace_id", c.workspace_id);
        trialRemindersSent++;
      } catch (e) {
        errors.push({
          accountId: c.workspace_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  // --- Nurture sweep -------------------------------------------------------
  // Owners who never subscribed. Every eligibility rule, quota and cap lives
  // in get_nurture_candidates; claim_nurture_email re-checks the recipient is
  // still the owner and refuses (null) a delivered, fresh or exhausted claim.
  // Both RPCs get the same clock so a claim can never be judged at a different
  // instant than the read that produced it.
  if (deps.nurtureEnabled) {
    const nowIso = deps.now().toISOString();
    const nurture = await deps.db.rpc("get_nurture_candidates", { p_now: nowIso });
    if (nurture.error) {
      errors.push({ error: `nurture candidates: ${nurture.error.message}` });
    } else {
      for (const c of (nurture.data ?? []) as NurtureCandidate[]) {
        try {
          const step = c.step;
          if (!isNurtureStep(step)) {
            throw new Error(`nurture: unknown step ${String(step)}`);
          }
          const to = (c.email ?? "").trim();
          if (!to) throw new Error(`nurture_${step}: candidate has no email`);

          // Before the claim: a signing failure (e.g. NURTURE_UNSUB_SECRET
          // missing) is reported without spending a claim attempt.
          const unsub = await deps.nurtureUnsubLinks(c.user_id);
          const claimed = await deps.db.rpc("claim_nurture_email", {
            p_workspace_id: c.workspace_id,
            p_step: step,
            p_recipient_user_id: c.user_id,
            p_now: nowIso,
          });
          if (claimed.error) throw new Error(`nurture claim failed: ${claimed.error.message}`);
          // Refused (owner changed, already delivered, claim in flight, budget
          // spent): not an error, just not ours to send.
          if (claimed.data == null) continue;

          const { subject, html } = buildNurtureEmail({
            step,
            firstName: firstNameFrom(c.nome),
            workspaceName: c.workspace_name,
            workspaceCreatedAt: c.workspace_created_at,
            clientCount: c.client_count,
            firstClientName: c.first_client_name,
            hasInstagram: c.has_instagram,
            appBaseUrl: deps.appBaseUrl,
            unsubUrl: unsub.page,
            whatsappUrl: deps.whatsappUrl,
          });
          await deps.sendNurture({
            to,
            subject,
            html,
            idempotencyKey: `nurture_${step}/${c.workspace_id}`,
            headers: unsubHeaders(unsub.oneClick),
          });
          await markNurtureDelivered(deps, c.workspace_id, step, nowIso);
          nurtureSent++;
        } catch (e) {
          errors.push({
            accountId: c.workspace_id,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[lifecycle-email-cron] ${errors.length} failure(s)`, errors);
    await deps.report({ failed: errors.length, errors });
  }
  return { welcomeSent, thanksSent, trialRemindersSent, nurtureSent, failed: errors.length };
}
