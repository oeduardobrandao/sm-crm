// billing-downgrade-cron: three independent legs, run daily.
//
//   A. Paid-through downgrade -- Pagar.me rows that canceled with cancel_at_period_end=true
//      and whose current_period_end has now passed get their default plan granted and the
//      flag flipped so the row leaves this query. Always runs (no gateway needed).
//   B. Stale checkout attempts -- global backstop for pagarme-checkout's own per-workspace
//      self-heal (handler.ts:119-139): any pending attempt older than STALE_ATTEMPT_MINUTES
//      is expired, but only after its recorded subscription is confirmed either not bound
//      locally (settled cancel) or reconciled as bound (finishAttempt("succeeded") is
//      best-effort, so a fully-bound checkout can still leave its attempt pending).
//   C. Remote orphan sweep -- the hard precondition for the production flip. Lists every
//      active/future Pagar.me subscription and cancels the ones our checkout created but
//      never bound to a local row. FETCH-THEN-CANCEL: the full candidate list is collected
//      before any cancel happens, because Pagar.me's page-number pagination would silently
//      skip unseen items if we canceled while paging.
//
// Per-item failures are pushed into `errors` and the loop continues -- one bad row must not
// starve the rest. Each leg also wraps its own body so a leg-level crash lands in `errors`
// and the remaining legs still run.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getDefaultPlanId } from "../_shared/billing-logic.ts";
import {
  isDefinitiveGatewayReject,
  shouldSweepRemoteSubscription,
} from "../_shared/pagarme-logic.ts";
import {
  isStripeNotFoundError,
  readStripeSubSnapshot,
  type StripeSwitchGateway,
} from "../_shared/stripe-switch.ts";
import type { DowngradeCronGateway, RemoteSubListItem } from "./gateway.ts";

const DB_TIMEOUT_MS = 10_000;
const BATCH_LIMIT = 100;
const STALE_ATTEMPT_MINUTES = 15;
const SWEEP_PAGE_SIZE = 50;
const SWEEP_MAX_PAGES = 20;
const SWITCH_BATCH_LIMIT = 100;
const SWITCH_MAX_PAGES = 20;

export interface DowngradeCronDeps {
  db: SupabaseClient;
  gateway: DowngradeCronGateway | null;
  stripeGateway: StripeSwitchGateway | null;
  now?: () => Date;
}

