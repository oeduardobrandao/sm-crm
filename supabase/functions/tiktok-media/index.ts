// supabase/functions/tiktok-media/index.ts
//
// Env wiring only — business logic lives in handler.ts (mirrors tiktok-webhook/{index,handler}.ts's
// split). Public endpoint (config.toml: verify_jwt = false): the /m/{token} proxy route's token
// verification IS its auth, and the verify-file route is intentionally public (TikTok's own
// URL-prefix verification fetch carries no auth headers).

import { signGetUrl } from "../_shared/r2.ts";
import { verifyTikTokMediaToken } from "../_shared/tiktok-media-url.ts";
import { createTikTokMediaHandler } from "./handler.ts";

Deno.serve(createTikTokMediaHandler({
  verifyTikTokMediaToken,
  signGetUrl,
  urlVerifyFilename: Deno.env.get("TIKTOK_URL_VERIFY_FILENAME"),
  urlVerifyContent: Deno.env.get("TIKTOK_URL_VERIFY_CONTENT"),
}));
