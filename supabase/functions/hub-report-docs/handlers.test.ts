import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { docHandler, HubReportListItem, listHandler, printDocHandler } from "./handlers.ts";
import { signImageBlocks } from "./sign-images.ts";
import { signPrintToken } from "../_shared/report-docs/print-token.ts";
import type { HubToken } from "../_shared/hub-token.ts";

const SECRET = "test-secret";

// Fake db para listHandler: from(tabela) devolve uma chain thenable que
// resolve para { data: rows[tabela] } em qualquer ponto (select/eq
// encadeados). A query real filtra client_id/conta_id/status="ready" no
// banco -- aqui simulamos o resultado JÁ filtrado, como o Postgres devolveria.
function makeListDb(rows: { analytics_reports?: unknown[]; report_documents?: unknown[] }) {
  // deno-lint-ignore no-explicit-any
  const chain = (result: unknown): any => {
    const c: Record<string, unknown> = {};
    // "order" entrou junto com o pin de ordenação do banco (period_start
    // desc, created_at desc) em listHandler -- o fake é argument-blind
    // (não simula ORDER BY de verdade), então só precisa aceitar a chamada
    // e devolver a mesma chain, como já faz para select/eq.
    for (const m of ["select", "eq", "order"]) c[m] = () => chain(result);
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result }).then(resolve);
    return c;
  };
  return {
    from: (table: string) => chain(rows[table as keyof typeof rows] ?? []),
    // deno-lint-ignore no-explicit-any
  } as any;
}

// Fake db para docHandler/printDocHandler: from("report_documents") só
// atende o caminho select().eq("id", docId).maybeSingle() usado por
// loadReadyDoc. `row` já representa o registro completo (incluindo
// client_id/conta_id/status) que o Postgres devolveria para aquele id.
function makeDocDb(row: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table !== "report_documents") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
      };
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const hubToken: HubToken = { cliente_id: 7, conta_id: "ws", is_active: true };

// --- listHandler ---------------------------------------------------------

Deno.test("uniao: 1 legado ready + 2 docs ready => 3 itens ordenados por month desc", async () => {
  const db = makeListDb({
    analytics_reports: [
      {
        report_month: "2026-06",
        status: "ready",
        generated_at: "2026-06-05T00:00:00Z",
        storage_path: "p.pdf",
        html_storage_path: "p.html",
      },
    ],
    report_documents: [
      { id: "doc-1", title: "Julho", period_start: "2026-07-01", created_at: "2026-07-02T00:00:00Z" },
      { id: "doc-2", title: "Maio", period_start: "2026-05-01", created_at: "2026-05-02T00:00:00Z" },
    ],
  });

  const items = await listHandler(db, hubToken);

  assertEquals(items.length, 3);
  assertEquals(
    items.map((i: HubReportListItem) => i.month),
    ["2026-07", "2026-06", "2026-05"],
  );
  assertEquals(items[0], {
    kind: "doc",
    id: "doc-1",
    title: "Julho",
    month: "2026-07",
    generated_at: "2026-07-02T00:00:00Z",
  });
  assertEquals(items[1], {
    kind: "legacy",
    month: "2026-06",
    status: "ready",
    generated_at: "2026-06-05T00:00:00Z",
    has_pdf: true,
    has_html: true,
  });
  assertEquals(items[2].kind, "doc");
});

// Achado 4: dois docs do MESMO mês não tinham nenhuma ordem garantida entre
// si -- a ordem dependia da ordem física de retorno do Postgres. A query
// agora pina .order("period_start", {ascending:false}).order("created_at",
// {ascending:false}) do lado do banco (ver handlers.ts). O fake acima é
// argument-blind (não simula ORDER BY de verdade, só aceita a chamada e
// devolve as linhas como foram alimentadas) -- então este teste alimenta as
// linhas JÁ na ordem que o Postgres devolveria com esse ORDER BY (created_at
// mais recente primeiro) e prova que listHandler não embaralha esse
// desempate: o .sort() por mês (Array.prototype.sort, estável desde ES2019)
// preserva a ordem relativa entre itens do mesmo mês.
Deno.test("dois docs do mesmo mes: a ordem entre eles vem do banco (pin period_start/created_at desc), listHandler preserva", async () => {
  const db = makeListDb({
    analytics_reports: [],
    report_documents: [
      {
        id: "doc-new",
        title: "Julho v2",
        period_start: "2026-07-15",
        created_at: "2026-07-20T00:00:00Z",
      },
      {
        id: "doc-old",
        title: "Julho v1",
        period_start: "2026-07-01",
        created_at: "2026-07-02T00:00:00Z",
      },
    ],
  });

  const items = await listHandler(db, hubToken);

  assertEquals(
    items.map((i: HubReportListItem) => (i as { id: string }).id),
    ["doc-new", "doc-old"],
  );
});

