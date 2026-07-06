// T3.2 test matrix (plan §4 + rev-2 delta): the full SSRF contract of _shared/brand-logo.ts,
// exercised through materializeBrandLogo with stub deps (no network), plus the pure helpers'
// notation matrices.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isDisallowedIpv4,
  isDisallowedIpv6,
  isIpLiteralHost,
  LOGO_MAX_BYTES,
  materializeBrandLogo,
  parseIpv4AnyNotation,
  parseIpv6Groups,
  sniffImageBytes,
  type BrandLogoDeps,
  type HubBrandLogoRow,
  type MaterializeLogoFailReason,
} from "../_shared/brand-logo.ts";

const CONTA_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const CLIENTE_ID = 7;
const ARGS = { contaId: CONTA_ID, clienteId: CLIENTE_ID, uploadedBy: USER_ID };

// Minimal valid-signature bodies — the sniff only reads the leading bytes.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const HTML_BYTES = new TextEncoder().encode("<!doctype html><html></html>");

interface DepsSpy {
  fetchedUrls: string[];
  resolvedHosts: string[];
  putCalls: Array<{ key: string; bytes: Uint8Array; contentType: string }>;
  deleteObjectCalls: string[];
  insertCalls: Array<Record<string, unknown>>;
  claimCalls: Array<{ clienteId: number; fileId: number }>;
  deleteRowCalls: number[];
}

function makeDeps(
  overrides: Partial<BrandLogoDeps> = {},
  brand: HubBrandLogoRow | null = { logo_url: "https://cdn.example.com/logo.png", logo_file_id: null },
): { deps: BrandLogoDeps; spy: DepsSpy } {
  const spy: DepsSpy = {
    fetchedUrls: [],
    resolvedHosts: [],
    putCalls: [],
    deleteObjectCalls: [],
    insertCalls: [],
    claimCalls: [],
    deleteRowCalls: [],
  };
  const deps: BrandLogoDeps = {
    getBrand: async () => brand,
    resolveDns: async (hostname, recordType) => {
      spy.resolvedHosts.push(`${recordType}:${hostname}`);
      return recordType === "A" ? ["93.184.216.34"] : [];
    },
    fetchUrl: async (url) => {
      spy.fetchedUrls.push(url);
      return new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } });
    },
    putObject: async (key, bytes, contentType) => {
      spy.putCalls.push({ key, bytes, contentType });
    },
    deleteObject: async (key) => {
      spy.deleteObjectCalls.push(key);
    },
    insertFile: async (p) => {
      spy.insertCalls.push(p);
      return { id: 501 };
    },
    claimLogoFileId: async (clienteId, fileId) => {
      spy.claimCalls.push({ clienteId, fileId });
      return true;
    },
    deleteFileRow: async (fileId) => {
      spy.deleteRowCalls.push(fileId);
    },
    randomUUID: () => "fixed-uuid",
    logError: () => {},
    ...overrides,
  };
  return { deps, spy };
}

async function expectReason(
  deps: BrandLogoDeps,
  reason: MaterializeLogoFailReason,
) {
  const result = await materializeBrandLogo(deps, ARGS);
  assertEquals(result, { logo_file_id: null, reason });
}

// ============================================================
// Happy path + idempotency
// ============================================================

Deno.test("materialize: happy path stores sniffed PNG under the tenant keyspace and stamps the claim", async () => {
  const { deps, spy } = makeDeps();
  const result = await materializeBrandLogo(deps, ARGS);
  assertEquals(result, { logo_file_id: 501, created: true });
  assertEquals(spy.putCalls.length, 1);
  assertEquals(spy.putCalls[0].key, `contas/${CONTA_ID}/files/fixed-uuid.png`);
  assertEquals(spy.putCalls[0].contentType, "image/png");
  assertEquals(spy.insertCalls[0].kind, "image");
  assertEquals(spy.insertCalls[0].mime_type, "image/png");
  assertEquals(spy.insertCalls[0].size_bytes, PNG_BYTES.byteLength);
  assertEquals(spy.insertCalls[0].uploaded_by, USER_ID);
  assertEquals(spy.claimCalls, [{ clienteId: CLIENTE_ID, fileId: 501 }]);
});

