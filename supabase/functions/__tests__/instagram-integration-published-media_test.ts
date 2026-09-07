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
  onDecrypt?: () => void;
  graph?: Record<string, unknown>;
  graphError?: Record<string, unknown>;
  onFetch?: (url: string) => void;
  onUpdate?: (payload: Record<string, unknown>) => void;
}

function makeDeps(opts: MakeDepsOpts = {}): Deps {
  const contaId = "conta-1";
  const accountRow = {
    id: "acct-1",
    encrypted_access_token: "ENC_TOKEN",
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
    fetchImpl,
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
