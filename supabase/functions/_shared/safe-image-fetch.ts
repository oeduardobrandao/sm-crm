// Fetch de imagem por URL não confiável, endurecido contra SSRF. Extraído de brand-logo.ts
// (camadas 1 a 7 do cabeçalho daquele arquivo) para servir também ao mcp-admin. Risco
// residual aceito: DNS rebinding entre a resolução e o fetch (o fetch do edge runtime não
// permite pinar o IP).
//
// As funções parseIpv4Part, parseIpv4AnyNotation, isIpLiteralHost, isDisallowedIpv4,
// parseIpv6Groups, isDisallowedIpv6 e sniffImageBytes são MOVIDAS de brand-logo.ts para cá
// (corpo idêntico, exportadas). brand-logo.ts passa a re-exportá-las. Nada aqui importa de
// brand-logo.ts.

export const SAFE_FETCH_DNS_TIMEOUT_MS = 5_000;

export interface SafeFetchDeps {
  resolveDns: (hostname: string, recordType: "A" | "AAAA") => Promise<string[]>;
  fetchUrl: (url: string, init: RequestInit) => Promise<Response>;
  dnsTimeoutMs?: number;
}

export type SafeFetchFailReason =
  | "invalid_url"
  | "not_https"
  | "ip_literal_host"
  | "dns_resolution_failed"
  | "private_address"
  | "redirect_rejected"
  | "timeout"
  | "fetch_failed"
  | "not_an_image"
  | "too_large";

export type SafeFetchResult =
  | { ok: true; bytes: Uint8Array; mime: string; ext: string; truncated: boolean }
  | { ok: false; reason: SafeFetchFailReason };

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
// Fetch pipeline
// ---------------------------------------------------------------------------

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");
}

/** Bounded await — the timer is always cleared so Deno's test sanitizer sees no leaked op. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
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

export async function readBodyCapped(
  body: ReadableStream<Uint8Array>,
  cap: number,
  truncate = false,
): Promise<{ bytes: Uint8Array; truncated: boolean } | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total + value.byteLength > cap) {
      if (!truncate) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value.slice(0, cap - total));
      total = cap;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    total += value.byteLength;
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { bytes: out, truncated };
}

export async function fetchImageSafely(
  deps: SafeFetchDeps,
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs: number; truncate?: boolean },
): Promise<SafeFetchResult> {
  const fail = (reason: SafeFetchFailReason): SafeFetchResult => ({ ok: false, reason });
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("invalid_url");
  }
  if (url.username || url.password) return fail("invalid_url");
  if (url.protocol !== "https:") return fail("not_https");
  if (isIpLiteralHost(url.hostname)) return fail("ip_literal_host");

  const dnsTimeout = deps.dnsTimeoutMs ?? SAFE_FETCH_DNS_TIMEOUT_MS;
  const [a, aaaa] = await Promise.allSettled([
    withDeadline(deps.resolveDns(url.hostname, "A"), dnsTimeout),
    withDeadline(deps.resolveDns(url.hostname, "AAAA"), dnsTimeout),
  ]);
  const v4 = a.status === "fulfilled" ? a.value : [];
  const v6 = aaaa.status === "fulfilled" ? aaaa.value : [];
  if (v4.length === 0 && v6.length === 0) return fail("dns_resolution_failed");
  for (const addr of v4) {
    const n = parseIpv4AnyNotation(addr);
    if (n === null || isDisallowedIpv4(n)) return fail("private_address");
  }
  for (const addr of v6) if (isDisallowedIpv6(addr)) return fail("private_address");

  let res: Response;
  try {
    res = await deps.fetchUrl(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs),
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
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (!opts.truncate && Number.isFinite(declared) && declared > opts.maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return fail("too_large");
  }
  if (!res.body) return fail("fetch_failed");
  let read: { bytes: Uint8Array; truncated: boolean } | null;
  try {
    read = await readBodyCapped(res.body, opts.maxBytes, opts.truncate === true);
  } catch (e) {
    return fail(isAbortError(e) ? "timeout" : "fetch_failed");
  }
  if (read === null) return fail("too_large");
  const sniffed = sniffImageBytes(read.bytes);
  if (!sniffed) return fail("not_an_image");
  return { ok: true, bytes: read.bytes, mime: sniffed.mime, ext: sniffed.ext, truncated: read.truncated };
}
