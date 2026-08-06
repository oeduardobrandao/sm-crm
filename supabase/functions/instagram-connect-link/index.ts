import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { sendConnectLinkEmail } from "../_shared/instagram-connect-email.ts";
import { createSignedState } from "../instagram-integration/oauth-state.ts";
import { createConnectLinkHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_ID = Deno.env.get("META_APP_ID")!;

const svc = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

Deno.serve(
  createConnectLinkHandler({
    buildCorsHeaders,
    createDb: () => svc(),
    now: () => new Date().toISOString(),
    appBaseUrl,
    // Service-role client + getUser(token). Never the anon client: user JWTs are
    // ES256 and the anon client cannot verify them.
    verifyUser: async (bearer) => {
      const { data, error } = await svc().auth.getUser(bearer);
      if (error || !data.user) return null;
      return { id: data.user.id };
    },
    // auth.users.email via the Auth admin API -- profiles has no email column.
    // Null on any failure (deleted user, lookup error): the reply-to is best-effort,
    // never a reason to block the client email.
    getUserEmail: async (userId) => {
      try {
        const { data, error } = await svc().auth.admin.getUserById(userId);
        if (error) return null;
        return data?.user?.email ?? null;
      } catch {
        return null;
      }
    },
    // deno-lint-ignore no-explicit-any
    planFeature: (db, contaId, key) => effectivePlanFeature(db as any, contaId, key),
    // deno-lint-ignore no-explicit-any
    rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
    sendClientEmail: sendConnectLinkEmail,
    createSignedState: (clientId, userId, contaId, db, linkToken) =>
      createSignedState(clientId, userId, contaId, db, linkToken),
    metaAppId: () => META_APP_ID,
    metaRedirectUri: () =>
      Deno.env.get("META_REDIRECT_URI") ?? `${SUPABASE_URL}/functions/v1/instagram-integration`,
  }),
);
