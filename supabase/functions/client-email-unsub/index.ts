import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { verifyUnsubTokenKind } from "../_shared/client-event-email.ts";
import { workspaceLang } from "../_shared/i18n/workspace-lang.ts";
import {
  type ClientEmailUnsubDb,
  createClientEmailUnsubHandler,
  createDescadastrarConvidado,
  type DescadastrarConvidadoDb,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ??
  (() => {
    throw new Error("TOKEN_ENCRYPTION_KEY is required");
  })();

// Bounded global fetch: a stalled PostgREST call would otherwise hang until
// the edge runtime kills the isolate, bypassing catch and cron-failure
// triage entirely (documented repo failure mode). A timeout surfaces as a
// normal throw instead.
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

Deno.serve(createClientEmailUnsubHandler({
  db: svc as unknown as ClientEmailUnsubDb,
  verifyToken: verifyUnsubTokenKind,
  descadastrarConvidado: createDescadastrarConvidado(svc as unknown as DescadastrarConvidadoDb),
  // Cliente or guest id -> its workspace -> language. Any failure is pt (workspaceLang never throws).
  targetLang: async (alvo) => {
    const table = alvo.tipo === "cliente" ? "clientes" : "agenda_convidados";
    const { data } = await svc.from(table).select("conta_id").eq("id", alvo.id).maybeSingle();
    const contaId = (data as { conta_id?: string } | null)?.conta_id;
    return contaId ? await workspaceLang(svc, contaId) : "pt";
  },
  tokenSecret: TOKEN_ENCRYPTION_KEY,
  now: () => new Date(),
  auditLog: (entry) => insertAuditLog(svc, entry),
  buildCorsHeaders,
}));
