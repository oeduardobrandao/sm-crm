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

export const LOGO_FETCH_TIMEOUT_MS = 10_000;
export const LOGO_DNS_TIMEOUT_MS = 5_000;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Pure SSRF helpers (exported for the deno test matrix)
// ---------------------------------------------------------------------------

function parseIpv4Part(part: string): number | null {
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) return parseInt(part.slice(2), 16);
  if (part.length > 1 && part[0] === "0") {
    // Leading zero = octal (inet_aton). Non-octal digits after "0" ("09") are malformed —
    // fail the parse rather than guess decimal.
    return /^0[0-7]+$/.test(part) ? parseInt(part, 8) : null;
  }
  if (/^[0-9]+$/.test(part)) return parseInt(part, 10);
  return null;
}

/** inet_aton-compatible IPv4 parse: 1–4 dot-separated parts, each decimal/octal/0x-hex, the
 * last part filling the remaining bytes ("127.1" → 127.0.0.1, "2130706433" → 127.0.0.1).
 * Returns the address as an unsigned 32-bit int, or null when `host` is not an IPv4 literal. */
export function parseIpv4AnyNotation(host: string): number | null {
  if (host.length === 0) return null;
  const parts = host.split(".");
  // WHATWG hosts may carry one trailing dot ("127.0.0.1.").
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  if (parts.length === 0 || parts.length > 4 || parts.some((p) => p === "")) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const value = parseIpv4Part(part);
    if (value === null || !Number.isFinite(value)) return null;
    nums.push(value);
  }
  for (let i = 0; i < nums.length - 1; i++) if (nums[i] > 0xff) return null;
  const last = nums[nums.length - 1];
  const remainingBytes = 4 - (nums.length - 1);
  if (last >= 2 ** (8 * remainingBytes)) return null;
  let n = 0;
  for (let i = 0; i < nums.length - 1; i++) n = n * 256 + nums[i];
  return (n * 2 ** (8 * remainingBytes) + last) >>> 0;
}

/** True when the URL hostname is an IP literal in any notation. Anything containing a colon
 * (bracketed or not) is judged an IPv6 literal without needing a full parse — a colon can
 * never appear in a resolvable DNS name, so failing closed costs nothing. */
export function isIpLiteralHost(hostname: string): boolean {
  const h = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (h.includes(":")) return true;
  return parseIpv4AnyNotation(h) !== null;
}

/** Non-global IPv4 ranges (loopback, RFC1918, link-local, CGNAT, multicast, reserved, …). */
export function isDisallowedIpv4(n: number): boolean {
  const a = n >>> 24;
  const b = (n >>> 16) & 0xff;
  const c = (n >>> 8) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF assignments
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
  return false;
}

/** Parses a textual IPv6 address (optionally bracketed/zoned) into its 8 16-bit groups.
 * Handles "::" compression and an embedded IPv4 tail ("::ffff:127.0.0.1"). Null on malformed. */
export function parseIpv6Groups(input: string): number[] | null {
  let s = input;
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zoneIdx = s.indexOf("%");
  if (zoneIdx !== -1) s = s.slice(0, zoneIdx);
  if (!s.includes(":")) return null;

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const parseSide = (side: string, isTail: boolean): number[] | null => {
    if (side === "") return [];
    const rawGroups = side.split(":");
    const out: number[] = [];
    for (let i = 0; i < rawGroups.length; i++) {
      const g = rawGroups[i];
      if (/^[0-9a-fA-F]{1,4}$/.test(g)) {
        out.push(parseInt(g, 16));
        continue;
      }
      // Embedded dotted IPv4 — only valid as the very last group of the address.
      const isLastGroup = isTail && i === rawGroups.length - 1;
      if (!isLastGroup || !/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(g)) return null;
      const v4 = parseIpv4AnyNotation(g);
      if (v4 === null) return null;
      out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
    }
    return out;
  };

  const head = parseSide(halves[0], halves.length === 1);
  if (head === null) return null;
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const tail = parseSide(halves[1], true);
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null; // "::" must compress at least one group
  return [...head, ...new Array(missing).fill(0), ...tail];
}

