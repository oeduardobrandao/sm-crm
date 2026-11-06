import { createClient } from "npm:@supabase/supabase-js@2";
import { getGoogleAccessToken, parseServiceAccount } from "../_shared/google-sa.ts";
import { createBlogSearchConsoleHandler } from "./handler.ts";
import { GSC_SCOPE } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

// Opcional, sem default: sem a chave o cron só registra e responde 200 (ver handler). A chave só
// é lida quando há token a buscar, então um JSON inválido falha a execução e passa pelo
// reportCronFailure em vez de derrubar o módulo no boot.
const GSC_SERVICE_ACCOUNT_JSON = Deno.env.get("GSC_SERVICE_ACCOUNT_JSON");
const GSC_SITE_URL = Deno.env.get("GSC_SITE_URL") ?? "sc-domain:mesaas.com.br";

// Um PostgREST parado não pode segurar o isolate até o runtime matá-lo (pularia o catch e o
// reportCronFailure). O timeout vira um throw comum.
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

Deno.serve(createBlogSearchConsoleHandler({
  db: svc,
  cronSecret: CRON_SECRET,
  getToken: GSC_SERVICE_ACCOUNT_JSON
    ? () => getGoogleAccessToken(parseServiceAccount(GSC_SERVICE_ACCOUNT_JSON), GSC_SCOPE)
    : null,
  fetch,
  now: () => new Date(),
  siteUrl: GSC_SITE_URL,
}));
