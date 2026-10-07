import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { hashToken } from "../_shared/mcp-token.ts";
import { checkRateLimit, getClientIP } from "../_shared/rate-limit.ts";
import {
  classificarErroRpc,
  createAgendaFeedHandler,
  type FeedResultado,
  type OcorrenciaIcs,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(createAgendaFeedHandler({
  buildCorsHeaders,
  feedEventos: async (token: string): Promise<FeedResultado | null> => {
    const { data, error } = await db.rpc("agenda_feed_eventos", { p_token: token });
    if (error) throw new Error(`agenda_feed_eventos: ${error.message}`);
    return (data ?? null) as FeedResultado | null;
  },
  getUser: async (jwt: string) => {
    const { data, error } = await db.auth.getUser(jwt);
    if (error) {
      // A bad/expired token is the caller's problem (401); anything else is ours (500).
      if (error.status === 401 || error.status === 403) return null;
      throw new Error(`auth.getUser: ${error.message}`);
    }
    return data?.user ? { id: data.user.id } : null;
  },
  listarOcorrencia: async (jwt: string, id: number) => {
    // Anon key + the caller's JWT: RLS and auth.uid() inside agenda_listar apply.
    // Never the service-role client with this header, which would bypass both.
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error, status } = await client.rpc("agenda_listar", { p_ocorrencia_id: id });
    const erro = classificarErroRpc(status, error);
    if (erro) {
      if (erro === "outro") console.error("[agenda-feed] agenda_listar failed:", error?.message);
      return { erro };
    }
    return { rows: (data ?? []) as OcorrenciaIcs[] };
  },
  // deno-lint-ignore no-explicit-any
  rateLimit: (key, max, win) => checkRateLimit(db as any, key, max, win),
  hashToken,
  clientIP: getClientIP,
  now: () => new Date(),
}));
