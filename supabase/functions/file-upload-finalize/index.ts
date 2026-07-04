// supabase/functions/file-upload-finalize/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { headObject, signGetUrl } from "../_shared/r2.ts";
import { signMediaUrl, isMediaProxyEnabled } from "../_shared/media-url.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createDesignRenderTrigger } from "../_shared/design-render-trigger.ts";
import { createFileUploadFinalizeHandler } from "./handler.ts";

const signUrl = isMediaProxyEnabled()
  ? (key: string) => signMediaUrl(key)
  : (key: string) => signGetUrl(key, 900);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Optional on purpose — see instagram-publish/index.ts; without it the staleness mark still
// lands, only the immediate render kick is skipped.
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(createFileUploadFinalizeHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
  headObject,
  signUrl,
  triggerDesignRender: CRON_SECRET ? createDesignRenderTrigger(SUPABASE_URL, CRON_SECRET) : undefined,
  // deno-lint-ignore no-undef -- EdgeRuntime is a Supabase Edge Runtime global.
  waitUntil: (promise) => { EdgeRuntime.waitUntil(promise); },
}));
