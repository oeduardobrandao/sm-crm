import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import {
  createProfile,
  deleteProfile,
  getProfile,
  saveData,
  saveProfile,
} from "../_shared/crisp.ts";
import { type CrispCronDeps, runCrispSyncCron } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

// Validated HERE, at module load, not lazily inside the client. A missing
// secret would otherwise fail per-candidate only AFTER record_crisp_contact has
// already written the ledger row -- recording a sync that never reached the
// vendor. Failing the whole invocation keeps every candidate retryable once the
// secret is actually set.
for (const name of ["CRISP_WEBSITE_ID", "CRISP_IDENTIFIER", "CRISP_KEY"]) {
  if (!Deno.env.get(name)) throw new Error(`${name} is required`);
}

// APP_BASE_URL is deliberately NOT required: admin_url is a convenience field,
// and appBaseUrl() throws by design. A missing base must degrade to an omitted
// link, never to a dead cron.
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? null;

const CRON_NAME = "crisp-sync-cron";

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
    const deps: CrispCronDeps = {
      rpc: (name) =>
        svc.rpc(name) as unknown as Promise<
          { data: unknown; error: { message: string } | null }
        >,
      recordContact: async (userId, email) => {
        const { data, error } = await svc.rpc("record_crisp_contact", {
          p_user_id: userId,
          p_email: email,
        });
        if (error) throw new Error(`contact record failed: ${error.message}`);
        return data === true;
      },
      // Returns false when the RPC matched no row, i.e. the deletion sweep
      // swept this person while our vendor call was in flight. The handler
      // deletes the orphaned profile on false; do NOT collapse this to void.
      confirmSync: async (userId, peopleId, fingerprint) => {
        const { data, error } = await svc.rpc("confirm_crisp_sync", {
          p_user_id: userId,
          p_people_id: peopleId,
          p_fingerprint: fingerprint,
        });
        if (error) throw new Error(`sync confirm failed: ${error.message}`);
        return data === true;
      },
      markContactDeleted: async (id) => {
        // synced_people_id is nulled in the SAME update. On an email change the
        // ledger row is reused by the next upsert, and a retained id would
        // address the profile that was just deleted.
        const { error } = await svc
          .from("crisp_contacts")
          .update({ deleted_at: new Date().toISOString(), synced_people_id: null })
          .eq("id", id);
        if (error) throw new Error(`contact delete record failed: ${error.message}`);
      },
      getProfile,
      createProfile,
      saveProfile,
      saveData,
      deleteProfile,
      adminUrlFor: (workspaceId) =>
        APP_BASE_URL && workspaceId
          ? `${APP_BASE_URL.replace(/\/+$/, "")}/admin/workspaces/${workspaceId}`
          : null,
      report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
    };

    const result = await runCrispSyncCron(deps);
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
