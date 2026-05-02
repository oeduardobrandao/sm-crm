import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { getObject } from "../_shared/r2.ts";
import { ZipWriter, BlobReader } from "npm:@zip.js/zip.js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZIP_TOKEN_SECRET = Deno.env.get("ZIP_TOKEN_SECRET");

if (!ZIP_TOKEN_SECRET) throw new Error("ZIP_TOKEN_SECRET is required");

async function verifyZipToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload: payloadStr, sig: sigHex } = JSON.parse(atob(token));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(ZIP_TOKEN_SECRET!), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
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

  interface ZipEntry {
    name: string;
    r2Key: string;
    path: string;
  }
  const entries: ZipEntry[] = [];

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

    async function walkFolder(fId: number, pathPrefix: string) {
      const { data: files } = await svc
        .from("files")
        .select("name, r2_key")
        .eq("folder_id", fId)
        .eq("conta_id", contaId);
      for (const f of files ?? []) {
        entries.push({ name: f.name, r2Key: f.r2_key, path: pathPrefix + f.name });
      }
      const { data: subs } = await svc
        .from("folders")
        .select("id, name")
        .eq("parent_id", fId)
        .eq("conta_id", contaId);
      for (const sub of subs ?? []) {
        await walkFolder(sub.id, pathPrefix + sub.name + "/");
      }
    }
    await walkFolder(folderId, "");

    const zipFilename = `${folder.name}.zip`;
    const { readable, writable } = new TransformStream();
    const zipWriter = new ZipWriter(writable);

    (async () => {
      for (const entry of entries) {
        try {
          const stream = await getObject(entry.r2Key);
          if (!stream) {
            console.error(`[file-zip] Skipped missing object: ${entry.r2Key}`);
            continue;
          }
          const blob = await new Response(stream).blob();
          await zipWriter.add(entry.path, new BlobReader(blob));
        } catch (err) {
          console.error(`[file-zip] Skipped failed object: ${entry.r2Key}`, err);
        }
      }
      await zipWriter.close();
    })();

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
    const { data: files } = await svc
      .from("files")
      .select("name, r2_key, conta_id")
      .eq("conta_id", contaId)
      .in("id", fileIds);

    const { readable, writable } = new TransformStream();
    const zipWriter = new ZipWriter(writable);

    (async () => {
      for (const f of files ?? []) {
        try {
          const stream = await getObject(f.r2_key);
          if (!stream) continue;
          const blob = await new Response(stream).blob();
          await zipWriter.add(f.name, new BlobReader(blob));
        } catch (err) {
          console.error(`[file-zip] Skipped: ${f.r2_key}`, err);
        }
      }
      await zipWriter.close();
    })();

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
