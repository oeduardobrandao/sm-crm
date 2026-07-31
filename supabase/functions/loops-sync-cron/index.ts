import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { deleteContact, sendEvent, updateContact } from "../_shared/loops.ts";
import { capturePostHog } from "../_shared/posthog.ts";
import { type LoopsCronDeps, runLoopsSyncCron } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const CRON_NAME = "loops-sync-cron";

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Bounded global fetch: a stalled PostgREST call would otherwise hang until
  // the edge runtime kills the isolate, bypassing catch and cron-failure triage
  // entirely (documented repo failure mode).
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000),
        }),
    },
  });

  try {
    const deps: LoopsCronDeps = {
      rpc: (name) =>
        svc.rpc(name) as unknown as Promise<{ data: unknown; error: { message: string } | null }>,
      claim: async (emailType, workspaceId, userId, attempts) => {
        const { data, error } = await svc.rpc("claim_marketing_email", {
          p_email_type: emailType,
          p_workspace_id: workspaceId,
          p_user_id: userId,
          p_attempts: attempts,
        });
        if (error) throw new Error(`claim failed: ${error.message}`);
        return data === true;
      },
      markDelivered: async (emailType, keyCol, keyVal) => {
        const { error } = await svc
          .from("lifecycle_emails")
          .update({ delivered_at: new Date().toISOString() })
          .eq("email_type", emailType)
          .eq(keyCol, keyVal);
        // A failed update leaves an undelivered claim: the stale retry re-sends
        // with the same idempotency key and Loops dedupes. Log, don't throw.
        if (error) {
          console.error(
            `[${CRON_NAME}] delivered_at update failed for ${emailType}/${keyVal}:`,
            error.message,
          );
        }
      },
      // Goes through the RPC rather than a bare upsert: the pending-deletion
      // check and the write have to be one atomic decision, or a trigger sweep
      // can overwrite synced_email while a deletion for the OLD address is
      // still owed, stranding that address at Loops permanently. Returns false
      // when the caller must skip this person entirely -- see
      // record_loops_contact in 20260731000004_loops_sync_rpcs.sql.
      recordContactSync: async (userId, email) => {
        const { data, error } = await svc.rpc("record_loops_contact", {
          p_user_id: userId,
          p_email: email,
        });
        if (error) throw new Error(`contact sync record failed: ${error.message}`);
        return data === true;
      },
      markContactDeleted: async (id) => {
        const { error } = await svc
          .from("loops_contacts")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw new Error(`contact delete record failed: ${error.message}`);
      },
      sendEvent,
      updateContact,
      deleteContact,
      capture: (event, props) => {
        // distinct_id MUST be the person (owner_user_id), matching the frontend's
        // posthog.identify(userId, ...) in apps/crm/src/lib/analytics.ts. Keying
        // on workspace_id here would create a phantom per-workspace profile that
        // never joins to the frontend's person-keyed events, breaking the exact
        // trigger -> checkout_started -> subscription funnel this capture exists
        // for. The workspace still travels, but as a GROUP (via $groups), the
        // server-side equivalent of the frontend's posthog.group('workspace', ...).
        const ownerUserId = props.owner_user_id;
        if (typeof ownerUserId !== "string" || ownerUserId.length === 0) {
          // No safe distinct_id to key on. Skipping the capture is strictly
          // better than falling back to workspace_id and recreating the bug.
          return Promise.resolve();
        }
        return capturePostHog(event, ownerUserId, {
          ...props,
          $groups: { workspace: props.workspace_id },
        });
      },
      report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
    };

    const result = await runLoopsSyncCron(deps);
    return json({ success: true, ...result });
  } catch (e) {
    console.error(`[${CRON_NAME}] run failed:`, e instanceof Error ? e.message : String(e));
    await reportCronFailure(svc, CRON_NAME, {
      failed: 1,
      errors: [{ error: e instanceof Error ? e.message : String(e) }],
    });
    return json({ error: "Cron run failed" }, 500);
  }
});
