interface Env {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_SIGNING_KEY: string;
  ALLOWED_ORIGINS?: string;
}

const YEAR_SECONDS = 31_536_000;

// Only edge-cache full (non-range) responses up to this size. Thumbnails and
// small assets get cached; large media is streamed straight from R2 instead of
// buffered into Worker memory. Range responses are NEVER cached (see fetch()).
const MAX_CACHE_BYTES = 50 * 1024 * 1024;

async function hmacSign(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(
  r2Key: string, exp: string, sig: string, signingKey: string,
): Promise<boolean> {
  const expected = await hmacSign(signingKey, `${r2Key}:${exp}`);
  if (expected.length !== sig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return mismatch === 0;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS?.split(",").map(s => s.trim()) ?? [];
  const match = allowed.length === 0 || allowed.includes(origin);
  return match && origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
        // Let cross-origin readers see the streaming/range metadata.
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      }
    : {};
}

function inferContentType(key: string, r2ContentType: string | undefined): string {
  if (r2ContentType) return r2ContentType;
  const ext = key.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif", avif: "image/avif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}

// Resolve R2's returned range descriptor into a concrete { offset, length }.
function resolveRange(range: R2Range | undefined, size: number): { offset: number; length: number } {
  const r = (range ?? {}) as { offset?: number; length?: number; suffix?: number };
  if (r.suffix != null) {
    const length = Math.min(r.suffix, size);
    return { offset: size - length, length };
  }
  const offset = r.offset ?? 0;
  const length = r.length ?? size - offset;
  return { offset, length };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(request, env),
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const r2Key = decodeURIComponent(url.pathname.slice(1));
    if (!r2Key) return new Response("Not found", { status: 404 });

    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    if (!exp || !sig) return new Response("Forbidden", { status: 403 });
    if (Number(exp) < Date.now() / 1000) return new Response("URL expired", { status: 410 });
    if (!await verifySignature(r2Key, exp, sig, env.MEDIA_SIGNING_KEY)) {
      return new Response("Forbidden", { status: 403 });
    }

    const cors = corsHeaders(request, env);

    // HEAD: return metadata only (no body fetch).
    if (request.method === "HEAD") {
      let meta: R2Object | null;
      try {
        meta = await env.MEDIA_BUCKET.head(r2Key);
      } catch {
        return new Response("Storage unavailable", {
          status: 503,
          headers: { ...cors, "Retry-After": "2" },
        });
      }
      if (!meta) return new Response("Not found", { status: 404 });
      const headers = new Headers({
        "Content-Type": inferContentType(r2Key, meta.httpMetadata?.contentType),
        "Cache-Control": `public, max-age=${YEAR_SECONDS}, immutable`,
        "ETag": meta.httpEtag,
        "Accept-Ranges": "bytes",
        ...cors,
      });
      headers.set("Content-Length", String(meta.size));
      return new Response(null, { status: 200, headers });
    }

    const rangeHeader = request.headers.get("Range");
    const isRangeRequest = !!rangeHeader;

    // Only full, non-range responses are cacheable. Range (206) responses are
    // never cached: caching a partial/streamed body can store a truncated entry
    // (full Content-Length, short body) that freezes playback for every client
    // hitting that edge node.
    const cache = caches.default;
    let cacheKey: Request | null = null;
    if (!isRangeRequest) {
      const cacheUrl = new URL(url.toString());
      cacheUrl.searchParams.delete("exp");
      cacheUrl.searchParams.delete("sig");
      const origin = request.headers.get("Origin");
      if (origin) cacheUrl.searchParams.set("_origin", origin);
      cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    let object: R2ObjectBody | null;
    try {
      object = await env.MEDIA_BUCKET.get(
        r2Key,
        isRangeRequest ? { range: request.headers } : undefined,
      );
    } catch {
      return new Response("Storage unavailable", {
        status: 503,
        headers: { ...cors, "Retry-After": "2" },
      });
    }
    if (!object) {
      // A range request can return null when the range is unsatisfiable.
      if (isRangeRequest) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: { ...cors, "Accept-Ranges": "bytes" },
        });
      }
      return new Response("Not found", { status: 404 });
    }

    const contentType = inferContentType(r2Key, object.httpMetadata?.contentType);
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${YEAR_SECONDS}, immutable`,
      "ETag": object.httpEtag,
      "Accept-Ranges": "bytes",
      ...cors,
    });

    // Partial content.
    if (isRangeRequest) {
      const { offset, length } = resolveRange(object.range, object.size);
      headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
      headers.set("Content-Length", String(length));
      return new Response(object.body, { status: 206, headers });
    }

    // Full content.
    headers.set("Content-Length", String(object.size));
    if (cacheKey && object.size <= MAX_CACHE_BYTES) {
      // Buffer the whole (bounded) body so the cached entry is guaranteed
      // complete — a streamed clone can be truncated if the client disconnects.
      const buf = await object.arrayBuffer();
      ctx.waitUntil(cache.put(cacheKey, new Response(buf, { status: 200, headers })));
      return new Response(buf, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  },
} satisfies ExportedHandler<Env>;
