import { assert, assertEquals } from "./assert.ts";
import { fetchImageSafely, type SafeFetchDeps } from "../_shared/safe-image-fetch.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 10, 0, 0, 0, 5]);
function deps(over: Partial<SafeFetchDeps> = {}): SafeFetchDeps {
  return {
    resolveDns: async (_h, t) => (t === "A" ? ["93.184.216.34"] : []),
    fetchUrl: async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }),
    ...over,
  };
}
const OPTS = { maxBytes: 1024, timeoutMs: 1000 };

Deno.test("fetchImageSafely: feliz — bytes, mime sniffado, ext", async () => {
  const r = await fetchImageSafely(deps(), "https://cdn.example.com/a.png", OPTS);
  assert(r.ok);
  assertEquals(r.mime, "image/png"); assertEquals(r.ext, "png"); assertEquals(r.truncated, false);
  assertEquals(r.bytes.byteLength, PNG.byteLength);
});

Deno.test("fetchImageSafely: http, credenciais, IP literal, URL inválida", async () => {
  assertEquals(await fetchImageSafely(deps(), "http://x.y/a.png", OPTS), { ok: false, reason: "not_https" });
  assertEquals(await fetchImageSafely(deps(), "https://u:p@x.y/a.png", OPTS), { ok: false, reason: "invalid_url" });
  assertEquals(await fetchImageSafely(deps(), "https://127.0.0.1/a.png", OPTS), { ok: false, reason: "ip_literal_host" });
  assertEquals(await fetchImageSafely(deps(), "https://0x7f000001/a.png", OPTS), { ok: false, reason: "ip_literal_host" });
  assertEquals(await fetchImageSafely(deps(), "https://[::1]/a.png", OPTS), { ok: false, reason: "ip_literal_host" });
  assertEquals(await fetchImageSafely(deps(), "nada", OPTS), { ok: false, reason: "invalid_url" });
});

Deno.test("fetchImageSafely: DNS para endereço privado, sem resposta ou pendurado falha fechado", async () => {
  assertEquals(await fetchImageSafely(deps({ resolveDns: async (_h, t) => (t === "A" ? ["10.0.0.5"] : []) }), "https://x.y/a", OPTS), { ok: false, reason: "private_address" });
  assertEquals(await fetchImageSafely(deps({ resolveDns: async (_h, t) => (t === "AAAA" ? ["::ffff:169.254.169.254"] : []) }), "https://x.y/a", OPTS), { ok: false, reason: "private_address" });
  assertEquals(await fetchImageSafely(deps({ resolveDns: async () => [] }), "https://x.y/a", OPTS), { ok: false, reason: "dns_resolution_failed" });
  assertEquals(await fetchImageSafely(deps({ resolveDns: () => new Promise(() => {}), dnsTimeoutMs: 20 }), "https://x.y/a", OPTS), { ok: false, reason: "dns_resolution_failed" });
});

Deno.test("fetchImageSafely: redirect, não-OK, content-type, sniff", async () => {
  const at = (status: number, body: BodyInit | null, ct = "image/png") =>
    deps({ fetchUrl: async () => new Response(body, { status, headers: { "content-type": ct, location: "https://evil/x" } }) });
  assertEquals(await fetchImageSafely(at(302, null), "https://x.y/a", OPTS), { ok: false, reason: "redirect_rejected" });
  assertEquals(await fetchImageSafely(at(404, "nope"), "https://x.y/a", OPTS), { ok: false, reason: "fetch_failed" });
  assertEquals(await fetchImageSafely(at(200, "<svg/>", "image/svg+xml"), "https://x.y/a", OPTS), { ok: false, reason: "not_an_image" });
  assertEquals(await fetchImageSafely(at(200, "texto", "text/html"), "https://x.y/a", OPTS), { ok: false, reason: "not_an_image" });
});

Deno.test("fetchImageSafely: cap por Content-Length e por stream; truncate devolve parcial", async () => {
  const big = new Uint8Array(2048); big.set(PNG);
  const d = deps({ fetchUrl: async () => new Response(big, { status: 200, headers: { "content-type": "image/png" } }) });
  assertEquals(await fetchImageSafely(d, "https://x.y/a", OPTS), { ok: false, reason: "too_large" });
  const streamed = deps({ fetchUrl: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(big.slice(0, 1000)); c.enqueue(big.slice(1000)); c.close(); },
  }), { status: 200, headers: { "content-type": "image/png" } }) });
  assertEquals(await fetchImageSafely(streamed, "https://x.y/a", OPTS), { ok: false, reason: "too_large" });
  const partial = await fetchImageSafely(streamed, "https://x.y/a", { ...OPTS, truncate: true });
  assert(partial.ok);
  assertEquals(partial.truncated, true);
  assert(partial.bytes.byteLength <= 1024 && partial.bytes.byteLength >= 24);
});

Deno.test("fetchImageSafely: fetch com redirect manual, Accept image/* e signal", async () => {
  let init: RequestInit | undefined;
  await fetchImageSafely(deps({ fetchUrl: async (_u, i) => { init = i; return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }); } }), "https://x.y/a", OPTS);
  assertEquals(init?.redirect, "manual");
  assert(init?.signal instanceof AbortSignal);
});
