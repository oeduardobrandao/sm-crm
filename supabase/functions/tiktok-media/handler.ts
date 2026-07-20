// supabase/functions/tiktok-media/handler.ts
//
// tiktok-media: public proxy that puts TikTok-bound R2 media behind our own function host.
// TikTok's PULL_FROM_URL source requires media URLs under a TikTok-verifiable URL prefix; raw
// R2 presigned URLs (*.r2.cloudflarestorage.com) fail that check (not our domain, private
// bucket). See _shared/tiktok-media-url.ts's module comment for the token shape. Two routes:
//
//   - GET /tiktok-media/m/{token} — token-gated proxy. verifyTikTokMediaToken resolves the
//     token to an r2Key (null if tampered/expired -> 403, R2 never touched). A valid token
//     gets a short-lived R2 presigned GET (signGetUrl, 600s) fetched server-side and streamed
//     back with the incoming Range header forwarded, so TikTok's range-based pulls work.
//   - GET /tiktok-media/{filename} — serves TikTok's URL-prefix verification signature file.
//     TIKTOK_URL_VERIFY_FILENAME/_CONTENT are unset until the operator registers the
//     verification file with TikTok; 404 until then. filename must match
//     ^tiktok[A-Za-z0-9_-]*\.txt$ regardless of env state (gate checked before comparing).
//
// Every non-2xx/206 response here is a bare status with an empty body — never echoes the r2
// key, R2's own error body, or any other internal detail back to the caller (security rule:
// never return raw internal/error details to clients). Mirrors tiktok-webhook's minimal
// response style. No CORS: this is a server-to-server fetch by TikTok, not a browser call.
//
// DI shape mirrors tiktok-webhook/handler.ts: env values (urlVerifyFilename/urlVerifyContent)
// are read once by index.ts and injected — this module never reads Deno.env itself.

import { verifyTikTokMediaToken as realVerifyTikTokMediaToken } from "../_shared/tiktok-media-url.ts";
import { signGetUrl as realSignGetUrl } from "../_shared/r2.ts";

const VERIFY_FILENAME_PATTERN = /^tiktok[A-Za-z0-9_-]*\.txt$/;

/** Signed GET TTL for the R2 fetch behind a valid proxy token. Short-lived by design — this is
 * a fresh presign minted per request, not reused across requests like the token itself can be
 * (within its own longer TTL, set by the caller of buildTikTokMediaUrl). */
const R2_FETCH_TTL_SECONDS = 600;

export interface TikTokMediaDeps {
  verifyTikTokMediaToken?: typeof realVerifyTikTokMediaToken;
  signGetUrl?: typeof realSignGetUrl;
  /** Injected fetch for the server-side R2 GET — same DI seam shape as _shared/r2.ts's own
   * plain-fetch functions (getObjectBytes/putObject), letting tests stub the R2 response
   * without a real network call. Defaults to the global fetch. */
  fetchR2?: typeof fetch;
  /** Deno.env.get("TIKTOK_URL_VERIFY_FILENAME"), read once by index.ts. */
  urlVerifyFilename?: string;
  /** Deno.env.get("TIKTOK_URL_VERIFY_CONTENT"), read once by index.ts. */
  urlVerifyContent?: string;
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

export function createTikTokMediaHandler(deps: TikTokMediaDeps) {
  const verifyToken = deps.verifyTikTokMediaToken ?? realVerifyTikTokMediaToken;
  const signUrl = deps.signGetUrl ?? realSignGetUrl;
  const fetchR2 = deps.fetchR2 ?? fetch;

  function handleVerifyFile(filename: string): Response {
    if (!deps.urlVerifyFilename || filename !== deps.urlVerifyFilename) {
      return emptyResponse(404);
    }
    return new Response(deps.urlVerifyContent ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  async function handleProxy(token: string, incomingRange: string | null, isHead = false): Promise<Response> {
    // (a) Token must verify (valid signature, unexpired) AND resolve to an r2Key. A bad token
    // never reaches signGetUrl/R2 at all — the token IS the only access grant; there is no
    // path traversal risk because the r2Key comes from the verified token payload, never from
    // the URL directly.
    const r2Key = await verifyToken(token);
    if (!r2Key) return emptyResponse(403);

    const signedUrl = await signUrl(r2Key, R2_FETCH_TTL_SECONDS);

    // HEAD is forwarded as HEAD so no media bytes transit for a metadata probe (TikTok's
    // verifier and its puller both HEAD before GET).
    const fetchInit: RequestInit = {
      ...(isHead ? { method: "HEAD" } : {}),
      ...(incomingRange ? { headers: { Range: incomingRange } } : {}),
    };

    let r2Res: Response;
    try {
      r2Res = await fetchR2(signedUrl, fetchInit);
    } catch {
      // Network failure reaching R2 — never leak the reason (or the signed URL) to the caller.
      return emptyResponse(404);
    }

    if (!r2Res.ok) {
      // R2 403/404 (deleted/missing object, bad presign) -> bare 404. Drain the body (R2's own
      // XML error payload) so the connection can be reused, but never forward it.
      await r2Res.body?.cancel();
      return emptyResponse(404);
    }

    // Pass through only the handful of headers a media consumer (TikTok's PULL_FROM_URL
    // fetcher) needs — never the full R2 response header set, which could include internal
    // metadata (e.g. an ETag or x-amz-* header) with no reason to leave this function.
    const headers = new Headers();
    const contentType = r2Res.headers.get("Content-Type");
    const contentLength = r2Res.headers.get("Content-Length");
    const contentRange = r2Res.headers.get("Content-Range");
    const acceptRanges = r2Res.headers.get("Accept-Ranges");
    if (contentType) headers.set("Content-Type", contentType);
    if (contentLength) headers.set("Content-Length", contentLength);
    if (contentRange) headers.set("Content-Range", contentRange);
    if (acceptRanges) headers.set("Accept-Ranges", acceptRanges);

    // status is R2's own (200 full body, or 206 when the Range request above was honored).
    if (isHead) {
      // Defensive: R2 HEAD responses carry no body, but never stream one on HEAD regardless.
      await r2Res.body?.cancel();
      return new Response(null, { status: r2Res.status, headers });
    }
    return new Response(r2Res.body, { status: r2Res.status, headers });
  }

  return async (req: Request): Promise<Response> => {
    const isHead = req.method === "HEAD";
    if (req.method !== "GET" && !isHead) return emptyResponse(404);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Expected: /tiktok-media/m/{token} (proxy) or /tiktok-media/{filename} (verify-file).
    const second = pathParts[1];

    if (second === "m" && pathParts.length === 3) {
      return handleProxy(pathParts[2], req.headers.get("Range"), isHead);
    }

    if (pathParts.length === 2 && second && VERIFY_FILENAME_PATTERN.test(second)) {
      const res = await handleVerifyFile(second);
      return isHead ? new Response(null, { status: res.status, headers: res.headers }) : res;
    }

    return emptyResponse(404);
  };
}
