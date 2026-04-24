// supabase/functions/post-media-manage/index.ts
// Adapter: queries post_file_links + files, returns legacy PostMedia-shaped records.
// link.id serves as the legacy "media ID".
import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl, signPutUrl } from "../_shared/r2.ts";
import { signMediaUrl, isMediaProxyEnabled } from "../_shared/media-url.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createPostMediaManageHandler } from "./handler.ts";

const signUrl = isMediaProxyEnabled()
  ? (key: string) => signMediaUrl(key)
  : (key: string) => signGetUrl(key, 900);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createPostMediaManageHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
  signUrl,
  signPutUrl,
}));
