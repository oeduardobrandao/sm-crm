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
      recordContactSync: async (userId, email) => {
        const { error } = await svc.from("loops_contacts").upsert(
          { user_id: userId, synced_email: email, synced_at: new Date().toISOString(), deleted_at: null },
          { onConflict: "user_id" },
        );
        if (error) throw new Error(`contact sync record failed: ${error.message}`);
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
      capture: (event, props) =>
        capturePostHog(event, String(props.workspace_id ?? "unknown"), props),
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
