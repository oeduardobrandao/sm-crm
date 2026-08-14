interface Env {
  SRC: R2Bucket;
  DST: R2Bucket;
  BACKUP_TRIGGER_SECRET?: string;
}

// Copy at most this many new objects per invocation; the daily upload volume is
// well under this, and a backlog simply drains across invocations.
const MAX_COPIES_PER_RUN = 400;

async function listAllKeys(bucket: R2Bucket, into: Set<string>): Promise<void> {
  let cursor: string | undefined;
  do {
    const page: R2Objects = await bucket.list({ cursor, limit: 1000 });
    for (const obj of page.objects) into.add(obj.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function runSync(env: Env, maxCopies = MAX_COPIES_PER_RUN): Promise<{ srcObjects: number; copied: number; pending: number; errors: number }> {
  const src = new Set<string>();
  const dst = new Set<string>();
  await listAllKeys(env.SRC, src);
  await listAllKeys(env.DST, dst);

  const missing: string[] = [];
  for (const key of src) {
    // trash/ holds soft-deleted objects awaiting purge — not part of the archive.
    if (key.startsWith("trash/")) continue;
    if (!dst.has(key)) missing.push(key);
  }

  let copied = 0;
  let errors = 0;
  for (const key of missing.slice(0, maxCopies)) {
    try {
      const obj = await env.SRC.get(key);
      if (!obj) continue; // raced with a delete; next run reconciles
      await env.DST.put(key, obj.body, {
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
      });
      copied++;
    } catch (e) {
      errors++;
      console.error("media-backup:copy", key, String(e).slice(0, 120));
    }
  }
  const pending = Math.max(0, missing.length - copied);
  console.log(JSON.stringify({ srcObjects: src.size, copied, pending, errors }));
  return { srcObjects: src.size, copied, pending, errors };
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSync(env));
  },

  // Manual endpoints, gated by a shared secret ("x-backup-secret" header):
  //   POST /sync   -> kicks a sync in the background (waitUntil), returns 202.
  //   GET  /status -> object counts in both buckets (source count excludes trash/).
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const secret = env.BACKUP_TRIGGER_SECRET;
    if (!secret || request.headers.get("x-backup-secret") !== secret) {
      return new Response("Forbidden", { status: 403 });
    }
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/sync") {
      // Inline with a SMALL batch: waitUntil only survives ~30 s past the
      // response, which silently truncated large background batches. A bounded
      // inline batch keeps each request short; callers loop until pending=0.
      const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 60));
      const result = await runSync(env, limit);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (request.method === "GET" && path === "/status") {
      const src = new Set<string>();
      const dst = new Set<string>();
      await listAllKeys(env.SRC, src);
      await listAllKeys(env.DST, dst);
      const srcArchive = [...src].filter((k) => !k.startsWith("trash/"));
      const missing = srcArchive.filter((k) => !dst.has(k)).length;
      return new Response(
        JSON.stringify({ source: srcArchive.length, backup: dst.size, missing }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
