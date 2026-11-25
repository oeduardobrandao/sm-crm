// Teste de colaboradores no agendamento: probeCollaborators e o uso dele em
// validateForScheduling.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-token-key");

const {
  collaboratorRefusedMessage,
  probeCollaborators,
  validateForScheduling,
} = await import("../_shared/instagram-publish-utils.ts");
type ProbeFn = typeof probeCollaborators;

async function encryptedToken(value = "ig-token") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("test-token-key".padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value)),
  );
  const combined = new Uint8Array(iv.length + data.length);
  combined.set(iv);
  combined.set(data, iv.length);
  return btoa(String.fromCharCode(...combined));
}

function stubFetch(respond: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    urls.push(String(input));
    const body = JSON.parse(String(init?.body ?? "{}"));
    bodies.push(body);
    return await respond(body);
  }) as typeof fetch;
  return { bodies, urls, restore: () => { globalThis.fetch = original; } };
}

function graphError(error: Record<string, unknown>, status = 400) {
  return new Response(JSON.stringify({ error }), { status });
}

const IMG = "https://app.example/ig-collab-probe.jpg";

// ---------------------------------------------------------------- probe

Deno.test("probe: container criado → ok, com collaborators e a imagem de teste", async () => {
  const f = stubFetch(() => new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
  try {
    const r = await probeCollaborators("ig1", "tok", ["ana", "bia"], { imageUrl: IMG });
    assertEquals(r.status, "ok");
    assertEquals(f.urls.length, 1);
    assert(f.urls[0].endsWith("/ig1/media"), "POST no /{ig-user-id}/media");
    assertEquals(f.bodies[0].collaborators, ["ana", "bia"]);
    assertEquals(f.bodies[0].image_url, IMG);
    assertEquals(f.bodies[0].caption, "");
  } finally {
    f.restore();
  }
});

Deno.test("probe: subcode 2207018 → refused com os nomes que a Meta citou", async () => {
  const f = stubFetch(() =>
    graphError({
      message: "Invalid user id",
      code: 110,
      error_subcode: 2207018,
      error_user_msg: "Os seguintes usuários não podem ser acessados: bia",
    })
  );
  try {
    const r = await probeCollaborators("ig1", "tok", ["ana", "bia"], { imageUrl: IMG });
    assertEquals(r, { status: "refused", refused: ["bia"] });
  } finally {
    f.restore();
  }
});

Deno.test("probe: 'User not visible' → refused sem nomes", async () => {
  const f = stubFetch(() => graphError({ message: "User not visible", code: 100 }));
  try {
    const r = await probeCollaborators("ig1", "tok", ["portal"], { imageUrl: IMG });
    assertEquals(r, { status: "refused", refused: [] });
  } finally {
    f.restore();
  }
});

Deno.test("probe: erro que não é de colaborador → skipped (falha aberta)", async () => {
  const f = stubFetch(() => graphError({ message: "An unexpected error has occurred.", code: 2 }, 500));
  try {
    const r = await probeCollaborators("ig1", "tok", ["ana"], { imageUrl: IMG });
    assertEquals(r.status, "skipped");
  } finally {
    f.restore();
  }
});

Deno.test("probe: fetch lança (timeout) → skipped", async () => {
  const f = stubFetch(() => {
    throw new DOMException("Signal timed out.", "TimeoutError");
  });
  try {
    const r = await probeCollaborators("ig1", "tok", ["ana"], { imageUrl: IMG });
    assertEquals(r.status, "skipped");
  } finally {
    f.restore();
  }
});

Deno.test("probe: sem URL da imagem → skipped sem chamar a Meta", async () => {
  const f = stubFetch(() => new Response("{}"));
  try {
    const r = await probeCollaborators("ig1", "tok", ["ana"], { imageUrl: null });
    assertEquals(r.status, "skipped");
    assertEquals(f.urls.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("probe: lista vazia → ok sem chamar a Meta", async () => {
  const f = stubFetch(() => new Response("{}"));
  try {
    const r = await probeCollaborators("ig1", "tok", [], { imageUrl: IMG });
    assertEquals(r.status, "ok");
    assertEquals(f.urls.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("collaboratorRefusedMessage: um, vários e nenhum nome", () => {
  assert(collaboratorRefusedMessage(["ana"]).includes("o colaborador @ana."));
  assert(collaboratorRefusedMessage(["ana", "bia"]).includes("os colaboradores @ana, @bia."));
  assert(collaboratorRefusedMessage([]).includes("um dos colaboradores"));
});

// ---------------------------------------------------------- validate

async function seed(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts: { collaborators?: string[]; tipo?: string; caption?: string } = {},
) {
  db.queue("workflow_posts", "select", {
    data: {
      id: 1, scheduled_at: null, ig_caption: opts.caption ?? "cap", workflow_id: 9,
      cliente_id: 5, tipo: opts.tipo ?? "feed", ig_trial_strategy: null,
      ig_collaborators: opts.collaborators ?? ["ana"], platform: "instagram",
    },
    error: null,
  });
  db.queue("post_file_links", "select", {
    data: [{
      sort_order: 0,
      files: {
        id: 1, kind: "image", mime_type: "image/jpeg", size_bytes: 1_000_000,
        width: 1080, height: 1080, duration_seconds: null, r2_key: "img/0.jpg",
      },
    }],
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: await encryptedToken(),
      instagram_user_id: "ig1",
      token_expires_at: null,
      authorization_status: "active",
    },
    error: null,
  });
}

function spyProbe(result: Awaited<ReturnType<ProbeFn>>) {
  const calls: unknown[][] = [];
  const probe = ((...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve(result);
  }) as unknown as ProbeFn;
  return { calls, probe };
}

Deno.test("validate: recusa no teste → não ok, erro com o @ e refusedCollaborators", async () => {
  const db = createSupabaseQueryMock();
  await seed(db, { collaborators: ["ana", "bia"] });
  const spy = spyProbe({ status: "refused", refused: ["bia"] });
  const res = await validateForScheduling(db as never, 1, {
    skipDateCheck: true, probeCollaborators: true, probe: spy.probe,
  });
  assert(!res.ok);
  assert(res.errors.some((e) => e.includes("@bia")), "erro nomeia o @ recusado");
  assertEquals(res.refusedCollaborators, ["bia"]);
  assertEquals(spy.calls.length, 1);
  assertEquals(spy.calls[0].slice(0, 3), ["ig1", "ig-token", ["ana", "bia"]]);
});

Deno.test("validate: teste ok ou inconclusivo → agenda normalmente", async () => {
  for (const status of ["ok", "skipped"] as const) {
    const db = createSupabaseQueryMock();
    await seed(db);
    const spy = spyProbe({ status });
    const res = await validateForScheduling(db as never, 1, {
      skipDateCheck: true, probeCollaborators: true, probe: spy.probe,
    });
    assert(res.ok, `status ${status} não bloqueia`);
    assertEquals(res.refusedCollaborators, undefined);
    assertEquals(spy.calls.length, 1);
  }
});

Deno.test("validate: sem probeCollaborators (publicar agora) → não testa", async () => {
  const db = createSupabaseQueryMock();
  await seed(db);
  const spy = spyProbe({ status: "refused", refused: ["ana"] });
  const res = await validateForScheduling(db as never, 1, { skipDateCheck: true, probe: spy.probe });
  assert(res.ok);
  assertEquals(spy.calls.length, 0);
});

Deno.test("validate: sem colaboradores → não testa", async () => {
  const db = createSupabaseQueryMock();
  await seed(db, { collaborators: [] });
  const spy = spyProbe({ status: "refused", refused: [] });
  const res = await validateForScheduling(db as never, 1, {
    skipDateCheck: true, probeCollaborators: true, probe: spy.probe,
  });
  assert(res.ok);
  assertEquals(spy.calls.length, 0);
});

Deno.test("validate: outro erro de validação → não gasta container no teste", async () => {
  const db = createSupabaseQueryMock();
  await seed(db, { caption: "" });
  const spy = spyProbe({ status: "refused", refused: ["ana"] });
  const res = await validateForScheduling(db as never, 1, {
    skipDateCheck: true, probeCollaborators: true, probe: spy.probe,
  });
  assert(!res.ok);
  assertEquals(spy.calls.length, 0);
  assertEquals(res.refusedCollaborators, undefined);
});

// ------------------------------------------------ recordRefusedCollaborators

const { recordRefusedCollaborators } = await import("../_shared/instagram-collaborators.ts");

Deno.test("recordRefusedCollaborators: grava a lista recusada no post", async () => {
  const db = createSupabaseQueryMock();
  await recordRefusedCollaborators(db as never, 7, ["bia"]);
  const updates = db.calls.filter((c) => c.table === "workflow_posts" && c.operation === "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, { ig_collaborators_refused: ["bia"] });
});

Deno.test("recordRefusedCollaborators: sem recusa não escreve", async () => {
  const db = createSupabaseQueryMock();
  await recordRefusedCollaborators(db as never, 7, undefined);
  assertEquals(db.calls.length, 0);
});
