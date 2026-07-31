/**
 * Sweep logic for the Loops marketing sync, dependency-injected so tests can
 * drive it without a network.
 *
 * Per trigger candidate:
 *   claim_marketing_email (atomic, arbitrates the 72h cap across ALL marketing
 *   types for the workspace) → send with a deterministic Idempotency-Key →
 *   mark delivered.
 *
 * A lost claim means another sweep, or another trigger type, already spoke to
 * this workspace inside 72h. Skip silently; it is not a failure.
 *
 * A failed send leaves the claim undelivered, so the candidate RPC re-offers it
 * after an hour and Loops dedupes the retry on the unchanged key (24h window,
 * which is why the attempt cap is 20).
 */

import { firstNameFrom } from "../_shared/lifecycle-emails.ts";

interface DbResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface LoopsCronDeps {
  rpc: (name: string) => Promise<DbResult<unknown>>;
  claim: (
    emailType: string,
    workspaceId: string,
    userId: string,
    attempts: number,
  ) => Promise<boolean>;
  markDelivered: (
    emailType: string,
    keyCol: "user_id" | "workspace_id",
    keyVal: string,
  ) => Promise<void>;
  recordContactSync: (userId: string, email: string) => Promise<void>;
  markContactDeleted: (id: string) => Promise<void>;
  sendEvent: (p: {
    email: string;
    eventName: string;
    properties: Record<string, unknown>;
    idempotencyKey: string;
  }) => Promise<void>;
  updateContact: (p: { email: string; traits: Record<string, unknown> }) => Promise<void>;
  deleteContact: (p: { email: string }) => Promise<void>;
  capture: (event: string, props: Record<string, unknown>) => Promise<void>;
  report: (detail: { failed: number; errors: Array<{ accountId?: string; error?: string }> }) => Promise<void>;
}

interface TriggerRow {
  workspace_id: string;
  workspace_name: string;
  owner_user_id: string;
  owner_email: string;
  owner_nome: string | null;
  attempts: number;
}

interface PaywallRow extends TriggerRow {
  plan_name: string | null;
  client_count: number;
  feature: string;
  clicked_upgrade: boolean;
}

interface AbandonedRow extends TriggerRow {
  plan_name: string | null;
  hours_since_attempt: number;
}

interface DormantRow extends TriggerRow {
  days_since_signup: number;
}

interface TraitRow {
  user_id: string;
  email: string;
  nome: string | null;
  days_since_signup: number;
  workspace_count: number;
  any_free: boolean;
}

interface DeletionRow {
  id: string;
  synced_email: string;
}

