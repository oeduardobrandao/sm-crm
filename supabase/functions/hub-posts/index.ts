import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl } from "../_shared/r2.ts";
import { signMediaUrl, isMediaProxyEnabled } from "../_shared/media-url.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createHubPostsHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const signUrl = isMediaProxyEnabled()
  ? (key: string) => signMediaUrl(key)
  : (key: string) => signGetUrl(key, 3600);

Deno.serve(createHubPostsHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  signGetUrl: signUrl,
}));