Deno.test("docs nao-ready ficam de fora (query ja filtra status=ready)", async () => {
  // A query real aplica .eq("status", "ready"); o fake representa o
  // resultado ja filtrado -- so o doc "ready" aparece na lista devolvida
  // pelo banco, e listHandler nao deve reintroduzir nada alem disso.
  const db = makeListDb({
    analytics_reports: [],
    report_documents: [
      { id: "doc-1", title: "Julho", period_start: "2026-07-01", created_at: "2026-07-02T00:00:00Z" },
    ],
  });

  const items = await listHandler(db, hubToken);

  assertEquals(items.length, 1);
  assertEquals(items[0].kind, "doc");
});

// --- docHandler ------------------------------------------------------------

Deno.test("doc do cliente do token: retorna payload com layout e data_snapshot", async () => {
  const db = makeDocDb({
    id: "doc-1",
    title: "Julho",
    layout: { blocks: [] },
    data_snapshot: { kpis: {} },
    period_start: "2026-07-01",
    client_id: 7,
    conta_id: "ws",
    status: "ready",
  });

  const payload = await docHandler(db, hubToken, "doc-1");

  assertEquals(payload, {
    id: "doc-1",
    title: "Julho",
    layout: { blocks: [] },
    data_snapshot: { kpis: {} },
    period_start: "2026-07-01",
  });
});

Deno.test("doc de OUTRO cliente do MESMO workspace: null (spec 9 - cadeia inteira)", async () => {
  const db = makeDocDb({
    id: "doc-1",
    title: "Julho",
    layout: {},
    data_snapshot: {},
    period_start: "2026-07-01",
    client_id: 99, // != hubToken.cliente_id
    conta_id: "ws", // mesmo workspace
    status: "ready",
  });

  assertEquals(await docHandler(db, hubToken, "doc-1"), null);
});

Deno.test("doc de outro workspace: null", async () => {
  const db = makeDocDb({
    id: "doc-1",
    title: "Julho",
    layout: {},
    data_snapshot: {},
    period_start: "2026-07-01",
    client_id: 7,
    conta_id: "OUTRA",
    status: "ready",
  });

  assertEquals(await docHandler(db, hubToken, "doc-1"), null);
});

// --- printDocHandler ---------------------------------------------------------

Deno.test("token HMAC valido para o docId: payload", async () => {
  const db = makeDocDb({
    id: "doc-1",
    title: "Julho",
    layout: { blocks: [] },
    data_snapshot: { kpis: {} },
    period_start: "2026-07-01",
    client_id: 7,
    conta_id: "ws",
    status: "ready",
  });
  const pt = await signPrintToken("doc-1", 2_000_000, SECRET);

  const payload = await printDocHandler(db, SECRET, "doc-1", pt, 1_000_000);

  assertEquals(payload, {
    id: "doc-1",
    title: "Julho",
    layout: { blocks: [] },
    data_snapshot: { kpis: {} },
    period_start: "2026-07-01",
  });
});

Deno.test("token expirado ou de outro docId: null (payload nunca sai)", async () => {
  const db = makeDocDb({
    id: "doc-1",
    title: "Julho",
    layout: {},
    data_snapshot: {},
    period_start: "2026-07-01",
    client_id: 7,
    conta_id: "ws",
    status: "ready",
  });

  const expired = await signPrintToken("doc-1", 1_000_000, SECRET);
  assertEquals(await printDocHandler(db, SECRET, "doc-1", expired, 1_000_000), null);

  const otherDoc = await signPrintToken("doc-2", 2_000_000, SECRET);
  assertEquals(await printDocHandler(db, SECRET, "doc-1", otherDoc, 1_000_000), null);
});

Deno.test("doc nao-ready: null mesmo com token valido", async () => {
  const db = makeDocDb({
    id: "doc-1",
    title: "Julho",
    layout: {},
    data_snapshot: {},
    period_start: "2026-07-01",
    client_id: 7,
    conta_id: "ws",
    status: "draft",
  });
  const pt = await signPrintToken("doc-1", 2_000_000, SECRET);

  assert((await printDocHandler(db, SECRET, "doc-1", pt, 1_000_000)) === null);
});

