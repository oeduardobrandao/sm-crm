import { assert, assertEquals } from "jsr:@std/assert";
import {
  createGeoAutocompleteHandler,
  type GeoAutocompleteDeps,
  LIMITE_SUGESTOES,
  mapearResultados,
  urlGeoapify,
} from "../geo-autocomplete/handler.ts";

const KEY = "geo-secret-key-123";

function harness(over: Partial<GeoAutocompleteDeps> = {}) {
  const calls = { rate: [] as Array<[string, number, number]>, fetch: [] as string[] };
  const deps: GeoAutocompleteDeps = {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://app.test" }),
    getUser: (jwt) => Promise.resolve(jwt === "good" ? { id: "u1" } : null),
    rateLimit: (k, m, w) => {
      calls.rate.push([k, m, w]);
      return Promise.resolve(true);
    },
    apiKey: () => KEY,
    fetch: (url) => {
      calls.fetch.push(url);
      return Promise.resolve(Response.json({
        results: [
          { formatted: "Av. Paulista, 1000 - Bela Vista, São Paulo - SP, Brasil", address_line1: "Av. Paulista, 1000", address_line2: "Bela Vista, São Paulo - SP, Brasil" },
        ],
      }));
    },
    ...over,
  };
  return { handler: createGeoAutocompleteHandler(deps), calls };
}

const req = (q: string | null, jwt: string | null = "good", method = "GET") => {
  const u = new URL("http://localhost/geo-autocomplete");
  if (q !== null) u.searchParams.set("q", q);
  const headers: Record<string, string> = {};
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  return new Request(u, { method, headers });
};

Deno.test("geo-autocomplete: OPTIONS answers 204 with CORS", async () => {
  const { handler, calls } = harness();
  const res = await handler(req(null, null, "OPTIONS"));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  assertEquals(calls.fetch.length, 0);
});

Deno.test("geo-autocomplete: no or bad JWT is a 401 and Geoapify is not called", async () => {
  const { handler, calls } = harness();
  assertEquals((await handler(req("paulista", null))).status, 401);
  assertEquals((await handler(req("paulista", "bad"))).status, 401);
  assertEquals(calls.fetch.length, 0);
});

Deno.test("geo-autocomplete: text shorter than 3 or longer than 200 is a 400", async () => {
  const { handler, calls } = harness();
  assertEquals((await handler(req("ab"))).status, 400);
  assertEquals((await handler(req("  a  "))).status, 400);
  assertEquals((await handler(req("x".repeat(201)))).status, 400);
  assertEquals(calls.fetch.length, 0);
});

Deno.test("geo-autocomplete: missing key is a 503 without upstream call", async () => {
  const { handler, calls } = harness({ apiKey: () => undefined });
  assertEquals((await handler(req("paulista"))).status, 503);
  assertEquals(calls.fetch.length, 0);
});

Deno.test("geo-autocomplete: rate limited per user", async () => {
  const { handler, calls } = harness({ rateLimit: () => Promise.resolve(false) });
  const res = await handler(req("paulista"));
  assertEquals(res.status, 429);
  assertEquals(calls.fetch.length, 0);
});

Deno.test("geo-autocomplete: ok maps suggestions, debits the user's key, never returns the API key", async () => {
  const { handler, calls } = harness();
  const res = await handler(req("  av paulista  "));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Cache-Control"), "private, max-age=3600");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  const text = await res.text();
  assert(!text.includes(KEY), "API key leaked into the response");
  assertEquals(JSON.parse(text), {
    sugestoes: [{
      rotulo: "Av. Paulista, 1000 - Bela Vista, São Paulo - SP, Brasil",
      linha1: "Av. Paulista, 1000",
      linha2: "Bela Vista, São Paulo - SP, Brasil",
    }],
  });
  assertEquals(calls.rate, [["geo-autocomplete:u1", 60, 60]]);
  const up = new URL(calls.fetch[0]);
  assertEquals(up.origin + up.pathname, "https://api.geoapify.com/v1/geocode/autocomplete");
  assertEquals(up.searchParams.get("text"), "av paulista");
  assertEquals(up.searchParams.get("lang"), "pt");
  assertEquals(up.searchParams.get("bias"), "countrycode:br");
  assertEquals(up.searchParams.get("format"), "json");
  assertEquals(up.searchParams.get("apiKey"), KEY);
});

Deno.test("geo-autocomplete: upstream error or network failure is a 502 and the key is not logged", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => logged.push(a.map(String).join(" "));
  try {
    const bad = harness({ fetch: () => Promise.resolve(new Response("nope", { status: 401 })) });
    assertEquals((await bad.handler(req("paulista"))).status, 502);
    const down = harness({ fetch: () => Promise.reject(new TypeError(`fetch failed for ...apiKey=${KEY}`)) });
    assertEquals((await down.handler(req("paulista"))).status, 502);
  } finally {
    console.error = orig;
  }
  assert(logged.length >= 2);
  assert(logged.every((l) => !l.includes(KEY)), "API key reached the logs");
});

Deno.test("geo-autocomplete: a throwing getUser is a generic 500", async () => {
  const { handler } = harness({ getUser: () => Promise.reject(new Error("auth down")) });
  const res = await handler(req("paulista"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro interno" });
});

Deno.test("geo-autocomplete: non-GET methods are 404", async () => {
  const { handler } = harness();
  assertEquals((await handler(req("paulista", "good", "POST"))).status, 404);
});

Deno.test("mapearResultados: drops empty/duplicate rows, falls back to the label, caps the list", () => {
  const rows = [
    { formatted: "A" },
    { formatted: "A", address_line1: "dup" },
    { formatted: "  " },
    { address_line1: "sem formatted" },
    ...Array.from({ length: 10 }, (_, i) => ({ formatted: `R${i}`, address_line1: `L${i}`, address_line2: 7 })),
  ];
  const out = mapearResultados({ results: rows });
  assertEquals(out.length, LIMITE_SUGESTOES);
  assertEquals(out[0], { rotulo: "A", linha1: "A", linha2: "" });
  assertEquals(out[1], { rotulo: "R0", linha1: "L0", linha2: "" });
  assertEquals(mapearResultados(null), []);
  assertEquals(mapearResultados({ results: "x" }), []);
});

Deno.test("urlGeoapify: encodes the query", () => {
  const u = new URL(urlGeoapify("Rua & Cia, 10", "k"));
  assertEquals(u.searchParams.get("text"), "Rua & Cia, 10");
  assertEquals(u.searchParams.get("limit"), String(LIMITE_SUGESTOES));
});
