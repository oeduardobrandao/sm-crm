interface Env {
  MEDIA_BUCKET: R2Bucket;
  MEDIA_SIGNING_KEY: string;
  ALLOWED_ORIGINS?: string;
}

const YEAR_SECONDS = 31_536_000;

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
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }
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

    // Build cache key without signature params (content-addressable)
    const cacheUrl = new URL(url.toString());
    cacheUrl.searchParams.delete("exp");
    cacheUrl.searchParams.delete("sig");
    const cacheKey = new Request(cacheUrl.toString(), { method: request.method });
    const cache = caches.default;

    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const object = await env.MEDIA_BUCKET.get(r2Key);
    if (!object) return new Response("Not found", { status: 404 });

    const contentType = inferContentType(r2Key, object.httpMetadata?.contentType);
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${YEAR_SECONDS}, immutable`,
      "ETag": object.httpEtag,
      ...corsHeaders(request, env),
    });
    if (object.size != null) headers.set("Content-Length", String(object.size));

    const response = new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers,
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
} satisfies ExportedHandler<Env>;
