import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { sendViaResend } from "../_shared/lifecycle-emails.ts";
import { resolveHubUrl as resolveHubUrlImpl } from "../_shared/hub-url.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import {
  type AgendaClienteEmailDb,
  createAgendaClienteEmailHandler,
  runAgendaClienteEmail,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ??
  (() => {
    throw new Error("TOKEN_ENCRYPTION_KEY is required");
  })();

const CRON_NAME = "agenda-cliente-email";

Deno.serve(createAgendaClienteEmailHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (req: Request): Promise<Response> => {
    const cors = buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    // Bounded global fetch: a stalled PostgREST call would otherwise hang until
    // the edge runtime kills the isolate, bypassing catch and cron-failure triage.
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
      const result = await runAgendaClienteEmail({
        db: svc as unknown as AgendaClienteEmailDb,
        sendEmail: sendViaResend,
        resolveHubUrl: (clienteId, contaId) => resolveHubUrlImpl(svc, clienteId, contaId),
        tokenSecret: TOKEN_ENCRYPTION_KEY,
        unsubBaseUrl: SUPABASE_URL,
        now: () => Date.now(),
      });
      return json({ success: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[${CRON_NAME}] run failed:`, message);
      await reportCronFailure(svc, CRON_NAME, {
        failed: 1,
        errors: [{ error: message }],
      });
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
