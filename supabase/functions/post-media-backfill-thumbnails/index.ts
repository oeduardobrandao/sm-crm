import { createClient } from "npm:@supabase/supabase-js@2";
import { PutObjectCommand } from "npm:@aws-sdk/client-s3@3.637.0";
import { r2, R2_BUCKET, signGetUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { Jimp } from "npm:jimp@^1";
import { Buffer } from "node:buffer";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

const THUMB_SIZE = 128;
const BATCH_SIZE = 5;

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const secret = req.headers.get("x-cron-secret");
  if (!secret || !timingSafeEqual(secret, CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: rows } = await svc
    .from("post_media")
    .select("id, r2_key, mime_type, conta_id, post_id")
    .eq("kind", "image")
    .is("thumbnail_r2_key", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (!rows || rows.length === 0) return json({ processed: 0, message: "Nothing to backfill" });

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const downloadUrl = await signGetUrl(row.r2_key, 300);
      const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      const image = await Jimp.fromBuffer(buffer);
      const scale = Math.min(THUMB_SIZE / image.width, THUMB_SIZE / image.height, 1);
      image.resize({ w: Math.round(image.width * scale), h: Math.round(image.height * scale) });
      const thumbBuffer = await image.getBuffer("image/jpeg", { quality: 70 });

      const thumbKey = row.r2_key.replace(/\.[^.]+$/, ".thumb.jpg");
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: thumbKey,
        Body: thumbBuffer,
        ContentType: "image/jpeg",
      }));

      await svc
        .from("post_media")
        .update({ thumbnail_r2_key: thumbKey })
        .eq("id", row.id);

      processed++;
    } catch (e) {
      failed++;
      errors.push(`id=${row.id}: ${(e as Error).message}`);
    }
  }

  return json({ processed, failed, remaining: rows.length - processed, errors: errors.slice(0, 5) });
});
