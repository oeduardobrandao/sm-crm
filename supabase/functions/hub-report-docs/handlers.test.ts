import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { docHandler, HubReportListItem, listHandler, printDocHandler } from "./handlers.ts";
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
    for (const m of ["select", "eq"]) c[m] = () => chain(result);
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
