import { createClient } from "npm:@supabase/supabase-js@2";
import { createPaywallReportHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service-role client + getUser(token) is the repo's user-token verification
// pattern; the anon client cannot verify these tokens.
//
// Bounded global fetch, same shape as loops-sync-cron/index.ts. Every call this
// client makes -- getUser, the workspace_members lookup, the paywall_hits
// insert -- is ours, so bounding the client rather than each call is the right
// scope here (unlike billing-checkout, where a client-wide wrapper would have
// caught unrelated pre-existing calls too). Unbounded, a stalled call hangs
// until the edge runtime kills the isolate, which BYPASSES catch: the handler
// never returns and the browser request never resolves.
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

Deno.serve(createPaywallReportHandler({
  getUser: async (token) => {
    const { data } = await svc.auth.getUser(token);
    return data?.user ? { id: data.user.id } : null;
  },
  isMember: async (userId, workspaceId) => {
    const { data, error } = await svc
      .from("workspace_members")
      .select("user_id")
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  },
  insertHit: async (row) => {
    const { error } = await svc.from("paywall_hits").insert(row);
    if (error) throw error;
  },
}));