function makeLinksDb(
  links: Array<{ file_id: number; files: { r2_key: string; media_lost_at: string | null } }>,
  error: { message: string } | null = null,
) {
  const calls: string[] = [];
  return {
    calls,
    db: {
      from: (table: string) => {
        calls.push(table);
        return {
          select: () => ({ eq: () => Promise.resolve({ data: error ? null : links, error }) }),
        };
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

const imgLayout = (blocks: unknown[]) => ({ version: 1, blocks });
const imgBlock = (id: string, config: Record<string, unknown>) => ({
  id,
  type: "image",
  size: "full",
  config,
});

Deno.test("signImageBlocks: assina só arquivos vinculados e não perdidos, chave vem de files", async () => {
  const { db } = makeLinksDb([
    { file_id: 1, files: { r2_key: "contas/ws/files/a.png", media_lost_at: null } },
    {
      file_id: 2,
      files: { r2_key: "contas/ws/files/b.png", media_lost_at: "2026-08-01T00:00:00Z" },
    },
  ]);
  const out = (await signImageBlocks(
    db,
    "doc-1",
    imgLayout([
      imgBlock("i1", { file_id: 1, width: 10, height: 10 }),
      imgBlock("i2", { file_id: 2, width: 10, height: 10 }),
      imgBlock("i3", { file_id: 3, width: 10, height: 10 }),
      { id: "t", type: "text", size: "full" },
    ]),
    async (k) => `https://signed/${k}`,
  )) as { blocks: Array<{ config?: Record<string, unknown> }> };
  assertEquals(out.blocks[0].config?.src, "https://signed/contas/ws/files/a.png");
  assertEquals(out.blocks[1].config?.src, undefined);
  assertEquals(out.blocks[2].config?.src, undefined);
});

Deno.test("signImageBlocks: remove src salvo mesmo sem signer", async () => {
  const { db, calls } = makeLinksDb([]);
  const out = (await signImageBlocks(
    db,
    "doc-1",
    imgLayout([imgBlock("i1", { src: "https://evil", file_id: 1, width: 1, height: 1 })]),
    undefined,
  )) as { blocks: Array<{ config?: Record<string, unknown> }> };
  assertEquals(out.blocks[0].config?.src, undefined);
  assertEquals(calls.length, 0);
});

Deno.test("signImageBlocks: layout sem imagem não consulta o banco", async () => {
  const { db, calls } = makeLinksDb([]);
  const lay = imgLayout([{ id: "t", type: "text", size: "full" }]);
  assertEquals(await signImageBlocks(db, "doc-1", lay, async () => "x"), lay);
  assertEquals(calls.length, 0);
});

Deno.test("signImageBlocks: falha do signer deixa o bloco sem src", async () => {
  const { db } = makeLinksDb([
    { file_id: 1, files: { r2_key: "contas/ws/files/a.png", media_lost_at: null } },
  ]);
  const out = (await signImageBlocks(
    db,
    "doc-1",
    imgLayout([imgBlock("i1", { file_id: 1, width: 10, height: 10 })]),
    async () => null,
  )) as { blocks: Array<{ config?: Record<string, unknown> }> };
  assertEquals(out.blocks[0].config?.src, undefined);
});

function captureConsoleError() {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  return { calls, restore: () => (console.error = original) };
}

Deno.test("signImageBlocks: signer que rejeita loga e deixa o bloco sem src", async () => {
  const { db } = makeLinksDb([
    { file_id: 1, files: { r2_key: "contas/ws/files/a.png", media_lost_at: null } },
  ]);
  const cap = captureConsoleError();
  try {
    const out = (await signImageBlocks(
      db,
      "doc-1",
      imgLayout([imgBlock("i1", { file_id: 1, width: 10, height: 10 })]),
      () => Promise.reject(new Error("r2 down")),
    )) as { blocks: Array<{ config?: Record<string, unknown> }> };
    assertEquals(out.blocks[0].config?.src, undefined);
    assertEquals(out.blocks[0].config?.file_id, 1);
  } finally {
    cap.restore();
  }
  assertEquals(cap.calls.length, 1);
  assertEquals(cap.calls[0][0], "[hub-report-docs] sign-images: sign failed");
  // A chave do R2 nunca vai para o log.
  assert(!JSON.stringify(cap.calls).includes("contas/ws/files/a.png"));
});

Deno.test("signImageBlocks: erro na consulta de vínculos loga e nenhum bloco ganha src", async () => {
  const { db } = makeLinksDb([], { message: "boom" });
  const cap = captureConsoleError();
  let signed = 0;
  try {
    const out = (await signImageBlocks(
      db,
      "doc-1",
      imgLayout([imgBlock("i1", { file_id: 1, width: 10, height: 10 })]),
      async () => {
        signed++;
        return "https://signed/x";
      },
    )) as { blocks: Array<{ config?: Record<string, unknown> }> };
    assertEquals(out.blocks[0].config?.src, undefined);
  } finally {
    cap.restore();
  }
  assertEquals(signed, 0);
  assertEquals(cap.calls.length, 1);
  assertEquals(cap.calls[0][0], "[hub-report-docs] sign-images: link query failed");
});
