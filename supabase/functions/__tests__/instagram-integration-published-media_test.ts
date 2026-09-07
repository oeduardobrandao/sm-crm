import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { handlePublishedMedia } from "../instagram-integration/published-media.ts";
import type { Deps } from "../instagram-integration/published-media.ts";

// --- Mock helpers -----------------------------------------------------------
// Minimal fluent chain: `.select().eq()...single()/.maybeSingle()` and a
// separate `.update(payload).eq()` path, both hanging off the same table
// object so `svc.from(table)` can be called once per query the handler makes.

// deno-lint-ignore no-explicit-any
function selectChain(resolver: () => { data: unknown; error: unknown }): any {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.single = () => Promise.resolve(resolver());
  chain.maybeSingle = () => Promise.resolve(resolver());
  return chain;
}

function accountsTable(
  row: Record<string, unknown> | null,
  onUpdate?: (payload: Record<string, unknown>) => void,
  // deno-lint-ignore no-explicit-any
): any {
  const table: Record<string, unknown> = {};
  table.select = () => table;
  table.eq = () => table;
  table.single = () => Promise.resolve({ data: row, error: null });
  table.update = (payload: Record<string, unknown>) => {
    onUpdate?.(payload);
    return { eq: () => Promise.resolve({ data: null, error: null }) };
  };
  return table;
}

interface MakeDepsOpts {
  permission?: boolean;
  role?: string;
  ownsClient?: boolean;
  authorizationStatus?: string;
  encryptedAccessToken?: string | null;
  onDecrypt?: () => void;
  graph?: Record<string, unknown>;
  graphError?: Record<string, unknown>;
  onFetch?: (url: string) => void;
  onUpdate?: (payload: Record<string, unknown>) => void;
  rateLimitAllowed?: boolean;
  onRateLimit?: (key: string, maxRequests: number, windowSeconds: number) => void;
  // Quando true, NAO seta `fetchImpl` no Deps retornado -- forca o handler a
  // montar `makeBoundedFetch(...)` de verdade (para o teste I3 de prazo).
  omitFetchImpl?: boolean;
  graphTimeoutMs?: number;
}

function makeDeps(opts: MakeDepsOpts = {}): Deps {
  const contaId = "conta-1";
  const accountRow = {
    id: "acct-1",
    encrypted_access_token: opts.encryptedAccessToken === undefined ? "ENC_TOKEN" : opts.encryptedAccessToken,
    authorization_status: opts.authorizationStatus ?? "active",
  };

  const svc = {
    from(table: string) {
      if (table === "profiles") {
        return selectChain(() => ({ data: { active_workspace_id: contaId }, error: null }));
      }
      if (table === "workspace_members") {
        return selectChain(() => ({ data: { user_id: "user-1", role: opts.role ?? "owner" }, error: null }));
      }
      if (table === "instagram_accounts") {
        return accountsTable(accountRow, opts.onUpdate);
      }
      throw new Error(`makeDeps: unexpected table "${table}"`);
    },
    rpc(name: string, _params: Record<string, unknown>) {
      if (name === "has_permission_for") {
        return Promise.resolve({ data: opts.permission ?? true, error: null });
      }
      throw new Error(`makeDeps: unexpected rpc "${name}"`);
    },
  };

  const fetchImpl = ((input: RequestInfo | URL) => {
    const urlStr = String(input);
    opts.onFetch?.(urlStr);
    if (opts.graphError) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: opts.graphError }), { status: 400 }),
      );
    }
    const payload = opts.graph ?? { data: [], paging: {} };
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
  }) as typeof fetch;

  return {
    // deno-lint-ignore no-explicit-any
    svc: svc as any,
    userId: "user-1",
    corsHeaders: {},
    decryptToken: (_encryptedBase64: string) => {
      opts.onDecrypt?.();
      return Promise.resolve("decrypted-token");
    },
    verifyClientOwnership: (
      _svc: unknown,
      _clientId: string,
      _contaId: string,
    ) => Promise.resolve(opts.ownsClient ?? true),
    checkRateLimit: (key: string, maxRequests: number, windowSeconds: number) => {
      opts.onRateLimit?.(key, maxRequests, windowSeconds);
      return Promise.resolve(opts.rateLimitAllowed ?? true);
    },
    fetchImpl: opts.omitFetchImpl ? undefined : fetchImpl,
    graphTimeoutMs: opts.graphTimeoutMs,
  };
}

