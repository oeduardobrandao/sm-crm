import { createClient } from "npm:@supabase/supabase-js@2";
import { createPaywallReportHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service-role client + getUser(token) is the repo's user-token verification
// pattern; the anon client cannot verify these tokens.
const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