Deno.test("materialize: sniffed type wins over the response content-type", async () => {
  const { deps, spy } = makeDeps({
    // Server lies: says PNG, delivers JPEG bytes.
    fetchUrl: async () =>
      new Response(JPEG_BYTES, { status: 200, headers: { "content-type": "image/png" } }),
  });
  const result = await materializeBrandLogo(deps, ARGS);
  assertEquals(result, { logo_file_id: 501, created: true });
  assertEquals(spy.putCalls[0].key, `contas/${CONTA_ID}/files/fixed-uuid.jpg`);
  assertEquals(spy.putCalls[0].contentType, "image/jpeg");
});

Deno.test("materialize: idempotent — already-materialized logo returns without ANY network I/O", async () => {
  const { deps, spy } = makeDeps({}, { logo_url: "https://cdn.example.com/logo.png", logo_file_id: 42 });
  const result = await materializeBrandLogo(deps, ARGS);
  assertEquals(result, { logo_file_id: 42, created: false });
  assertEquals(spy.resolvedHosts.length, 0);
  assertEquals(spy.fetchedUrls.length, 0);
  assertEquals(spy.putCalls.length, 0);
});

Deno.test("materialize: no brand row / empty logo_url → no_logo_url", async () => {
  await expectReason(makeDeps({}, null).deps, "no_logo_url");
  await expectReason(makeDeps({}, { logo_url: "   ", logo_file_id: null }).deps, "no_logo_url");
});

// ============================================================
// URL-shape gates: https-only + IP literals in every notation
// ============================================================

function depsForUrl(logoUrl: string) {
  return makeDeps({}, { logo_url: logoUrl, logo_file_id: null });
}

Deno.test("materialize: plain-http URL is rejected (https-only)", async () => {
  const { deps, spy } = depsForUrl("http://cdn.example.com/logo.png");
  await expectReason(deps, "not_https");
  assertEquals(spy.resolvedHosts.length, 0);
  assertEquals(spy.fetchedUrls.length, 0);
});

Deno.test("materialize: unparseable URL is rejected", async () => {
  await expectReason(depsForUrl("not a url at all").deps, "invalid_url");
});

Deno.test("materialize: URL with embedded credentials is rejected", async () => {
  await expectReason(depsForUrl("https://user:pass@cdn.example.com/logo.png").deps, "invalid_url");
});

Deno.test("materialize: IP-literal hosts are rejected in every notation, before DNS or fetch", async () => {
  const literals = [
    "https://127.0.0.1/logo.png", // dotted decimal
    "https://127.1/logo.png", // shortened
    "https://2130706433/logo.png", // decimal (127.0.0.1)
    "https://0x7f000001/logo.png", // hex single-part
    "https://0x7f.0.0.1/logo.png", // hex first octet
    "https://017700000001/logo.png", // octal single-part
    "https://0177.0.0.1/logo.png", // octal first octet
    "https://[::1]/logo.png", // IPv6 loopback
    "https://[::ffff:10.0.0.1]/logo.png", // IPv6 v4-mapped
    "https://[fe80::1]/logo.png", // IPv6 link-local
    "https://[2606:4700::6810:84e5]/logo.png", // even a PUBLIC IPv6 literal — literals are rejected outright
    "https://8.8.8.8/logo.png", // even a PUBLIC IPv4 literal
  ];
  for (const url of literals) {
    const { deps, spy } = depsForUrl(url);
    await expectReason(deps, "ip_literal_host");
    assertEquals(spy.resolvedHosts.length, 0, `resolved DNS for ${url}`);
    assertEquals(spy.fetchedUrls.length, 0, `fetched ${url}`);
  }
});

// ============================================================
// DNS gate: resolve + private/link-local/loopback rejection
// ============================================================

Deno.test("materialize: hostname resolving to a private IPv4 is rejected pre-fetch", async () => {
  for (const addr of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1"]) {
    const { deps, spy } = makeDeps({
      resolveDns: async (_h, recordType) => (recordType === "A" ? [addr] : []),
    });
    await expectReason(deps, "private_address");
    assertEquals(spy.fetchedUrls.length, 0, `fetched despite ${addr}`);
  }
});