/** Non-global IPv6: unspecified, loopback, link-local, ULA, multicast — plus v4-mapped and
 * NAT64 forms, whose EMBEDDED IPv4 is re-judged with the IPv4 ranges. Fails closed on input
 * that doesn't parse as 8 groups. */
export function isDisallowedIpv6(input: string): boolean {
  const g = parseIpv6Groups(input);
  if (g === null || g.length !== 8) return true;
  const headZero = (upto: number) => g.slice(0, upto).every((x) => x === 0);
  if (headZero(8)) return true; // ::
  if (headZero(7) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (headZero(5) && g[5] === 0xffff) {
    return isDisallowedIpv4((((g[6] << 16) | g[7]) >>> 0)); // ::ffff:0:0/96 v4-mapped
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isDisallowedIpv4((((g[6] << 16) | g[7]) >>> 0)); // 64:ff9b::/96 NAT64
  }
  return false;
}

/** Magic-byte sniff for the storable logo formats. The sniffed type — never the response
 * Content-Type — decides the stored mime/extension. SVG intentionally absent (see header). */
export function sniffImageBytes(bytes: Uint8Array): { mime: string; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) {
    return { mime: "image/gif", ext: "gif" };
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

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
  /** DNS deadline override for tests; production uses LOGO_DNS_TIMEOUT_MS. */
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

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");
}

/** Bounded await — the timer is always cleared so Deno's test sanitizer sees no leaked op. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("deadline exceeded")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readBodyCapped(
  body: ReadableStream<Uint8Array>,
  cap: number,
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

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

  // --- URL-shape gates (layers 1–2) ---
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("invalid_url");
  }
  if (url.protocol !== "https:") return fail("not_https");
  if (url.username || url.password) return fail("invalid_url");
  if (isIpLiteralHost(url.hostname)) return fail("ip_literal_host");

  // --- DNS gate (layer 3), immediately pre-fetch. Each lookup is deadline-bounded: a hung
  // resolver must fail closed here, not ride to the silent isolate kill. ---
  const dnsTimeout = deps.dnsTimeoutMs ?? LOGO_DNS_TIMEOUT_MS;
  const [aRecords, aaaaRecords] = await Promise.allSettled([
    withDeadline(deps.resolveDns(url.hostname, "A"), dnsTimeout),
    withDeadline(deps.resolveDns(url.hostname, "AAAA"), dnsTimeout),
  ]);
  const v4 = aRecords.status === "fulfilled" ? aRecords.value : [];
  const v6 = aaaaRecords.status === "fulfilled" ? aaaaRecords.value : [];
  if (v4.length === 0 && v6.length === 0) return fail("dns_resolution_failed");
  for (const addr of v4) {
    const n = parseIpv4AnyNotation(addr);
    if (n === null || isDisallowedIpv4(n)) return fail("private_address"); // unparseable = fail closed
  }
  for (const addr of v6) {
    if (isDisallowedIpv6(addr)) return fail("private_address");
  }

  // --- Fetch (layers 4–5) ---
  let res: Response;
  try {
    res = await deps.fetchUrl(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
      headers: { Accept: "image/*" },
    });
  } catch (e) {
    return fail(isAbortError(e) ? "timeout" : "fetch_failed");
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    return fail("redirect_rejected");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return fail("fetch_failed");
  }
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) {
    await res.body?.cancel().catch(() => undefined);
    return fail("not_an_image");
  }
  const declaredLength = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > LOGO_MAX_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return fail("too_large");
  }

  // --- Body (layers 6–7): streamed cap, then the sniff decides the stored type ---
  if (!res.body) return fail("fetch_failed");
  let bytes: Uint8Array | null;
  try {
    bytes = await readBodyCapped(res.body, LOGO_MAX_BYTES);
  } catch (e) {
    return fail(isAbortError(e) ? "timeout" : "fetch_failed");
  }
  if (bytes === null) return fail("too_large");
  const sniffed = sniffImageBytes(bytes);
  if (!sniffed) return fail("not_an_image");

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