function req(clientId: string, body: unknown = {}) {
  return new Request(`https://x/instagram-integration/published-media/${clientId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Tests -------------------------------------------------------------------

Deno.test("published-media: 403 sem automacoes:editar", async () => {
  const res = await handlePublishedMedia(req("42"), makeDeps({ permission: false }));
  assertEquals(res.status, 403);
});

Deno.test("published-media: 200 para agent, que tem automacoes:editar", async () => {
  const res = await handlePublishedMedia(req("42"), makeDeps({ permission: true, role: "agent" }));
  assertEquals(res.status, 200);
});

Deno.test("published-media: 403 para client_id de outra workspace", async () => {
  const res = await handlePublishedMedia(req("999"), makeDeps({ permission: true, ownsClient: false }));
  assertEquals(res.status, 403);
});

Deno.test("published-media: 409 quando a conta nao esta ativa, sem descriptografar", async () => {
  let decrypted = false;
  const res = await handlePublishedMedia(
    req("42"),
    makeDeps({ permission: true, authorizationStatus: "revoked", onDecrypt: () => { decrypted = true; } }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "instagram_not_authorized");
  assertEquals(decrypted, false);
});

Deno.test("published-media: mapeia a lista e repassa next_cursor", async () => {
  const graph = {
    data: [{ id: "1813", caption: "oi", media_type: "VIDEO", thumbnail_url: "t", permalink: "p", timestamp: "2026-09-07T12:00:10+0000" }],
    paging: { cursors: { after: "CURSOR_2" } },
  };
  const res = await handlePublishedMedia(req("42"), makeDeps({ permission: true, graph }));
  const body = await res.json();
  assertEquals(body.posts[0].id, "1813");
  assertEquals(body.next_cursor, "CURSOR_2");
});

Deno.test("published-media: segunda pagina manda o after certo", async () => {
  let urlUsada = "";
  const res = await handlePublishedMedia(
    req("42", { cursor: "CURSOR_2" }),
    makeDeps({ permission: true, onFetch: (u: string) => { urlUsada = u; } }),
  );
  assertEquals(res.status, 200);
  assertStringIncludes(urlUsada, "after=CURSOR_2");
});

Deno.test("published-media: erro 10 da Graph carimba revoked", async () => {
  const updates: Record<string, unknown>[] = [];
  await handlePublishedMedia(
    req("42"),
    makeDeps({ permission: true, graphError: { code: 10 }, onUpdate: (u) => updates.push(u) }),
  );
  assertEquals(updates[0].authorization_status, "revoked");
});

Deno.test("published-media: token rejeitado carimba authorization_status", async () => {
  const updates: Record<string, unknown>[] = [];
  await handlePublishedMedia(
    req("42"),
    makeDeps({ permission: true, graphError: { code: 190 }, onUpdate: (u) => updates.push(u) }),
  );
  assertEquals(updates[0].authorization_status, "expired");
});

Deno.test("published-media: nao descriptografa token de cliente de outra workspace", async () => {
  let decrypted = false;
  const res = await handlePublishedMedia(
    req("999"),
    makeDeps({ permission: true, ownsClient: false, onDecrypt: () => { decrypted = true; } }),
  );
  assertEquals(res.status, 403);
  assertEquals(decrypted, false);
});

Deno.test("published-media: Graph API pendurada devolve erro dentro do prazo", async () => {
  const res = await handlePublishedMedia(
    req("42"),
    // fetchImpl que rejeita como AbortSignal.timeout faria
    makeDeps({ permission: true, onFetch: () => { throw new DOMException("timeout", "TimeoutError"); } }),
  );
  assertEquals(res.status, 502);
});

Deno.test("published-media: erro da Graph API nao vaza detalhe", async () => {
  const res = await handlePublishedMedia(
    req("42"),
    makeDeps({ permission: true, graphError: { message: "OAuthException: token xyz leaked" } }),
  );
  const body = await res.json();
  assertEquals(body.message.includes("xyz"), false);
});

// --- C1: falha de transporte na Graph nao pode vazar o access_token no log ---
//
// Reproduz o achado do revisor: em Deno, connection refused / reset / TLS / DNS
// produz um erro cuja `.message` inclui a URL INTEIRA da requisicao, e essa URL
// carrega `access_token=<token em claro>`. `console.error` e substituido
// temporariamente pra capturar exatamente o que sairia no log do Supabase.
Deno.test("published-media: erro de transporte na Graph nao vaza o access_token no log", async () => {
  const originalConsoleError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const res = await handlePublishedMedia(
      req("42"),
      makeDeps({
        permission: true,
        // Reproduz literalmente a saida real capturada pelo revisor: um
        // TypeError cuja mensagem inclui a URL da Graph com o
        // access_token=decrypted-token (o valor que makeDeps.decryptToken
        // devolve) em claro.
        onFetch: (url: string) => {
          throw new TypeError(
            `error sending request for url (${url}): client error (Connect): tcp connect error: Connection refused (os error 61)`,
          );
        },
      }),
    );
    assertEquals(res.status, 502);
  } finally {
    console.error = originalConsoleError;
  }
  const allLogged = logged.join("\n");
  assertEquals(allLogged.includes("decrypted-token"), false);
  assertEquals(allLogged.includes("access_token"), false);
});

// --- I2: rate limit por (workspace, cliente) na Graph API -------------------

Deno.test("published-media: 429 quando o rate limit estoura", async () => {
  const res = await handlePublishedMedia(
    req("42"),
    makeDeps({ permission: true, rateLimitAllowed: false }),
  );
  assertEquals(res.status, 429);
  const body = await res.json();
  assertEquals(body.error, "Rate limit exceeded");
});

Deno.test("published-media: chave do rate limit e por workspace + cliente, 30/60s", async () => {
  let capturedKey = "";
  let capturedMax = 0;
  let capturedWindow = 0;
  const res = await handlePublishedMedia(
    req("42"),
    makeDeps({
      permission: true,
      onRateLimit: (key, max, windowSeconds) => {
        capturedKey = key;
        capturedMax = max;
        capturedWindow = windowSeconds;
      },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(capturedKey, "ig-published-media:conta-1:42");
  assertEquals(capturedMax, 30);
  assertEquals(capturedWindow, 60);
});

Deno.test("published-media: rate limit e checado ANTES de descriptografar (usuario sem ownership nao consome o budget)", async () => {
  let rateLimitCalled = false;
  const res = await handlePublishedMedia(
    req("999"),
    makeDeps({ permission: true, ownsClient: false, onRateLimit: () => { rateLimitCalled = true; } }),
  );
  assertEquals(res.status, 403);
  assertEquals(rateLimitCalled, false);
});

// --- I3: o prazo da chamada a Graph e aplicado de verdade (makeBoundedFetch) -
//
// Sem `fetchImpl` nas deps, o handler monta `makeBoundedFetch(graphTimeoutMs)`
// de verdade. `globalThis.fetch` e substituido por um stub que so resolve
// (rejeitando) quando o `AbortSignal` recebido dispara -- exatamente o
// contrato real do fetch com `signal`, sem reimplementar makeBoundedFetch.
// Um `graphTimeoutMs` pequeno mantem o teste rapido no caminho feliz; o
// `Promise.race` com um teto curto garante uma falha RAPIDA e limpa (em vez
// de travar pendurado) se a mutacao (`deps.fetchImpl ?? fetch`, sem
// makeBoundedFetch) remover o signal por completo.
Deno.test("published-media: sem fetchImpl, o prazo da Graph e aplicado por makeBoundedFetch de verdade", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // sem signal: nunca resolve (prova que o prazo so vem do signal)
      if (signal.aborted) {
        reject(new DOMException("Signal timed out.", "TimeoutError"));
        return;
      }
      signal.addEventListener("abort", () => {
        reject(new DOMException("Signal timed out.", "TimeoutError"));
      });
    })) as typeof fetch;

  let timeoutId: number | undefined;
  try {
    const deps = makeDeps({ permission: true, omitFetchImpl: true, graphTimeoutMs: 50 });
    const res = await Promise.race([
      handlePublishedMedia(req("42"), deps),
      new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("handler ficou pendurado -- nenhum prazo foi aplicado")), 1500);
      }),
    ]);
    assertEquals(res.status, 502);
  } finally {
    clearTimeout(timeoutId);
    globalThis.fetch = originalFetch;
  }
});

// --- M4: corpo JSON valido igual a `null` nao pode estourar fora do try -----

Deno.test("published-media: corpo JSON 'null' (valido, nao malformado) nao crasha -- usa defaults", async () => {
  const res = await handlePublishedMedia(req("42", null), makeDeps({ permission: true }));
  assertEquals(res.status, 200);
});

// --- M5: encrypted_access_token nulo com conta 'active' nao pode estourar ---

Deno.test("published-media: conta 'active' com token nulo vira 409 instagram_not_authorized, sem descriptografar", async () => {
  let decrypted = false;
  const res = await handlePublishedMedia(
    req("42"),
    makeDeps({ permission: true, encryptedAccessToken: null, onDecrypt: () => { decrypted = true; } }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "instagram_not_authorized");
  assertEquals(decrypted, false);
});

// --- M6: o clamp de `limit` deve inteirizar (Math.floor) --------------------

Deno.test("published-media: limit fracionario e inteirizado antes de ir pra Graph", async () => {
  let urlUsada = "";
  const res = await handlePublishedMedia(
    req("42", { limit: 30.7 }),
    makeDeps({ permission: true, onFetch: (u: string) => { urlUsada = u; } }),
  );
  assertEquals(res.status, 200);
  assertStringIncludes(urlUsada, "limit=30");
  assertEquals(urlUsada.includes("30.7"), false);
});