Deno.test("materialize: ONE private address among public ones still rejects (DNS round-robin)", async () => {
  const { deps, spy } = makeDeps({
    resolveDns: async (_h, recordType) =>
      recordType === "A" ? ["93.184.216.34", "10.0.0.5"] : [],
  });
  await expectReason(deps, "private_address");
  assertEquals(spy.fetchedUrls.length, 0);
});

Deno.test("materialize: hostname resolving to disallowed IPv6 (incl. mapped v4) is rejected", async () => {
  for (const addr of ["::1", "fe80::1", "fc00::1", "::ffff:192.168.0.1", "64:ff9b::a00:1"]) {
    const { deps, spy } = makeDeps({
      resolveDns: async (_h, recordType) => (recordType === "AAAA" ? [addr] : []),
    });
    await expectReason(deps, "private_address");
    assertEquals(spy.fetchedUrls.length, 0, `fetched despite ${addr}`);
  }
});

Deno.test("materialize: hostname that resolves to nothing is rejected", async () => {
  const { deps } = makeDeps({
    resolveDns: async () => {
      throw new Error("NXDOMAIN");
    },
  });
  await expectReason(deps, "dns_resolution_failed");
});

Deno.test("materialize: a HUNG resolver fails closed at the DNS deadline (never reaches fetch)", async () => {
  const { deps, spy } = makeDeps({
    resolveDns: () => new Promise<string[]>(() => {}), // never settles
    dnsTimeoutMs: 20,
  });
  await expectReason(deps, "dns_resolution_failed");
  assertEquals(spy.fetchedUrls.length, 0);
});

Deno.test("materialize: AAAA-only host with a public address passes the DNS gate", async () => {
  const { deps } = makeDeps({
    resolveDns: async (_h, recordType) =>
      recordType === "AAAA" ? ["2606:4700::6810:84e5"] : [],
  });
  const result = await materializeBrandLogo(deps, ARGS);
  assertEquals(result, { logo_file_id: 501, created: true });
});

// ============================================================
// Fetch gates: redirects, status, content-type, size, sniff
// ============================================================

Deno.test("materialize: every 3xx is rejected — 301, 302, 307, 308", async () => {
  for (const status of [301, 302, 307, 308]) {
    let fetches = 0;
    const { deps, spy } = makeDeps({
      fetchUrl: async () => {
        fetches++;
        return new Response(null, { status, headers: { location: "https://evil.example.com/" } });
      },
    });
    await expectReason(deps, "redirect_rejected");
    assertEquals(fetches, 1); // exactly one fetch — the redirect is NOT followed
    assertEquals(spy.putCalls.length, 0);
  }
});

Deno.test("materialize: non-OK response → fetch_failed", async () => {
  const { deps } = makeDeps({ fetchUrl: async () => new Response("nope", { status: 404 }) });
  await expectReason(deps, "fetch_failed");
});

Deno.test("materialize: network error → fetch_failed; abort/timeout → timeout", async () => {
  const { deps: netDeps } = makeDeps({
    fetchUrl: async () => {
      throw new TypeError("connection refused");
    },
  });
  await expectReason(netDeps, "fetch_failed");

  const { deps: timeoutDeps } = makeDeps({
    fetchUrl: async () => {
      throw new DOMException("timed out", "TimeoutError");
    },
  });
  await expectReason(timeoutDeps, "timeout");
});

Deno.test("materialize: non-image content-type → not_an_image", async () => {
  const { deps } = makeDeps({
    fetchUrl: async () =>
      new Response(PNG_BYTES, { status: 200, headers: { "content-type": "text/html" } }),
  });
  await expectReason(deps, "not_an_image");
});

Deno.test("materialize: image/* content-type but non-image bytes fails the sniff", async () => {
  const { deps, spy } = makeDeps({
    fetchUrl: async () =>
      new Response(HTML_BYTES, { status: 200, headers: { "content-type": "image/png" } }),
  });
  await expectReason(deps, "not_an_image");
  assertEquals(spy.putCalls.length, 0);
});