export interface CronResult {
  downgraded: number;
  attemptsExpired: number;
  attemptsReconciled: number;
  orphansCanceled: number;
  orphansUnrecognized: number;
  sweepTruncated: boolean;
  remoteSkipped: boolean;
  switchesEnforced: number;
  switchesCleared: number;
  switchesCanceledNow: number;
  switchSkipped: boolean;
  switchSweepTruncated: boolean;
  errors: string[];
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runBillingDowngradeCron(deps: DowngradeCronDeps): Promise<CronResult> {
  const now = deps.now ?? (() => new Date());
  const nowIso = now().toISOString();

  const errors: string[] = [];
  let downgraded = 0;
  let attemptsExpired = 0;
  let attemptsReconciled = 0;
  let orphansCanceled = 0;
  let orphansUnrecognized = 0;
  let sweepTruncated = false;
  let remoteSkipped = false;
  let switchesEnforced = 0;
  let switchesCleared = 0;
  let switchesCanceledNow = 0;
  let switchSkipped = false;
  let switchSweepTruncated = false;

  // ── Leg A: paid-through downgrade ─────────────────────────────────────────
  async function runLegA(): Promise<void> {
    try {
      const { data: due, error: dueErr } = await deps.db
        .from("workspace_subscriptions")
        .select("workspace_id, pagarme_subscription_id")
        .eq("provider", "pagarme")
        .eq("status", "canceled")
        .eq("cancel_at_period_end", true)
        .not("pagarme_subscription_id", "is", null)
        .lte("current_period_end", nowIso)
        .order("current_period_end", { ascending: true })
        .limit(BATCH_LIMIT)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (dueErr) throw new Error(`due rows read failed: ${dueErr.message}`);

      const rows = (due ?? []) as Array<
        { workspace_id: string; pagarme_subscription_id: string | null }
      >;
      if (rows.length === BATCH_LIMIT) {
        console.warn(
          `[billing-downgrade-cron] leg A: batch full at ${BATCH_LIMIT} rows; backlog drains across daily runs`,
        );
      }

      const defaultPlanId = await getDefaultPlanId(deps.db);

      for (const row of rows) {
        try {
          const { data: written, error: rpcErr } = await deps.db
            .rpc("grant_pagarme_plan", {
              p_workspace: row.workspace_id,
              p_plan: defaultPlanId,
              p_sub: row.pagarme_subscription_id,
              p_status: "canceled",
            })
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          if (rpcErr) {
            errors.push(
              `leg A grant failed for workspace ${row.workspace_id}: ${rpcErr.message}`,
            );
            continue; // ORDER MATTERS: no flip when the grant itself errored.
          }
          if (written === 1) {
            downgraded++;
          } else {
            console.warn(
              `[billing-downgrade-cron] leg A: grant wrote 0 rows for workspace ${row.workspace_id} (concurrent rebind or manual comp)`,
            );
          }

          // Grant succeeded (written 1 or 0, no error): flip the flag so the row leaves this
          // query. A manual comp's episode is over and the comp stays preserved; a
          // concurrently-changed row's own CAS pins make this a natural zero-row no-op.
          const { error: flipErr } = await deps.db
            .from("workspace_subscriptions")
            .update({ cancel_at_period_end: false, updated_at: nowIso })
            .eq("workspace_id", row.workspace_id)
            .eq("provider", "pagarme")
            .eq("pagarme_subscription_id", row.pagarme_subscription_id)
            .eq("status", "canceled")
            .eq("cancel_at_period_end", true)
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          if (flipErr) {
            errors.push(
              `leg A flag flip failed for workspace ${row.workspace_id}: ${flipErr.message}`,
            );
          }
          // Zero rows on the flip: the row moved under us; next run re-evaluates, and the
          // grant is idempotent. Silent continue.
        } catch (e) {
          errors.push(`leg A row failed for workspace ${row.workspace_id}: ${errMessage(e)}`);
        }
      }
    } catch (e) {
      errors.push(`leg A failed: ${errMessage(e)}`);
    }
  }

  // ── Leg B: stale checkout attempts (global backstop) ──────────────────────
  async function runLegB(): Promise<void> {
    try {
      const staleBefore = new Date(now().getTime() - STALE_ATTEMPT_MINUTES * 60_000)
        .toISOString();
      const { data: stale, error: staleErr } = await deps.db
        .from("pagarme_checkout_attempts")
        .select("id, workspace_id, pagarme_subscription_id")
        .eq("state", "pending")
        .lt("created_at", staleBefore)
        .order("created_at", { ascending: true })
        .limit(BATCH_LIMIT)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (staleErr) throw new Error(`stale attempts read failed: ${staleErr.message}`);

      const attempts = (stale ?? []) as Array<
        { id: string; workspace_id: string; pagarme_subscription_id: string | null }
      >;
      if (attempts.length === BATCH_LIMIT) {
        console.warn(
          `[billing-downgrade-cron] leg B: batch full at ${BATCH_LIMIT} rows; backlog drains across daily runs`,
        );
      }

      // BOUND-SUBSCRIPTION GUARD (load-bearing): a pending attempt with a sub id is NOT proof
      // of an orphan -- the checkout's finishAttempt("succeeded") is best-effort, so a
      // checkout that fully bound the subscription locally can still leave its attempt
      // pending. The checkout's own self-heal is protected by its 409 in-force gate running
      // before it; this cron has no such gate and would otherwise cancel a PAID, BOUND
      // subscription. Read the linked picture BEFORE touching anything; a read error aborts
      // ALL of leg B into the outer catch (fail closed, same rule as leg C's local reads).
      const subIds = attempts
        .map((a) => a.pagarme_subscription_id)
        .filter((id): id is string => !!id);
      const linkedSubIds = new Set<string>();
      if (subIds.length > 0) {
        const { data: linked, error: linkedErr } = await deps.db
          .from("workspace_subscriptions")
          .select("pagarme_subscription_id", { count: "exact" })
          .in("pagarme_subscription_id", subIds)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
        if (linkedErr) throw new Error(`leg B linked read failed: ${linkedErr.message}`);
        for (
          const row of (linked ?? []) as Array<{ pagarme_subscription_id: string | null }>
        ) {
          if (row.pagarme_subscription_id) linkedSubIds.add(row.pagarme_subscription_id);
        }
      }

      for (const a of attempts) {
        try {
          if (a.pagarme_subscription_id) {
            if (linkedSubIds.has(a.pagarme_subscription_id)) {
              // The checkout actually succeeded and bound the row locally; only the
              // attempt's own state write never landed. Reconcile it -- never call the
              // gateway on a subscription that is paid and bound.
              const { error: reconcileErr } = await deps.db
                .from("pagarme_checkout_attempts")
                .update({ state: "succeeded", updated_at: nowIso })
                .eq("id", a.id)
                .eq("state", "pending")
                .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
              if (reconcileErr) {
                errors.push(
                  `leg B reconcile failed for attempt ${a.id}: ${reconcileErr.message}`,
                );
                continue;
              }
              attemptsReconciled++;
              continue;
            }

            if (deps.gateway === null) {
              // Dark env: nothing here can confirm the remote state. Leave pending for the
              // env that can check.
              continue;
            }
            try {
              await deps.gateway.cancelSubscription(a.pagarme_subscription_id);
              // Settled (canceled just now): fall through to expiry below.
            } catch (e) {
              if (!isDefinitiveGatewayReject(e)) {
                // Never release a reservation while the remote subscription may still be
                // live (same rule as pagarme-checkout/handler.ts:119-139).
                errors.push(
                  `leg B cancel failed for attempt ${a.id}: ${errMessage(e)}`,
                );
                continue;
              }
              // Definitive reject: already gone. Settled, fall through to expiry.
            }
          }

          const { error: expireErr } = await deps.db
            .from("pagarme_checkout_attempts")
            .update({ state: "expired", updated_at: nowIso })
            .eq("id", a.id)
            .eq("state", "pending")
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          if (expireErr) {
            errors.push(`leg B expiry failed for attempt ${a.id}: ${expireErr.message}`);
            continue;
          }
          attemptsExpired++;
        } catch (e) {
          errors.push(`leg B attempt ${a.id} failed: ${errMessage(e)}`);
        }
      }
    } catch (e) {
      errors.push(`leg B failed: ${errMessage(e)}`);
    }
  }

  // ── Leg C: remote orphan sweep (flip precondition; needs a gateway) ───────
  async function runLegC(): Promise<void> {
    if (deps.gateway === null) {
      remoteSkipped = true;
      console.warn("[billing-downgrade-cron] PAGARME_SECRET_KEY unset; remote legs skipped");
      return;
    }
    const gateway = deps.gateway;

    try {
      // Both reads are LOAD-BEARING: a failed read that silently became an empty set would
      // make every remote subscription look unlinked and the sweep would cancel live, paid
      // subscriptions. MUST throw on error so the whole leg aborts into the catch below.
      // `{ count: "exact" }` + a length check also guards the read PostgREST itself performs
      // silently: an unbounded select truncates at db-max-rows (1000 on hosted Supabase),
      // which is not an error and would otherwise make bound, paid subscriptions look
      // orphaned. Truncation must be detected by count and treated as a failure too.
      const { data: linked, error: linkedErr, count: linkedCount } = await deps.db
        .from("workspace_subscriptions")
        .select("pagarme_subscription_id", { count: "exact" })
        .not("pagarme_subscription_id", "is", null)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (linkedErr) throw new Error(`sweep linked read failed: ${linkedErr.message}`);
      if (linkedCount !== null && (linked ?? []).length !== linkedCount) {
        throw new Error(
          `sweep linked read truncated: got ${(linked ?? []).length} of ${linkedCount}`,
        );
      }

      const { data: pendingAttempts, error: pendingErr, count: pendingCount } = await deps.db
        .from("pagarme_checkout_attempts")
        .select("pagarme_subscription_id", { count: "exact" })
        .eq("state", "pending")
        .not("pagarme_subscription_id", "is", null)
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (pendingErr) throw new Error(`sweep pending read failed: ${pendingErr.message}`);
      if (pendingCount !== null && (pendingAttempts ?? []).length !== pendingCount) {
        throw new Error(
          `sweep pending read truncated: got ${(pendingAttempts ?? []).length} of ${pendingCount}`,
        );
      }

      const linkedIds = new Set<string>(
        ((linked ?? []) as Array<{ pagarme_subscription_id: string | null }>)
          .map((r) => r.pagarme_subscription_id)
          .filter((x): x is string => !!x),
      );
      const pendingIds = new Set<string>(
        ((pendingAttempts ?? []) as Array<{ pagarme_subscription_id: string | null }>)
          .map((r) => r.pagarme_subscription_id)
          .filter((x): x is string => !!x),
      );

      // FETCH-THEN-CANCEL: collect the full candidate list for both statuses before any
      // cancel happens. Pagar.me's pagination is page-number based, so canceling while
      // paging would shift unseen items into already-visited pages and silently skip them.
      const candidates: RemoteSubListItem[] = [];
      for (const status of ["active", "future"] as const) {
        try {
          let page = 1;
          while (true) {
            const { data, paging } = await gateway.listSubscriptions(status, page, SWEEP_PAGE_SIZE);
            candidates.push(...data);
            const shortPage = data.length < SWEEP_PAGE_SIZE;
            const reachedTotalPages = paging?.total_pages !== undefined &&
              page >= paging.total_pages;
            if (shortPage || reachedTotalPages) break;
            page++;
            if (page > SWEEP_MAX_PAGES) {
              if (!sweepTruncated) errors.push("sweep truncated at SWEEP_MAX_PAGES pages");
              sweepTruncated = true;
              console.warn(
                `[billing-downgrade-cron] sweep truncated at ${SWEEP_MAX_PAGES} pages for status ${status}`,
              );
              break;
            }
          }
        } catch (e) {
          errors.push(`leg C list failed for status ${status}: ${errMessage(e)}`);
          // Only the failing page is dropped: any pages already fetched for this status
          // stayed in `candidates` (pushed before the failure) and are still processed below.
          // Continue with the next status rather than aborting the whole leg over one page.
        }
      }

      for (const sub of candidates) {
        const verdict = shouldSweepRemoteSubscription(sub, linkedIds, pendingIds, now());
        if (verdict === "cancel") {
          console.error(
            "[billing-downgrade-cron] CRITICAL orphan subscription: canceling",
            sub.id,
            "workspace",
            sub.metadata?.workspace_id,
          );
          try {
            await gateway.cancelSubscription(sub.id);
            orphansCanceled++;
          } catch (e) {
            if (isDefinitiveGatewayReject(e)) {
              orphansCanceled++;
            } else {
              errors.push(`leg C cancel failed for subscription ${sub.id}: ${errMessage(e)}`);
            }
          }
        } else if (verdict === "skip_unrecognized") {
          orphansUnrecognized++;
          console.warn(
            "[billing-downgrade-cron] unrecognized subscription in our account, never touched:",
            sub.id,
          );
        }
      }
    } catch (e) {
      errors.push(`leg C failed: ${errMessage(e)}`);
    }
  }

  // ── Leg D: switch enforcement (spec 2026-08-14) ────────────────────────
  // Fair rotation by switch_checked_at: markers persist for the whole switch window (up to
  // ~31d), so a fixed limit or a keyset on the smallest workspace_id would starve the tail
  // forever (unlike leg C, whose candidate set shrinks because orphans get removed). With
  // runStartedAt plus a per-row stamp, each workspace appears at most ONCE within a run (the
  // stamp removes the row from the predicate), and across runs the queue resumes from the
  // oldest unchecked marker.
  async function runLegD(): Promise<void> {
    if (deps.stripeGateway === null) {
      switchSkipped = true;
      console.warn("[billing-downgrade-cron] STRIPE_SECRET_KEY unset; leg D skipped");
      return;
    }
    const stripeGateway = deps.stripeGateway;
    try {
      const runStartedAt = now().toISOString();
      let pages = 0;
      while (true) {
        const { data: batch, error: batchErr } = await deps.db
          .from("workspace_subscriptions")
          .select(
            "workspace_id, provider, status, current_period_end, switched_from_stripe_subscription_id, switched_from_plan_id, pagarme_subscription_id, switch_checked_at",
          )
          .not("switched_from_stripe_subscription_id", "is", null)
          .or(`switch_checked_at.is.null,switch_checked_at.lt.${runStartedAt}`)
          .order("switch_checked_at", { ascending: true, nullsFirst: true })
          .order("workspace_id", { ascending: true })
          .limit(SWITCH_BATCH_LIMIT)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
        if (batchErr) throw new Error(`leg D batch read failed: ${batchErr.message}`);
        const rows = (batch ?? []) as Array<Record<string, unknown>>;
        if (rows.length === 0) break;
        pages++;

        for (const row of rows) {
          const wsId = row.workspace_id as string;
          const marker = row.switched_from_stripe_subscription_id as string;
          // Stamp FIRST: guarantees queue progress even when row processing fails. A stamp
          // that fails ABORTS the whole leg (rethrow): without it, the same row would come
          // back in the next batch of this run in an infinite loop.
          const { error: stampErr } = await deps.db
            .from("workspace_subscriptions")
            .update({ switch_checked_at: new Date().toISOString() })
            .eq("workspace_id", wsId)
            .not("switched_from_stripe_subscription_id", "is", null)
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          if (stampErr) throw new Error(`leg D stamp failed for ${wsId}: ${stampErr.message}`);

          try {
            let remote: unknown | null = null;
            let notFound = false;
            try {
              remote = await stripeGateway.retrieveSubscription(marker);
            } catch (e) {
              if (isStripeNotFoundError(e)) {
                notFound = true; // sub no longer exists: safe
              } else {
                errors.push(`leg D retrieve failed for workspace ${wsId}: ${errMessage(e)}`);
                continue;
              }
            }
            const snap = notFound ? null : readStripeSubSnapshot(remote);
            let safe = snap === null ||
              snap.status === "canceled" ||
              snap.status === "incomplete_expired" ||
              snap.cancelAtPeriodEnd;

            if (!safe) {
              const boundaryMs = typeof row.current_period_end === "string"
                ? Date.parse(row.current_period_end)
                : NaN;
              const windowOpen = row.provider === "pagarme" && row.status === "trialing";
              const renewalFired = Number.isFinite(boundaryMs) &&
                snap!.periodEndMs !== null && snap!.periodEndMs > boundaryMs;
              if (windowOpen && !renewalFired) {
                await stripeGateway.setCancelAtPeriodEnd(marker, true);
                switchesEnforced++;
                // Re-read post-write: the undo may have raced this and cleared the marker;
                // in that case the monthly plan was REACTIVATED on purpose, revert the true.
                const { data: recheck, error: recheckErr } = await deps.db
                  .from("workspace_subscriptions")
                  .select("switched_from_stripe_subscription_id")
                  .eq("workspace_id", wsId)
                  .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
                  .maybeSingle();
                if (recheckErr) {
                  errors.push(`leg D recheck failed for workspace ${wsId}: ${recheckErr.message}`);
                  continue;
                }
                if (!recheck?.switched_from_stripe_subscription_id) {
                  await stripeGateway.setCancelAtPeriodEnd(marker, false);
                  switchesEnforced--;
                }
                continue; // window open: markers stay (undo/frontend rely on them)
              }
              // Renewal escaped or the window closed with the monthly still armed:
              // cancel_at_period_end=true would now wait a whole extra month, so cancel NOW
              // and flag the manual refund.
              console.error(
                `[billing-downgrade-cron] CRITICAL: leg D canceling stripe sub ${marker} NOW for workspace ${wsId} (renewal escaped or window closed); check for a renewal charge to refund manually`,
              );
              await stripeGateway.cancelNow(marker);
              switchesCanceledNow++;
              safe = true;
            }

            // Clear only when safe AND outside the window (trialing still needs the markers).
            if (safe && row.status !== "trialing") {
              const { error: clearErr } = await deps.db
                .from("workspace_subscriptions")
                .update({
                  switched_from_stripe_subscription_id: null,
                  switched_from_plan_id: null,
                  updated_at: nowIso,
                })
                .eq("workspace_id", wsId)
                .eq("switched_from_stripe_subscription_id", marker)
                .neq("status", "trialing")
                .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
              if (clearErr) {
                errors.push(`leg D clear failed for workspace ${wsId}: ${clearErr.message}`);
                continue;
              }
              switchesCleared++;
            }
          } catch (e) {
            errors.push(`leg D row failed for workspace ${wsId}: ${errMessage(e)}`);
          }
        }

        if (pages >= SWITCH_MAX_PAGES) {
          switchSweepTruncated = true;
          errors.push("leg D truncated at SWITCH_MAX_PAGES pages");
          break;
        }
      }
    } catch (e) {
      errors.push(`leg D failed: ${errMessage(e)}`);
    }
  }

  await runLegA();
  await runLegB();
  await runLegC();
  await runLegD();

  return {
    downgraded,
    attemptsExpired,
    attemptsReconciled,
    orphansCanceled,
    orphansUnrecognized,
    sweepTruncated,
    remoteSkipped,
    switchesEnforced,
    switchesCleared,
    switchesCanceledNow,
    switchSkipped,
    switchSweepTruncated,
    errors,
  };
}

// ─── Auth wrapper (mention-email-cron's shape) ───────────────────────────────

interface DowngradeCronHandlerDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createBillingDowngradeCronHandler(deps: DowngradeCronHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
