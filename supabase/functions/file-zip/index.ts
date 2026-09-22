import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getObject } from "../_shared/r2.ts";
import {
  buildZipStream,
  collectFileEntries,
  collectFolderEntries,
  type FileZipDeps,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZIP_TOKEN_SECRET = Deno.env.get("ZIP_TOKEN_SECRET");

if (!ZIP_TOKEN_SECRET) throw new Error("ZIP_TOKEN_SECRET is required");

async function verifyZipToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload: payloadStr, sig: sigHex } = JSON.parse(atob(token));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(ZIP_TOKEN_SECRET!),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(payloadStr));
    if (!valid) return null;
    const payload = JSON.parse(payloadStr);
    if (payload.expires_at && new Date(payload.expires_at) < new Date()) return null;
    return payload;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await verifyZipToken(token);
  if (!payload) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const contaId = payload.conta_id as string;
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const deps: FileZipDeps = {
    db: svc,
    contaId,
    getObjectStream: getObject,
  };

  if (payload.folder_id) {
    const folderId = payload.folder_id as number;
    const { data: folder } = await svc
      .from("folders")
      .select("name, conta_id")
      .eq("id", folderId)
      .single();
    if (!folder || folder.conta_id !== contaId) {
      return new Response(JSON.stringify({ error: "Folder not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const entries = await collectFolderEntries(deps, folderId);
    const zipFilename = `${folder.name}.zip`;
    const readable = buildZipStream(deps, entries);

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(zipFilename)}"`,
      },
    });
  } else if (payload.file_ids) {
    const fileIds = payload.file_ids as number[];
    const entries = await collectFileEntries(deps, fileIds);
    const readable = buildZipStream(deps, entries);

    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="arquivos.zip"`,
      },
    });
  }

  return new Response(JSON.stringify({ error: "Invalid token scope" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
