import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { capturePostHog } from "../_shared/posthog.ts";
import { createHubBootstrapHandler } from "./handler.ts";
import { makeTouchToken, TOUCH_TIMEOUT_MS } from "./touch.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same contract as touchToken: bounded by an AbortSignal, never throws, never
// logs the session hash (a lookup credential).
async function touchSession(sessionHash: string): Promise<void> {
  try {
    const { error } = await createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
      .rpc("hub_session_touch", { p_session_hash: sessionHash })
      .abortSignal(AbortSignal.timeout(TOUCH_TIMEOUT_MS));
    if (error) {
      console.error("[hub-bootstrap:touch] hub_session_touch RPC returned an error:", error.message ?? error);
    }
  } catch (err) {
    console.error("[hub-bootstrap:touch] hub_session_touch threw:", (err as Error)?.message ?? err);
  }
}

Deno.serve(createHubBootstrapHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  touchToken: makeTouchToken(() => createClient(SUPABASE_URL, SERVICE_ROLE_KEY)),
  touchSession,
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
  // The Hub has no analytics SDK, so the paused page is measured here. Distinct id
  // is the workspace (agency) id; nothing about the client or the person viewing.
  trackPaused: (contaId) => {
    EdgeRuntime.waitUntil(
      capturePostHog("hub_paused_viewed", contaId, {
        $groups: { workspace: contaId },
        $process_person_profile: false,
      }).catch(() => {}),
    );
  },
}));
