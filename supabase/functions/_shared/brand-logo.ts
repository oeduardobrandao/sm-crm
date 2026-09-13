// Brand-logo materialization (docs/estudio-design.md §4.1 / §5.4, plan T3.2, decision 1b-9).
// Imports a client's `hub_brand.logo_url` — tenant-authored FREE TEXT — into R2 as a real
// `files` row and stamps `hub_brand.logo_file_id`. Idempotent: an already-materialized logo is
// returned as-is, no fetch.
//
// The URL is untrusted input fetched SERVER-SIDE, so the import is SSRF-hardened in layers:
//   1. https-only.
//   2. IP-literal hosts rejected in ANY notation — IPv4 dotted/decimal/octal/hex/shortened
//      ("127.1", "0x7f000001", "017700000001") are normalized inet_aton-style BEFORE judging,
//      and anything colon-shaped (incl. "[::1]") is treated as an IPv6 literal and rejected.
//   3. DNS resolve (A + AAAA) immediately before the fetch; any resolved address in a
//      private/link-local/loopback/otherwise-non-global range rejects the import, including
//      IPv4 addresses embedded in v4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) IPv6.
//      Resolution itself is raced against a 5 s deadline — a hung resolver on the edge runtime
//      would otherwise burn to the isolate wall-clock kill, which bypasses catch blocks and
//      logs nothing (the aws-sdk PutObject lesson in _shared/r2.ts).
//   4. `redirect: "manual"` and ANY 3xx response rejected — no cross-host redirect following.
//   5. 10 s fetch timeout (headers + body, one AbortSignal).
//   6. ≤5 MB streamed cap — the body is read chunk-by-chunk and cancelled at the cap, never
//      buffered on trust of Content-Length alone.
//   7. Content-Type must be image/* AND the bytes must magic-byte sniff as PNG/JPEG/GIF/WebP
//      (the sniffed type wins for storage). SVG is deliberately NOT accepted: it has no magic
//      bytes and can carry scripts.
//
// Residual risk, accepted for v1: DNS rebinding (resolve-then-fetch TOCTOU). The pre-fetch
// resolution and fetch's own resolution are separate lookups, so an attacker-controlled
// resolver could answer differently between them. The layered caps above (https-only, no
// redirects, 10 s / 5 MB, image-sniffed, response never echoed to the caller) bound the blast
// radius; a pinned-IP dial is not available to edge `fetch`.
//
// Infra failures (R2 PUT, unexpected DB errors) THROW — the route maps them to a generic 500.
// Everything expected (bad URL, unreachable host, quota, non-image) returns a machine-readable
// `reason` for the UI to translate.

import { fetchImageSafely } from "./safe-image-fetch.ts";

export {
  isDisallowedIpv4,
  isDisallowedIpv6,
  isIpLiteralHost,
  parseIpv4AnyNotation,
  parseIpv6Groups,
  sniffImageBytes,
} from "./safe-image-fetch.ts";

export const LOGO_FETCH_TIMEOUT_MS = 10_000;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

export interface HubBrandLogoRow {
  logo_url: string | null;
  logo_file_id: number | null;
}