Deno.test("materialize: SVG is rejected even when declared as an image", async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const { deps } = makeDeps({
    fetchUrl: async () =>
      new Response(svg, { status: 200, headers: { "content-type": "image/svg+xml" } }),
  });
  await expectReason(deps, "not_an_image");
});

Deno.test("materialize: oversize declared via Content-Length is rejected before reading", async () => {
  const { deps } = makeDeps({
    fetchUrl: async () =>
      new Response(PNG_BYTES, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(LOGO_MAX_BYTES + 1),
        },
      }),
  });
  await expectReason(deps, "too_large");
});

Deno.test("materialize: streamed body over the cap is cut off (no Content-Length header)", async () => {
  // A stream that would deliver cap+1 bytes across chunks — the reader must cancel at the cap.
  const chunk = new Uint8Array(1024 * 1024); // 1 MB
  chunk.set(PNG_BYTES); // valid signature so ONLY the size gate can be the rejector
  let delivered = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (delivered > LOGO_MAX_BYTES) {
        controller.close();
        return;
      }
      delivered += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const { deps, spy } = makeDeps({
    fetchUrl: async () =>
      new Response(body, { status: 200, headers: { "content-type": "image/png" } }),
  });
  await expectReason(deps, "too_large");
  assertEquals(spy.putCalls.length, 0);
});

// ============================================================
// Storage: quota failure + claim race
// ============================================================

Deno.test("materialize: quota failure deletes the just-uploaded R2 object and soft-fails", async () => {
  const { deps, spy } = makeDeps({
    insertFile: async () => {
      throw new Error('quota_exceeded');
    },
  });
  await expectReason(deps, "quota_exceeded");
  assertEquals(spy.putCalls.length, 1);
  assertEquals(spy.deleteObjectCalls, [`contas/${CONTA_ID}/files/fixed-uuid.png`]);
});

