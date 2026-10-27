import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIP } from "../_shared/rate-limit.ts";
import { createBlogViewHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Endpoint público: um banco lento não pode segurar a requisição indefinidamente. O timeout
// vira uma falha comum, que o handler engole e responde 204.
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
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

Deno.serve(createBlogViewHandler({
  buildCorsHeaders,
  db: svc,
  rateLimit: (key, max, windowSeconds) => checkRateLimit(svc, key, max, windowSeconds),
  getClientIP,
}));
