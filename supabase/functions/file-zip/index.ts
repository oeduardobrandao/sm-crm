import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getObjectStreamSigned } from "../_shared/r2.ts";
import {
  buildZipStream,
  checkZipBudget,
  collectFileEntries,
  collectFolderEntries,
  type FileZipDeps,
  ZipBudgetExceededError,
  type ZipPlanEntry,
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
    getObjectStream: getObjectStreamSigned,
  };

  function jsonResponse(body: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Never surface the raw collect error to the client (security rule: no raw
  // error details out of an edge function) -- the JSON 500 below is returned
  // BEFORE any stream starts, which is also what fixes the old
  // silent-empty-zip failure mode (a thrown collect used to be indistinguishable
  // from "no files").
  async function collectEntriesOrRespond(
    collect: () => Promise<ZipPlanEntry[]>,
  ): Promise<{ entries: ZipPlanEntry[] } | { response: Response }> {
    try {
      return { entries: await collect() };
    } catch (err) {
      // Budget refusal during collection is the SAME contract as the
      // pre-stream checkZipBudget 413 below, just earlier: collection stops
      // one page past the cap instead of paging a huge folder into memory.
      if (err instanceof ZipBudgetExceededError) {
        return { response: jsonResponse({ error: err.message }, 413) };
      }
      console.error("[file-zip] Failed to collect entries", err);
      return { response: jsonResponse({ error: "Erro ao preparar o zip" }, 500) };
    }
  }

  function respondZip(entries: ZipPlanEntry[], filename: string, presetSkipped: string[] = []): Response {
    const budget = checkZipBudget(entries);
    if (!budget.ok) {
      return jsonResponse({ error: budget.error }, 413);
    }
    const readable = buildZipStream(deps, entries, presetSkipped);
    return new Response(readable, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  }

  if (payload.folder_id) {
    const folderId = payload.folder_id as number;
    const { data: folder } = await svc
      .from("folders")
      .select("name, conta_id")
      .eq("id", folderId)
      .single();
    if (!folder || folder.conta_id !== contaId) {
      return jsonResponse({ error: "Folder not found" }, 404);
    }

    let skippedPaths: string[] = [];
    const collected = await collectEntriesOrRespond(async () => {
      const result = await collectFolderEntries(deps, folderId);
      skippedPaths = result.skippedPaths;
      return result.entries;
    });
    if ("response" in collected) return collected.response;

    return respondZip(collected.entries, `${folder.name}.zip`, skippedPaths);
  } else if (payload.file_ids) {
    const fileIds = payload.file_ids as number[];

    const collected = await collectEntriesOrRespond(() => collectFileEntries(deps, fileIds));
    if ("response" in collected) return collected.response;

    return respondZip(collected.entries, "arquivos.zip");
  }

  return jsonResponse({ error: "Invalid token scope" }, 400);
});
