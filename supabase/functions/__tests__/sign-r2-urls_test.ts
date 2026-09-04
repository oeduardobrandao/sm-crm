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
            // platform_admins lookup chains .eq().abortSignal().maybeSingle(); default: not an admin.
            abortSignal: (_s: AbortSignal) => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          // global_popups admin lookup chains .select().abortSignal(); default: no rows.
          abortSignal: async (_s: AbortSignal) => ({ data: [], error: null }),
        }),
      }),
    }),
    createUserDb: (_authHeader: string) => ({
      from: (_table: string) => ({
        select: (_cols: string) => ({
          abortSignal: async (_s: AbortSignal) => ({ data: [], error: null }),
        }),
      }),
    }),
    signGetUrl: async (key: string) => `https://r2.example.com/${key}?signed=1`,
    getObjectBytes: async (key: string) =>
      key.includes("missing") ? null : new Uint8Array([0x89, 0x50, 0x4e]),
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

// ── GET byte-proxy route ─────────────────────────────────────────────────────

function makeGetReq(key: string, withAuth = true) {
  return new Request(
    `http://localhost/sign-r2-urls?key=${encodeURIComponent(key)}`,
    { method: "GET", headers: withAuth ? { Authorization: "Bearer test-token" } : {} },
  );
}

Deno.test("GET streams an own-conta object with CORS + content type + nosniff", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeGetReq("contas/conta-abc/files/img1.png"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "image/png");
  assertEquals(res.headers.get("X-Content-Type-Options"), "nosniff");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "http://localhost");
  assertEquals(res.headers.get("Cache-Control"), "private, max-age=3600");
  const bytes = new Uint8Array(await res.arrayBuffer());
  assertEquals(bytes.length, 3);
});

Deno.test("GET on an unknown extension falls back to octet-stream (never sniffable)", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeGetReq("contas/conta-abc/files/payload.svg"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/octet-stream");
});

Deno.test("GET on a foreign-conta key is 404 (existence never confirmed)", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeGetReq("contas/other-workspace/files/img.png"));
  assertEquals(res.status, 404);
});

Deno.test("GET on a missing object is 404", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeGetReq("contas/conta-abc/files/missing.png"));
  assertEquals(res.status, 404);
});

Deno.test("GET without auth header is 401", async () => {
  const handler = createSignR2UrlsHandler(makeDeps());
  const res = await handler(makeGetReq("contas/conta-abc/files/img1.png", false));
  assertEquals(res.status, 401);
});

// ── Imagens de popups (global_popups.pages[].image_key) ───────────────────────

const POPUP_KEY = "contas/00000000-0000-0000-0000-000000000000/files/popup.png";

function userDbReturning(rows: unknown[]) {
  return (_authHeader: string) => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        abortSignal: async (_s: AbortSignal) => ({ data: rows, error: null }),
      }),
    }),
  });
}

Deno.test("assina image_key de página de popup que a RLS do usuário devolve", async () => {
  const handler = createSignR2UrlsHandler(makeDeps({
    createUserDb: userDbReturning([{ pages: [{ title: "T", body: "B", image_key: POPUP_KEY }] }]),
  }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY, "contas/conta-abc/files/own.png"] }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls[POPUP_KEY], `https://r2.example.com/${POPUP_KEY}?signed=1`);
  assertEquals(data.urls["contas/conta-abc/files/own.png"], "https://r2.example.com/contas/conta-abc/files/own.png?signed=1");
});

Deno.test("não assina chave de popup que o client do usuário não devolve (draft ou não direcionado)", async () => {
  const handler = createSignR2UrlsHandler(makeDeps({ createUserDb: userDbReturning([]) }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY] }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).urls, {});
});

Deno.test("falha na consulta de popups não derruba a assinatura das ownKeys", async () => {
  const handler = createSignR2UrlsHandler(makeDeps({
    createUserDb: () => { throw new Error("boom"); },
  }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY, "contas/conta-abc/files/own.png"] }));
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.urls[POPUP_KEY], undefined);
  assertEquals(data.urls["contas/conta-abc/files/own.png"], "https://r2.example.com/contas/conta-abc/files/own.png?signed=1");
});

