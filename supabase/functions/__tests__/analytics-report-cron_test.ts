import { assert, assertEquals } from "./assert.ts";
import { queueMonthlyReports } from "../analytics-report-cron/queue.ts";

interface StubOpts {
  accounts: Array<{ id: string; client_id: number }> | null;
  accountsError?: { message: string } | null;
  clientes?: Record<number, { conta_id: string; include_ai_analysis: boolean } | undefined>;
  upsertError?: { message: string } | null;
}

function makeSupabaseStub(opts: StubOpts) {
  const calls = {
    notArgs: null as unknown[] | null,
    upserts: [] as Array<{ row: Record<string, unknown>; options: Record<string, unknown> }>,
  };

  const client = {
    from(table: string) {
      if (table === "instagram_accounts") {
        return {
          select(_cols: string) {
            return {
              not(col: string, op: string, val: unknown) {
                calls.notArgs = [col, op, val];
                return Promise.resolve({
                  data: opts.accounts,
                  error: opts.accountsError ?? null,
                });
              },
            };
          },
        };
      }
      if (table === "clientes") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, id: number) {
                return {
                  single() {
                    return Promise.resolve({ data: opts.clientes?.[id] ?? null, error: null });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "analytics_reports") {
        return {
          upsert(row: Record<string, unknown>, options: Record<string, unknown>) {
            calls.upserts.push({ row, options });
            return Promise.resolve({ error: opts.upsertError ?? null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { client, calls };
}

function makeFetchStub(status = 200) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response("{}", { status }));
  }) as typeof fetch;
  return { fetchFn, requests };
}

const BASE_DEPS = {
  supabaseUrl: "https://project.supabase.co",
  anonKey: "anon-key",
  cronSecret: "cron-secret",
  now: new Date(2026, 8, 1), // 2026-09-01 -> relatório de 2026-08
};

Deno.test("filtra contas pela coluna real de token (encrypted_access_token, não access_token_enc)", async () => {
  const { client, calls } = makeSupabaseStub({
    accounts: [{ id: "acc-1", client_id: 7 }],
    clientes: { 7: { conta_id: "ws-1", include_ai_analysis: true } },
  });
  const { fetchFn } = makeFetchStub();

  await queueMonthlyReports({ ...BASE_DEPS, supabase: client, fetchFn });

  assertEquals(calls.notArgs, ["encrypted_access_token", "is", null]);
});

Deno.test("enfileira o mês anterior e chama o report-worker com x-cron-secret", async () => {
  const { client, calls } = makeSupabaseStub({
    accounts: [
      { id: "acc-1", client_id: 7 },
      { id: "acc-2", client_id: 8 },
    ],
    clientes: {
      7: { conta_id: "ws-1", include_ai_analysis: true },
      8: { conta_id: "ws-1", include_ai_analysis: false },
    },
  });
  const { fetchFn, requests } = makeFetchStub();

  const result = await queueMonthlyReports({ ...BASE_DEPS, supabase: client, fetchFn });

  assert(result.kind === "done");
  assertEquals(result.month, "2026-08");
  assertEquals(result.queued, 2);
  assertEquals(result.total, 2);
  assertEquals(calls.upserts.length, 2);
  assertEquals(calls.upserts[0].row.report_month, "2026-08");

  assertEquals(requests.length, 1);
  assert(requests[0].url.endsWith("/functions/v1/report-worker"));
  const headers = requests[0].init.headers as Record<string, string>;
  assertEquals(headers["x-cron-secret"], "cron-secret");
  assertEquals(headers["X-Internal-Token"], undefined);
});

Deno.test("não chama o worker quando nada foi enfileirado", async () => {
  const { client } = makeSupabaseStub({
    accounts: [{ id: "acc-1", client_id: 7 }],
    clientes: {}, // cliente não encontrado -> skipped
  });
  const { fetchFn, requests } = makeFetchStub();

  const result = await queueMonthlyReports({ ...BASE_DEPS, supabase: client, fetchFn });

  assert(result.kind === "done");
  assertEquals(result.queued, 0);
  assertEquals(result.skipped, 1);
  assertEquals(requests.length, 0);
});

Deno.test("sem contas conectadas retorna 'empty' sem chamar o worker", async () => {
  const { client } = makeSupabaseStub({ accounts: [] });
  const { fetchFn, requests } = makeFetchStub();

  const result = await queueMonthlyReports({ ...BASE_DEPS, supabase: client, fetchFn });

  assertEquals(result.kind, "empty");
  assertEquals(requests.length, 0);
});

Deno.test("erro no upsert conta como failed e não derruba as demais contas", async () => {
  const { client } = makeSupabaseStub({
    accounts: [
      { id: "acc-1", client_id: 7 },
      { id: "acc-2", client_id: 8 },
    ],
    clientes: {
      7: { conta_id: "ws-1", include_ai_analysis: true },
      8: { conta_id: "ws-1", include_ai_analysis: true },
    },
    upsertError: { message: "boom" },
  });
  const { fetchFn, requests } = makeFetchStub();

  const result = await queueMonthlyReports({ ...BASE_DEPS, supabase: client, fetchFn });

  assert(result.kind === "done");
  assertEquals(result.failed, 2);
  assertEquals(result.queued, 0);
  assertEquals(requests.length, 0);
});
