import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { makeBoundedFetch } from "../_shared/bounded-fetch.ts";
import {
  signPutUrl, signGetUrl, headObjectSigned, copyObjectSigned, trashObject,
} from "../_shared/r2.ts";
import { createEquipeChatMediaHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createEquipeChatMediaHandler({
  buildCorsHeaders,
  // Handler grava estado (copy/trash + RPC de quota): fetch com teto e
  // helpers R2 "signed" (o transport do aws-sdk trava no edge runtime).
  createDb: () =>
    createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: makeBoundedFetch() },
    }),
  signPutUrl,
  signGetUrl,
  headObject: headObjectSigned,
  copyObject: copyObjectSigned,
  trashObject,
}));