Deno.test("consulta de popups só roda quando há otherKeys", async () => {
  let called = 0;
  const handler = createSignR2UrlsHandler(makeDeps({
    createUserDb: (h) => { called++; return userDbReturning([])(h); },
  }));
  await handler(makeReq("POST", { keys: ["contas/conta-abc/files/own.png"] }));
  assertEquals(called, 0);
});

// ── Platform admin: qualquer imagem de popup, inclusive draft ────────────────

function adminDb(popupRows: unknown[]) {
  return () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin-user" } }, error: null }) },
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_c: string, _v: string) => ({
          single: async () => ({ data: { conta_id: "conta-abc" }, error: null }),
          in: async () => ({ data: [], error: null }),
          abortSignal: () => ({ maybeSingle: async () => ({ data: table === "platform_admins" ? { id: "adm-1" } : null, error: null }) }),
        }),
        abortSignal: async () => ({ data: table === "global_popups" ? popupRows : [], error: null }),
      }),
    }),
  });
}

Deno.test("platform admin: assina image_key de popup draft de outro admin (service role, sem RLS de usuário)", async () => {
  let userDbCalled = 0;
  const handler = createSignR2UrlsHandler(makeDeps({
    createDb: adminDb([{ pages: [{ title: "T", body: "B", image_key: POPUP_KEY }] }]),
    createUserDb: (h) => { userDbCalled++; return userDbReturning([])(h); },
  }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY] }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).urls[POPUP_KEY], `https://r2.example.com/${POPUP_KEY}?signed=1`);
  assertEquals(userDbCalled, 0);
});

Deno.test("platform admin: chave que nenhum popup referencia continua negada", async () => {
  const handler = createSignR2UrlsHandler(makeDeps({ createDb: adminDb([]) }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY] }));
  assertEquals((await res.json()).urls, {});
});

Deno.test("usuário comum (não admin) segue pela RLS do próprio contexto", async () => {
  let userDbCalled = 0;
  const handler = createSignR2UrlsHandler(makeDeps({
    createUserDb: (h) => { userDbCalled++; return userDbReturning([{ pages: [{ title: "T", body: "B", image_key: POPUP_KEY }] }])(h); },
  }));
  const res = await handler(makeReq("POST", { keys: [POPUP_KEY] }));
  assertEquals((await res.json()).urls[POPUP_KEY], `https://r2.example.com/${POPUP_KEY}?signed=1`);
  assertEquals(userDbCalled, 1);
});

Deno.test("não consulta popups quando a allowlist de artigos já resolveu todas as otherKeys", async () => {
  let adminChecked = 0;
  let userDbCalled = 0;
  const KB = "contas/kb-owner/files/cover.png";
  const handler = createSignR2UrlsHandler(makeDeps({
    createDb: () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
      from: (table: string) => ({
        select: (_c: string) => ({
          eq: (_col: string, _v: string) => ({
            single: async () => ({ data: { conta_id: "conta-abc" }, error: null }),
            in: async () => ({ data: table === "kb_articles" ? [{ cover_image_url: KB }] : [], error: null }),
            abortSignal: (_s: AbortSignal) => ({
              maybeSingle: async () => { adminChecked++; return { data: null, error: null }; }
            }),
          }),
          abortSignal: async (_s: AbortSignal) => ({ data: [], error: null }),
        }),
      }),
    }),
    createUserDb: (h) => { userDbCalled++; return userDbReturning([])(h); },
  }));
  const res = await handler(makeReq("POST", { keys: [KB, "contas/conta-abc/files/own.png"] }));
  const data = await res.json();
  assertEquals(data.urls[KB], `https://r2.example.com/${KB}?signed=1`);
  assertEquals(adminChecked, 0);
  assertEquals(userDbCalled, 0);
});