export async function runLoopsSyncCron(
  deps: LoopsCronDeps,
): Promise<{ traitsSynced: number; eventsSent: number; contactsDeleted: number; failed: number }> {
  let traitsSynced = 0;
  let eventsSent = 0;
  let contactsDeleted = 0;
  const errors: Array<{ accountId?: string; error?: string }> = [];

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // --- Ordering is deliberate and encodes priority, do NOT "tidy" it back ---
  //
  // Trait sync is `limit 200` with no ledger exclusion (~2 round trips each),
  // the three trigger sweeps are up to 50 candidates each at ~4 round trips
  // each, and the deletion sweep is up to 50 more -- worst case is roughly a
  // thousand sequential awaits in one edge invocation, which can exceed the
  // wall clock. Whichever sweep runs last is the one a slow run silently
  // drops. So the sweeps are ordered by what is most costly to lose:
  //   1. Contact deletions FIRST -- these are consent revocations, an LGPD
  //      obligation. Losing one means a person who withdrew consent stays
  //      resident at a US vendor.
  //   2. Trigger sweeps SECOND -- these are the revenue path.
  //   3. Trait sync LAST -- pure enrichment. If the clock runs out, this is
  //      the right thing to drop: it self-heals next run because the RPC's
  //      ordering is least-recently-synced-first, so nothing is lost, only
  //      delayed.

  // --- Revocation ------------------------------------------------------------
  const delRes = await deps.rpc("get_loops_contact_deletions");
  if (delRes.error) {
    errors.push({ error: `contact deletions: ${delRes.error.message}` });
  } else {
    for (const d of (delRes.data ?? []) as DeletionRow[]) {
      try {
        await deps.deleteContact({ email: d.synced_email });
        await deps.markContactDeleted(d.id);
        contactsDeleted++;
      } catch (e) {
        errors.push({ accountId: d.id, error: msg(e) });
      }
    }
  }

  // --- Trigger sweeps ------------------------------------------------------
  const sweep = async <T extends TriggerRow>(
    rpcName: string,
    emailType: string,
    keyCol: "user_id" | "workspace_id",
    props: (row: T) => Record<string, unknown>,
  ) => {
    const res = await deps.rpc(rpcName);
    if (res.error) {
      errors.push({ error: `${rpcName}: ${res.error.message}` });
      return;
    }
    for (const c of (res.data ?? []) as T[]) {
      try {
        const won = await deps.claim(
          emailType,
          c.workspace_id,
          c.owner_user_id,
          c.attempts + 1,
        );
        // Claim refused. Either another type or another run already emailed
        // this workspace inside 72h, or the send-time re-check found the
        // workspace subscribed / consent revoked between the RPC's SELECT and
        // now. Both are correct outcomes, not failures. No ledger row was
        // written, so if the workspace becomes eligible again it qualifies
        // naturally on a later sweep.
        if (!won) continue;

        // The idempotency key MUST be scoped the same way the ledger row is
        // keyed, or a retry changes key and Loops stops deduping it.
        //
        // `dormant_signup` keys on user_id: it is an email about a PERSON, and
        // its ledger row's workspace_id moves when the reported workspace
        // changes. Concretely: U owns free W1 and W2. The claim writes
        // workspace_id=W1, sendEvent succeeds, markDelivered FAILS -- this
        // whole candidate iteration is caught below as a candidate error
        // (failed++, eventsSent NOT incremented for it), even though the email
        // already went out. W1 later gains a client and stops qualifying, so the
        // next sweep picks W2; the claim's 72h cap looks for workspace_id=W2,
        // does not see the W1 row, and passes. With a workspace-scoped key the
        // retry would carry `dormant_signup/W2`, Loops would NOT recognise it,
        // and the person gets a second email — bypassing both the cap and Loops
        // dedupe. A user-scoped key makes that retry a 409, which is success.
        //
        // The other two types key on workspace_id in the ledger and legitimately
        // send once per workspace, so their key stays workspace-scoped.
        const idKey = keyCol === "user_id"
          ? `${emailType}/${c.owner_user_id}`
          : `${emailType}/${c.workspace_id}`;

        await deps.sendEvent({
          email: c.owner_email,
          eventName: emailType,
          properties: { workspaceName: c.workspace_name, ...props(c) },
          idempotencyKey: idKey,
        });
        await deps.markDelivered(
          emailType,
          keyCol,
          keyCol === "user_id" ? c.owner_user_id : c.workspace_id,
        );
        // Measurement only: a capture failure must never fail an email.
        try {
          await deps.capture("lifecycle_email_triggered", {
            type: emailType,
            workspace_id: c.workspace_id,
            owner_user_id: c.owner_user_id,
          });
        } catch (e) {
          console.error("[loops-sync-cron] posthog capture failed:", msg(e));
        }
        eventsSent++;
      } catch (e) {
        errors.push({ accountId: c.workspace_id, error: msg(e) });
      }
    }
  };

  await sweep<PaywallRow>(
    "get_paywall_hit_candidates",
    "paywall_hit",
    "workspace_id",
    (r) => ({
      feature: r.feature,
      clickedUpgrade: r.clicked_upgrade,
      planName: r.plan_name,
      clientCount: r.client_count,
    }),
  );

  await sweep<AbandonedRow>(
    "get_abandoned_checkout_candidates",
    "checkout_abandoned",
    "workspace_id",
    (r) => ({ planName: r.plan_name, hoursSinceAttempt: r.hours_since_attempt }),
  );

  await sweep<DormantRow>(
    "get_dormant_signup_candidates",
    "dormant_signup",
    "user_id",
    (r) => ({ daysSinceSignup: r.days_since_signup }),
  );

  // --- Trait sync (last: pure enrichment, safe to lose to a timeout) --------
  const traitRes = await deps.rpc("get_loops_trait_candidates");
  if (traitRes.error) {
    errors.push({ error: `trait candidates: ${traitRes.error.message}` });
  } else {
    for (const c of (traitRes.data ?? []) as TraitRow[]) {
      try {
        // Person-level only. Workspace facts go in event properties: Loops keys
        // contacts by email and one person can own several workspaces, so a
        // workspace trait would be clobbered by whichever synced last.
        await deps.updateContact({
          email: c.email,
          traits: {
            firstName: firstNameFrom(c.nome),
            daysSinceSignup: c.days_since_signup,
            workspaceCount: c.workspace_count,
            anyFree: c.any_free,
          },
        });
        await deps.recordContactSync(c.user_id, c.email);
        traitsSynced++;
      } catch (e) {
        errors.push({ accountId: c.user_id, error: msg(e) });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`[loops-sync-cron] ${errors.length} failure(s)`, errors);
    await deps.report({ failed: errors.length, errors });
  }
  return { traitsSynced, eventsSent, contactsDeleted, failed: errors.length };
}