Deno.test("materialize: non-quota insert failure cleans up R2 and rethrows (route maps to 500)", async () => {
  const { deps, spy } = makeDeps({
    insertFile: async () => {
      throw new Error("connection reset");
    },
  });
  let threw = false;
  try {
    await materializeBrandLogo(deps, ARGS);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
  assertEquals(spy.deleteObjectCalls, [`contas/${CONTA_ID}/files/fixed-uuid.png`]);
});

Deno.test("materialize: losing the claim race deletes our orphan file row and returns the winner", async () => {
  let reads = 0;
  const { deps, spy } = makeDeps({
    getBrand: async () => {
      reads++;
      // First read: not yet materialized. Re-read after the lost claim: the winner's id.
      return reads === 1
        ? { logo_url: "https://cdn.example.com/logo.png", logo_file_id: null }
        : { logo_url: "https://cdn.example.com/logo.png", logo_file_id: 42 };
    },
    claimLogoFileId: async () => false,
  });
  const result = await materializeBrandLogo(deps, ARGS);
  assertEquals(result, { logo_file_id: 42, created: false });
  assertEquals(spy.deleteRowCalls, [501]);
});

// ============================================================
// Pure helpers: notation + range matrices
// ============================================================

Deno.test("parseIpv4AnyNotation: notations normalize to the same address", () => {
  const loopback = parseIpv4AnyNotation("127.0.0.1");
  assertEquals(loopback, 0x7f000001);
  assertEquals(parseIpv4AnyNotation("127.1"), loopback);
  assertEquals(parseIpv4AnyNotation("127.0.1"), loopback);
  assertEquals(parseIpv4AnyNotation("2130706433"), loopback);
  assertEquals(parseIpv4AnyNotation("0x7f000001"), loopback);
  assertEquals(parseIpv4AnyNotation("0x7f.0.0.1"), loopback);
  assertEquals(parseIpv4AnyNotation("017700000001"), loopback);
  assertEquals(parseIpv4AnyNotation("0177.0.0.1"), loopback);
  assertEquals(parseIpv4AnyNotation("127.0.0.1."), loopback); // trailing dot
});

Deno.test("parseIpv4AnyNotation: non-IP hostnames and malformed numbers return null", () => {
  assertEquals(parseIpv4AnyNotation("cdn.example.com"), null);
  assertEquals(parseIpv4AnyNotation("localhost"), null);
  assertEquals(parseIpv4AnyNotation("256.0.0.1"), null); // octet overflow
  assertEquals(parseIpv4AnyNotation("1.2.3.4.5"), null); // too many parts
  assertEquals(parseIpv4AnyNotation("09.0.0.1"), null); // malformed octal
  assertEquals(parseIpv4AnyNotation(""), null);
  assertEquals(parseIpv4AnyNotation("4294967296"), null); // 2^32 — out of range
});

Deno.test("isIpLiteralHost: colon-shaped hosts are always literals (fail closed)", () => {
  assertEquals(isIpLiteralHost("[::1]"), true);
  assertEquals(isIpLiteralHost("::ffff:127.0.0.1"), true);
  assertEquals(isIpLiteralHost("[not:even:valid:ipv6]"), true);
  assertEquals(isIpLiteralHost("cdn.example.com"), false);
  assertEquals(isIpLiteralHost("0x7f.1"), true);
});

Deno.test("isDisallowedIpv4: range matrix", () => {
  const disallowed = [
    "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.254", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.254", "192.0.0.1", "192.168.0.1", "198.18.0.1", "198.19.255.254",
    "224.0.0.1", "240.0.0.1", "255.255.255.255",
  ];
  for (const a of disallowed) {
    assertEquals(isDisallowedIpv4(parseIpv4AnyNotation(a)!), true, `${a} should be disallowed`);
  }
  const allowed = ["8.8.8.8", "93.184.216.34", "100.63.0.1", "100.128.0.1", "172.15.0.1", "172.32.0.1", "192.0.1.1", "198.17.0.1", "198.20.0.1", "223.255.255.254"];
  for (const a of allowed) {
    assertEquals(isDisallowedIpv4(parseIpv4AnyNotation(a)!), false, `${a} should be allowed`);
  }
});

Deno.test("parseIpv6Groups: compression, embedded v4, zone ids, malformed", () => {
  assertEquals(parseIpv6Groups("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assertEquals(parseIpv6Groups("[::1]"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assertEquals(parseIpv6Groups("fe80::1%eth0"), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  assertEquals(parseIpv6Groups("::ffff:127.0.0.1"), [0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001]);
  assertEquals(
    parseIpv6Groups("2606:4700:0:0:0:0:6810:84e5"),
    [0x2606, 0x4700, 0, 0, 0, 0, 0x6810, 0x84e5],
  );
  assertEquals(parseIpv6Groups("1.2.3.4"), null); // no colon — not IPv6
  assertEquals(parseIpv6Groups("::1::2"), null); // double compression
  assertEquals(parseIpv6Groups("1:2:3"), null); // too few groups, no compression
});

Deno.test("isDisallowedIpv6: loopback/link-local/ULA/multicast/mapped-v4/NAT64", () => {
  for (const a of ["::", "::1", "fe80::1", "fc00::1", "fdff::1", "ff02::1", "::ffff:10.0.0.1", "64:ff9b::a00:1"]) {
    assertEquals(isDisallowedIpv6(a), true, `${a} should be disallowed`);
  }
  assertEquals(isDisallowedIpv6("2606:4700::6810:84e5"), false);
  assertEquals(isDisallowedIpv6("::ffff:8.8.8.8"), false); // mapped PUBLIC v4 is fine
  assertEquals(isDisallowedIpv6("garbage"), true); // unparseable fails closed
});

Deno.test("sniffImageBytes: accepts PNG/JPEG/GIF/WebP, rejects everything else", () => {
  assertEquals(sniffImageBytes(PNG_BYTES)?.mime, "image/png");
  assertEquals(sniffImageBytes(JPEG_BYTES)?.mime, "image/jpeg");
  assertEquals(sniffImageBytes(new TextEncoder().encode("GIF89a....."))?.mime, "image/gif");
  const webp = new Uint8Array(16);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  assertEquals(sniffImageBytes(webp)?.mime, "image/webp");
  assertEquals(sniffImageBytes(HTML_BYTES), null);
  assertEquals(sniffImageBytes(new Uint8Array(0)), null);
});