export interface BrandLogoDeps {
  getBrand: (clienteId: number) => Promise<HubBrandLogoRow | null>;
  resolveDns: (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;
  fetchUrl: (url: string, init: RequestInit) => Promise<Response>;
  putObject: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  deleteObject: (key: string) => Promise<void>;
  /** file_insert_with_quota RPC — must THROW with a message containing "quota_exceeded" when
   * the tenant is over its storage quota (that is what the SQL raises). */
  insertFile: (p: Record<string, unknown>) => Promise<{ id: number }>;
  /** Guarded stamp: UPDATE hub_brand SET logo_file_id = $2 WHERE cliente_id = $1 AND
   * logo_file_id IS NULL. Returns whether a row was updated (false = lost a concurrent race). */
  claimLogoFileId: (clienteId: number, fileId: number) => Promise<boolean>;
  /** Deletes a files row (the existing DB trigger queues its R2 key into file_deletions). */
  deleteFileRow: (fileId: number) => Promise<void>;
  randomUUID: () => string;
  logError: (context: string, error: unknown) => void;
  /** DNS deadline override for tests; production uses SAFE_FETCH_DNS_TIMEOUT_MS. */
  dnsTimeoutMs?: number;
}

export type MaterializeLogoFailReason =
  | "no_logo_url"
  | "invalid_url"
  | "not_https"
  | "ip_literal_host"
  | "dns_resolution_failed"
  | "private_address"
  | "redirect_rejected"
  | "timeout"
  | "fetch_failed"
  | "not_an_image"
  | "too_large"
  | "quota_exceeded"
  | "conflict";

export type MaterializeLogoResult =
  | { logo_file_id: number; created: boolean }
  | { logo_file_id: null; reason: MaterializeLogoFailReason };

export async function materializeBrandLogo(
  deps: BrandLogoDeps,
  args: { contaId: string; clienteId: number; uploadedBy: string },
): Promise<MaterializeLogoResult> {
  const fail = (reason: MaterializeLogoFailReason): MaterializeLogoResult => ({
    logo_file_id: null,
    reason,
  });

  const brand = await deps.getBrand(args.clienteId);
  // Idempotency first — an already-materialized logo short-circuits before any network I/O.
  if (brand?.logo_file_id) return { logo_file_id: brand.logo_file_id, created: false };
  const rawUrl = brand?.logo_url?.trim();
  if (!rawUrl) return fail("no_logo_url");

  const fetched = await fetchImageSafely(
    { resolveDns: deps.resolveDns, fetchUrl: deps.fetchUrl, dnsTimeoutMs: deps.dnsTimeoutMs },
    rawUrl,
    { maxBytes: LOGO_MAX_BYTES, timeoutMs: LOGO_FETCH_TIMEOUT_MS },
  );
  if (!fetched.ok) return fail(fetched.reason);
  const bytes = fetched.bytes;
  const sniffed = { mime: fetched.mime, ext: fetched.ext };

  // --- Store: R2 → files row (quota-charged) → guarded logo_file_id stamp ---
  const r2Key = `contas/${args.contaId}/files/${deps.randomUUID()}.${sniffed.ext}`;
  await deps.putObject(r2Key, bytes, sniffed.mime); // infra failure → throw → route 500

  let fileId: number;
  try {
    const inserted = await deps.insertFile({
      conta_id: args.contaId,
      folder_id: "",
      r2_key: r2Key,
      thumbnail_r2_key: "",
      name: `brand-logo-cliente-${args.clienteId}.${sniffed.ext}`,
      kind: "image",
      mime_type: sniffed.mime,
      size_bytes: bytes.byteLength,
      width: "",
      height: "",
      duration_seconds: "",
      uploaded_by: args.uploadedBy,
    });
    fileId = inserted.id;
  } catch (e) {
    // No files row exists yet, so the orphan-queue trigger can't clean the object — do it here.
    await deps.deleteObject(r2Key).catch((err) =>
      deps.logError("brand-logo:cleanup-object", err)
    );
    if (e instanceof Error && e.message.includes("quota_exceeded")) return fail("quota_exceeded");
    throw e;
  }

  const claimed = await deps.claimLogoFileId(args.clienteId, fileId);
  if (!claimed) {
    // Lost a concurrent materialization race (or the brand row vanished). Our files row is an
    // orphan — deleting it queues the R2 object for cleanup via the existing trigger.
    await deps.deleteFileRow(fileId).catch((err) => deps.logError("brand-logo:cleanup-row", err));
    const winner = await deps.getBrand(args.clienteId);
    if (winner?.logo_file_id) return { logo_file_id: winner.logo_file_id, created: false };
    return fail("conflict");
  }

  return { logo_file_id: fileId, created: true };
}
