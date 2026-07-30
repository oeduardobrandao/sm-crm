/**
 * Sweep logic for the lifecycle-email cron, dependency-injected so tests can
 * drive it without a network.
 *
 * Protocol per candidate (both sweeps):
 *   claim-upsert (refresh sent_at) → send with a deterministic Resend
 *   Idempotency-Key → set delivered_at.
 * No ownership check and no delete-on-failure: the candidate RPCs exclude
 * delivered and fresh (<1h) claims, so a failed/crashed attempt goes stale
 * and retries with the SAME key — Resend dedupes keys for 24h, making
 * overlapping runs and ambiguous failures safe.
 */

import { firstNameFrom } from "../_shared/lifecycle-emails.ts";

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/** The two supabase-js surfaces this handler touches. */
export interface LifecycleDb {
  rpc(name: string): Promise<DbResult<unknown>>;
  from(table: "lifecycle_emails"): {
    upsert(
      row: {
        email_type: string;
        user_id?: string;
        workspace_id?: string;
        sent_at: string;
        attempts: number;
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

/** Claim refresh: bumps sent_at and writes attempts = prior + 1 (RPC-supplied). */
async function claim(
  deps: LifecycleCronDeps,
  row: { email_type: string; user_id?: string; workspace_id?: string; attempts: number },
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

export async function runLifecycleEmailCron(
  deps: LifecycleCronDeps,
): Promise<{ welcomeSent: number; thanksSent: number; failed: number }> {
  let welcomeSent = 0;
  let thanksSent = 0;
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

  if (errors.length > 0) {
    console.error(`[lifecycle-email-cron] ${errors.length} failure(s)`, errors);
    await deps.report({ failed: errors.length, errors });
  }
  return { welcomeSent, thanksSent, failed: errors.length };
}
