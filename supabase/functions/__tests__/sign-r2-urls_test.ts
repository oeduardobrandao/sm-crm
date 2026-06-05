import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSignR2UrlsHandler } from "../sign-r2-urls/handler.ts";

function makeDeps(overrides: Partial<Parameters<typeof createSignR2UrlsHandler>[0]> = {}) {
  return {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "http://localhost" }),
    createDb: () => ({
      auth: {
        getUser: async (_token: string) => ({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: (table: string) => ({
        select: (_cols: string) => ({
          eq: (_col: string, _val: string) => ({
            single: async () => ({ data: { conta_id: "conta-abc" }, error: null }),
            // kb_articles lookup chains .in() after .eq(); default to no matches.
            in: async (_inCol: string, _vals: string[]) => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
    signGetUrl: async (key: string) => `https://r2.example.com/${key}?signed=1`,
    ...overrides,
  };
}

function makeReq(method: string, body?: unknown) {
  return new Request("http://localhost/sign-r2-urls", {
    method,
    headers: {
      "Authorization": "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

Deno.test("returns signed URLs for valid keys owned by user's workspace", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeReq("POST", {
    keys: ["contas/conta-abc/files/img1.webp", "contas/conta-abc/files/img2.png"],
  }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls["contas/conta-abc/files/img1.webp"], "https://r2.example.com/contas/conta-abc/files/img1.webp?signed=1");
  assertEquals(data.urls["contas/conta-abc/files/img2.png"], "https://r2.example.com/contas/conta-abc/files/img2.png?signed=1");
});

Deno.test("rejects keys not belonging to user's workspace", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeReq("POST", {
    keys: ["contas/other-workspace/files/img.webp"],
  }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls, {});
});

Deno.test("returns 401 without auth header", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(new Request("http://localhost/sign-r2-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [] }),
  }));
  assertEquals(res.status, 401);
});

Deno.test("returns 400 when keys is not an array", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeReq("POST", { keys: "not-array" }));
  assertEquals(res.status, 400);
});

Deno.test("handles OPTIONS for CORS preflight", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(new Request("http://localhost/sign-r2-urls", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});
