import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createNurtureUnsubHandler, type NurtureUnsubDb } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NURTURE_UNSUB_SECRET = Deno.env.get("NURTURE_UNSUB_SECRET") ??
  (() => {
    throw new Error("NURTURE_UNSUB_SECRET is required");
  })();

// Bounded fetch: a stalled PostgREST call must surface as a normal throw.
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

Deno.serve(createNurtureUnsubHandler({
  db: svc as unknown as NurtureUnsubDb,
  tokenSecret: NURTURE_UNSUB_SECRET,
  now: () => new Date(),
  buildCorsHeaders,
}));
